import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/server/auth/index.js';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/env';
import { legacyRubricRedirect } from '#lib/server/legacy-paths.js';

export async function handle({ event, resolve }) {
	// The rubric section moved from /plantillas to /rubricas; keep old links alive.
	const movedTo = legacyRubricRedirect(event.url.pathname, event.url.search);
	if (movedTo) redirect(308, movedTo);

	// Fetch current session from Better Auth and attach to event.locals so
	// +layout.server.ts, actions and endpoints can read it.
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}
	return svelteKitHandler({ event, resolve, auth, building });
}