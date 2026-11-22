<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import CardFooter from '#lib/components/ui/card/card-footer.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import type {
		Activity,
		PendingSubmissionFile,
		SubmissionListItem,
		SubmissionMemberRef,
		Template
	} from '#lib/domain/types.js';
	import { parseMoodleFileName, resolveRosterMatch, submissionStudentName } from '#lib/domain/roster.js';
	import { needsMetadataCompletion } from '#lib/domain/metadata.js';
	import { runConcurrently } from '#lib/domain/pool.js';
	import DropdownMenu from '#lib/components/ui/dropdown-menu/dropdown-menu.svelte';
	import { MoreHorizontal } from '@lucide/svelte';

	/** How many files are processed at the same time in one batch. */
	const PROCESS_CONCURRENCY = 3;

	/**
	 * Longest delivery label shown in the table. Moodle exports carry the whole
	 * header in the file name, so an unbounded name stretches the column and
	 * pushes the grade out of view. The full name stays in the tooltip.
	 */
	const DELIVERY_LABEL_MAX = 28;

	function shortDeliveryLabel(value: string): string {
		if (value.length <= DELIVERY_LABEL_MAX) return value;
		return `${value.slice(0, DELIVERY_LABEL_MAX - 1)}…`;
	}

	interface Props {
		data: { activity: Activity; rubric: Template | null };
	}

	let { data }: Props = $props();
	const activity = $derived(data.activity);
	/** Rubric of the activity, read-only here: it is edited in the template screen. */
	const rubric = $derived(data.rubric);
	const rubricTotal = $derived(
		rubric ? rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0) : 0
	);

	// Submission table state
	let submissions = $state<SubmissionListItem[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let saving = $state<Record<string, boolean>>({});
	let metadataLoading = $state<Record<string, boolean>>({});
	let metadataNotice = $state<Record<string, { text: string; error: boolean }>>({});
	/** Applied-but-unsaved suggestion per row: extraction never writes on its own. */
	let metadataPending = $state<Record<string, boolean>>({});

	// Files extracted from the deliveries ZIP, before the teacher processes them
	let pendingFiles = $state<PendingSubmissionFile[]>([]);
	let pendingLoading = $state(true);
	// Multi-select only builds the processing queue; it never links the files.
	let selectedFiles = $state<Record<string, boolean>>({});
	let processingIds = $state<Record<string, boolean>>({});
	let queue = $state({ running: false, total: 0, done: 0 });
	let fileErrors = $state<Record<string, string>>({});
	let retryingFile = $state<Record<string, boolean>>({});
	let queueNotice = $state<{ text: string; error: boolean } | null>(null);

	const selectedFileIds = $derived(
		pendingFiles.filter((entry) => selectedFiles[entry.fileId]).map((entry) => entry.fileId)
	);

	const queueProgress = $derived(
		queue.total === 0 ? 0 : Math.round((queue.done / queue.total) * 100)
	);

	// Grading state. A grade is persisted by the server, so the table is always
	// the source of truth: after a grade the list is reloaded instead of patched.
	let grading = $state<Record<string, boolean>>({});
	let gradeErrors = $state<Record<string, string>>({});
	/** Which detail panel is open for a delivery: grades, members or roster link. */
	type PanelKind = 'grades' | 'members' | 'link';
	let panel = $state<Record<string, PanelKind | undefined>>({});
	let gradeQueue = $state({ running: false, total: 0, done: 0 });
	let gradeNotice = $state<{ text: string; error: boolean } | null>(null);

	// Bulk metadata pass: fills the title, the printed name and the roster link
	// on every delivery that still has a gap, with bounded concurrency.
	let metadataQueue = $state({ running: false, total: 0, done: 0 });
	let metadataBulkNotice = $state<{ text: string; error: boolean } | null>(null);
	/**
	 * Deliveries the pass already read and found nothing in. They stay out of the
	 * count until the page is reloaded: re-reading the same header costs a model
	 * call and cannot produce a different answer.
	 */
	let metadataExhausted = $state<Record<string, boolean>>({});
	/** Roster of the activity's subject, loaded once for every row. */
	let activityRoster = $state<{ id: string; name: string; matchKey: string }[]>([]);
	let rosterLoaded = false;
	let rosterLoad: Promise<void> | null = null;
	// Confirmation dialog for the bulk pass: it costs one model call per
	// delivery, so the teacher sees what will happen before it starts.
	let showMetadataDialog = $state(false);
	let metadataConfirmButton = $state<HTMLButtonElement | null>(null);

	function openMetadataDialog() {
		if (metadataQueue.running || metadataCandidates.length === 0) return;
		showMetadataDialog = true;
		// The dialog opens over the table: move focus to its main action so the
		// keyboard never stays on the trigger behind the overlay.
		tick().then(() => metadataConfirmButton?.focus());
	}

	function closeMetadataDialog() {
		showMetadataDialog = false;
	}

	/** Escape closes the dialog; the listener is always mounted and checks the flag. */
	function handleMetadataDialogKey(event: KeyboardEvent) {
		if (showMetadataDialog && event.key === 'Escape') closeMetadataDialog();
	}

	/** One panel at a time per delivery; pressing the same action again closes it. */
	function togglePanel(submissionId: string, kind: PanelKind) {
		panel[submissionId] = panel[submissionId] === kind ? undefined : kind;
	}

	/** Deliveries that can be graded right now: text extracted and no grade yet. */
	const pendingGradingIds = $derived(
		submissions
			.filter((entry) => entry.status !== 'graded' && entry.files[0]?.extraction === 'ok')
			.map((entry) => entry.id)
	);

	const gradeQueueProgress = $derived(
		gradeQueue.total === 0 ? 0 : Math.round((gradeQueue.done / gradeQueue.total) * 100)
	);

	/**
	 * Deliveries the bulk pass can actually help: text extracted, and a gap the
	 * header is able to close (no title, no printed name, or no roster link while
	 * a roster exists). A delivery the pass already found nothing in is skipped,
	 * so pressing the button twice never re-reads the same document.
	 */
	const metadataCandidates = $derived(
		submissions
			.filter(
				(entry) =>
					entry.files[0]?.extraction === 'ok' &&
					!metadataExhausted[entry.id] &&
					needsMetadataCompletion({
						title: entry.title,
						studentName: entry.studentName,
						studentId: entry.studentId,
						rosterSize: activityRoster.length
					})
			)
			.map((entry) => entry.id)
	);

	const metadataQueueProgress = $derived(
		metadataQueue.total === 0 ? 0 : Math.round((metadataQueue.done / metadataQueue.total) * 100)
	);

	/**
	 * Grades one delivery with the rubric of the activity.
	 *
	 * The request carries no prompt material: the server reads the extracted
	 * text, the contexts and the rubric, then stores the grade. A failure leaves
	 * the previous grade untouched.
	 */
	async function gradeOne(submissionId: string) {
		if (grading[submissionId]) return;
		grading[submissionId] = true;
		delete gradeErrors[submissionId];
		try {
			const res = await fetch(`/api/submissions/${submissionId}/grade`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo calificar la entrega');
			await loadSubmissions();
			panel[submissionId] = 'grades';
		} catch (e) {
			gradeErrors[submissionId] = e instanceof Error ? e.message : 'Error calificando la entrega';
		} finally {
			delete grading[submissionId];
		}
	}

	/** Grades every delivery that has text and no grade, bounded like file processing. */
	async function gradePending() {
		if (gradeQueue.running || pendingGradingIds.length === 0) return;
		const ids = [...pendingGradingIds];

		gradeQueue = { running: true, total: ids.length, done: 0 };
		gradeErrors = {};
		gradeNotice = null;

		const failures = await runConcurrently(ids, PROCESS_CONCURRENCY, async (id) => {
			grading[id] = true;
			try {
				const res = await fetch(`/api/submissions/${id}/grade`, { method: 'POST' });
				const data = await res.json();
				if (!res.ok) throw new Error(data.error || 'No se pudo calificar la entrega');
			} finally {
				delete grading[id];
				gradeQueue.done++;
			}
		});

		for (const failure of failures) {
			gradeErrors[failure.item] =
				failure.error instanceof Error ? failure.error.message : 'Error calificando la entrega';
		}

		gradeQueue.running = false;
		await loadSubmissions();

		const graded = ids.length - failures.length;
		gradeNotice = {
			text:
				failures.length === 0
					? `${graded} entrega(s) calificadas.`
					: `Calificadas ${graded} de ${ids.length}. Revisá los errores en la tabla.`,
			error: failures.length > 0
		};
	}

	// Per-row edit state
	type RowEdit = {
		studentId: string | null;
		title: string;
		/** Name printed in the header, saved only when the teacher confirms it. */
		detectedName: string | null;
		members: { studentId?: string | null; name: string; isAuthor: boolean }[];
		roster: { id: string; name: string; matchKey: string }[];
	};
	let rowEdits = $state<Record<string, RowEdit>>({});

	async function loadSubmissions() {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/activities/${activity.id}/submissions`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las entregas');
			submissions = data.submissions ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Error cargando entregas';
		} finally {
			loading = false;
		}
	}

	/** Files of the ZIP that do not belong to a delivery yet. */
	async function loadPendingFiles() {
		pendingLoading = true;
		try {
			const res = await fetch(`/api/activities/${activity.id}/pending-files`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los archivos pendientes');
			pendingFiles = data.files ?? [];
			// A file that stopped being pending must not stay selected.
			const present = new Set(pendingFiles.map((entry) => entry.fileId));
			selectedFiles = Object.fromEntries(
				Object.entries(selectedFiles).filter(([id, on]) => on && present.has(id))
			);
		} catch {
			pendingFiles = [];
		} finally {
			pendingLoading = false;
		}
	}

	/**
	 * Processes the given files with bounded concurrency.
	 *
	 * Every file becomes its own individual delivery with its own extracted
	 * text: the selection is a batch, never a group. Each file is one request,
	 * at most PROCESS_CONCURRENCY are in flight, and a failure on one file is
	 * reported on its row without cancelling the rest.
	 */
	async function processFiles(fileIds: string[]) {
		if (queue.running || fileIds.length === 0) return;

		queue = { running: true, total: fileIds.length, done: 0 };
		fileErrors = {};
		processingIds = {};
		queueNotice = null;
		let metadataFailures = 0;

		const failures = await runConcurrently(fileIds, PROCESS_CONCURRENCY, async (fileId) => {
			processingIds[fileId] = true;
			try {
				const res = await fetch(`/api/activities/${activity.id}/files/${fileId}/process`, {
					method: 'POST'
				});
				const data = await res.json();
				if (!res.ok) throw new Error(data.error || 'No se pudo procesar el archivo');
				if (data.metadata?.error) metadataFailures++;
				pendingFiles = pendingFiles.filter((entry) => entry.fileId !== fileId);
				delete selectedFiles[fileId];
			} finally {
				delete processingIds[fileId];
				queue.done++;
			}
		});

		for (const failure of failures) {
			fileErrors[failure.item] =
				failure.error instanceof Error ? failure.error.message : 'Error procesando el archivo';
		}

		queue.running = false;
		await Promise.all([loadSubmissions(), loadPendingFiles()]);

		const processed = fileIds.length - failures.length;
		const metadataNote =
			metadataFailures > 0
				? ` ${metadataFailures} sin datos de encabezado: usá "Completar datos".`
				: '';
		queueNotice = {
			text:
				failures.length === 0
					? `${processed} archivo(s) procesados.${metadataNote}`
					: `Procesados ${processed} de ${fileIds.length}. Revisá los que fallaron.${metadataNote}`,
			error: failures.length > 0
		};
	}

	/** Retries the text of a file that already belongs to a delivery. */
	async function retryFileText(fileId: string) {
		if (retryingFile[fileId]) return;
		retryingFile[fileId] = true;
		try {
			const res = await fetch(`/api/activities/${activity.id}/files/${fileId}/process`, {
				method: 'POST'
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo procesar el archivo');
			await Promise.all([loadSubmissions(), loadPendingFiles()]);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error procesando el archivo');
		} finally {
			retryingFile[fileId] = false;
		}
	}

	function toggleAllPending() {
		selectedFiles =
			selectedFileIds.length === pendingFiles.length
				? {}
				: Object.fromEntries(pendingFiles.map((entry) => [entry.fileId, true]));
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	/**
	 * Roster of the activity's subject. It is the same list for every row, so it
	 * is fetched once: the bulk pass needs its size to know whether an unlinked
	 * delivery is a real gap, and every row panel reuses it.
	 */
	async function loadActivityRoster(): Promise<{ id: string; name: string; matchKey: string }[]> {
		if (!activity.subjectId) return [];
		if (rosterLoaded) return activityRoster;
		// Every row asks for the same list: one request, and a failure leaves the
		// flag unset so a later call retries instead of caching the empty answer.
		if (!rosterLoad) {
			rosterLoad = (async () => {
				try {
					const res = await fetch(`/api/subjects/${activity.subjectId}/students`);
					const data = await res.json();
					if (!res.ok) throw new Error(data.error || 'No se pudo cargar el padrón');
					activityRoster = data.students ?? [];
					rosterLoaded = true;
				} catch {
					activityRoster = [];
				}
			})().finally(() => {
				rosterLoad = null;
			});
		}
		await rosterLoad;
		return activityRoster;
	}

	function getInitialRowEdit(submission: SubmissionListItem): RowEdit {
		// The title is never derived from the file name: a Moodle export names the
		// file after the student, so pre-filling it here showed the author as the
		// work's title and also blocked the header suggestion, which only fills an
		// empty title. The student name is only what the server verified (roster
		// match) or what the header printed; a file name is a hint, not a person.
		return {
			studentId: submission.studentId ?? null,
			title: submission.title ?? '',
			// Only a name the system can defend: a linked student answers for the
			// identity, and an unlinked row keeps the printed header name, never
			// the file-name echo of older rows.
			detectedName: submission.studentId ? null : submissionStudentName(submission),
			members: submission.members.length > 0
				? submission.members.map((m) => ({ studentId: m.studentId ?? undefined, name: m.name, isAuthor: m.isAuthor }))
				: submission.studentId
					? [
							{
								studentId: submission.studentId,
								name: submission.studentRosterName ?? submission.studentName ?? '',
								isAuthor: true
							}
						]
					: [],
			roster: []
		};
	}

	async function ensureRowEdit(submission: SubmissionListItem) {
		if (rowEdits[submission.id]) return;
		const roster = await loadActivityRoster();
		rowEdits[submission.id] = {
			...getInitialRowEdit(submission),
			roster: roster.map((s) => ({ id: s.id, name: s.name, matchKey: s.matchKey }))
		};
	}

	async function saveStudentLink(submissionId: string) {
		const edit = rowEdits[submissionId];
		if (!edit) return;
		saving[submissionId] = true;
		try {
			const res = await fetch(`/api/submissions/${submissionId}/student`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ studentId: edit.studentId })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo vincular');
			await loadSubmissions();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error guardando vinculación');
		} finally {
			saving[submissionId] = false;
		}
	}

	async function clearStudentLink(submissionId: string) {
		const edit = rowEdits[submissionId];
		if (!edit) return;
		edit.studentId = null;
		await saveStudentLink(submissionId);
	}

	async function saveTitle(submission: SubmissionListItem) {
		const edit = rowEdits[submission.id];
		if (!edit) return;
		// The input saves on every blur: skip the request when nothing changed.
		const next = edit.title || null;
		if (next === (submission.title ?? null)) return;

		saving[submission.id] = true;
		try {
			const res = await fetch(`/api/submissions/${submission.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: next })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo guardar el título');
			await loadSubmissions();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error guardando título');
		} finally {
			saving[submission.id] = false;
		}
	}

	async function saveMembers(submissionId: string) {
		const edit = rowEdits[submissionId];
		if (!edit) return;
		saving[submissionId] = true;
		try {
			const res = await fetch(`/api/submissions/${submissionId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ members: edit.members })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo guardar los integrantes');
			await loadSubmissions();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error guardando integrantes');
		} finally {
			saving[submissionId] = false;
		}
	}

	function addMember(submissionId: string) {
		const edit = rowEdits[submissionId];
		if (!edit) return;
		edit.members = [...edit.members, { name: '', isAuthor: edit.members.length === 0 }];
	}

	/** Whether the main document has text the metadata pass can read. */
	function hasExtractedText(submission: SubmissionListItem): boolean {
		return submission.files[0]?.extraction === 'ok';
	}

	/**
	 * Asks the server to read the header with the model and applies the result
	 * without overwriting anything the teacher already set. Nothing is written
	 * here: the applied suggestion stays pending until the teacher saves it.
	 */
	async function extractMetadata(submission: SubmissionListItem) {
		const edit = rowEdits[submission.id];
		if (!edit) return;

		metadataLoading[submission.id] = true;
		delete metadataNotice[submission.id];
		delete metadataPending[submission.id];
		try {
			const res = await fetch(`/api/submissions/${submission.id}/metadata`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudieron extraer los metadatos');

			const metadata = data.metadata as {
				name: string | null;
				members: string[];
				title: string | null;
			};
			const applied: string[] = [];

			if (data.source === 'cache') {
				applied.push('sugerencia guardada');
			}

			if (metadata.title && !edit.title.trim()) {
				edit.title = metadata.title;
				applied.push('título');
			}

			// The header is the printed evidence, but a cover page without a name
			// must not throw away the other signals: the name detected when the
			// delivery was created and the one the file name carries.
			const modelAuthor = metadata.name ?? metadata.members[0] ?? null;
			const fileName = submission.files[0]?.fileName ?? '';
			const candidates: { name: string; fromHeader: boolean }[] = [];
			if (modelAuthor) candidates.push({ name: modelAuthor, fromHeader: true });
			if (submission.studentName) candidates.push({ name: submission.studentName, fromHeader: false });
			const parsedFileName = fileName ? parseMoodleFileName(fileName)?.name : null;
			if (parsedFileName) candidates.push({ name: parsedFileName, fromHeader: false });

			if (!edit.studentId) {
				for (const candidate of candidates) {
					const match = resolveRosterMatch(candidate.name, edit.roster);
					if (!match) continue;
					edit.studentId = match.studentId;
					applied.push(
						candidate.fromHeader
							? 'estudiante del padrón'
							: 'estudiante del padrón (por el nombre del archivo)'
					);
					break;
				}
			}

			const hasMembers = edit.members.some((member) => member.name.trim());
			if (modelAuthor && !hasMembers) {
				const names = metadata.name ? [metadata.name, ...metadata.members] : metadata.members;
				edit.members = names.map((name, index) => ({ name, isAuthor: index === 0 }));
				// A group header is worth opening so the teacher sees every member.
				if (names.length > 1) panel[submission.id] = 'members';
				applied.push(names.length > 1 ? 'integrantes' : 'autor');
			}

			// The printed name is worth keeping even when it is not in the roster:
			// it is the evidence the teacher needs to link the delivery by hand.
			if (modelAuthor && !edit.detectedName) {
				edit.detectedName = modelAuthor;
				applied.push('nombre impreso');
			}

			const unsaved =
				edit.title.trim() !== (submission.title ?? '') ||
				edit.studentId !== submission.studentId ||
				(edit.detectedName ?? '') !== (submission.studentName ?? '');
			if (unsaved) metadataPending[submission.id] = true;

			metadataNotice[submission.id] = {
				text:
					applied.length > 0
						? `Sugerido: ${applied.join(', ')}.`
						: 'El encabezado no tenía datos utilizables.',
				error: false
			};
		} catch (e) {
			metadataNotice[submission.id] = {
				text: e instanceof Error ? e.message : 'Error extrayendo metadatos',
				error: true
			};
		} finally {
			metadataLoading[submission.id] = false;
		}
	}

	/**
	 * Persists what the header pass applied to the row: the confirmed title and,
	 * when the detected author matched the roster, the roster link. This is the
	 * explicit save the extraction deliberately does not do by itself.
	 */
	async function saveAppliedMetadata(submission: SubmissionListItem) {
		const edit = rowEdits[submission.id];
		if (!edit || saving[submission.id]) return;

		saving[submission.id] = true;
		try {
			const requests: Promise<Response>[] = [];
			const nextTitle = edit.title.trim() || null;
			if (nextTitle !== (submission.title ?? null)) {
				requests.push(
					fetch(`/api/submissions/${submission.id}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ title: nextTitle })
					})
				);
			}
			if ((edit.detectedName ?? '') !== (submission.studentName ?? '')) {
				requests.push(
					fetch(`/api/submissions/${submission.id}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ studentName: edit.detectedName?.trim() || null })
					})
				);
			}
			if (edit.studentId !== submission.studentId) {
				requests.push(
					fetch(`/api/submissions/${submission.id}/student`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ studentId: edit.studentId })
					})
				);
			}

			const responses = await Promise.all(requests);
			for (const res of responses) {
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(data.error || 'No se pudo guardar la sugerencia');
				}
			}

			delete metadataPending[submission.id];
			await loadSubmissions();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Error guardando la sugerencia');
		} finally {
			saving[submission.id] = false;
		}
	}

	/**
	 * Runs the header pass over every delivery with a gap and writes the result.
	 *
	 * This is the fallback for rows whose automatic pass after processing failed
	 * (a scanned file, a model hiccup): the server extracts or reuses the stored
	 * suggestion and fills only the empty fields, never a value the teacher set.
	 */
	async function completeAllMetadata() {
		if (metadataQueue.running || metadataCandidates.length === 0) {
			closeMetadataDialog();
			return;
		}
		const ids = [...metadataCandidates];
		closeMetadataDialog();

		metadataQueue = { running: true, total: ids.length, done: 0 };
		metadataBulkNotice = null;
		let withoutData = 0;

		const failures = await runConcurrently(ids, PROCESS_CONCURRENCY, async (id) => {
			try {
				const res = await fetch(`/api/submissions/${id}/metadata`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ apply: true })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(data.error || 'No se pudieron leer los metadatos');

				// `applied` lists what the pass actually wrote. Empty means the header
				// had nothing usable: the row says so and drops out of the queue, so
				// the count stops promising work the model cannot do.
				const applied: string[] = Array.isArray(data.applied) ? data.applied : [];
				if (applied.length === 0) {
					withoutData += 1;
					metadataExhausted[id] = true;
					metadataNotice[id] = {
						text: 'El encabezado no tenía datos utilizables.',
						error: false
					};
				} else {
					delete metadataExhausted[id];
					delete metadataNotice[id];
				}
			} finally {
				metadataQueue.done++;
			}
		});

		for (const failure of failures) {
			metadataNotice[failure.item] = {
				text: failure.error instanceof Error ? failure.error.message : 'Error leyendo metadatos',
				error: true
			};
		}

		metadataQueue.running = false;
		await loadSubmissions();

		const completed = ids.length - failures.length - withoutData;
		const parts = [`${completed} entrega(s) completada(s)`];
		if (withoutData > 0) parts.push(`${withoutData} sin datos en el encabezado`);
		if (failures.length > 0) parts.push(`${failures.length} con error`);

		metadataBulkNotice = {
			text: `${parts.join(', ')}.${failures.length > 0 ? ' Revisá los errores en la tabla.' : ''}`,
			error: failures.length > 0
		};
	}

	function removeMember(submissionId: string, index: number) {
		const edit = rowEdits[submissionId];
		if (!edit) return;
		edit.members = edit.members.filter((_, i) => i !== index);
	}

	/** Deletes the delivery and refreshes both tables; a failure stays on its row. */
	async function removeSubmission(submission: SubmissionListItem) {
		const who = submission.studentRosterName ?? submission.studentName ?? 'esta entrega';
		if (!confirm(`¿Eliminar la entrega de ${who}? Esta acción no se puede deshacer.`)) return;

		try {
			const res = await fetch(`/api/submissions/${submission.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || 'No se pudo eliminar la entrega');
			}
			delete panel[submission.id];
			await Promise.all([loadSubmissions(), loadPendingFiles()]);
		} catch (e) {
			gradeErrors[submission.id] = e instanceof Error ? e.message : 'Error eliminando la entrega';
		}
	}

	/**
	 * Menu of one delivery. Built per row so every item reflects the current
	 * state: grading needs extracted text, linking needs a roster, and the
	 * destructive action only appears at the end.
	 */
	function rowActions(submission: SubmissionListItem) {
		type RowAction = { label: string; action: () => void; disabled?: boolean; destructive?: boolean };
		const items: RowAction[] = [];
		const canRead = hasExtractedText(submission);

		if (rubric) {
			items.push({
				label: submission.grades.length > 0 ? 'Recalificar' : 'Calificar',
				action: () => gradeOne(submission.id),
				disabled: !canRead || Boolean(grading[submission.id])
			});
		}

		items.push({
			label: 'Leer metadatos',
			action: () => extractMetadata(submission),
			disabled: !canRead || Boolean(metadataLoading[submission.id])
		});

		items.push({
			label: 'Integrantes',
			action: () => togglePanel(submission.id, 'members')
		});

		items.push({
			label: submission.studentId ? 'Cambiar estudiante del padrón' : 'Asignar al padrón',
			action: () => togglePanel(submission.id, 'link'),
			disabled: !activity.subjectId
		});

		if (submission.grades.length > 0) {
			items.push({
				label: 'Ver detalle de la nota',
				action: () => togglePanel(submission.id, 'grades')
			});
		}

		if (submission.studentId) {
			items.push({
				label: 'Desvincular del padrón',
				action: () => clearStudentLink(submission.id),
				disabled: Boolean(saving[submission.id])
			});
		}

		items.push({
			label: 'Eliminar entrega',
			action: () => removeSubmission(submission),
			destructive: true,
			disabled: Boolean(saving[submission.id])
		});

		return items;
	}

	function getStatusBadge(status: string) {
		const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
			pending: 'secondary',
			processing: 'default',
			graded: 'default',
			error: 'destructive'
		};
		const labels: Record<string, string> = {
			pending: 'Pendiente',
			processing: 'Procesando',
			graded: 'Calificada',
			error: 'Error'
		};
		return { variant: variants[status] ?? 'outline', label: labels[status] ?? status };
	}

	function getFileBadge(mime: string) {
		if (mime === 'application/pdf') return { label: 'PDF', variant: 'default' as const };
		if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
			return { label: 'DOCX', variant: 'secondary' as const };
		return { label: mime, variant: 'outline' as const };
	}

	onMount(() => {
		loadSubmissions();
		loadPendingFiles();
		// The bulk pass needs the roster size to know what it can fill.
		loadActivityRoster();
	});
</script>

<svelte:head>
	<title>Revisar entregas — {activity.title} — RevisIA</title>
</svelte:head>

<svelte:window onkeydown={handleMetadataDialogKey} />

<div class="space-y-6">
	<div class="flex items-center justify-between flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Revisar entregas</h1>
			<p class="text-sm text-muted-foreground">
				{activity.title} — {submissions.length} entregas{#if pendingFiles.length > 0} · {pendingFiles.length} pendientes{/if}
			</p>
		</div>
		<div class="flex gap-2 items-center flex-wrap">
			{#if metadataCandidates.length > 0}
				<Button
					variant="outline"
					onclick={openMetadataDialog}
					disabled={metadataQueue.running}
					title="Lee el encabezado de cada entrega y completa título, estudiante y vínculo con el padrón"
				>
					{metadataQueue.running
						? `Completando ${metadataQueue.done}/${metadataQueue.total}…`
						: `Completar datos (${metadataCandidates.length})`}
				</Button>
			{/if}
			{#if rubric && pendingGradingIds.length > 0}
				<Button onclick={gradePending} disabled={gradeQueue.running}>
					{gradeQueue.running
						? `Calificando ${gradeQueue.done}/${gradeQueue.total}…`
						: `Calificar pendientes (${pendingGradingIds.length})`}
				</Button>
			{/if}
			{#if rubric}
				<Button variant="outline" href={`/api/activities/${activity.id}/export`} title="Descargar las notas de la actividad en Excel">
					Exportar a Excel
				</Button>
			{/if}
			<Button variant="outline" onclick={() => goto(`/actividades/${activity.id}`)}>
				Editar actividad
			</Button>
			<Button variant="outline" onclick={() => goto('/')}>Volver</Button>
		</div>
	</div>

	{#if gradeQueue.running}
		<div class="space-y-1">
			<p class="text-xs text-muted-foreground">
				Calificando de a {Math.min(PROCESS_CONCURRENCY, gradeQueue.total)} — {gradeQueue.done} de {gradeQueue.total} listas…
			</p>
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full bg-primary transition-all" style={`width: ${gradeQueueProgress}%`}></div>
			</div>
		</div>
	{/if}
	{#if gradeNotice}
		<p class="text-xs {gradeNotice.error ? 'text-destructive' : 'text-muted-foreground'}">{gradeNotice.text}</p>
	{/if}

	{#if metadataQueue.running}
		<div class="space-y-1">
			<p class="text-xs text-muted-foreground">
				Leyendo encabezados — {metadataQueue.done} de {metadataQueue.total}…
			</p>
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full bg-primary transition-all" style={`width: ${metadataQueueProgress}%`}></div>
			</div>
		</div>
	{/if}
	{#if metadataBulkNotice}
		<p class="text-xs {metadataBulkNotice.error ? 'text-destructive' : 'text-muted-foreground'}">{metadataBulkNotice.text}</p>
	{/if}

	{#if rubric}
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between flex-wrap gap-2">
					<div>
						<CardTitle>Rúbrica</CardTitle>
						<CardDescription>
							{rubric.name} · {rubric.criteria.length} criterios · {rubricTotal} pts en total
						</CardDescription>
					</div>
					<Button variant="outline" size="sm" onclick={() => goto(`/rubricas/${rubric.id}`)}>
						Editar rúbrica
					</Button>
				</div>
			</CardHeader>
			<CardContent class="space-y-3">
				{#each rubric.criteria as criterion, index}
					<div class="rounded-md border border-border p-3">
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-sm font-medium">{index + 1}. {criterion.name}</p>
							<p class="text-xs text-muted-foreground shrink-0">
								{criterion.maxPoints} pts · peso {criterion.weight}
							</p>
						</div>
						{#if criterion.description}
							<p class="text-xs text-muted-foreground mt-1">{criterion.description}</p>
						{/if}
						{#if criterion.levels.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each criterion.levels as level}
									<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">
										{level.label} · {level.points} pts
									</span>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</CardContent>
		</Card>
	{:else}
		<Card class="border-dashed">
			<CardHeader>
				<CardTitle>Sin rúbrica</CardTitle>
				<CardDescription>
					Esta actividad no tiene una rúbrica asignada, así que todavía no se puede calificar.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button variant="outline" onclick={() => goto(`/actividades/${activity.id}`)}>
					Asignar rúbrica
				</Button>
			</CardContent>
		</Card>
	{/if}

	{#if !pendingLoading && pendingFiles.length > 0}
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between flex-wrap gap-2">
					<div>
						<CardTitle>Archivos pendientes de procesar</CardTitle>
						<CardDescription>
							{pendingFiles.length} archivo(s) del ZIP sin entrega. Cada archivo se procesa por
							separado: crea su propia entrega individual y extrae su texto. La selección solo
							arma el lote; no los vincula entre sí.
						</CardDescription>
					</div>
					<div class="flex items-center gap-2 flex-wrap">
						<Button variant="outline" size="sm" onclick={toggleAllPending} disabled={queue.running}>
							{selectedFileIds.length === pendingFiles.length ? 'Quitar selección' : 'Seleccionar todos'}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => processFiles(selectedFileIds)}
							disabled={queue.running || selectedFileIds.length === 0}
						>
							Procesar seleccionados ({selectedFileIds.length})
						</Button>
						<Button
							size="sm"
							onclick={() => processFiles(pendingFiles.map((entry) => entry.fileId))}
							disabled={queue.running || pendingFiles.length === 0}
						>
							Procesar todos ({pendingFiles.length})
						</Button>
					</div>
				</div>
				{#if queue.running}
					<div class="mt-3 space-y-1">
						<p class="text-xs text-muted-foreground">
							Procesando de a {Math.min(PROCESS_CONCURRENCY, queue.total)} — {queue.done} de {queue.total} listos…
						</p>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div class="h-full bg-primary transition-all" style={`width: ${queueProgress}%`}></div>
						</div>
					</div>
				{/if}
			</CardHeader>
			<CardContent class="p-0">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="bg-muted/50">
							<tr class="border-b border-border">
								<th class="px-4 py-3 w-10"></th>
								<th class="px-4 py-3 text-left font-medium">Archivo</th>
								<th class="px-4 py-3 text-left font-medium">Tipo</th>
								<th class="px-4 py-3 text-left font-medium">Texto</th>
								<th class="px-4 py-3 text-right font-medium">Tamaño</th>
								<th class="px-4 py-3 text-right font-medium">Acción</th>
							</tr>
						</thead>
						<tbody>
							{#each pendingFiles as pending (pending.fileId)}
								<tr class="border-b border-border/50 hover:bg-muted/30">
									<td class="px-4 py-3">
										<input
											type="checkbox"
											bind:checked={selectedFiles[pending.fileId]}
											disabled={queue.running}
											aria-label={`Seleccionar ${pending.fileName}`}
										/>
									</td>
									<td class="px-4 py-3">
										<span class="block truncate max-w-md">{pending.fileName}</span>
										<code class="text-xs text-muted-foreground break-all">{pending.sha256.slice(0, 16)}…</code>
										{#if fileErrors[pending.fileId]}
											<p class="mt-1 text-xs text-destructive">{fileErrors[pending.fileId]}</p>
										{/if}
									</td>
									<td class="px-4 py-3">
										<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
											{getFileBadge(pending.mime).label}
										</span>
									</td>
									<td class="px-4 py-3">
										{#if pending.extraction === 'ok'}
											<span class="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs">{pending.extractedChars} chars</span>
										{:else if pending.extraction === 'pending'}
											<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">Sin procesar</span>
										{:else if pending.extraction === 'empty'}
											<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">Sin texto</span>
										{:else}
											<span class="inline-flex items-center rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs">Error</span>
										{/if}
									</td>
									<td class="px-4 py-3 text-right text-muted-foreground">{formatSize(pending.sizeBytes)}</td>
									<td class="px-4 py-3 text-right">
										<Button
											variant="outline"
											size="sm"
											onclick={() => processFiles([pending.fileId])}
											disabled={queue.running}
										>
											{processingIds[pending.fileId] ? 'Procesando…' : 'Procesar'}
										</Button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if queueNotice}
					<p class="px-4 py-3 text-xs {queueNotice.error ? 'text-destructive' : 'text-muted-foreground'}">
						{queueNotice.text}
					</p>
				{/if}
			</CardContent>
		</Card>
	{/if}

	{#if loading}
		<div class="flex justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
		</div>
	{:else if error}
		<Card class="border-destructive">
			<CardContent class="text-destructive">{error}</CardContent>
		</Card>
	{:else if submissions.length === 0}
		<Card>
			<CardContent class="py-12 text-center text-muted-foreground">
				{#if pendingFiles.length > 0}
					Todavía no hay entregas. Procesá los archivos pendientes de arriba para crear las entregas.
				{:else}
					No hay entregas para esta actividad.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardContent class="p-0">
				<div class="overflow-x-auto lg:overflow-x-visible">
					<table class="grades-table w-full text-sm">
						<thead class="bg-muted/50">
							<tr class="border-b border-border">
								<th scope="col" class="px-4 py-3 text-left font-medium">Entrega</th>
								<th scope="col" class="px-4 py-3 text-left font-medium">Estudiante</th>
								<th scope="col" class="w-32 px-4 py-3 text-left font-medium">Estado</th>
								<th scope="col" class="w-40 px-4 py-3 text-left font-medium">Nota</th>
								<th scope="col" class="w-16 px-4 py-3 text-right font-medium">
									<span class="sr-only">Acciones</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each submissions as submission (submission.id)}
								{#await ensureRowEdit(submission)}
									<tr>
										<td class="px-4 py-3" colspan="5">
											<div class="flex justify-center py-4">
												<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
											</div>
										</td>
									</tr>
								{:then _}
									<tr class="border-b border-border/50 align-top hover:bg-muted/30">
										<td class="px-4 py-3">
											<div class="space-y-1.5">
												{#each submission.files as file}
													<div class="flex items-center gap-2 min-w-0">
														<span class="inline-flex h-6 shrink-0 items-center rounded-full bg-primary/10 px-2.5 text-[11px] font-medium leading-none text-primary">
															{getFileBadge(file.mime).label}
														</span>
														<span class="min-w-0 flex-1 truncate text-sm leading-5" title={file.fileName}>{shortDeliveryLabel(file.fileName)}</span>
														{#if file.extraction === 'empty'}
															<span class="inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] leading-none text-muted-foreground">Sin texto</span>
														{:else if file.extraction === 'failed'}
															<span class="inline-flex h-6 shrink-0 items-center rounded-full bg-destructive/10 px-2.5 text-[11px] leading-none text-destructive">Error</span>
														{:else if file.extraction === 'ok'}
															<span class="inline-flex h-6 shrink-0 items-center rounded-full bg-secondary px-2.5 text-[11px] leading-none text-secondary-foreground">{file.extractedChars} chars</span>
														{/if}
														{#if file.extraction !== 'ok'}
															<button
																type="button"
																class="shrink-0 text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
																disabled={retryingFile[file.fileId] || queue.running}
																onclick={() => retryFileText(file.fileId)}
															>
																{retryingFile[file.fileId] ? 'Procesando…' : 'Procesar'}
															</button>
														{/if}
													</div>
												{/each}
												{#if submission.sha256}
													<code class="block text-[11px] leading-4 text-muted-foreground">{submission.sha256.slice(0, 16)}…</code>
												{/if}
											</div>
										</td>
										<td class="px-4 py-3">
											<div class="flex items-center gap-2 flex-wrap">
												<span class="font-medium leading-5">
													{submissionStudentName(submission) ?? 'Sin identificar'}
												</span>
												{#if submission.kind === 'group'}
													<span class="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-[11px] leading-none text-secondary-foreground">Grupo</span>
												{/if}
												{#if submission.studentRosterName}
													<span
														class="inline-flex h-6 items-center rounded-full border border-green-600/40 px-2.5 text-[11px] leading-none text-green-700 dark:text-green-300"
														title="Vinculada a un estudiante del padrón: ese nombre se usa en la retroalimentación"
													>
														Padrón
													</span>
												{:else if submissionStudentName(submission)}
													<span
														class="inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] leading-none text-muted-foreground"
														title="Nombre leído del encabezado; no coincide con el padrón"
													>
														Encabezado
													</span>
												{:else}
													<span class="text-[11px] leading-4 text-muted-foreground">Sin vincular al padrón</span>
												{/if}
											</div>
											{#if submission.files[0] && !submissionStudentName(submission)}
												<code class="block mt-0.5 text-[11px] leading-4 text-muted-foreground">
													archivo: {shortDeliveryLabel(parseMoodleFileName(submission.files[0].fileName)?.name ?? '—')}
												</code>
											{/if}
											<input
												bind:value={rowEdits[submission.id].title}
												placeholder="Título de la entrega (opcional)"
												class="mt-1.5 w-full rounded border border-transparent bg-transparent px-2 py-1 text-xs text-foreground/80 transition-colors placeholder:text-muted-foreground/60 hover:border-input focus:border-input focus:bg-background focus:text-foreground focus:outline-none"
												onblur={() => saveTitle(submission)}
											/>
											{#if metadataNotice[submission.id]}
												<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
													<p
														class="text-[11px] leading-4 {metadataNotice[submission.id].error
															? 'text-destructive'
															: 'text-muted-foreground'}"
													>
														{metadataNotice[submission.id].text}
													</p>
													{#if metadataPending[submission.id]}
														<button
															type="button"
															class="text-[11px] leading-4 underline underline-offset-2 text-foreground hover:text-primary disabled:opacity-50"
															disabled={Boolean(saving[submission.id])}
															onclick={() => saveAppliedMetadata(submission)}
														>
															{saving[submission.id] ? 'Guardando…' : 'Guardar sugerencia'}
														</button>
													{/if}
												</div>
											{/if}
										</td>
										<td class="px-4 py-3 whitespace-nowrap">
											<span class="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium leading-none {submission.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}">
												{getStatusBadge(submission.status).label}
											</span>
										</td>
										<td class="px-4 py-3 whitespace-nowrap">
											{#if submission.grades.length > 0}
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium tabular-nums">
														{submission.totalPoints?.toFixed(2) ?? '0'} / {submission.maxPoints ?? '—'}
													</span>
													<button
														type="button"
														class="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
														onclick={() => togglePanel(submission.id, 'grades')}
													>
														{panel[submission.id] === 'grades' ? 'Ocultar' : 'Detalle'}
													</button>
												</div>
											{:else}
												<span class="text-sm text-muted-foreground">—</span>
											{/if}
											{#if gradeErrors[submission.id]}
												<p class="mt-1 whitespace-normal text-xs text-destructive">{gradeErrors[submission.id]}</p>
											{/if}
										</td>
										<td class="px-4 py-3 text-right whitespace-nowrap">
											<DropdownMenu items={rowActions(submission)} align="end" class="row-menu">
												{#snippet trigger({ open, disabled }: { open: boolean; disabled: boolean })}
													<Button
														variant={open ? 'secondary' : 'outline'}
														size="icon-sm"
														{disabled}
														aria-haspopup="menu"
														aria-expanded={open}
														aria-label={`Acciones de la entrega ${submission.files[0]?.fileName ?? ''}`}
														title={grading[submission.id] ? 'Calificando…' : 'Acciones de esta entrega'}
													>
														{#if grading[submission.id]}
															<span class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
														{:else}
															<MoreHorizontal class="size-4" />
														{/if}
													</Button>
												{/snippet}
											</DropdownMenu>
										</td>
									</tr>
								{:catch err}
									<tr>
										<td class="px-4 py-3 text-destructive" colspan="5">Error cargando fila: {err.message}</td>
									</tr>
								{/await}

								{#if panel[submission.id] === 'grades' && submission.grades.length > 0}
									<tr class="border-b border-border/50 bg-muted/20">
										<td colspan="5" class="px-4 py-3">
											<div class="rounded-md border border-border/60 bg-background">
												<div class="divide-y divide-border/60">
													{#each submission.grades as criterionGrade}
														<div class="flex items-baseline justify-between gap-4 px-4 py-2.5">
															<div class="min-w-0">
																<p class="text-sm font-medium leading-5">{criterionGrade.criterionName}</p>
																{#if criterionGrade.feedback}
																	<p class="mt-0.5 text-xs leading-5 text-muted-foreground">{criterionGrade.feedback}</p>
																{/if}
															</div>
															<span class="shrink-0 text-xs tabular-nums text-muted-foreground">
																{criterionGrade.points} / {criterionGrade.maxPoints}
															</span>
														</div>
													{/each}
												</div>
												{#if submission.gradingSummary}
													<p class="border-t border-border/60 px-4 py-2.5 text-sm leading-6 text-muted-foreground">
														<span class="font-medium text-foreground">Resumen:</span>
														{submission.gradingSummary}
													</p>
												{/if}
											</div>
										</td>
									</tr>
								{/if}

								{#if panel[submission.id] === 'members'}
									<tr class="border-b border-border/50 bg-muted/20">
										<td colspan="5" class="px-4 py-3">
											<div class="space-y-3 rounded-md border border-border/60 bg-background p-4">
												<p class="text-xs leading-5 text-muted-foreground">
													Integrantes del trabajo{#if submission.kind === 'group'} (grupal){/if}. Marcá el
													autor principal; los demás son coautores.
												</p>
												{#if rowEdits[submission.id].members.length === 0}
													<p class="text-xs text-muted-foreground">Sin integrantes cargados.</p>
												{/if}
												<div class="space-y-2">
													{#each rowEdits[submission.id].members as member, index}
														<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto_auto] sm:items-center">
															<input
																bind:value={member.name}
																placeholder="Nombre"
																class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
															/>
															<select
																bind:value={member.studentId}
																class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
															>
																<option value="">— Sin vincular —</option>
																{#each rowEdits[submission.id].roster as s}
																	<option value={s.id}>{s.name}</option>
																{/each}
															</select>
															<label class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
																<input type="checkbox" bind:checked={member.isAuthor} />
																Autor
															</label>
															<Button variant="ghost" size="sm" onclick={() => removeMember(submission.id, index)}>
																Quitar
															</Button>
														</div>
													{/each}
												</div>
												<div class="flex flex-wrap gap-2 border-t border-border/60 pt-3">
													<Button variant="outline" size="sm" onclick={() => addMember(submission.id)}>
														+ Agregar integrante
													</Button>
													<Button size="sm" onclick={() => saveMembers(submission.id)} disabled={saving[submission.id]}>
														{saving[submission.id] ? 'Guardando…' : 'Guardar integrantes'}
													</Button>
												</div>
											</div>
										</td>
									</tr>
								{/if}

								{#if panel[submission.id] === 'link'}
									<tr class="border-b border-border/50 bg-muted/20">
										<td colspan="5" class="px-4 py-3">
											<div class="space-y-3 rounded-md border border-border/60 bg-background p-4">
												<p class="text-xs leading-5 text-muted-foreground">
													Estudiante del padrón de la asignatura. Su nombre es el que se usa en la
													retroalimentación y en la nota exportada; el vínculo se guarda al elegir.
												</p>
												<div class="flex flex-wrap items-center gap-2">
													<select
														bind:value={rowEdits[submission.id].studentId}
														onchange={() => saveStudentLink(submission.id)}
														class="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
													>
														<option value="">— Sin vincular —</option>
														{#each rowEdits[submission.id].roster as s}
															<option value={s.id}>{s.name}</option>
														{/each}
													</select>
													{#if rowEdits[submission.id].studentId}
														<Button
															variant="ghost"
															size="sm"
															onclick={() => clearStudentLink(submission.id)}
															disabled={saving[submission.id]}
														>
															Quitar vínculo
														</Button>
													{/if}
												</div>
												{#if rowEdits[submission.id].roster.length === 0}
													<p class="text-xs text-muted-foreground">
														El padrón está vacío. Cargá estudiantes en la asignatura para poder vincular.
													</p>
												{/if}
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>

{#if showMetadataDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			class="absolute inset-0 bg-black/50"
			aria-label="Cerrar"
			onclick={closeMetadataDialog}
		></button>
		<Card
			class="relative w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="metadata-dialog-title"
			aria-describedby="metadata-dialog-description"
		>
			<CardHeader>
				<CardTitle id="metadata-dialog-title">Completar datos de las entregas</CardTitle>
				<p id="metadata-dialog-description" class="text-sm text-muted-foreground">
					Se leerá el encabezado de {metadataCandidates.length} entrega(s) con el modelo de IA
					para completar título, nombre del estudiante y vínculo con el padrón.
					<span class="block mt-1">
						Solo se completa lo que está vacío: lo que ya cargaste no se modifica. Las
						entregas sin texto extraído se omiten.
					</span>
				</p>
			</CardHeader>
			<CardFooter class="flex justify-end gap-2">
				<Button variant="ghost" onclick={closeMetadataDialog}>Cancelar</Button>
				<Button bind:ref={metadataConfirmButton} onclick={completeAllMetadata} disabled={metadataQueue.running}>
					{metadataQueue.running ? 'Completando…' : 'Completar datos'}
				</Button>
			</CardFooter>
		</Card>
	</div>
{/if}

<style>
	/* The actions menu lives in the last column: anchor it to the right edge so
	   it opens inward instead of overflowing the card. */
	:global(.row-menu [role='menu']) {
		right: 0;
		left: auto;
		min-width: 220px;
	}

	/* The card already draws the bottom edge: a trailing row border doubles it. */
	:global(.grades-table tbody tr:last-child) {
		border-bottom-width: 0;
	}
</style>