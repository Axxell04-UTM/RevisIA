import { getDocumentProxy, extractText } from 'unpdf';
import { extractRawText as extractDocx } from 'mammoth';
import { getClient, getBucket, presignedGet } from './r2.js';
import {
	buildModelAttempts,
	exhaustedMessage,
	isRetryableStatus
} from '#lib/domain/ai-retry.js';

const MIN_CHARS_PER_PAGE = 80; // umbral para considerar que el PDF tiene capa de texto
const VISION_PROMPT = `Extrae todo el texto visible en este documento escaneado (PDF).
Devuelve únicamente el texto extraído, sin comentarios, sin formato markdown, sin explicaciones.
Si hay múltiples páginas, concatena el texto de todas separadas por dobles saltos de línea.
Si el documento está ilegible o vacío, devuelve "NO_LEGIBLE".`;

export type SupportedMimeType =
	| 'application/pdf'
	| 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	| 'text/plain';

export interface ExtractionResult {
	success: boolean;
	text: string;
	pages: number;
	hasTextLayer: boolean;
	error?: string;
}

/**
 * Extrae texto de un PDF usando unpdf.
 *
 * unpdf 2.x rejects a Node `Buffer` (it demands a real `Uint8Array`) and
 * returns `{ totalPages, text }` instead of a bare string or array, so both
 * details are handled here once, for every caller.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
	try {
		const bytes = new Uint8Array(buffer);
		const pdf = await getDocumentProxy(bytes);
		const { totalPages, text } = await extractText(pdf, { mergePages: false });

		const pages = Array.isArray(text) ? text : [String(text ?? '')];
		const fullText = pages.join('\n\n');
		const pageCount = totalPages > 0 ? totalPages : pages.length;

		const avgCharsPerPage = pageCount > 0 ? fullText.trim().length / pageCount : 0;
		const hasTextLayer = avgCharsPerPage >= MIN_CHARS_PER_PAGE;

		return {
			success: true,
			text: fullText.trim(),
			pages: pageCount,
			hasTextLayer
		};
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

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
	return extractPdfText(buffer);
}

/**
 * Extrae texto de un DOCX usando mammoth.
 */
async function extractDocxText(buffer: Buffer): Promise<ExtractionResult> {
	try {
		const result = await extractDocx({ buffer });
		const text = result.value.trim();
		// mammoth no da número de páginas, estimamos 1 "página" por cada ~3000 chars
		const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));
		return {
			success: true,
			text,
			pages: estimatedPages,
			hasTextLayer: true // DOCX siempre tiene capa de texto
		};
	} catch (error: any) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: error?.message ?? 'Error desconocido extrayendo DOCX'
		};
	}
}

/**
 * Extrae texto de un archivo TXT plano.
 */
async function extractTxtText(buffer: Buffer): Promise<ExtractionResult> {
	try {
		const text = buffer.toString('utf-8').trim();
		const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));
		return {
			success: true,
			text,
			pages: estimatedPages,
			hasTextLayer: true
		};
	} catch (error: any) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: error?.message ?? 'Error desconocido leyendo TXT'
		};
	}
}

/**
 * Extrae texto de un archivo sostenido en R2 usando presigned GET.
 */
export async function extractFileFromR2(storageKey: string, mimeType: SupportedMimeType): Promise<ExtractionResult> {
	try {
		const url = await presignedGet(storageKey);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Error descargando de R2: ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		switch (mimeType) {
			case 'application/pdf':
				return extractPdf(buffer);
			case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
				return extractDocxText(buffer);
			case 'text/plain':
				return extractTxtText(buffer);
			default:
				return {
					success: false,
					text: '',
					pages: 0,
					hasTextLayer: false,
					error: `Tipo MIME no soportado: ${mimeType}`
				};
		}
	} catch (error: any) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: error?.message ?? 'Error descargando/extrayendo archivo'
		};
	}
}

/**
 * Procesa un archivo subido: descarga de R2, extrae texto, actualiza registro en DB.
 */
export async function processUploadedFile(fileId: string): Promise<ExtractionResult> {
	const { getDb } = await import('#lib/server/db/index.js');
	const { file } = await import('#lib/server/db/schema/academic.js');
	const { eq } = await import('drizzle-orm');

	const db = getDb();

	const [record] = await db.select().from(file).where(eq(file.id, fileId)).limit(1);
	if (!record) {
		return { success: false, text: '', pages: 0, hasTextLayer: false, error: 'Archivo no encontrado en DB' };
	}

	// Marcar como procesando
	await db.update(file).set({ extraction: 'pending' as const }).where(eq(file.id, fileId));

	// Extraer según tipo MIME
	const result = await extractFileFromR2(record.storageKey, record.mime as SupportedMimeType);

	// Actualizar registro
	const extractionStatus = result.success
		? (result.hasTextLayer ? 'ok' : 'empty')
		: 'failed';

	await db.update(file).set({
		extractedText: result.success ? result.text : null,
		extraction: extractionStatus as 'pending' | 'ok' | 'empty' | 'failed'
	}).where(eq(file.id, fileId));

	return result;
}

/**
 * Versión que recibe un Buffer directamente (para uso en workers o tests).
 */
export async function extractFileFromBuffer(buffer: Buffer, mimeType: SupportedMimeType): Promise<ExtractionResult> {
	switch (mimeType) {
		case 'application/pdf':
			return extractPdf(buffer);
		case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
			return extractDocxText(buffer);
		case 'text/plain':
			return extractTxtText(buffer);
		default:
			return {
				success: false,
				text: '',
				pages: 0,
				hasTextLayer: false,
				error: `Tipo MIME no soportado: ${mimeType}`
			};
	}
}

/**
 * Extrae texto de un PDF escaneado usando visión del modelo (Gemini).
 * Solo funciona con proveedor Google (Gemini) que acepta PDF directo.
 *
 * La credencial y los modelos salen de la misma configuración que el resto de
 * las llamadas (`/admin/api-keys` + Ajustes), y un 503 de Gemini se reintenta
 * con el modelo de respaldo antes de rendirse.
 */
export async function extractPdfWithVision(
	buffer: Buffer,
	teacherId: string | null = null
): Promise<ExtractionResult> {
	const { resolveAiConfig } = await import('./ai-config.js');
	const config = await resolveAiConfig(teacherId, 'google');

	if (!config.apiKey) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: 'Falta una API key de Google para extracción con visión (cargala en /admin/api-keys)'
		};
	}

	const base64Pdf = buffer.toString('base64');
	const body = {
		contents: [{
			role: 'user',
			parts: [
				{ text: VISION_PROMPT },
				{ inline_data: { mime_type: 'application/pdf', data: base64Pdf } }
			]
		}],
		generationConfig: {
			temperature: 0.1,
			maxOutputTokens: 8192,
		},
	};

	const attempts = buildModelAttempts(config.primaryModel, config.fallbackModel);
	const failures: { model: string; message: string }[] = [];

	try {
		for (const [index, attempt] of attempts.entries()) {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(attempt.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				failures.push({ model: attempt.model, message: `Gemini Vision ${res.status}: ${text.slice(0, 400)}` });
				const next = attempts[index + 1];
				if (!next || !isRetryableStatus(res.status)) break;
				console.warn(
					`[vision] Gemini falló con ${attempt.model}; reintentando con ${next.model}: ${res.status}`
				);
				continue;
			}

			const data = await res.json();
			const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

			if (!textOut || textOut === 'NO_LEGIBLE') {
				return {
					success: false,
					text: '',
					pages: 0,
					hasTextLayer: false,
					error: 'El modelo no pudo extraer texto legible del PDF escaneado'
				};
			}

			// Estimar páginas basado en longitud del texto
			const estimatedPages = Math.max(1, Math.ceil(textOut.length / 3000));

			return {
				success: true,
				text: textOut,
				pages: estimatedPages,
				hasTextLayer: true // ahora sí tiene texto extraído
			};
		}
	} catch (error: any) {
		return {
			success: false,
			text: '',
			pages: 0,
			hasTextLayer: false,
			error: error?.message ?? 'Error en extracción con visión'
		};
	}

	return {
		success: false,
		text: '',
		pages: 0,
		hasTextLayer: false,
		error: exhaustedMessage(failures)
	};
}

/**
 * Procesa un archivo con fallback automático a visión si no tiene capa de texto.
 * Solo aplica a PDFs y solo si el proveedor es Google (Gemini).
 */
export async function processUploadedFileWithVisionFallback(
	fileId: string,
	teacherId: string | null = null
): Promise<ExtractionResult> {
	const { getDb } = await import('#lib/server/db/index.js');
	const { file } = await import('#lib/server/db/schema/academic.js');
	const { eq } = await import('drizzle-orm');

	const db = getDb();

	const [record] = await db.select().from(file).where(eq(file.id, fileId)).limit(1);
	if (!record) {
		return { success: false, text: '', pages: 0, hasTextLayer: false, error: 'Archivo no encontrado en DB' };
	}

	// Marcar como procesando
	await db.update(file).set({ extraction: 'pending' as const }).where(eq(file.id, fileId));

	// Extracción normal primero
	const result = await extractFileFromR2(record.storageKey, record.mime as SupportedMimeType);

	// Si es PDF sin capa de texto y hay credencial de Google, intentar visión
	let finalResult = result;
	if (record.mime === 'application/pdf' && result.success && !result.hasTextLayer) {
		const { resolveAiConfig } = await import('./ai-config.js');
		// Vision only exists on Gemini, so the credential is resolved for Google
		// even when the teacher's default provider is another one.
		const visionConfig = await resolveAiConfig(teacherId, 'google');

		if (visionConfig.apiKey) {
			// Descargar buffer para visión
			try {
				const url = await presignedGet(record.storageKey);
				const response = await fetch(url);
				if (response.ok) {
					const arrayBuffer = await response.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);
					const visionResult = await extractPdfWithVision(buffer, teacherId);
					if (visionResult.success) {
						finalResult = visionResult;
					}
				}
			} catch {
				// Si falla la visión, mantener resultado original
			}
		}
	}

	// Actualizar registro
	const extractionStatus = finalResult.success
		? (finalResult.hasTextLayer ? 'ok' : 'empty')
		: 'failed';

	await db.update(file).set({
		extractedText: finalResult.success ? finalResult.text : null,
		extraction: extractionStatus as 'pending' | 'ok' | 'empty' | 'failed'
	}).where(eq(file.id, fileId));

	return finalResult;
}