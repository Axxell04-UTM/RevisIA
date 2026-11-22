import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSubjectById, updateSubject, assignTeachers, listAvailableTeachers } from '#lib/server/repositories/subject.js';
import { logAudit } from '#lib/server/repositories/audit.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	const subject = await getSubjectById(params.id);
	if (!subject) redirect(302, '/admin/subjects');
	const teachers = await listAvailableTeachers();
	return { subject, teachers };
};

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const name = formData.get('name') as string;
		const code = formData.get('code') as string;
		const term = formData.get('term') as string;
		const description = formData.get('description') as string;
		const teacherIds = formData.getAll('teacherIds') as string[];

		if (!name) return fail(400, { error: 'El nombre es requerido' });

		await updateSubject(params.id, { name, code, term, description, teacherIds });
		await logAudit({ action: 'subject.update', entity: 'subject', entityId: params.id, metadata: { name, code, term, description, teacherIds }, userId: locals.user.id });
		return { success: true };
	},

	assignTeachers: async ({ request, params, locals }) => {
		const formData = await request.formData();
		const teacherIds = formData.getAll('teacherIds') as string[];

		await assignTeachers(params.id, teacherIds, locals.user.id);
		await logAudit({ action: 'subject.assign_teachers', entity: 'subject', entityId: params.id, metadata: { teacherIds }, userId: locals.user.id });
		return { success: true };
	}
};