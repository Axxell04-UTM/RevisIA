import { defineConfig } from 'drizzle-kit';

/**
 * `generate` works offline: it diffs the schema against ./drizzle and writes SQL.
 * `migrate` / `push` / `studio` need a reachable DATABASE_URL.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/revisia'
	},
	strict: true,
	verbose: true
});
