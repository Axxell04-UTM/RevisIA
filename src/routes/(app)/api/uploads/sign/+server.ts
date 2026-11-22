import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { file } from '#lib/server/db/schema/academic.js';
import { validateUpload, makeStorageKey, presignedPut } from '#lib/server/r2.js';
import { eq } from 'drizzle-orm';

/** POST /api/uploads/sign
 *  Body: { fileName: string, contentType: string, size: number, context?: 'submission' | 'submissionZip' | 'sourceDocument' | 'rubricImport' }
 *  Returns: { uploadUrl: string, fileId: string, key: string, expiresIn: number }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'No autenticado' }, { status: 401 });
	}

	const db = getDb();
	const body = await request.json().catch(() => ({}));
	const { fileName, contentType, size, context = 'submission' } = body as {
		fileName?: string;
		contentType?: string;
		size?: number;
		context?: 'submission' | 'submissionZip' | 'sourceDocument' | 'rubricImport';
	};

	if (!fileName || !contentType || typeof size !== 'number') {
		return json({ error: 'fileName, contentType y size son requeridos' }, { status: 400 });
	}

	const validation = validateUpload(contentType, size, context);
	if (!validation.ok) {
		return json({ error: validation.error }, { status: 400 });
	}

	const key = makeStorageKey(context, fileName);
	const uploadUrl = await presignedPut(key, validation.contentType);

	// Create pending file record
	const [created] = await db
		.insert(file)
		.values({
			storageKey: key,
			bucket: context === 'sourceDocument' || context === 'rubricImport' ? context : 'submissions',
			originalName: fileName,
			mime: contentType,
			sizeBytes: size,
			sha256: '', // computed on confirm, from the stored bytes
			extraction: 'pending',
			uploadContext: context,
			uploadedBy: locals.user.id
		})
		.returning({ id: file.id });

	return json({
		uploadUrl,
		fileId: created.id,
		key,
		contentType: validation.contentType, // Return normalized type for the PUT header
		expiresIn: 900
	});
};