/// <reference types="@sveltejs/kit" />

// Types for the private env vars registered in `src/env.ts`.
// `src/env.ts` is the runtime source of truth: declaring a variable here alone
// does NOT expose it to the server. Keep both files in sync.
declare module '$env/dynamic/private' {
	export const env: {
		DATABASE_URL: string;
		/** `tcp` (default) or `websocket` — see `src/lib/server/db/index.ts`. */
		DATABASE_TRANSPORT: string | undefined;
		NODE_ENV: string;

		BETTER_AUTH_SECRET: string | undefined;
		BETTER_AUTH_URL: string | undefined;
		API_KEY_ENCRYPTION_KEY: string | undefined;

		FILEBASE_ENDPOINT: string | undefined;
		FILEBASE_BUCKET: string | undefined;
		FILEBASE_ACCESS_KEY_ID: string | undefined;
		FILEBASE_SECRET_ACCESS_KEY: string | undefined;

		R2_ACCOUNT_ID: string | undefined;
		R2_BUCKET: string | undefined;
		R2_ACCESS_KEY_ID: string | undefined;
		R2_SECRET_ACCESS_KEY: string | undefined;

		AI_PROVIDER: string | undefined;
		AI_API_KEY: string | undefined;
		AI_MODEL: string | undefined;
		/** Model retried when the primary one is rejected transiently (503/429/5xx). */
		AI_FALLBACK_MODEL: string | undefined;
		AI_BASE_URL: string | undefined;
	};
}
