import { describe, expect, it } from 'vitest';
import { resolveDbTransport } from '#lib/server/db/index.js';

/**
 * `DATABASE_TRANSPORT` decides how the app reaches Postgres:
 *
 * - `tcp` (default): the `pg` driver on port 5432. Works everywhere the port is
 *   reachable, and is what production uses.
 * - `websocket`: `@neondatabase/serverless` over WSS on 443. Needed when the
 *   network blocks 5432 — the query then fails as "Failed query" with a TCP
 *   timeout underneath.
 *
 * Unset and unrecognised values must stay on `tcp` so an existing deployment
 * keeps its previous behaviour.
 */
describe('resolveDbTransport', () => {
	it('defaults to tcp when the variable is unset', () => {
		expect(resolveDbTransport(undefined)).toBe('tcp');
	});

	it('defaults to tcp when the variable is empty', () => {
		expect(resolveDbTransport('')).toBe('tcp');
		expect(resolveDbTransport('   ')).toBe('tcp');
	});

	it('keeps tcp when asked for tcp', () => {
		expect(resolveDbTransport('tcp')).toBe('tcp');
	});

	it('accepts the websocket spellings people actually type', () => {
		expect(resolveDbTransport('websocket')).toBe('websocket');
		expect(resolveDbTransport('WEBSOCKET')).toBe('websocket');
		expect(resolveDbTransport(' wss ')).toBe('websocket');
		expect(resolveDbTransport('https')).toBe('websocket');
	});

	it('falls back to tcp for unknown values instead of guessing', () => {
		expect(resolveDbTransport('http')).toBe('tcp');
		expect(resolveDbTransport('bogus')).toBe('tcp');
	});
});
