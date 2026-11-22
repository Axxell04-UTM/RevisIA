import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { listPendingSubmissionFiles } from '#lib/server/repositories/submission.js';

/**
 * GET /api/activities/[id]/pending-files — delivery files extracted for the
 * activity that are not grouped into a submission yet.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Actividad inválida' }, { status: 400 });

	const files = await listPendingSubmissionFiles(locals.user.id, params.id);
	return json({ files });
};
