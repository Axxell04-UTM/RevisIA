import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { linkSubmissionFileToActivity } from '#lib/server/repositories/submission.js';

/**
 * POST /api/activities/[id]/files
 * Body: { fileId: string }
 *
 * Stages ONE delivery file in the activity, after the browser already uploaded
 * it through `/api/uploads/sign` → R2 → `/api/uploads/confirm`.
 *
 * This is the single-PDF path that the ZIP ingest did not cover: a teacher who
 * downloaded one student's delivery from Moodle does not have to zip it first.
 * The file lands next to the ZIP ones, in "Archivos pendientes", so processing
 * it is the same decision as any other staged file.
 *
 * Only a confirmed file is accepted (`sha256` set by confirm), and the response
 * never echoes storage keys or bytes.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Actividad inválida' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const { fileId } = body as { fileId?: string };
	if (!fileId) return json({ error: 'fileId requerido' }, { status: 400 });

	const staged = await linkSubmissionFileToActivity(locals.user.id, params.id, fileId);
	if (!staged) {
		return json(
			{
				error:
					'El archivo no existe, no está confirmado o no pertenece a este docente y actividad'
			},
			{ status: 404 }
		);
	}

	return json({ file: staged });
};
