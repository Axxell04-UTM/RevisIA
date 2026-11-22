import type { Template, Run } from './types.js';

/**
 * Templates ("rúbricas" in the UI) live in Postgres and are served by `/api/templates`.
 *
 * Runs are still local-only: they move to the `submission`/`grade` tables in
 * Fase 3. Until then the store keeps them in `localStorage` so nothing already
 * graded in the browser is lost.
 */
const RUNS_KEY = 'revisia.v1.runs';

function isBrowser() {
	return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readRuns(): Run[] {
	if (!isBrowser()) return [];
	try {
		const raw = localStorage.getItem(RUNS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as { runs?: Run[] };
		return Array.isArray(parsed.runs) ? parsed.runs : [];
	} catch {
		return [];
	}
}

function writeRuns(runs: Run[]) {
	if (!isBrowser()) return;
	localStorage.setItem(RUNS_KEY, JSON.stringify({ version: 1, runs }));
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
	if (!res.ok) throw new Error(data.error ?? 'Error de red');
	return data as T;
}

function message(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

export class Store {
	templates = $state<Template[]>([]);
	runs = $state<Run[]>(readRuns());
	/** True once the first successful fetch from the server finished. */
	loaded = $state(false);
	error = $state<string | null>(null);

	private inflight: Promise<void> | null = null;

	/** Single-flight load. Call from the app layout (browser only). */
	load(force = false): Promise<void> {
		if (!isBrowser()) return Promise.resolve();
		if (this.loaded && !force) return Promise.resolve();
		if (this.inflight) return this.inflight;

		this.inflight = (async () => {
			try {
				const data = await api<{ templates: Template[] }>('/api/templates');
				this.templates = data.templates;
				this.loaded = true;
				this.error = null;
			} catch (error) {
				this.error = message(error, 'No se pudieron cargar las rúbricas');
			} finally {
				this.inflight = null;
			}
		})();

		return this.inflight;
	}

	find(id: string | undefined): Template | null {
		if (!id) return null;
		return this.templates.find((t) => t.id === id) ?? null;
	}

	private upsertLocally(template: Template) {
		const idx = this.templates.findIndex((t) => t.id === template.id);
		if (idx >= 0) this.templates[idx] = template;
		else this.templates.unshift(template);
	}

	/** Create or update. The server owns ids, so the returned row is what counts. */
	async saveTemplate(template: Template): Promise<Template> {
		await this.load();
		const data = await api<{ template: Template }>('/api/templates', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				template: {
					id: template.id,
					name: template.name,
					instruction: template.instruction,
					answerTag: template.answerTag,
					answerLabel: template.answerLabel,
					contexts: template.contexts.map(({ tag, label, placeholder }) => ({ tag, label, placeholder })),
					criteria: template.criteria.map(({ id, name, description, maxPoints }) => ({
						id,
						name,
						description,
						maxPoints
					}))
				}
			})
		});
		this.upsertLocally(data.template);
		return data.template;
	}

	/**
	 * Deletes a rubric and returns how many activities lost their rubric.
	 *
	 * The server unbinds them in the same transaction, so the count is what the
	 * UI needs to tell the teacher which activities are now unassigned.
	 */
	async deleteTemplate(id: string): Promise<number> {
		const data = await api<{ unboundActivities?: number }>(`/api/templates/${id}`, {
			method: 'DELETE'
		});
		this.templates = this.templates.filter((t) => t.id !== id);
		return data.unboundActivities ?? 0;
	}

	async duplicateTemplate(id: string): Promise<Template | null> {
		const data = await api<{ template: Template }>(`/api/templates/${id}/duplicate`, { method: 'POST' });
		this.upsertLocally(data.template);
		return data.template;
	}

	saveRun(run: Run) {
		this.runs.unshift(run);
		writeRuns(this.runs);
	}

	exportJSON(): string {
		return JSON.stringify({ version: 1, templates: this.templates, runs: this.runs }, null, 2);
	}

	/**
	 * Import a previously exported file. Templates are inserted as new rows
	 * (old ids are not reused), runs stay in `localStorage`.
	 */
	async importJSON(json: string): Promise<Template[]> {
		const parsed = JSON.parse(json) as { templates?: Template[]; runs?: Run[] };
		if (!Array.isArray(parsed.templates)) throw new Error('Archivo inválido: falta "templates"');
		const data = await api<{ templates: Template[] }>('/api/templates', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ templates: parsed.templates })
		});
		for (const template of data.templates) this.upsertLocally(template);
		if (Array.isArray(parsed.runs)) {
			this.runs = parsed.runs;
			writeRuns(this.runs);
		}
		return data.templates;
	}

	/** Kept for callers from the localStorage era; runs are the only local state. */
	flush() {
		writeRuns(this.runs);
	}
}

export const store = new Store();
