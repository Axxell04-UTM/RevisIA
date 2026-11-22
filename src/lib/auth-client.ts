import { createAuthClient } from 'better-auth/client';

/** Client-side auth. Import this in +page.svelte / +layout.svelte (browser only). */
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_BETTER_AUTH_URL ?? window.location.origin
});