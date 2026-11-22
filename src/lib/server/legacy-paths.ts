/**
 * Paths that moved but must keep working for old links and bookmarks.
 *
 * The rubric section used to live under `/plantillas`. Keeping the rule here,
 * pure and tested, means the hook stays a one-line branch and the redirect
 * cannot silently drift.
 */

const LEGACY_RUBRIC_PATH = '/plantillas';
const RUBRIC_PATH = '/rubricas';

/** New location for a legacy path, or `null` when the path did not move. */
export function legacyRubricRedirect(pathname: string, search = ''): string | null {
	if (pathname !== LEGACY_RUBRIC_PATH && !pathname.startsWith(`${LEGACY_RUBRIC_PATH}/`)) {
		return null;
	}
	return `${RUBRIC_PATH}${pathname.slice(LEGACY_RUBRIC_PATH.length)}${search}`;
}
