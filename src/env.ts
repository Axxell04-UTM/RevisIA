import { defineEnvVars } from '@sveltejs/kit/env';

// SvelteKit 3 only exposes private env vars that are declared in this file.
// Anything the server reads through `$app/env/private` (or the deprecated
// `$env/dynamic/private`) must be registered here, otherwise it arrives as
// `undefined` at runtime even when the variable exists in `.env`.
const isProduction = process.env.NODE_ENV === 'production';

/** Always required: without it the app silently dials a local Postgres. */
function required(value?: string) {
	const trimmed = value?.trim();
	if (trimmed) return trimmed;
	throw new Error('DATABASE_URL is required');
}

/** Required in production, optional during development (dev defaults apply). */
function requiredInProduction(name: string) {
	return (value?: string) => {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
		if (isProduction) throw new Error(`${name} is required in production`);
		return undefined;
	};
}

function optional(value?: string) {
	return value?.trim() || undefined;
}

export const variables = defineEnvVars({
	DATABASE_URL: { schema: required },
	/**
	 * `tcp` (default) dials port 5432 with the `pg` driver; `websocket` dials 443
	 * with `@neondatabase/serverless`. Only needed on networks that filter 5432.
	 */
	DATABASE_TRANSPORT: { schema: optional },
	NODE_ENV: { schema: (value?: string) => value ?? process.env.NODE_ENV ?? 'development' },

	BETTER_AUTH_SECRET: { schema: requiredInProduction('BETTER_AUTH_SECRET') },
	BETTER_AUTH_URL: { schema: optional },

	API_KEY_ENCRYPTION_KEY: { schema: requiredInProduction('API_KEY_ENCRYPTION_KEY') },

	FILEBASE_ENDPOINT: { schema: optional },
	FILEBASE_BUCKET: { schema: optional },
	FILEBASE_ACCESS_KEY_ID: { schema: optional },
	FILEBASE_SECRET_ACCESS_KEY: { schema: optional },

	R2_ACCOUNT_ID: { schema: optional },
	R2_BUCKET: { schema: optional },
	R2_ACCESS_KEY_ID: { schema: optional },
	R2_SECRET_ACCESS_KEY: { schema: optional },

	AI_PROVIDER: { schema: optional },
	AI_API_KEY: { schema: optional },
	AI_MODEL: { schema: optional },
	/** Model retried when the primary one is rejected transiently (503/429/5xx). */
	AI_FALLBACK_MODEL: { schema: optional },
	AI_BASE_URL: { schema: optional }
});
