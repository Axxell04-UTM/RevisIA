import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}
	// Allow teachers to access /admin/first-login for mandatory password change
	if (locals.user.role !== 'admin' && !url.pathname.startsWith('/admin/first-login')) {
		redirect(302, '/');
	}
	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			role: locals.user.role,
			active: locals.user.active
		}
	};
};