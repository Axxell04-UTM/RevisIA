import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteActivity,
	getActivity,
	renameActivity,
	saveActivity,
	type ActivityInput
} from '#lib/server/repositories/activity.js';

/** GET /api/activities/[id] */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const activity = await getActivity(locals.user.id, params.id);
	if (!activity) return json({ error: 'Actividad no encontrada' }, { status: 404 });
	return json({ activity });
};

/** PUT /api/activities/[id] — the body must carry the full activity. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { activity?: Record<string, unknown> };
	if (!body.activity) return json({ error: 'Enviá { activity }' }, { status: 400 });

	try {
		const activity = await saveActivity(locals.user.id, {
			...(body.activity as unknown as ActivityInput),
			id: params.id
		});
		return json({ activity });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando la actividad';
		return json({ error: message }, { status: 400 });
	}
};

/**
 * PATCH /api/activities/[id] { title } — rename only.
 *
 * The sidebar renames an activity in place; sending the whole activity through
 * PUT would replace the fields the sidebar does not even know about.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { title?: unknown };
	if (typeof body.title !== 'string') return json({ error: 'Enviá { title }' }, { status: 400 });

	try {
		const activity = await renameActivity(locals.user.id, params.id, body.title);
		return json({ activity });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error renombrando la actividad';
		const status = message === 'Actividad no encontrada' ? 404 : 400;
		return json({ error: message }, { status });
	}
};

/** DELETE /api/activities/[id] — soft delete. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const deleted = await deleteActivity(locals.user.id, params.id);
	if (!deleted) return json({ error: 'Actividad no encontrada' }, { status: 404 });
	return json({ ok: true });
};
