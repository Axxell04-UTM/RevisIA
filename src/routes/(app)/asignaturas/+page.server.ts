import type { PageServerLoad } from './$types';
import { countSubmissionsByActivity } from '#lib/server/repositories/submission.js';
import { groupActivitiesBySubject } from '#lib/domain/activity-groups.js';

/** One row per assigned subject, with its activities and delivery totals. */
export const load: PageServerLoad = async ({ parent }) => {
	const { user, activities, subjects } = await parent();
	const counts = await countSubmissionsByActivity(
		user.id,
		activities.map((activity) => activity.id)
	);
	const groups = groupActivitiesBySubject(activities, subjects);

	const rows = subjects.map((subject) => {
		const group = groups.find((candidate) => candidate.key === subject.id);
		const list = group?.activities ?? [];
		const totals = list.reduce(
			(acc, activity) => {
				const counted = counts.get(activity.id) ?? { total: 0, graded: 0 };
				return { total: acc.total + counted.total, graded: acc.graded + counted.graded };
			},
			{ total: 0, graded: 0 }
		);
		return {
			...subject,
			activityCount: list.length,
			submissions: totals.total,
			graded: totals.graded,
			// Only the first few are rendered; the sidebar holds the full list.
			recent: list.slice(0, 5).map((activity) => ({ id: activity.id, title: activity.title }))
		};
	});

	return { rows };
};
