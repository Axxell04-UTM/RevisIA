import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin } from 'better-auth/plugins/admin';
import { createAccessControl } from 'better-auth/plugins/access';
import { getRequestEvent } from '$app/server';
import { db, schema } from '#lib/server/db/index.js';
import { env } from '$env/dynamic/private';

/**
 * Better Auth refuses to boot without a secret. Throwing here would break
 * `vite build`'s SSR analysis (which runs without env vars), so we fall back to
 * a development secret and say it loudly. Production MUST set
 * `BETTER_AUTH_SECRET`; an insecure secret means forgeable sessions.
 */
function resolveSecret(): string {
	const secret = env.BETTER_AUTH_SECRET;
	if (secret) return secret;
	console.warn(
		'[auth] Falta BETTER_AUTH_SECRET: usando un secreto de desarrollo INSEGURO. Configuralo antes de desplegar.'
	);
	return 'revisia-insecure-development-secret-do-not-deploy';
}

/**
 * Single Better Auth instance. Everything (client, server, hooks) imports from
 * here so there is exactly one source of truth for the auth config.
 *
 * `user` is extended with `role`, `active`, `defaultProvider` and `defaultModel`.
 * All four are `input: false` — they are server-owned and cannot be supplied by
 * the client. Better Auth maps them onto the `user` table defined in `auth.ts`
 * (schema/auth.ts) as plain columns.
 */

// Custom access control for admin plugin with teacher role
const adminAc = createAccessControl({
	user: ['create', 'list', 'get', 'update', 'set-password', 'set-role', 'ban', 'impersonate', 'impersonate-admins', 'delete', 'set-email', 'set-phone'],
	session: ['list', 'revoke', 'delete'],
	audit: ['read']
});

const teacherAc = adminAc.newRole({
	user: ['list', 'get', 'update', 'set-password', 'create'],
	session: ['list', 'revoke'],
	audit: ['read']
});

const adminRolesAc = adminAc.newRole({
	user: ['create', 'list', 'get', 'update', 'set-password', 'set-role', 'ban', 'impersonate', 'impersonate-admins', 'delete', 'set-email', 'set-phone'],
	session: ['list', 'revoke', 'delete'],
	audit: ['read']
});

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema,
	}),
	emailAndPassword: {
		enabled: true,
	},
	user: {
		additionalFields: {
			role: {
				type: ['admin', 'teacher'],
				required: false,
				defaultValue: 'teacher',
				input: false,
			},
			active: {
				type: 'boolean',
				required: false,
				defaultValue: true,
				input: false,
			},
			mustChangePassword: {
				type: 'boolean',
				required: false,
				defaultValue: false,
				input: false,
			},
			defaultProvider: {
				type: 'string',
				required: false,
				input: false,
			},
			defaultModel: {
				type: 'string',
				required: false,
				input: false,
			},
		},
	},
	secret: resolveSecret(),
	baseURL: env.BETTER_AUTH_URL,
	advanced: {
		cookiePrefix: 'revisia',
	},
	plugins: [
		admin({
			ac: adminAc,
			adminRoles: ['admin'],
			defaultRole: 'teacher',
			roles: {
				teacher: teacherAc,
				admin: adminRolesAc
			}
		}),
		// Must stay last: lets `auth.api.*` called from server actions/endpoints
		// write its Set-Cookie headers through SvelteKit's cookies API.
		sveltekitCookies(getRequestEvent)
	],
});