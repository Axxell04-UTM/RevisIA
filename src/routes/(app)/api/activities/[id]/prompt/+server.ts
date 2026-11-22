import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getActivityPrompt } from '#lib/server/repositories/activity.js';

/**
 * GET /api/activities/[id]/prompt
 *
 * Returns the activity together with the extracted text of its source document.
 * The evaluation screen uses it to render the same prompt the model will see,
 * including the material the students worked from.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const result = await getActivityPrompt(locals.user.id, params.id);
	if (!result) return json({ error: 'Actividad no encontrada' }, { status: 404 });
	return json(result);
};
