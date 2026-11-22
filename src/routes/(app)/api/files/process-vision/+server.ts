import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processUploadedFileWithVisionFallback } from '#lib/server/file-extraction.js';
import type { Config } from '@sveltejs/adapter-vercel';

// Vision fallback: one model call per page over a PDF without a text layer.
export const config: Config = { maxDuration: 60 };

/** POST /api/files/process-vision
 *  Body: { fileId: string }
 *  Fuerza re-procesamiento con visión (Gemini) para PDFs sin capa de texto.
 *  Solo funciona si AI_PROVIDER=google.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'No autenticado' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const { fileId } = body as { fileId?: string };

	if (!fileId) {
		return json({ error: 'fileId requerido' }, { status: 400 });
	}

	const result = await processUploadedFileWithVisionFallback(fileId, locals.user.id);

	if (!result.success) {
		return json(
			{ ok: false, error: result.error, hasTextLayer: false, pages: 0 },
			{ status: 500 }
		);
	}

	return json({
		ok: true,
		fileId,
		text: result.text,
		pages: result.pages,
		hasTextLayer: result.hasTextLayer,
		extraction: result.hasTextLayer ? 'ok' : 'empty'
	});
};