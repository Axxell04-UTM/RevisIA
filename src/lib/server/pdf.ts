import { presignedGet } from './r2.js';
import { extractPdfText } from './file-extraction.js';

export interface ExtractionResult {
	success: boolean;
	text: string;
	pages: number;
	hasTextLayer: boolean;
	error?: string;
}

/**
 * Descarga el PDF desde R2 usando presigned GET, extrae texto con unpdf
 * y detecta si es un escaneo (sin capa de texto).
 */
export async function extractPdfFromR2(storageKey: string): Promise<ExtractionResult> {
	try {
		const url = await presignedGet(storageKey);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Error descargando de R2: ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();

		return await extractPdfText(Buffer.from(arrayBuffer));
	} catch (error: any) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: error?.message ?? 'Error desconocido extrayendo PDF'
		};
	}
}

/**
 * Versión que recibe un Buffer directamente (para uso en workers o tests).
 */
export async function extractPdfFromBuffer(buffer: Buffer): Promise<ExtractionResult> {
	return extractPdfText(buffer);
}

/**
 * Procesa un archivo subido: descarga de R2, extrae texto, actualiza registro en DB.
 * Devuelve el texto extraído y si tiene capa de texto.
 */
export async function processUploadedFile(fileId: string): Promise<ExtractionResult> {
	const { getDb } = await import('#lib/server/db/index.js');
	const { file } = await import('#lib/server/db/schema/academic.js');
	const { eq } = await import('drizzle-orm');

	const db = getDb();

	const [record] = await db.select().from(file).where(eq(file.id, fileId)).limit(1);
	if (!record) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: 'Archivo no encontrado en DB'
		};
	}

	await db.update(file).set({ extraction: 'pending' as const }).where(eq(file.id, fileId));

	const result = await extractPdfFromR2(record.storageKey);

	const extractionStatus = result.success ? (result.hasTextLayer ? 'ok' : 'empty') : 'failed';

	await db
		.update(file)
		.set({
			extractedText: result.success ? result.text : null,
			extraction: extractionStatus as 'pending' | 'ok' | 'empty' | 'failed'
		})
		.where(eq(file.id, fileId));

	return result;
}
