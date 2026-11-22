import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '#lib/server/auth/index.js';

/**
 * Single logout endpoint for every layout. `+layout.server.ts` cannot export
 * `actions` (SvelteKit only allows them in `+page.server.ts`), so the form posts
 * here instead. Cookies are handled by the `sveltekitCookies` plugin.
 */
export const POST: RequestHandler = async ({ request }) => {
	await auth.api.signOut({ headers: request.headers });
	redirect(302, '/login');
};
