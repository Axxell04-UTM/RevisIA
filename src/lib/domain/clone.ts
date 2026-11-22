import type { Template } from './types';

/** Deep clone that also unwraps Svelte state proxies into plain objects. */
export function cloneTemplate(template: Template): Template {
	return JSON.parse(JSON.stringify(template)) as Template;
}
