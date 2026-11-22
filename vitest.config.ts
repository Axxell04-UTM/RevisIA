import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit/integration test runner.
 *
 * Kept separate from `vite.config.ts` on purpose: the app config loads the
 * SvelteKit and Tailwind plugins, which are not needed (and get in the way)
 * when the subject under test is server code.
 *
 * `#lib` mirrors the subpath import declared in `package.json`; `$app/server` is
 * stubbed because Better Auth imports `getRequestEvent` and that virtual module
 * only exists inside a real SvelteKit request.
 */
export default defineConfig({
	resolve: {
		alias: {
			'#lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$app/server': fileURLToPath(new URL('./tests/stubs/app-server.ts', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		// PGlite is a WASM Postgres: one child process per file is more stable
		// than sharing a worker thread, and each file still gets its own database.
		pool: 'forks'
	}
});
