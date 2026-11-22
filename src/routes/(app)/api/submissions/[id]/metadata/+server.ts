import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import {
	applySubmissionMetadata,
	extractSubmissionMetadata,
	MetadataExtractionError
} from '#lib/server/metadata-extraction.js';
import type { Config } from '@sveltejs/adapter-vercel';

// Metadata extraction is a model call over the document header.
export const config: Config = { maxDuration: 60 };

/**
 * POST /api/submissions/[id]/metadata
 *
 * Extracts author / members / title from the header of the delivery's main
 * document and stores them as a suggestion on the file. Does not touch the
 * submission: the teacher confirms in the review table.
 *
 * Body: `{ force?: boolean, apply?: boolean }` — `force` re-runs the model even
 * when a suggestion is already stored; `apply` also writes the suggestion on
 * the delivery (title, printed name, roster link), filling gaps only.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as { force?: boolean; apply?: boolean };

	try {
		const options = { force: body.force === true };
		const result =
			body.apply === true
				? await applySubmissionMetadata(locals.user.id, params.id, options)
				: await extractSubmissionMetadata(locals.user.id, params.id, options);
		return json(result);
	} catch (error) {
		if (error instanceof MetadataExtractionError) {
			if (error.code === 'not_found') return json({ error: error.message }, { status: 404 });
			if (error.code === 'no_text') return json({ error: error.message, code: 'no_text' }, { status: 422 });
			return json({ error: error.message, code: 'model' }, { status: 502 });
		}
		const message = error instanceof Error ? error.message : 'Error extrayendo metadatos';
		return json({ error: message }, { status: 500 });
	}
};
