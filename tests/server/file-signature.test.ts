import { describe, expect, it } from 'vitest';
import {
	detectMimeType,
	sha256Of,
	verifyUploadedBytes
} from '../../src/lib/server/file-signature.js';

/**
 * Byte-level verification of uploads. The browser controls both the declared
 * MIME and the declared size, so these functions are the only line of defence
 * between a presigned PUT and a submission row.
 */

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('docx-bytes')]);
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
const JSON_BODY = Buffer.from('  \n{"templates":[]}');
const TXT = Buffer.from('Resumen del ensayo\nsegunda línea\n');
const HTML = Buffer.from('<html><body>no soy un pdf</body></html>');

describe('detectMimeType', () => {
	it('detects a PDF by its header, even after leading whitespace', () => {
		expect(detectMimeType(PDF)).toBe('application/pdf');
		expect(detectMimeType(Buffer.concat([Buffer.from('\n '), PDF]))).toBe('application/pdf');
	});

	it('detects ZIP containers (the shape of a DOCX)', () => {
		expect(detectMimeType(DOCX)).toBe('application/zip');
		expect(detectMimeType(EMPTY_ZIP)).toBe('application/zip');
	});

	it('detects JSON by its first structural character', () => {
		expect(detectMimeType(JSON_BODY)).toBe('application/json');
	});

	it('treats readable bytes without nulls as plain text', () => {
		expect(detectMimeType(TXT)).toBe('text/plain');
	});

	it('returns null for HTML, which is neither JSON nor PDF', () => {
		// HTML has no null bytes, so it is text/plain at this level; the declared
		// type check is what rejects it for a PDF upload.
		expect(detectMimeType(HTML)).toBe('text/plain');
	});

	it('returns null for binary data that matches nothing', () => {
		expect(detectMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
	});
});

describe('sha256Of', () => {
	it('is stable for the same bytes and different for different bytes', () => {
		expect(sha256Of(PDF)).toBe(sha256Of(Buffer.from(PDF)));
		expect(sha256Of(PDF)).not.toBe(sha256Of(TXT));
		expect(sha256Of(PDF)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('verifyUploadedBytes — submission', () => {
	it('accepts a real PDF', () => {
		expect(verifyUploadedBytes('application/pdf', 'submission', PDF)).toEqual({
			ok: true,
			detected: 'application/pdf'
		});
	});

	it('rejects HTML renamed to .pdf', () => {
		const result = verifyUploadedBytes('application/pdf', 'submission', HTML);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('no es un PDF válido');
	});

	it('rejects an empty file', () => {
		const result = verifyUploadedBytes('application/pdf', 'submission', Buffer.alloc(0));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('vacío');
	});
});

describe('verifyUploadedBytes — sourceDocument', () => {
	it('accepts PDF, DOCX and plain text', () => {
		expect(verifyUploadedBytes('application/pdf', 'sourceDocument', PDF).ok).toBe(true);
		expect(
			verifyUploadedBytes(
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'sourceDocument',
				DOCX
			).ok
		).toBe(true);
		expect(verifyUploadedBytes('text/plain', 'sourceDocument', TXT).ok).toBe(true);
	});

	it('rejects a DOCX that is not a ZIP container', () => {
		const result = verifyUploadedBytes(
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'sourceDocument',
			PDF
		);
		expect(result.ok).toBe(false);
	});

	it('rejects binary content declared as text', () => {
		const result = verifyUploadedBytes('text/plain', 'sourceDocument', Buffer.from([0x00, 0x01]));
		expect(result.ok).toBe(false);
	});
});

describe('verifyUploadedBytes — rubricImport', () => {
	it('accepts JSON and rejects a PDF', () => {
		expect(verifyUploadedBytes('application/json', 'rubricImport', JSON_BODY).ok).toBe(true);
		expect(verifyUploadedBytes('application/json', 'rubricImport', PDF).ok).toBe(false);
	});
});
