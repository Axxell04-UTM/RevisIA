import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { createSubmission, listSubmissions } from '#lib/server/repositories/submission.js';

/** GET /api/activities/[id]/submissions — all deliveries for the activity. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const submissions = await listSubmissions(locals.user.id, params.id);
	return json({ submissions });
};

/**
 * POST /api/activities/[id]/submissions { fileIds } — register a delivery.
 *
 * One file is an individual delivery. Several files in one call remain
 * supported for legacy group deliveries, but the review screen processes one
 * file per call and never groups a selection (a group is one delivery with
 * several members). The per-file processing route is
 * `/api/activities/[id]/files/[fileId]/process`.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Actividad inválida' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as { fileIds?: unknown };
	const fileIds = Array.isArray(body.fileIds)
		? body.fileIds.filter((value): value is string => typeof value === 'string')
		: [];

	if (fileIds.length === 0) return json({ error: 'Seleccioná al menos un archivo' }, { status: 400 });
	if (fileIds.some((id) => !isUuid(id))) return json({ error: 'Archivo inválido' }, { status: 400 });

	try {
		const { submission, duplicate } = await createSubmission(locals.user.id, {
			activityId: params.id,
			files: fileIds.map((fileId) => ({ fileId })),
			source: 'zip'
		});
		return json({ submission, duplicate });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'No se pudo crear la entrega';
		return json({ error: message }, { status: 400 });
	}
};
