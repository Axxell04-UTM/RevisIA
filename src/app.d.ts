/// <reference types="@sveltejs/kit" />
/// <reference types="@sveltejs/kit/env" />

declare global {
	namespace App {
		// Shape populated by hooks.server.ts from Better Auth.
		interface Locals {
			session?: import('#lib/server/auth/index.js').Session | null;
			user?: import('#lib/server/auth/index.js').User | null;
		}
		// interface Error {}
		// interface PageData {}

		interface PageState {
			/** Set by the editor right after a new activity is created. */
			activityCreated?: number;
		}

		// interface Platform {}
	}
}

export {};