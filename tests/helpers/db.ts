import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '#lib/server/db/schema/index.js';

/**
 * In-memory Postgres for repository tests.
 *
 * PGlite is a real Postgres compiled to WASM, so the repositories run their
 * actual SQL — joins, NULL ordering, cascade deletes, transactions — against
 * the same schema the migrations create. No Docker, no Neon, no network, and
 * nothing can leak into a real database.
 *
 * The migrations under `drizzle/` are applied verbatim, which also keeps them
 * honest: a migration that cannot run here cannot run in production either.
 */

const migrationsDir = fileURLToPath(new URL('../../drizzle', import.meta.url));

const pg = new PGlite();
await pg.waitReady;

for (const file of readdirSync(migrationsDir)
	.filter((name) => name.endsWith('.sql'))
	.sort()) {
	await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'));
}

export const testDb = drizzle(pg, { schema });
export { schema };

/**
 * Empty every table between tests.
 *
 * `subject` has no FK to `user`, so truncating `user` alone leaves subjects,
 * rosters and everything hanging off them from the previous test. Both roots
 * are truncated, and `cascade` walks the rest of the graph.
 */
export async function resetDb(): Promise<void> {
	await pg.exec('truncate table "user", subject cascade;');
}

export async function closeDb(): Promise<void> {
	await pg.close();
}
