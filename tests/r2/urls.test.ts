import { describe, expect, it } from 'vitest';
import {
	UPLOAD_LIMITS,
	makeStorageKey,
	presignedGet,
	presignedPut,
	validateUpload
} from '../../src/lib/server/r2.js';

/**
 * Upload rules and presigned URLs. Presigning is pure local signing (no network,
 * no bucket needed), so these tests pin the security-relevant parts: which
 * types and sizes a browser may ask for, that keys are unique and unguessable,
 * and that the URLs really expire in 15 minutes.
 *
 * The environment comes from `tests/setup.ts` (fake account and credentials).
 */

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MB = 1024 * 1024;

describe('validateUpload', () => {
	it('accepts a pdf submission up to the limit', () => {
		expect(validateUpload(PDF, 1 * MB, 'submission')).toEqual({ ok: true, contentType: PDF });
		expect(validateUpload(PDF, UPLOAD_LIMITS.submission.maxSize, 'submission')).toEqual({ ok: true, contentType: PDF });
	});

	it('rejects a submission over the limit and says how big it was', () => {
		const result = validateUpload(PDF, UPLOAD_LIMITS.submission.maxSize + 1, 'submission');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Archivo demasiado grande');
			expect(result.error).toContain('Máximo: 25 MB');
		}
	});

	it('accepts PDF and DOCX as deliveries, since a DOCX is a real submission too', () => {
		expect(validateUpload(DOCX, 1 * MB, 'submission')).toEqual({ ok: true, contentType: DOCX });
	});

	it('rejects types outside the context allowlist and lists what is allowed', () => {
		const result = validateUpload('text/plain', 1 * MB, 'submission');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Tipo de archivo no permitido: text/plain');
			expect(result.error).toContain(PDF);
		}
	});

	it('keeps ZIP archives out of the single-file context and gives them their own limit', () => {
		expect(validateUpload('application/zip', 1 * MB, 'submission').ok).toBe(false);
		expect(validateUpload('application/zip', 1 * MB, 'submissionZip')).toEqual({ ok: true, contentType: 'application/zip' });
		expect(UPLOAD_LIMITS.submissionZip.maxSize).toBe(50 * MB);
	});

	it('accepts ZIP MIME aliases for ZIP uploads', () => {
		const xzip = 'application/x-zip-compressed';
		const result = validateUpload(xzip, 1 * MB, 'submissionZip');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.contentType).toBe('application/zip'); // normalized
		}
	});

	it('gives source documents a wider allowlist', () => {
		expect(validateUpload(DOCX, 1 * MB, 'sourceDocument')).toEqual({ ok: true, contentType: DOCX });
		expect(validateUpload('text/plain', 1 * MB, 'sourceDocument')).toEqual({ ok: true, contentType: 'text/plain' });
	});

	it('keeps rubric imports small', () => {
		expect(validateUpload('application/json', 1 * MB, 'rubricImport')).toEqual({ ok: true, contentType: 'application/json' });
		expect(validateUpload('application/json', 2 * MB, 'rubricImport').ok).toBe(false);
		expect(validateUpload(PDF, 1 * MB, 'rubricImport').ok).toBe(false);
	});

	it('falls back to the submission rules for an unknown context', () => {
		expect(validateUpload(PDF, 1 * MB, 'otro' as never)).toEqual({ ok: true, contentType: PDF });
		expect(validateUpload('image/png', 1 * MB, 'otro' as never).ok).toBe(false);
	});
});

describe('makeStorageKey', () => {
	it('builds a prefixed key with a lowercase extension', () => {
		expect(makeStorageKey('submission', 'Tarea Final.PDF')).toMatch(
			/^submission\/[0-9a-f]{16}\.pdf$/
		);
	});

	it('never reuses a key, even for the same file name', () => {
		const keys = new Set(
			Array.from({ length: 20 }, () => makeStorageKey('sourceDocument', 'consigna.pdf'))
		);

		expect(keys.size).toBe(20);
	});

	it('falls back to .bin when the name has no extension', () => {
		expect(makeStorageKey('rubricImport', 'plantillas')).toMatch(/^rubricImport\/[0-9a-f]{16}\.bin$/);
	});

	it('never lets the original name inject separators into the key', () => {
		expect(makeStorageKey('submission', '../../etc/passwd')).toMatch(
			/^submission\/[0-9a-f]{16}\.bin$/
		);
		expect(makeStorageKey('submission', 'nota/2026.tarea.pdf')).toMatch(
			/^submission\/[0-9a-f]{16}\.pdf$/
		);
	});
});

describe('presignedPut', () => {
	it('signs a 15-minute URL against the configured bucket', async () => {
		const url = new URL(await presignedPut('submission/abc.pdf', PDF));

		expect(url.protocol).toBe('https:');
		// The host should be virtual-hosted style: <bucket>.<endpoint-host>
		// Works for both Filebase (<bucket>.s3.filebase.com) and R2 (<bucket>.<account>.r2.cloudflarestorage.com)
		const bucket = process.env.FILEBASE_BUCKET ?? process.env.R2_BUCKET ?? 'revisia-test';
		const endpointHost = process.env.FILEBASE_ENDPOINT
			? new URL(process.env.FILEBASE_ENDPOINT).host
			: `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
		expect(url.host).toBe(`${bucket}.${endpointHost}`);
		expect(url.pathname).toBe('/submission/abc.pdf');
		expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
		expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('produces a different signature for a different key', async () => {
		const first = await presignedPut('submission/uno.pdf', PDF);
		const second = await presignedPut('submission/dos.pdf', PDF);

		expect(first).not.toBe(second);
	});

	it('signs only the host, so no browser-owned header can break the signature', async () => {
		const url = new URL(await presignedPut('submission/abc.pdf', PDF));

		// The real type is verified from the bytes on confirm, not from the
		// signature: binding a header the browser normalises causes 403s.
		const signedHeaders = decodeURIComponent(url.searchParams.get('X-Amz-SignedHeaders') ?? '');
		expect(signedHeaders).toBe('host');
	});

	it('never signs content-length, which a browser PUT cannot mirror exactly', async () => {
		const url = new URL(await presignedPut('submission/abc.pdf', PDF));

		// Filebase answers 403 AccessDenied when the signed length is absent or
		// normalised differently; confirm enforces the real size instead.
		const signedHeaders = decodeURIComponent(url.searchParams.get('X-Amz-SignedHeaders') ?? '');
		expect(signedHeaders).not.toContain('content-length');
	});

	it('does not sign a request checksum, which a browser PUT of the real bytes cannot satisfy', async () => {
		const url = new URL(await presignedPut('submission/abc.pdf', PDF));

		// SDK >= 3.729 would otherwise add CRC32 of the empty presign body.
		expect(url.searchParams.get('x-amz-checksum-crc32')).toBeNull();
		expect(url.searchParams.get('x-amz-sdk-checksum-algorithm')).toBeNull();
	});
});

describe('presignedGet', () => {
	it('signs a 15-minute read URL on the same endpoint', async () => {
		const url = new URL(await presignedGet('submission/abc.pdf'));

		const bucket = process.env.FILEBASE_BUCKET ?? process.env.R2_BUCKET ?? 'revisia-test';
		const endpointHost = process.env.FILEBASE_ENDPOINT
			? new URL(process.env.FILEBASE_ENDPOINT).host
			: `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
		expect(url.host).toBe(`${bucket}.${endpointHost}`);
		expect(url.pathname).toBe('/submission/abc.pdf');
		expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
		expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
	});
});
