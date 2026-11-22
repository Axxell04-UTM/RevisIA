import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { activity } from '#lib/server/db/schema/academic.js';
import { isUuid } from '#lib/server/repositories/rubric.js';

/**
 * DELETE /api/activities/[id]/zip — unlink the deliveries ZIP from the activity.
 *
 * The extracted `file` rows stay: they are still valid deliveries waiting to be
 * grouped in review. Only the editor's pointer is cleared, so the upload box
 * comes back empty on the next load.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Actividad inválida' }, { status: 400 });

	const [updated] = await getDb()
		.update(activity)
		.set({ submissionsZipFileId: null, submissionsZipFileCount: 0, updatedAt: new Date() })
		.where(
			and(
				eq(activity.id, params.id),
				eq(activity.createdBy, locals.user.id),
				isNull(activity.deletedAt)
			)
		)
		.returning({ id: activity.id });

	if (!updated) return json({ error: 'Actividad no encontrada' }, { status: 404 });
	return json({ ok: true });
};
