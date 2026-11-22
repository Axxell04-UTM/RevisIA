import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth/index.js';
import { updateTeacher } from '#lib/server/repositories/teacher.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.mustChangePassword) {
		redirect(302, '/admin');
	}
	return {};
};

export const actions: Actions = {
	changePassword: async ({ request, locals }) => {
		const formData = await request.formData();
		const currentPassword = formData.get('currentPassword') as string;
		const newPassword = formData.get('newPassword') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, { error: 'Todos los campos son requeridos' });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { error: 'Las contraseñas no coinciden' });
		}
		if (newPassword.length < 8) {
			return fail(400, { error: 'La contraseña debe tener al menos 8 caracteres' });
		}

		try {
			// Verify current password by trying to sign in
			await auth.api.signInEmail({
				body: { email: locals.user.email, password: currentPassword },
				headers: request.headers
			});

			// Change password via admin API
			await auth.api.changePassword({
				body: { currentPassword, newPassword },
				headers: request.headers
			});

			// Clear mustChangePassword flag
			await updateTeacher(locals.user.id, { mustChangePassword: false });

			return { success: true };
		} catch {
			return fail(400, { error: 'Contraseña actual incorrecta' });
		}
	}
};