import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createStudent,
	listStudents,
	type StudentInput
} from '#lib/server/repositories/student.js';

/** GET /api/subjects/[id]/students — the roster of one subject. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const students = await listStudents(locals.user.id, params.id);
	return json({ students });
};

/** POST /api/subjects/[id]/students { student: StudentInput } — add one. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { student?: StudentInput };
	if (!body.student) return json({ error: 'Enviá { student }' }, { status: 400 });

	try {
		const student = await createStudent(locals.user.id, params.id, body.student);
		return json({ student }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando el estudiante';
		return json({ error: message }, { status: 400 });
	}
};
