import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processUploadedFile } from '#lib/server/file-extraction.js';

/** POST /api/files/process
 *  Body: { fileId: string }
 *  Descarga el PDF de R2, extrae texto con unpdf, detecta si es escaneo.
 *  Actualiza el registro `file` con `extractedText`, `extraction` (ok/empty/failed) y `pages`.
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

	let result;
	try {
		result = await processUploadedFile(fileId);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error procesando archivo';
		console.error('[files/process]', error);
		return json({ ok: false, error: message, hasTextLayer: false, pages: 0 }, { status: 500 });
	}

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