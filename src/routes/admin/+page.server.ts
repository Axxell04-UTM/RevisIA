import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { user, activity, submission } from '#lib/server/db/schema/index.js';
import { eq, sql, gte } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}
	if (locals.user.role !== 'admin') {
		redirect(302, '/');
	}

	const db = getDb();
	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const [
		[{ total: totalTeachers }],
		[{ active: activeTeachers }],
		[{ total: totalSubmissions }],
		[{ recent: recentSubmissions }],
		[{ total: totalActivities }]
	] = await Promise.all([
		db.select({ total: sql<number>`count(*)` }).from(user).where(eq(user.role, 'teacher')),
		db.select({ active: sql<number>`count(*)` }).from(user).where(sql`${user.role} = 'teacher' AND ${user.active} = true`),
		db.select({ total: sql<number>`count(*)` }).from(submission),
		db.select({ recent: sql<number>`count(*)` }).from(submission).where(gte(submission.createdAt, weekAgo)),
		db.select({ total: sql<number>`count(*)` }).from(activity)
	]);

	return {
		metrics: {
			totalTeachers: Number(totalTeachers),
			activeTeachers: Number(activeTeachers),
			totalSubmissions: Number(totalSubmissions),
			recentSubmissions: Number(recentSubmissions),
			totalActivities: Number(totalActivities)
		}
	};
};