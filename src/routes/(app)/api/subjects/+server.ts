import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTeacherSubjects } from '#lib/server/repositories/subject.js';

/** GET /api/subjects — the subjects the signed-in teacher is assigned to. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const subjects = await listTeacherSubjects(locals.user.id);
	return json({ subjects });
};
