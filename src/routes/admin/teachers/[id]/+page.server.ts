import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth/index.js';
import { getTeacherById, updateTeacher } from '#lib/server/repositories/teacher.js';
import { getSubjects } from '#lib/server/repositories/subject.js';
import { logAudit } from '#lib/server/repositories/audit.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	const teacher = await getTeacherById(params.id);
	if (!teacher) redirect(302, '/admin/teachers');
	const subjects = await getSubjects();
	return { teacher, subjects };
};

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const name = formData.get('name') as string;
		const active = formData.get('active') === 'true';
		const subjectIds = formData.getAll('subjectIds') as string[];

		if (!name) return fail(400, { error: 'Nombre requerido' });

		await updateTeacher(params.id, { name, active, subjectIds });
		await logAudit({ action: 'teacher.update', entity: 'user', entityId: params.id, metadata: { name, active, subjectIds }, userId: locals.user.id });
		return { success: true };
	},

	resetPassword: async ({ request, params, locals }) => {
		const tempPassword = crypto.randomUUID().slice(0, 12);
		await (auth.api as any).setUserPassword({ userId: params.id, newPassword: tempPassword, headers: request.headers });
		await (auth.api as any).adminUpdateUser({ userId: params.id, data: { mustChangePassword: true }, headers: request.headers });
		await logAudit({ action: 'teacher.reset-password', entity: 'user', entityId: params.id, userId: locals.user.id });
		return { success: true, tempPassword };
	}
};