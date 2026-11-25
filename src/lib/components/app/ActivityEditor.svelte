<script lang="ts">
	import Card from '#lib/components/ui/card/card.svelte';
	import CardHeader from '#lib/components/ui/card/card-header.svelte';
	import CardTitle from '#lib/components/ui/card/card-title.svelte';
	import CardDescription from '#lib/components/ui/card/card-description.svelte';
	import CardContent from '#lib/components/ui/card/card-content.svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { slugify } from '#lib/domain/types.js';
	import { buildPrompt } from '#lib/domain/prompt.js';
	import type { Activity, ActivityContextBlock, SubjectSummary, Template } from '#lib/domain/types.js';

	interface Props {
		/** `null` creates a new activity; otherwise the editor saves in place. */
		activity: Activity | null;
		subjects: SubjectSummary[];
		rubrics: Template[];
		/** Extracted text of the activity source document, used by the prompt preview. */
		sourceDocument?: string;
	}

	let { activity = null, subjects, rubrics, sourceDocument = '' }: Props = $props();

	const isNew = $derived(activity === null);

	let title = $state(activity?.title ?? '');
	let description = $state(activity?.description ?? '');
	let objectives = $state(activity?.objectives ?? '');
	let instructions = $state(activity?.instructions ?? '');
	let dueAt = $state(
		activity?.dueAt ? new Date(activity.dueAt).toISOString().slice(0, 16) : ''
	);
	let status = $state(activity?.status ?? 'draft');
	let subjectId = $state(activity?.subjectId ?? '');
	let rubricId = $state(activity?.rubricId ?? '');
	let contexts = $state(activity?.contexts.map((c: ActivityContextBlock) => ({ ...c })) ?? []);

	let saving = $state(false);
	// The canonical editor shows "Guardado" once, right after the create redirect.
	let statusMsg = $state<string | null>(page.state?.activityCreated ? 'Guardado' : null);
	let saveError = $state<string | null>(null);

	// Source document upload state
	let sourceFileId = $state(activity?.sourceFileId ?? '');
	let sourceFileStatus = $state<string | null>(activity?.sourceFileId ? 'ready' : null);
	let sourceFileError = $state<string | null>(null);
	let sourceFileExtracting = $state(false);
	let sourceFileExtractedText = $state<string | null>(sourceDocument.trim() ? sourceDocument : null);
	let sourceFileHasTextLayer = $state(sourceDocument.trim().length > 0);
	let sourceFileUploading = $state(false);
	let sourceFileVisionProcessing = $state(false);

	// Submissions ZIP upload state (restored from the activity once a ZIP was processed)
	let submissionsZipFileId = $state(activity?.submissionsZip?.fileId ?? '');
	let submissionsZipStatus = $state<string | null>(activity?.submissionsZip ? 'done' : null);
	let submissionsZipError = $state<string | null>(null);
	let submissionsZipUploading = $state(false);
	let submissionsZipProcessing = $state(false);
	let submissionsZipResult = $state<{ accepted: number; rejected: number; rejectedDetails: any[] } | null>(
		activity?.submissionsZip
			? { accepted: activity.submissionsZip.fileCount, rejected: 0, rejectedDetails: [] }
			: null
	);

	// One-delivery upload state: a single PDF/DOCX that does not need a ZIP.
	let singleFileUploading = $state(false);
	let singleFileError = $state<string | null>(null);
	let singleFileNotice = $state<string | null>(null);

	async function save() {
		saving = true;
		statusMsg = null;
		saveError = null;

		const payload = {
			id: activity?.id,
			title,
			description,
			objectives,
			instructions,
			dueAt: dueAt ? new Date(dueAt).toISOString() : null,
			status,
			subjectId: subjectId || null,
			rubricId: rubricId || null,
			sourceFileId: sourceFileId || null,
			contexts: contexts.map((c: ActivityContextBlock) => ({ tag: c.tag, label: c.label, content: c.content }))
		};

		try {
			const isCreate = isNew;
			const res = await fetch(isCreate ? '/api/activities' : `/api/activities/${activity?.id}`, {
				method: isCreate ? 'POST' : 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ activity: payload })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'No se pudo guardar');

			if (isCreate) {
				const created = data.activity as Activity;
				// Land on the canonical URL; `refreshAll` re-runs the layout load so the
				// sidebar and the root listing pick up the new activity.
				await goto(`/actividades/${created.id}`, {
					state: { activityCreated: Date.now() },
					refreshAll: true
				});
				return;
			}

			activity = data.activity;
			statusMsg = 'Guardado';
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Error desconocido';
		} finally {
			saving = false;
		}
	}

	function addContext() {
		contexts.push({ id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2), tag: 'contexto', label: 'Contexto', content: '' });
	}

	function removeContext(i: number) {
		contexts.splice(i, 1);
	}

	function normalizeTag(e: Event, ctx: typeof contexts[0]) {
		const target = e.currentTarget as HTMLInputElement;
		ctx.tag = slugify(target.value);
	}

	async function uploadSourceFile(file: File) {
		sourceFileUploading = true;
		sourceFileError = null;
		sourceFileStatus = 'uploading';
		try {
			// 1. Get presigned URL
			const signRes = await fetch('/api/uploads/sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileName: file.name,
					contentType: file.type,
					size: file.size,
					context: 'sourceDocument'
				})
			});
			const signData = await signRes.json();
			if (!signRes.ok) throw new Error(signData.error || 'Error obteniendo URL de subida');

			// 2. Upload to R2
			// Use the contentType returned by the server (normalized if needed)
			const contentType = signData.contentType ?? file.type;
			const uploadRes = await fetch(signData.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': contentType },
				body: file
			});
			if (!uploadRes.ok) {
				const details = await uploadRes.text().catch(() => '');
				throw new Error(`Error subiendo archivo a R2 (HTTP ${uploadRes.status})${details ? ': ' + details.slice(0, 100) : ''}`);
			}

			// 3. Confirm upload
			const confirmRes = await fetch('/api/uploads/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: signData.fileId })
			});
			const confirmData = await confirmRes.json();
			if (!confirmRes.ok) throw new Error(confirmData.error || 'Error confirmando subida');

			sourceFileId = signData.fileId;
			sourceFileStatus = 'uploaded';
			return signData.fileId;
		} catch (e) {
			sourceFileError = e instanceof Error ? e.message : 'Error subiendo archivo';
			sourceFileStatus = 'error';
			throw e;
		} finally {
			sourceFileUploading = false;
		}
	}

	async function processSourceFile() {
		if (!sourceFileId) return;
		sourceFileExtracting = true;
		sourceFileError = null;
		sourceFileStatus = 'extracting';
		try {
			const res = await fetch('/api/files/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: sourceFileId })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Error extrayendo texto');

			sourceFileExtractedText = data.text;
			sourceFileHasTextLayer = data.hasTextLayer;
			sourceFileStatus = data.hasTextLayer ? 'ready' : 'empty';
		} catch (e) {
			sourceFileError = e instanceof Error ? e.message : 'Error extrayendo texto';
			sourceFileStatus = 'error';
		} finally {
			sourceFileExtracting = false;
		}
	}

	async function processSourceFileWithVision() {
		if (!sourceFileId) return;
		sourceFileVisionProcessing = true;
		sourceFileError = null;
		sourceFileStatus = 'vision-processing';
		try {
			const res = await fetch('/api/files/process-vision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: sourceFileId })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Error en extracción con visión');

			sourceFileExtractedText = data.text;
			sourceFileHasTextLayer = data.hasTextLayer;
			sourceFileStatus = data.hasTextLayer ? 'ready' : 'empty';
			if (!data.hasTextLayer) {
				sourceFileError = 'La visión no pudo extraer texto legible';
			}
		} catch (e) {
			sourceFileError = e instanceof Error ? e.message : 'Error en extracción con visión';
			sourceFileStatus = 'error';
		} finally {
			sourceFileVisionProcessing = false;
		}
	}

	async function handleFileSelect(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = ''; // reset para permitir mismo archivo

		const allowedTypes = [
			'application/pdf',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'text/plain'
		];
		if (!allowedTypes.includes(file.type)) {
			sourceFileError = `Tipo no permitido: ${file.type}. Usa PDF, DOCX o TXT.`;
			return;
		}
		if (file.size > 25 * 1024 * 1024) {
			sourceFileError = 'Archivo demasiado grande (máx 25 MB)';
			return;
		}

		await uploadSourceFile(file);
		await processSourceFile();
	}

	async function removeSourceFile() {
		sourceFileId = '';
		sourceFileStatus = null;
		sourceFileError = null;
		sourceFileExtractedText = null;
		sourceFileHasTextLayer = false;
		sourceFileVisionProcessing = false;
	}

	async function uploadSubmissionsZip(file: File) {
		submissionsZipUploading = true;
		submissionsZipError = null;
		submissionsZipStatus = 'uploading';
		submissionsZipResult = null;
		try {
			// 1. Get presigned URL
			const signRes = await fetch('/api/uploads/sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileName: file.name,
					contentType: file.type,
					size: file.size,
					context: 'submissionZip'
				})
			});
			const signData = await signRes.json();
			if (!signRes.ok) throw new Error(signData.error || 'Error obteniendo URL de subida');

			// 2. Upload to R2
			// Use the contentType returned by the server (normalized if needed)
			const contentType = signData.contentType ?? file.type;
			const uploadRes = await fetch(signData.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': contentType },
				body: file
			});
			if (!uploadRes.ok) {
				const details = await uploadRes.text().catch(() => '');
				throw new Error(`Error subiendo archivo a R2 (HTTP ${uploadRes.status})${details ? ': ' + details.slice(0, 100) : ''}`);
			}

			// 3. Confirm upload
			const confirmRes = await fetch('/api/uploads/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: signData.fileId })
			});
			const confirmData = await confirmRes.json();
			if (!confirmRes.ok) throw new Error(confirmData.error || 'Error confirmando subida');

			submissionsZipFileId = signData.fileId;
			submissionsZipStatus = 'uploaded';
			return signData.fileId;
		} catch (e) {
			submissionsZipError = e instanceof Error ? e.message : 'Error subiendo archivo';
			submissionsZipStatus = 'error';
			throw e;
		} finally {
			submissionsZipUploading = false;
		}
	}

	async function processSubmissionsZip() {
		if (!submissionsZipFileId) return;
		submissionsZipProcessing = true;
		submissionsZipError = null;
		submissionsZipStatus = 'processing';
		try {
			const res = await fetch('/api/uploads/zip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: submissionsZipFileId, activityId: activity?.id })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Error procesando ZIP');

			const accepted = data.accepted?.length ?? 0;
			const rejected = data.rejected?.length ?? 0;
			submissionsZipResult = { accepted, rejected, rejectedDetails: data.rejected ?? [] };
			submissionsZipStatus = accepted > 0 ? 'done' : 'error';
			if (accepted === 0) {
				submissionsZipError = 'No se aceptaron archivos del ZIP';
			}
		} catch (e) {
			submissionsZipError = e instanceof Error ? e.message : 'Error procesando ZIP';
			submissionsZipStatus = 'error';
		} finally {
			submissionsZipProcessing = false;
		}
	}

	async function resetSubmissionsZip() {
		const previousId = submissionsZipFileId;
		submissionsZipFileId = '';
		submissionsZipStatus = null;
		submissionsZipError = null;
		submissionsZipResult = null;
		// Persist the removal so reloading does not bring the old ZIP back.
		if (previousId && activity?.id) {
			try {
				await fetch(`/api/activities/${activity.id}/zip`, { method: 'DELETE' });
			} catch {
				// Local state is already cleared; the next load will show the truth.
			}
		}
	}

	async function handleSubmissionsZipSelect(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';

		const allowedTypes = ['application/zip', 'application/x-zip-compressed'];
		if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.zip')) {
			submissionsZipError = 'Solo archivos .zip permitidos';
			return;
		}
		if (file.size > 50 * 1024 * 1024) {
			submissionsZipError = 'Archivo demasiado grande (máx 50 MB)';
			return;
		}

		try {
			await uploadSubmissionsZip(file);
			await processSubmissionsZip();
		} catch {
			// `uploadSubmissionsZip` already turned the failure into visible state.
		}
	}

	const SINGLE_LIMIT_BYTES = 25 * 1024 * 1024;
	const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

	/**
	 * Uploads ONE delivery file: sign → PUT → confirm → stage.
	 *
	 * Same four steps the ZIP uses for its archive, except the bytes already are
	 * one delivery, so staging is the whole post-processing. Nothing sent by the
	 * browser is trusted: confirm re-downloads the object, checks the real size
	 * and sniffs the magic bytes before the file can be staged.
	 */
	async function uploadSingleDelivery(file: File) {
		if (!activity?.id) return;
		singleFileUploading = true;
		singleFileError = null;
		singleFileNotice = null;

		try {
			// Some browsers report an empty type for local files; the extension
			// is the only hint left, and the server verifies the bytes anyway.
			const contentType =
				file.type ||
				(file.name.toLowerCase().endsWith('.docx') ? DOCX_MIME : 'application/pdf');

			const signRes = await fetch('/api/uploads/sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileName: file.name,
					contentType,
					size: file.size,
					context: 'submission'
				})
			});
			const signData = await signRes.json();
			if (!signRes.ok) throw new Error(signData.error || 'Error obteniendo URL de subida');

			const uploadRes = await fetch(signData.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': signData.contentType ?? contentType },
				body: file
			});
			if (!uploadRes.ok) throw new Error(`Error subiendo el archivo (HTTP ${uploadRes.status})`);

			const confirmRes = await fetch('/api/uploads/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: signData.fileId })
			});
			const confirmData = await confirmRes.json();
			if (!confirmRes.ok) throw new Error(confirmData.error || 'No se pudo confirmar el archivo');

			const linkRes = await fetch(`/api/activities/${activity.id}/files`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId: signData.fileId })
			});
			const linkData = await linkRes.json();
			if (!linkRes.ok) throw new Error(linkData.error || 'No se pudo agregar el archivo');

			singleFileNotice = `${linkData.file?.fileName ?? file.name} agregado a los archivos pendientes.`;
		} catch (e) {
			singleFileError = e instanceof Error ? e.message : 'Error subiendo la entrega';
		} finally {
			singleFileUploading = false;
		}
	}

	function handleSingleFileSelect(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		singleFileError = null;
		singleFileNotice = null;

		const name = file.name.toLowerCase();
		if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
			singleFileError = 'Solo se aceptan PDF o DOCX';
			return;
		}
		if (file.size > SINGLE_LIMIT_BYTES) {
			singleFileError = 'Archivo demasiado grande (máx 25 MB)';
			return;
		}

		void uploadSingleDelivery(file);
	}

	const selectedRubric = $derived(rubrics.find((r: Template) => r.id === rubricId) ?? null);

	const promptBuild = $derived.by(() => {
		if (!selectedRubric) return null;
		return buildPrompt(
			selectedRubric,
			Object.fromEntries(contexts.map((c: ActivityContextBlock) => [c.tag, c.content])),
			[{ student: 'Estudiante de ejemplo', text: 'Respuesta de ejemplo del estudiante para ver el formato final.' }],
			{
				extras: {
					title,
					description,
					objectives,
					instructions,
					sourceDocument: sourceFileExtractedText ?? ''
				}
			}
		);
	});

	const promptPreview = $derived(
		promptBuild?.prompt ?? 'Seleccioná una rúbrica para ver el prompt que se enviará al modelo.'
	);
	const promptWarnings = $derived(promptBuild?.warnings ?? []);
	const promptTokens = $derived(promptBuild?.estimatedTokens ?? 0);
</script>

<svelte:head>
	<title>{isNew ? 'Nueva actividad — RevisIA' : `${title} — RevisIA`}</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">
				{isNew ? 'Nueva actividad' : 'Editar actividad'}
			</h1>
			<p class="text-sm text-muted-foreground">
				{isNew
					? 'Definí el contexto académico y guardá para empezar a cargar entregas.'
					: 'Define el contexto académico, rúbrica y bloques de referencia.'}
			</p>
		</div>
		<div class="flex gap-2 items-center flex-wrap">
			{#if statusMsg}<span class="text-xs text-muted-foreground">{statusMsg}</span>{/if}
			{#if saveError}<span class="text-xs text-destructive">{saveError}</span>{/if}
			<Button disabled={saving} onclick={save}>
				{saving ? (isNew ? 'Creando…' : 'Guardando…') : isNew ? 'Crear actividad' : 'Guardar'}
			</Button>
			{#if !isNew && rubricId}
				<Button variant="outline" onclick={() => goto(`/revisar/${activity?.id}`)}>
					Calificar
				</Button>
			{/if}
			<Button variant="outline" onclick={() => goto('/')}>Volver</Button>
		</div>
	</div>

	<Card>
		<CardHeader><CardTitle>Datos básicos</CardTitle></CardHeader>
		<CardContent class="space-y-4">
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Título</div>
				<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={title} placeholder="Título de la actividad" />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<div class="text-xs font-medium text-muted-foreground mb-1">Asignatura</div>
					<select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={subjectId}>
						<option value="">— Sin asignar —</option>
						{#each subjects as s}
							<option value={s.id}>{s.name} {s.code ? `(${s.code})` : ''}</option>
						{/each}
					</select>
				</div>
				<div>
					<div class="flex items-baseline justify-between gap-2 mb-1">
						<div class="text-xs font-medium text-muted-foreground">Rúbrica</div>
						<a href="/rubricas" class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
							Gestionar rúbricas
						</a>
					</div>
					<select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rubricId}>
						<option value="">— Sin rúbrica —</option>
						{#each rubrics as r}
							<option value={r.id}>{r.name} ({r.criteria.length} criterios)</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<div class="text-xs font-medium text-muted-foreground mb-1">Fecha de entrega</div>
					<input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="datetime-local" bind:value={dueAt} />
				</div>
				<div>
					<div class="text-xs font-medium text-muted-foreground mb-1">Estado</div>
					<select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={status}>
						<option value="draft">Borrador</option>
						<option value="open">Abierta</option>
						<option value="closed">Cerrada</option>
					</select>
				</div>
			</div>
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Descripción</div>
				<textarea class="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={description} placeholder="Descripción general de la actividad..."></textarea>
			</div>
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Objetivos</div>
				<textarea class="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={objectives} placeholder="Objetivos de aprendizaje..."></textarea>
			</div>
			<div>
				<div class="text-xs font-medium text-muted-foreground mb-1">Instrucciones</div>
				<textarea class="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={instructions} placeholder="Instrucciones para los estudiantes..."></textarea>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Documento fuente</CardTitle>
				{#if !sourceFileId}
					<Button size="sm" variant="outline" onclick={() => document.getElementById('source-file-input')?.click()}>Subir archivo</Button>
				{:else}
					<Button size="sm" variant="ghost" onclick={removeSourceFile}>Quitar</Button>
				{/if}
			</div>
			<CardDescription>PDF, DOCX o TXT (máx 25 MB). El texto extraído se incluye en el prompt como {`<documento_fuente>`}.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if !sourceFileId}
				<div class="border-2 border-dashed border-border rounded-lg p-8 text-center">
					<input
						id="source-file-input"
						type="file"
						accept=".pdf,.docx,.txt"
						class="hidden"
						onchange={handleFileSelect}
						disabled={sourceFileUploading}
					/>
					<p class="text-sm text-muted-foreground mb-4">Arrastra un archivo o haz clic en "Subir archivo"</p>
					<Button variant="outline" onclick={() => document.getElementById('source-file-input')?.click()} disabled={sourceFileUploading}>
						{sourceFileUploading ? 'Subiendo…' : 'Seleccionar archivo'}
					</Button>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="flex items-center justify-between p-3 rounded-md border border-border bg-background">
						<div class="flex items-center gap-3">
							<svg class="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
							<div>
								<p class="font-medium text-sm">{activity?.sourceFileId ? 'Archivo subido' : 'Documento fuente'}</p>
								<p class="text-xs text-muted-foreground">
								{sourceFileStatus === 'ready' ? 'Texto extraído ✓' :
								 sourceFileStatus === 'empty' ? 'Sin capa de texto (posible escaneo)' :
								 sourceFileStatus === 'vision-processing' ? 'Procesando con visión (Gemini)…' :
								 sourceFileStatus === 'extracting' ? 'Extrayendo texto…' :
								 sourceFileStatus === 'uploaded' ? 'Subido, listo para procesar' : 'Error'}
							</p>
							</div>
						</div>
						<div class="flex gap-2">
							{#if sourceFileStatus === 'uploaded' || sourceFileStatus === 'error'}
								<Button size="sm" variant="outline" onclick={processSourceFile} disabled={sourceFileExtracting}>
									{sourceFileExtracting ? 'Procesando…' : 'Procesar'}
								</Button>
							{/if}
							{#if sourceFileStatus === 'empty'}
								<Button size="sm" variant="outline" onclick={processSourceFileWithVision} disabled={sourceFileVisionProcessing}>
									{sourceFileVisionProcessing ? 'Visión…' : 'Re-procesar con visión'}
								</Button>
							{/if}
							{#if sourceFileStatus === 'vision-processing'}
								<Button size="sm" variant="outline" disabled>Procesando con visión…</Button>
							{/if}
							<Button size="sm" variant="ghost" onclick={removeSourceFile}>Eliminar</Button>
						</div>
					</div>
					{#if sourceFileError}
						<p class="text-sm text-destructive">{sourceFileError}</p>
					{/if}
					{#if sourceFileExtractedText && sourceFileHasTextLayer}
						<div>
							<div class="text-xs font-medium text-muted-foreground mb-1">Vista previa del texto extraído (primeros 500 caracteres)</div>
							<pre class="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{sourceFileExtractedText.slice(0, 500)}…</pre>
						</div>
					{:else if sourceFileExtractedText && !sourceFileHasTextLayer}
						<p class="text-sm text-muted-foreground">El archivo no tiene capa de texto extraíble (posible PDF escaneado). Considera usar OCR.</p>
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if isNew}
		<Card>
			<CardHeader>
				<CardTitle>Entregas de estudiantes</CardTitle>
				<CardDescription>
					Guardá la actividad primero para poder subir el ZIP de entregas o una entrega suelta.
				</CardDescription>
			</CardHeader>
		</Card>
	{:else}
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-2">
					<CardTitle>Entregas de estudiantes</CardTitle>
					<div class="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={() => document.getElementById('submissions-zip-input')?.click()}
							disabled={submissionsZipUploading || submissionsZipProcessing}
						>
							{submissionsZipFileId ? 'Agregar otro ZIP' : 'Subir ZIP'}
						</Button>
						{#if submissionsZipFileId}
							<Button size="sm" variant="ghost" onclick={resetSubmissionsZip}>Quitar</Button>
						{/if}
					</div>
				</div>
				<CardDescription>
					ZIP con PDFs/DOCX de las entregas (máx 50 MB), o un PDF/DOCX suelto. Podés subir varios
					ZIPs: cada uno agrega sus archivos a los pendientes para revisión y matching con el padrón.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<input
					id="submissions-zip-input"
					type="file"
					accept=".zip"
					class="hidden"
					onchange={handleSubmissionsZipSelect}
					disabled={submissionsZipUploading}
				/>
				{#if !submissionsZipFileId}
					<div class="border-2 border-dashed border-border rounded-lg p-8 text-center">
						<p class="text-sm text-muted-foreground mb-4">Arrastra un archivo .zip o haz clic en "Subir ZIP"</p>
						<Button variant="outline" onclick={() => document.getElementById('submissions-zip-input')?.click()} disabled={submissionsZipUploading}>
							{submissionsZipUploading ? 'Subiendo…' : 'Seleccionar archivo'}
						</Button>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex items-center justify-between p-3 rounded-md border border-border bg-background">
							<div class="flex items-center gap-3">
								<svg class="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
								</svg>
								<div>
									<p class="font-medium text-sm">Último ZIP de entregas importado</p>
									<p class="text-xs text-muted-foreground">
										{submissionsZipStatus === 'uploading' ? 'Subiendo ZIP…' :
										 submissionsZipStatus === 'uploaded' ? 'Subido, listo para procesar' :
										 submissionsZipStatus === 'processing' ? 'Procesando ZIP…' :
										 submissionsZipStatus === 'done' ? `Completado: ${submissionsZipResult?.accepted ?? 0} aceptados, ${submissionsZipResult?.rejected ?? 0} rechazados` :
										 submissionsZipStatus === 'error' ? 'Error' : 'Estado desconocido'}
									</p>
								</div>
							</div>
							<div class="flex gap-2">
								{#if submissionsZipStatus === 'uploaded' || submissionsZipStatus === 'error'}
									<Button size="sm" variant="outline" onclick={processSubmissionsZip} disabled={submissionsZipProcessing}>
										{submissionsZipProcessing ? 'Procesando…' : 'Procesar'}
									</Button>
								{/if}
								<Button size="sm" variant="ghost" onclick={resetSubmissionsZip}>Eliminar</Button>
							</div>
						</div>
						{#if submissionsZipError}
							<p class="text-sm text-destructive">{submissionsZipError}</p>
						{/if}
						{#if submissionsZipResult && submissionsZipResult.accepted > 0}
							<div class="rounded-md border border-green-500/40 bg-green-500/10 p-3 space-y-1">
								<p class="text-xs text-green-700 dark:text-green-300 font-medium">
									{submissionsZipResult.accepted} archivo(s) listo(s) para revisar
								</p>
								{#if submissionsZipResult.rejected > 0}
									<p class="text-xs text-amber-700 dark:text-amber-300">
										{submissionsZipResult.rejected} archivo(s) rechazados
										{#each submissionsZipResult.rejectedDetails.slice(0, 3) as r}
											<br>• {r.name}: {r.reason}
										{/each}
										{#if submissionsZipResult.rejectedDetails.length > 3}
											<br>• …y {submissionsZipResult.rejectedDetails.length - 3} más
										{/if}
									</p>
								{/if}
								<Button size="sm" variant="outline" class="mt-2" onclick={() => goto(`/revisar/${activity?.id}`)}>
									Ir a revisar entregas
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				<div class="border-t border-border pt-4">
					<div class="flex items-center justify-between flex-wrap gap-2">
						<div>
							<p class="text-sm font-medium">Entrega suelta</p>
							<p class="text-xs text-muted-foreground">
								Un PDF o DOCX de un solo estudiante (máx 25 MB). Se agrega a los archivos
								pendientes, igual que los que salen del ZIP.
							</p>
						</div>
						<input
							id="single-delivery-input"
							type="file"
							accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
							class="hidden"
							onchange={handleSingleFileSelect}
							disabled={singleFileUploading}
						/>
						<Button
							size="sm"
							variant="outline"
							onclick={() => document.getElementById('single-delivery-input')?.click()}
							disabled={singleFileUploading}
						>
							{singleFileUploading ? 'Subiendo…' : 'Subir PDF/DOCX'}
						</Button>
					</div>
					{#if singleFileError}
						<p class="mt-2 text-sm text-destructive">{singleFileError}</p>
					{/if}
					{#if singleFileNotice}
						<p class="mt-2 text-sm text-green-700 dark:text-green-300">
							{singleFileNotice}
							<a class="underline underline-offset-2" href={`/revisar/${activity?.id}`}>
								Ir a revisar
							</a>
						</p>
					{/if}
				</div>
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Bloques de contexto</CardTitle>
				<Button size="sm" variant="outline" onclick={addContext}>+ Agregar</Button>
			</div>
			<CardDescription>Material de referencia compartido. El tag se usa como <code>tag</code> en el prompt.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3">
			{#each contexts as c, i}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
					<input class="sm:col-span-4 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Etiqueta visible" bind:value={c.label} />
					<input class="sm:col-span-4 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" value={c.tag} oninput={(e) => normalizeTag(e, c)} />
					<textarea class="sm:col-span-12 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-16" placeholder="Contenido del bloque (texto base)" bind:value={c.content}></textarea>
					<Button size="sm" variant="ghost" class="sm:col-span-1 self-end" onclick={() => removeContext(i)}>Eliminar</Button>
				</div>
			{/each}
			{#if contexts.length === 0}
				<p class="text-sm text-muted-foreground text-center py-4">Sin bloques de contexto. Agrega uno para incluir material de referencia en el prompt.</p>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between flex-wrap gap-2">
				<CardTitle>Vista previa del prompt</CardTitle>
				<CardDescription>
					~{promptTokens} tokens estimados. La respuesta es un ejemplo: al calificar se envía el
					texto extraído de cada entrega.
				</CardDescription>
			</div>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if promptWarnings.length > 0}
				<div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
					{#each promptWarnings as warning}
						<p class="text-xs text-amber-700 dark:text-amber-300">{warning}</p>
					{/each}
				</div>
			{/if}
			<pre class="max-h-[360px] overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap">{promptPreview}</pre>
		</CardContent>
	</Card>
</div>
