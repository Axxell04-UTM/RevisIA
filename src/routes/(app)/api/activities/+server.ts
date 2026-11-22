import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listActivities,
	saveActivity,
	type ActivityInput
} from '#lib/server/repositories/activity.js';

/** GET /api/activities[?subjectId=uuid] — the signed-in teacher's activities. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const subjectId = url.searchParams.get('subjectId');
	const activities = await listActivities(locals.user.id, { subjectId });
	return json({ activities });
};

/** POST /api/activities { activity: ActivityInput } — create or update one. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { activity?: ActivityInput };
	if (!body.activity) return json({ error: 'Enviá { activity }' }, { status: 400 });

	try {
		const activity = await saveActivity(locals.user.id, body.activity);
		return json({ activity });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando la actividad';
		return json({ error: message }, { status: 400 });
	}
};
