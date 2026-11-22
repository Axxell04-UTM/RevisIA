import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { countActivitiesByRubric } from '#lib/server/repositories/activity.js';

/**
 * The rubric list needs to say how many activities use each rubric before the
 * teacher deletes one, so the count is part of the page data and not an extra
 * round trip from the browser.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	return { usage: await countActivitiesByRubric(locals.user.id) };
};
