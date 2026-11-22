import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { activity, activityFile, file } from '#lib/server/db/schema/academic.js';
import { getObjectBuffer, makeStorageKey, putObject } from '#lib/server/r2.js';
import { extractSubmissionZip } from '#lib/server/zip-ingest.js';
import { isUuid } from '#lib/server/repositories/rubric.js';

/**
 * POST /api/uploads/zip
 * Body: { fileId: string, activityId?: string }
 *
 * The teacher uploads one ZIP straight to Filebase. This endpoint downloads it,
 * expands it under the safe limits in `zip-ingest.ts` (zip-slip, zip bombs,
 * inflated size, magic bytes), stores each accepted PDF/DOCX as its own `file`
 * row and returns what went in and what was rejected, with reasons.
 *
 * When `activityId` belongs to the same teacher the activity is linked to the
 * ZIP and to how many files it produced, so reopening the editor shows the
 * archive instead of an empty upload box.
 *
 * It does NOT create submissions: grouping files into deliveries is a review
 * decision (F2.10), and the teacher must be able to fix a bad match first.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const { fileId, activityId } = body as { fileId?: string; activityId?: string };
	if (!fileId) return json({ error: 'fileId requerido' }, { status: 400 });

	const db = getDb();

	let targetActivityId: string | null = null;
	if (activityId) {
		if (!isUuid(activityId)) return json({ error: 'Actividad inválida' }, { status: 400 });
		const [owned] = await db
			.select({ id: activity.id })
			.from(activity)
			.where(
				and(
					eq(activity.id, activityId),
					eq(activity.createdBy, locals.user.id),
					isNull(activity.deletedAt)
				)
			)
			.limit(1);
		if (!owned) return json({ error: 'Actividad no encontrada' }, { status: 404 });
		targetActivityId = owned.id;
	}

	const [archive] = await db
		.select()
		.from(file)
		.where(and(eq(file.id, fileId), eq(file.uploadedBy, locals.user.id)))
		.limit(1);

	if (!archive) return json({ error: 'Archivo no encontrado' }, { status: 404 });
	if (archive.uploadContext !== 'submissionZip') {
		return json({ error: 'Ese archivo no es un ZIP de entregas' }, { status: 400 });
	}
	if (!archive.sha256) {
		return json(
			{ error: 'El ZIP todavía no fue confirmado. Reintentá la subida.' },
			{ status: 409 }
		);
	}

	let buffer: Buffer;
	try {
		buffer = await getObjectBuffer(archive.storageKey);
	} catch {
		return json({ error: 'No se pudo leer el ZIP desde el almacenamiento' }, { status: 409 });
	}

	let result;
	try {
		result = await extractSubmissionZip(buffer);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'El ZIP no se pudo abrir' },
			{ status: 400 }
		);
	}

	if (result.accepted.length === 0) {
		return json({ accepted: [], rejected: result.rejected, totalUncompressed: 0 });
	}

	const uploaded: { fileId: string; name: string; mime: string; sizeBytes: number; sha256: string }[] =
		[];

	for (const entry of result.accepted) {
		const key = makeStorageKey('submissions', entry.name);
		await putObject(key, entry.bytes, entry.mime);

		const [row] = await db
			.insert(file)
			.values({
				storageKey: key,
				bucket: 'submissions',
				originalName: entry.name,
				mime: entry.mime,
				sizeBytes: entry.bytes.length,
				sha256: entry.sha256,
				extraction: 'pending',
				uploadContext: 'submission',
				uploadedBy: locals.user.id
			})
			.returning({ id: file.id });

		uploaded.push({
			fileId: row.id,
			name: entry.name,
			mime: entry.mime,
			sizeBytes: entry.bytes.length,
			sha256: entry.sha256
		});
	}

	if (targetActivityId) {
		await db.insert(activityFile).values(
			uploaded.map((entry) => ({ activityId: targetActivityId, fileId: entry.fileId }))
		);

		await db
			.update(activity)
			.set({
				submissionsZipFileId: archive.id,
				submissionsZipFileCount: uploaded.length,
				updatedAt: new Date()
			})
			.where(eq(activity.id, targetActivityId));
	}

	return json({
		accepted: uploaded,
		rejected: result.rejected,
		totalUncompressed: result.totalUncompressed
	});
};
