import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { file } from '#lib/server/db/schema/academic.js';
import { UPLOAD_LIMITS, getObjectBuffer, type UploadContext } from '#lib/server/r2.js';
import { sha256Of, verifyUploadedBytes } from '#lib/server/file-signature.js';

/**
 * POST /api/uploads/confirm
 * Body: { fileId: string }
 *
 * Runs after the browser PUTs the bytes straight to Filebase. Nothing the
 * browser said earlier is trusted: the object is downloaded, the real size is
 * checked against the context limit, the SHA-256 is computed from the bytes,
 * and the magic numbers must match the declared MIME. Only then is the row
 * marked as received (`sha256` non-empty), which is what submissions require.
 *
 * Responds `{ file, duplicateOf }`: `duplicateOf` is the id of an earlier file
 * by the same teacher with identical bytes, so the UI can offer to reuse it.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const { fileId } = body as { fileId?: string };
	if (!fileId) return json({ error: 'fileId requerido' }, { status: 400 });

	const db = getDb();
	const [record] = await db
		.select()
		.from(file)
		.where(eq(file.id, fileId))
		.limit(1);

	if (!record || record.uploadedBy !== locals.user.id) {
		return json({ error: 'Archivo no encontrado' }, { status: 404 });
	}
	if (record.sha256) {
		// Idempotent: a retried confirm returns the same result instead of re-downloading.
		return json({ file: record, duplicateOf: null });
	}

	const context = (record.uploadContext ?? 'submission') as UploadContext;
	const limits = UPLOAD_LIMITS[context] ?? UPLOAD_LIMITS.submission;

	if (record.sizeBytes > limits.maxSize) {
		await db.update(file).set({ extraction: 'failed' }).where(eq(file.id, fileId));
		return json({ error: 'El archivo declarado supera el límite permitido' }, { status: 400 });
	}

	let buffer: Buffer;
	try {
		buffer = await getObjectBuffer(record.storageKey);
	} catch {
		return json(
			{ error: 'El archivo no llegó al almacenamiento. Reintentá la subida.' },
			{ status: 409 }
		);
	}

	if (buffer.length > limits.maxSize) {
		await db.update(file).set({ extraction: 'failed' }).where(eq(file.id, fileId));
		return json({ error: 'El archivo real supera el límite permitido' }, { status: 413 });
	}

	const verification = verifyUploadedBytes(record.mime, context, buffer);
	if (!verification.ok) {
		await db.update(file).set({ extraction: 'failed' }).where(eq(file.id, fileId));
		return json({ error: verification.error }, { status: 400 });
	}

	const sha256 = sha256Of(buffer);

	const [duplicate] = await db
		.select({ id: file.id })
		.from(file)
		.where(and(eq(file.sha256, sha256), eq(file.uploadedBy, locals.user.id)))
		.limit(1);

	const [updated] = await db
		.update(file)
		.set({ sha256, sizeBytes: buffer.length })
		.where(eq(file.id, fileId))
		.returning();

	return json({
		file: updated,
		duplicateOf: duplicate && duplicate.id !== fileId ? duplicate.id : null
	});
};
