import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateTemplate } from '#lib/server/repositories/rubric.js';

/** POST /api/templates/[id]/duplicate */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	const template = await duplicateTemplate(locals.user.id, params.id);
	if (!template) return json({ error: 'Rúbrica no encontrada' }, { status: 404 });
	return json({ template }, { status: 201 });
};
