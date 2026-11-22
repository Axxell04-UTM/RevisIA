import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Deploy target: Vercel. The adapter turns each route into a serverless
			// function; the slow ones declare their own `maxDuration` in the route.
			// See https://svelte.dev/docs/kit/adapter-vercel
			adapter: adapter()
		})
	],
	resolve: {
		alias: {
			'#lib': path.resolve('./src/lib'),
			'#lib/*': path.resolve('./src/lib/*')
		}
	}
});
