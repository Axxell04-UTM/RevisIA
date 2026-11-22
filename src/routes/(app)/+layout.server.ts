import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { listActivities, listSubjects } from '#lib/server/repositories/activity.js';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}
	// Force password change for new teachers (mustChangePassword flag)
	// Skip redirect if already on the first-login page to avoid loop
	if (locals.user.mustChangePassword && !url.pathname.startsWith('/admin/first-login')) {
		redirect(302, '/admin/first-login');
	}

	// The sidebar shows every activity of the signed-in teacher, grouped by
	// subject, so both lists come with the layout instead of one fetch per page.
	const [activities, subjects] = await Promise.all([
		listActivities(locals.user.id),
		listSubjects(locals.user.id)
	]);

	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			role: locals.user.role,
			active: locals.user.active,
			mustChangePassword: locals.user.mustChangePassword
		},
		activities,
		subjects
	};
};