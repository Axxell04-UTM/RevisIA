import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { gradeSubmission } from '#lib/server/grading.js';
import type { Config } from '@sveltejs/adapter-vercel';

// One grading call to the model: the client drives the batch, one per request.
export const config: Config = { maxDuration: 60 };

/**
 * POST /api/submissions/[id]/grade
 *
 * Grades one delivery with the rubric of its activity and stores the result.
 * The request carries no prompt material: the server reads the delivery's
 * extracted text, the activity's contexts and the rubric itself, so a client
 * cannot grade against a rubric it invented.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	try {
		const result = await gradeSubmission(locals.user.id, params.id);
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error calificando la entrega';
		// Nothing was stored, so the previous grade (if any) is still valid.
		const status = /no existe|no pertenece/i.test(message) ? 404 : 400;
		return json({ error: message }, { status });
	}
};
