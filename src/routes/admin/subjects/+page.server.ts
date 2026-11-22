import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listSubjects, createSubject, setSubjectActive, deleteSubjectSoft, getSubjects, restoreSubject } from '#lib/server/repositories/subject.js';
import { listAvailableTeachers } from '#lib/server/repositories/subject.js';
import { logAudit } from '#lib/server/repositories/audit.js';

export const load: PageServerLoad = async ({ url, locals }) => {
	const page = Number(url.searchParams.get('page')) || 1;
	const limit = 20;
	const offset = (page - 1) * limit;
	const search = url.searchParams.get('search') || undefined;
	const deleted = url.searchParams.get('deleted');
	const sortBy = url.searchParams.get('sortBy') || 'createdAt';
	const sortOrder = url.searchParams.get('sortOrder') || 'desc';

	const [{ items, total }, teachers] = await Promise.all([
		listSubjects({ limit, offset, search, deleted: deleted === 'true', sortBy: sortBy as any, sortOrder: sortOrder as any }),
		listAvailableTeachers()
	]);

	return {
		subjects: items,
		total,
		page,
		totalPages: Math.ceil(total / limit),
		search,
		deleted: deleted ?? 'false',
		sortBy,
		sortOrder,
		teachers
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const formData = await request.formData();
		const name = formData.get('name') as string;
		const code = formData.get('code') as string;
		const term = formData.get('term') as string;
		const description = formData.get('description') as string;
		const teacherIds = formData.getAll('teacherIds') as string[];

		if (!name) {
			return fail(400, { error: 'El nombre es requerido' });
		}

		try {
			const subjectId = await createSubject({ name, code, term, description, teacherIds, createdBy: locals.user.id });
			await logAudit({ action: 'subject.create', entity: 'subject', entityId: subjectId, metadata: { name, code, term, teacherIds }, userId: locals.user.id });
			return { success: true, subjectId };
		} catch (e: any) {
			return fail(400, { error: e.message || 'Error al crear asignatura' });
		}
	},

	toggleActive: async ({ request, locals }) => {
		const formData = await request.formData();
		const subjectId = formData.get('subjectId') as string;
		const active = formData.get('active') === 'true';

		if (active) {
			await restoreSubject(subjectId);
			await logAudit({ action: 'subject.restore', entity: 'subject', entityId: subjectId, userId: locals.user.id });
		} else {
			await deleteSubjectSoft(subjectId);
			await logAudit({ action: 'subject.delete', entity: 'subject', entityId: subjectId, userId: locals.user.id });
		}
		return { success: true };
	},

	delete: async ({ request, locals }) => {
		const formData = await request.formData();
		const subjectId = formData.get('subjectId') as string;

		await deleteSubjectSoft(subjectId);
		await logAudit({ action: 'subject.delete', entity: 'subject', entityId: subjectId, userId: locals.user.id });
		return { success: true };
	}
};