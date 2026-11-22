import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importStudents } from '#lib/server/repositories/student.js';

/**
 * POST /api/subjects/[id]/students/import
 *
 * Body: the raw CSV as `text/csv` (or JSON `{ csv: string }`).
 *
 * The CSV is parsed server-side and imported idempotently by `match_key`, so
 * re-uploading the same export is a no-op instead of a roster full of twins.
 * Partial success is the normal outcome: one broken row does not discard the
 * other thirty-nine.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const contentType = request.headers.get('content-type') ?? '';
	let csv: string;

	if (contentType.includes('application/json')) {
		const body = (await request.json().catch(() => ({}))) as { csv?: string };
		if (!body.csv) return json({ error: 'Enviá { csv }' }, { status: 400 });
		csv = body.csv;
	} else {
		csv = await request.text();
	}

	if (!csv.trim()) return json({ error: 'El CSV está vacío' }, { status: 400 });

	try {
		const result = await importStudents(locals.user.id, params.id, csv);
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error importando el padrón';
		return json({ error: message }, { status: 400 });
	}
};
