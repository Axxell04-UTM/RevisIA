import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import {
	attachStudent,
	deleteSubmission,
	listSubmissions,
	setMembers,
	updateSubmissionDetails
} from '#lib/server/repositories/submission.js';

/**
 * PATCH /api/submissions/[id] { title?, studentName? } — edit the delivery title
 * and the student name detected in the document header. Only the keys present
 * are written.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as {
		title?: string | null;
		studentName?: string | null;
	};
	if (body.title === undefined && body.studentName === undefined) {
		return json({ error: 'Enviá { title } o { studentName }' }, { status: 400 });
	}

	try {
		const submission = await updateSubmissionDetails(locals.user.id, params.id, {
			...(body.title !== undefined ? { title: body.title?.trim() || null } : {}),
			...(body.studentName !== undefined
				? { studentName: body.studentName?.trim() || null }
				: {})
		});
		if (!submission) return json({ error: 'Entrega no encontrada' }, { status: 404 });
		return json({ submission });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error actualizando la entrega';
		return json({ error: message }, { status: 400 });
	}
};

/**
 * DELETE /api/submissions/[id] — soft delete the delivery.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	const deleted = await deleteSubmission(locals.user.id, params.id);
	if (!deleted) return json({ error: 'Entrega no encontrada' }, { status: 404 });
	return json({ ok: true });
};