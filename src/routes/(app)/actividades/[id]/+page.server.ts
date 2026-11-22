import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActivityPrompt, listSubjects } from '#lib/server/repositories/activity.js';
import { listTemplates } from '#lib/server/repositories/rubric.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const found = await getActivityPrompt(locals.user.id, params.id);
	if (!found) {
		redirect(302, '/');
	}
	const { activity, sourceDocument } = found;

	const [subjects, rubrics] = await Promise.all([
		listSubjects(locals.user.id),
		listTemplates(locals.user.id)
	]);

	return {
		activity,
		subjects,
		rubrics,
		// Extracted text of the source document, so the prompt preview matches
		// what grading actually sends instead of dropping it after a reload.
		sourceDocument
	};
};