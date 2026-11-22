import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteTemplate, getTemplate, saveTemplate, type TemplateInput } from '#lib/server/repositories/rubric.js';

/** GET /api/templates/[id] */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const template = await getTemplate(locals.user.id, params.id);
	if (!template) return json({ error: 'Rúbrica no encontrada' }, { status: 404 });
	return json({ template });
};

/** DELETE /api/templates/[id] — soft delete plus unbinding its activities. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const result = await deleteTemplate(locals.user.id, params.id);
	if (!result.deleted) return json({ error: 'Rúbrica no encontrada' }, { status: 404 });
	return json({ ok: true, unboundActivities: result.unboundActivities });
};

/** PUT /api/templates/[id] — update in place (id from the URL wins). */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { template?: TemplateInput };
	if (!body.template) return json({ error: 'Falta template' }, { status: 400 });

	try {
		const template = await saveTemplate(locals.user.id, {
			...body.template,
			id: params.id
		});
		return json({ template });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando la rúbrica';
		return json({ error: message }, { status: 400 });
	}
};
