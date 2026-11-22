import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActivity } from '#lib/server/repositories/activity.js';
import { getTemplate } from '#lib/server/repositories/rubric.js';
import { listTeacherSubjects } from '#lib/server/repositories/subject.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const activity = await getActivity(locals.user.id, params.id);
	if (!activity) {
		redirect(302, '/');
	}

	const [subjects, rubric] = await Promise.all([
		listTeacherSubjects(locals.user.id),
		activity.rubricId ? getTemplate(locals.user.id, activity.rubricId) : Promise.resolve(null)
	]);

	return {
		activity,
		subjects,
		rubric
	};
};