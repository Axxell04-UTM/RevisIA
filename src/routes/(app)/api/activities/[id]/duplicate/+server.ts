import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateActivity } from '#lib/server/repositories/activity.js';

/** POST /api/activities/[id]/duplicate — copy the activity into a new draft. */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	try {
		const activity = await duplicateActivity(locals.user.id, params.id);
		return json({ activity }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error duplicando la actividad';
		const status = message === 'Actividad no encontrada' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
