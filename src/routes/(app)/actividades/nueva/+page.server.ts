import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listSubjects } from '#lib/server/repositories/activity.js';
import { listTemplates } from '#lib/server/repositories/rubric.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const [subjects, rubrics] = await Promise.all([
		listSubjects(locals.user.id),
		listTemplates(locals.user.id)
	]);

	return { subjects, rubrics };
};
