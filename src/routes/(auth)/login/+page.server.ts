import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { auth } from '#lib/server/auth/index.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		if (locals.user.role === 'admin') {
			redirect(302, '/admin');
		}
		redirect(302, '/');
	}
	return {};
};

export const actions = {
	default: async ({ request }: { request: Request }) => {
		const formData = await request.formData();
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (!email || !password) {
			return { error: 'Email y contraseña son requeridos' };
		}

		try {
			await auth.api.signInEmail({
				body: { email, password },
				headers: request.headers
			});

			// Get session to check user role for redirect
			const session = await auth.api.getSession({ headers: request.headers });
			if (session?.user?.role === 'admin') {
				throw redirect(302, '/admin');
			}

			throw redirect(302, '/');
		} catch (e: any) {
			if (e?.status === 302 && e?.headers?.location) {
				throw e;
			}
			return { error: e?.message ?? 'Credenciales inválidas' };
		}
	}
};