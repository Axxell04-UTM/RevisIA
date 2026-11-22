import { createHash } from 'node:crypto';

/**
 * File identity and type verification.
 *
 * The browser picks the `Content-Type` it declares, so nothing that arrives
 * from a presigned PUT can be trusted: a `.pdf` can be an HTML page, and a
 * declared size can differ from the bytes actually stored. Before a file is
 * accepted these helpers read the real bytes: magic numbers decide the type and
 * `sha256` decides identity (dedupe, F2.5).
 */

export type DetectedMimeType =
	| 'application/pdf'
	| 'application/zip'
	| 'application/json'
	| 'text/plain';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PDF_HEADER = '%PDF-';
const ZIP_HEADERS = [
	Buffer.from([0x50, 0x4b, 0x03, 0x04]),
	Buffer.from([0x50, 0x4b, 0x05, 0x06]),
	Buffer.from([0x50, 0x4b, 0x07, 0x08])
];

export function sha256Of(buffer: Buffer): string {
	return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sniffs the type from the bytes themselves.
 *
 * DOCX is a ZIP container, so it can only be described as `application/zip` at
 * this level; the extension (already sanitized into the storage key) and the
 * declared MIME carry the rest. Returns `null` when nothing matches.
 */
export function detectMimeType(buffer: Buffer): DetectedMimeType | null {
	// The signature must be at the start (after optional whitespace/BOM), never
	// anywhere in the first KB: a ZIP that *contains* a PDF would otherwise be
	// reported as a PDF, and so would any file with an embedded `%PDF-` string.
	const firstTextByte = findFirstNonWhitespace(buffer);
	if (
		firstTextByte !== -1 &&
		buffer.subarray(firstTextByte, firstTextByte + PDF_HEADER.length).toString('latin1') ===
			PDF_HEADER
	) {
		return 'application/pdf';
	}

	if (ZIP_HEADERS.some((magic) => buffer.subarray(0, 4).equals(magic))) return 'application/zip';

	if (firstTextByte !== -1) {
		const char = buffer[firstTextByte];
		if (char === 0x7b || char === 0x5b) return 'application/json';
		if (!hasNullByte(buffer.subarray(0, 8192))) return 'text/plain';
	}

	return null;
}

/**
 * Checks that the bytes match what the client declared for the upload context.
 *
 * `submission` only accepts real PDFs; `sourceDocument` accepts PDF, DOCX (a
 * ZIP container) and plain text; `rubricImport` accepts JSON.
 */
export function verifyUploadedBytes(
	declaredMime: string,
	context: 'submission' | 'submissionZip' | 'sourceDocument' | 'rubricImport',
	buffer: Buffer
): { ok: true; detected: DetectedMimeType } | { ok: false; error: string } {
	if (buffer.length === 0) {
		return { ok: false, error: 'El archivo está vacío' };
	}

	const detected = detectMimeType(buffer);

	if (context === 'submissionZip') {
		if (detected !== 'application/zip') {
			return { ok: false, error: 'El archivo no es un ZIP válido (firma PK ausente)' };
		}
		return { ok: true, detected };
	}

	if (context === 'rubricImport') {
		if (detected !== 'application/json') {
			return { ok: false, error: 'El archivo no es JSON válido' };
		}
		return { ok: true, detected };
	}

	// DOCX is a ZIP container, so the bytes alone cannot tell it from any other
	// ZIP; the declared type identifies it and the container proves it is real.
	if (declaredMime === DOCX_MIME) {
		if (detected !== 'application/zip') {
			return { ok: false, error: 'El archivo no es un DOCX válido (contenedor ZIP ausente)' };
		}
		return { ok: true, detected };
	}

	if (declaredMime === 'application/pdf') {
		if (detected !== 'application/pdf') {
			return { ok: false, error: 'El archivo no es un PDF válido (firma %PDF- ausente)' };
		}
		return { ok: true, detected };
	}

	if (context === 'submission') {
		return { ok: false, error: 'Las entregas deben ser PDF o DOCX' };
	}

	// sourceDocument: the remaining allowed type is plain text.
	if (declaredMime === 'text/plain') {
		if (detected !== 'text/plain') {
			return { ok: false, error: 'El archivo no es texto plano válido' };
		}
		return { ok: true, detected };
	}

	return { ok: false, error: `Tipo de archivo no soportado en este contexto: ${declaredMime}` };
}

function findFirstNonWhitespace(buffer: Buffer): number {
	for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
		const byte = buffer[i];
		if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return i;
	}
	return -1;
}

function hasNullByte(buffer: Buffer): boolean {
	return buffer.includes(0);
}
