/**
 * Turns any human label into a safe tag name: lowercase, accents stripped,
 * everything outside [a-z0-9] collapsed into single underscores.
 */
export function slugify(value: string, fallback = 'campo'): string {
	const slug = value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');

	return slug.length > 0 ? slug : fallback;
}

/**
 * Lighter variant for live inputs: keeps partial values (including a trailing
 * underscore) while the user types. `slugify` finishes the job when rendering.
 */
export function sanitizeTag(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/_+/g, '_');
}
