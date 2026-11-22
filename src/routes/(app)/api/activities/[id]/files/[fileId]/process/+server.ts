import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { createSubmission, getFileProcessingState } from '#lib/server/repositories/submission.js';
import { processUploadedFile } from '#lib/server/file-extraction.js';
import { applySubmissionMetadata } from '#lib/server/metadata-extraction.js';

/**
 * POST /api/activities/[id]/files/[fileId]/process
 *
 * Processes ONE file of the activity:
 *
 * - a pending file becomes its own individual delivery (one file, one
 *   delivery) and its text is extracted;
 * - a file that already backs a live delivery is only re-extracted, which makes
 *   this the retry path after a failed or empty extraction.
 *
 * The review screen drives one call per file, in sequence, so a large ZIP can
 * be processed in a single order without relating the deliveries to each other
 * and without one slow request holding the whole batch.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Actividad inválida' }, { status: 400 });
	if (!isUuid(params.fileId)) return json({ error: 'Archivo inválido' }, { status: 400 });

	const state = await getFileProcessingState(locals.user.id, params.id, params.fileId);
	if (!state) {
		return json({ error: 'El archivo no pertenece a esta actividad' }, { status: 404 });
	}

	let submission = state.status === 'linked' ? state.submission : null;

	if (state.status === 'pending') {
		try {
			const created = await createSubmission(locals.user.id, {
				activityId: params.id,
				files: [{ fileId: params.fileId }],
				source: 'zip'
			});
			submission = created.submission;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'No se pudo crear la entrega';
			return json({ error: message }, { status: 409 });
		}
	}

	let extractionResult;
	try {
		extractionResult = await processUploadedFile(params.fileId);
	} catch (error) {
		console.error('[files/process]', error);
		const message = error instanceof Error ? error.message : 'No se pudo extraer el texto';
		return json({ ok: false, error: message, submission, extraction: 'failed' }, { status: 500 });
	}

	const extraction = extractionResult.success
		? (extractionResult.hasTextLayer ? 'ok' : 'empty')
		: 'failed';

	if (!extractionResult.success) {
		return json(
			{
				ok: false,
				error: extractionResult.error ?? 'No se pudo extraer el texto',
				submission,
				extraction
			},
			{ status: 502 }
		);
	}

	// The header pass runs by itself once the text exists: the title and the
	// student's name are the whole point of processing the file, and making the
	// teacher press a second button per row was the complaint that created this
	// path. A metadata failure never fails the processing: it is reported and
	// the bulk button in the review table can retry it later.
	let metadata: { applied: string[]; error?: string } | null = null;
	if (submission) {
		try {
			const applied = await applySubmissionMetadata(locals.user.id, submission.id);
			metadata = { applied: applied.applied };
		} catch (error) {
			console.warn('[files/process] metadata', error);
			metadata = {
				applied: [],
				error: error instanceof Error ? error.message : 'No se pudieron leer los metadatos'
			};
		}
	}

	return json({
		ok: true,
		submission,
		extraction,
		chars: extractionResult.text.length,
		pages: extractionResult.pages,
		metadata
	});
};
