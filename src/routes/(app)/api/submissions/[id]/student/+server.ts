import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { attachStudent } from '#lib/server/repositories/submission.js';

/**
 * PATCH /api/submissions/[id]/student { studentId?: string } — link or unlink a roster student.
 * Sending `studentId: null` or omitting it clears the link (reversible, F2.9).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as { studentId?: string | null };
	const studentId = body.studentId?.trim() || null;

	if (studentId && !isUuid(studentId)) {
		return json({ error: 'Estudiante inválido' }, { status: 400 });
	}

	const submission = await attachStudent(locals.user.id, params.id, studentId);
	if (!submission) return json({ error: 'Entrega no encontrada' }, { status: 404 });
	return json({ submission });
};