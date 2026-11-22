import type { PageServerLoad } from './$types';
import { countSubmissionsByActivity } from '#lib/server/repositories/submission.js';

/**
 * The overview reuses the activity list the layout already loaded and only adds
 * delivery counters, so opening `/` costs one grouped count query.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { user, activities } = await parent();
	const counts = await countSubmissionsByActivity(
		user.id,
		activities.map((activity) => activity.id)
	);
	return { counts: Object.fromEntries(counts) };
};
