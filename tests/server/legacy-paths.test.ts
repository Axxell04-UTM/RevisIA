import { describe, expect, it } from 'vitest';
import { legacyRubricRedirect } from '#lib/server/legacy-paths.js';

/**
 * The rubric section moved from `/plantillas` to `/rubricas`. Old links still
 * exist in bookmarks and in anything the teacher shared, so the redirect has to
 * keep the sub-path and the query string, and must not swallow unrelated paths.
 */
describe('legacyRubricRedirect', () => {
	it('moves the section root', () => {
		expect(legacyRubricRedirect('/plantillas')).toBe('/rubricas');
	});

	it('keeps the sub-path', () => {
		expect(legacyRubricRedirect('/plantillas/abc-123')).toBe('/rubricas/abc-123');
	});

	it('keeps the query string', () => {
		expect(legacyRubricRedirect('/plantillas/abc-123', '?tab=criterios')).toBe(
			'/rubricas/abc-123?tab=criterios'
		);
	});

	it('ignores a path that only starts with the same letters', () => {
		expect(legacyRubricRedirect('/plantillass')).toBeNull();
		expect(legacyRubricRedirect('/plantillas-viejas/1')).toBeNull();
	});

	it('ignores every other route', () => {
		expect(legacyRubricRedirect('/revisar/1')).toBeNull();
		expect(legacyRubricRedirect('/')).toBeNull();
	});
});
