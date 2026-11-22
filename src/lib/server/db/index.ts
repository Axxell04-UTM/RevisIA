import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { Pool as NodePgPool } from 'pg';
import { Pool as NeonPool } from '@neondatabase/serverless';
import * as schema from './schema/index.js';

// $env/dynamic/private is SvelteKit-only; fallback to process.env for standalone scripts
let env: Record<string, string | undefined> = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = await import('$env/dynamic/private');
  env = m.env;
} catch {
  env = process.env;
}

/**
 * How the app reaches Postgres.
 *
 * - `tcp` (default): the `pg` driver on port 5432. Standard everywhere and the
 *   only transport production should use.
 * - `websocket`: `@neondatabase/serverless` over WSS on 443. Same Postgres, same
 *   SQL, same transactions — but it never opens port 5432. Escape hatch for when
 *   the 5432 path is unreachable (network filtering, or a pooler outage: the
 *   symptom is Drizzle's "Failed query" with a TCP timeout as its cause).
 *
 * Unrecognised values stay on `tcp` so a typo never silently changes how the
 * app talks to the database.
 */
export type DbTransport = 'tcp' | 'websocket';

const WEBSOCKET_ALIASES = new Set(['websocket', 'wss', 'https']);

export function resolveDbTransport(raw: string | undefined): DbTransport {
	const value = raw?.trim().toLowerCase() ?? '';
	return WEBSOCKET_ALIASES.has(value) ? 'websocket' : 'tcp';
}

/**
 * Shared Drizzle client. Lazily initialized so the module can be imported from
 *  contexts that must not touch the network (tests, edge runtime).
 *
 * Both drivers expose the same Drizzle query builder, including `transaction`,
 * so repositories never know which one is active. The type alias below pins the
 * query API to the Node driver, which is what every call site was written
 * against.
 */
export type DB = NodePgDatabase<typeof schema>;

let _db: DB | null = null;
let _warned = false;

export function getDb(): DB {
	if (_db) return _db;
	const url = env.DATABASE_URL;
	if (!url && !_warned) {
		_warned = true;
		// Do not throw at import time: `svelte-check`/`vite build` analyse these
		// modules without env vars. The failure surfaces on the first query.
		console.warn('[db] Falta DATABASE_URL: se usará el Postgres local por defecto');
	}
	const transport = resolveDbTransport(
		env.DATABASE_TRANSPORT ?? process.env.DATABASE_TRANSPORT
	);
	const logger = env.NODE_ENV === 'development';

	if (transport === 'websocket') {
		// Port 443 only: the serverless pool speaks the Postgres wire protocol over
		// WebSockets. `max`/`ssl` are irrelevant here; TLS is implied by `wss:`.
		const pool = new NeonPool({ connectionString: url });
		_db = drizzleNeon(pool, { schema, logger }) as unknown as DB;
	} else {
		// One pool per process, and on serverless that means one per instance.
		// Keep it small: Neon's pooler multiplexes the real connections, and a
		// large per-instance pool multiplies the connection count under load.
		const pool = new NodePgPool({
			connectionString: url,
			max: env.NODE_ENV === 'production' ? 3 : 10,
			// Verify the server certificate. Neon serves a publicly trusted chain,
			// so `rejectUnauthorized: false` would only make the connection
			// accept any certificate. Outside production the URL decides.
			ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined
		});
		_db = drizzleNodePg(pool, { schema, logger });
	}

	console.info(`[db] transport=${transport}`);
	return _db;
}

/** Convenience export. Prefer getDb() inside handlers to keep lazy init. */
export const db = getDb();
export { schema };
