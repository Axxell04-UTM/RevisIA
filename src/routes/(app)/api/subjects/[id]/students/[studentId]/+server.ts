import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteStudent,
	updateStudent,
	type StudentInput
} from '#lib/server/repositories/student.js';

/** PATCH /api/subjects/[id]/students/[studentId] { student: Partial<StudentInput> } */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { student?: Partial<StudentInput> };
	if (!body.student) return json({ error: 'Enviá { student }' }, { status: 400 });

	try {
		const student = await updateStudent(locals.user.id, params.id, params.studentId, body.student);
		if (!student) return json({ error: 'Estudiante no encontrado' }, { status: 404 });
		return json({ student });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error actualizando el estudiante';
		return json({ error: message }, { status: 400 });
	}
};

/** DELETE /api/subjects/[id]/students/[studentId] — soft delete. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const deleted = await deleteStudent(locals.user.id, params.id, params.studentId);
	if (!deleted) return json({ error: 'Estudiante no encontrado' }, { status: 404 });
	return json({ ok: true });
};
