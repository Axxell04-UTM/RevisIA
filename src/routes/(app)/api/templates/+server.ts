import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTemplates, saveTemplate, importTemplates, type TemplateInput } from '#lib/server/repositories/rubric.js';

/** GET /api/templates — every non-deleted template of the signed-in user. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const templates = await listTemplates(locals.user.id);
	return json({ templates });
};

/**
 * POST /api/templates
 *   { template: TemplateInput }  -> create or update one template
 *   { templates: TemplateInput[] } -> bulk import (localStorage JSON migration)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as {
		template?: TemplateInput;
		templates?: TemplateInput[];
	};

	try {
		if (Array.isArray(body.templates)) {
			const templates = await importTemplates(locals.user.id, body.templates);
			return json({ templates });
		}
		if (body.template) {
			const template = await saveTemplate(locals.user.id, body.template);
			return json({ template });
		}
		return json({ error: 'Enviá { template } o { templates }' }, { status: 400 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando la rúbrica';
		return json({ error: message }, { status: 400 });
	}
};
