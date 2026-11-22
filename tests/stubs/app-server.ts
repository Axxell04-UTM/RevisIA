/**
 * Stub for SvelteKit's `$app/server` virtual module.
 *
 * `auth/index.ts` registers the `sveltekitCookies(getRequestEvent)` plugin, so
 * importing the auth instance outside a request is fine, but calling
 * `getRequestEvent()` is not. It fails loudly instead of returning a fake event.
 */
export function getRequestEvent(): never {
	throw new Error('getRequestEvent() is not available outside a SvelteKit request');
}
