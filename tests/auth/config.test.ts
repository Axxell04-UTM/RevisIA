import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { auth } from '#lib/server/auth/index.js';

/**
 * Better Auth configuration invariants.
 *
 * `input: false` is what stops a sign-up request from choosing its own `role`.
 * If that flag is ever dropped, anyone can register as an admin, so it is
 * pinned here even though Better Auth itself owns the rest of the flow.
 */

const fields = auth.options.user?.additionalFields ?? {};

describe('user fields are server-owned', () => {
	it('refuses client input for role, active and the AI defaults', () => {
		for (const name of ['role', 'active', 'defaultProvider', 'defaultModel'] as const) {
			expect(fields[name], `missing field ${name}`).toBeDefined();
			expect(fields[name].input, `${name} must not be client-supplied`).toBe(false);
		}
	});

	it('defaults new accounts to an active teacher', () => {
		expect(fields.role.defaultValue).toBe('teacher');
		expect(fields.active.defaultValue).toBe(true);
	});

	it('restricts role to the two known values', () => {
		expect(fields.role.type).toEqual(['admin', 'teacher']);
	});
});

describe('session configuration', () => {
	it('uses the configured secret instead of the insecure development fallback', () => {
		expect(auth.options.secret).toBe(process.env.BETTER_AUTH_SECRET);
		expect(auth.options.secret).not.toContain('insecure');
	});

	it('scopes every cookie to the app prefix', () => {
		expect(auth.options.advanced?.cookiePrefix).toBe('revisia');
	});

	it('signs sessions against the configured base URL', () => {
		expect(auth.options.baseURL).toBe('http://localhost:5173');
	});

	it('registers admin plugin first and SvelteKit cookie plugin last', () => {
		const plugins = auth.options.plugins ?? [];

		expect(plugins).toHaveLength(2);
		expect(plugins[0]?.id).toBe('admin');
		expect(plugins.at(-1)?.id).toBe('sveltekit-cookies');
	});
});
