import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	classifyEntry,
	extractSubmissionZip,
	ZIP_LIMITS,
	type EntryHeader
} from '../../src/lib/server/zip-ingest.js';
import { DOCX_BYTES, HTML_BYTES, makeZip, PDF_BYTES } from '../helpers/zip.js';

/**
 * A student ZIP is hostile input until proven otherwise. These tests cover the
 * three attacks that matter — zip-slip, zip bomb, type spoofing — plus the
 * everyday case of a folder full of PDFs.
 *
 * `classifyEntry` is tested directly because the interesting rejections must
 * happen *before* a byte is inflated; `extractSubmissionZip` is tested with real
 * archives to prove the wiring, not to re-prove the rules.
 */

/** A big, barely-compressible body that still starts with a PDF signature. */
function incompressiblePdf(size = 1_200_000): Buffer {
	return Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), randomBytes(size)]);
}

const header = (overrides: Partial<EntryHeader> = {}): EntryHeader => ({
	fileName: 'Perez_Juan_12345.pdf',
	generalPurposeBitFlag: 0,
	uncompressedSize: 1024,
	compressedSize: 512,
	...overrides
});

const fresh = { seen: 1, totalAccepted: 0 };

describe('classifyEntry', () => {
	it('accepts a Moodle-named PDF and keeps the extension', () => {
		expect(classifyEntry(header(), fresh)).toEqual({
			action: 'accept',
			baseName: 'Perez_Juan_12345.pdf',
			extension: 'pdf'
		});
	});

	it('accepts a DOCX', () => {
		const decision = classifyEntry(header({ fileName: 'Gomez_Ana_1.docx' }), fresh);

		expect(decision).toMatchObject({ action: 'accept', extension: 'docx' });
	});

	it.each([
		['../../.env', 'traversal'],
		['entregas/../../evil.pdf', 'traversal in the middle'],
		['/etc/passwd.pdf', 'absolute posix path'],
		['C:/Windows/x.pdf', 'absolute windows path'],
		['..\\..\\evil.pdf', 'windows separators']
	])('rejects %s (%s) as unsafe', (fileName) => {
		expect(classifyEntry(header({ fileName }), fresh)).toEqual({
			action: 'reject',
			reason: 'unsafe-path'
		});
	});

	it('rejects directories, OS metadata and unsupported extensions', () => {
		expect(classifyEntry(header({ fileName: 'carpeta/' }), fresh)).toMatchObject({
			reason: 'directory'
		});
		expect(classifyEntry(header({ fileName: '.DS_Store' }), fresh)).toMatchObject({
			reason: 'metadata'
		});
		expect(
			classifyEntry(header({ fileName: '__MACOSX/._Perez_Juan_1.pdf' }), fresh)
		).toMatchObject({ reason: 'metadata' });
		expect(classifyEntry(header({ fileName: 'notas.txt' }), fresh)).toMatchObject({
			reason: 'unsupported-type'
		});
		expect(classifyEntry(header({ fileName: 'virus.exe' }), fresh)).toMatchObject({
			reason: 'unsupported-type'
		});
	});

	it('rejects an encrypted entry without touching its bytes', () => {
		expect(classifyEntry(header({ generalPurposeBitFlag: 0x1 }), fresh)).toEqual({
			action: 'reject',
			reason: 'encrypted'
		});
	});

	it('rejects an entry above the per-entry limit', () => {
		expect(
			classifyEntry(header({ uncompressedSize: ZIP_LIMITS.maxEntrySize + 1 }), fresh)
		).toMatchObject({ reason: 'too-large' });
	});

	it('rejects an entry that would break the archive total', () => {
		expect(
			classifyEntry(
				header({ uncompressedSize: 500 }),
				{ seen: 1, totalAccepted: ZIP_LIMITS.maxTotalUncompressed - 100 }
			)
		).toMatchObject({ reason: 'total-too-large' });
	});

	it('rejects a bomb by ratio and spares a large well-compressed file', () => {
		// 2 MB declared, 2 KB compressed: ratio ~1000.
		expect(
			classifyEntry(
				header({ uncompressedSize: 2 * 1024 * 1024, compressedSize: 2048 }),
				fresh
			)
		).toMatchObject({ reason: 'suspicious-ratio' });

		// 1.2 MB declared, 1.1 MB compressed: ratio ~1.
		expect(
			classifyEntry(
				header({ uncompressedSize: 1_200_000, compressedSize: 1_100_000 }),
				fresh
			)
		).toMatchObject({ action: 'accept' });
	});

	it('ignores the ratio on small files, where it means nothing', () => {
		expect(
			classifyEntry(header({ uncompressedSize: 200, compressedSize: 1 }), fresh)
		).toMatchObject({ action: 'accept' });
	});

	it('rejects entries past the count limit', () => {
		expect(
			classifyEntry(header(), { seen: ZIP_LIMITS.maxEntries + 1, totalAccepted: 0 })
		).toMatchObject({ reason: 'too-many-entries' });
	});
});

describe('extractSubmissionZip — happy path', () => {
	it('extracts PDF and DOCX entries with their real type and hash', async () => {
		const zip = makeZip([
			{ name: 'Perez_Juan_12345.pdf', data: PDF_BYTES },
			{ name: 'Gomez_Ana_67890.docx', data: DOCX_BYTES }
		]);

		const result = await extractSubmissionZip(zip);

		expect(result.rejected).toEqual([]);
		expect(result.accepted).toHaveLength(2);
		expect(result.accepted[0]).toMatchObject({
			name: 'Perez_Juan_12345.pdf',
			mime: 'application/pdf'
		});
		expect(result.accepted[1]).toMatchObject({
			name: 'Gomez_Ana_67890.docx',
			mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		});
		expect(result.accepted[0].sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(result.accepted[0].sha256).not.toBe(result.accepted[1].sha256);
		expect(result.totalUncompressed).toBe(PDF_BYTES.length + DOCX_BYTES.length);
	});

	it('flattens nested folders into the basename the Moodle parser needs', async () => {
		const zip = makeZip([{ name: 'TP1/comision-2/Perez_Juan_123.pdf', data: PDF_BYTES }]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted[0].name).toBe('Perez_Juan_123.pdf');
	});

	it('rejects an archive that is not a ZIP at all', async () => {
		await expect(extractSubmissionZip(PDF_BYTES)).rejects.toThrow('no es un ZIP válido');
	});

	it('does not mistake a ZIP that contains a PDF for a PDF', async () => {
		// The ZIP starts with PK, but a `%PDF-` sits a few bytes in. A naive
		// "search the first KB" would call it a PDF and skip the ingest entirely.
		const zip = makeZip([{ name: 'Perez_Juan_123.pdf', data: PDF_BYTES }]);

		await expect(extractSubmissionZip(zip)).resolves.toBeDefined();
	});
});

describe('extractSubmissionZip — hostile archive', () => {
	it('rejects the whole archive on a traversal attempt instead of importing the rest', async () => {
		const zip = makeZip([
			{ name: '../../.env', data: Buffer.from('SECRET=1') },
			{ name: 'Perez_Juan_123.pdf', data: PDF_BYTES }
		]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted).toEqual([]);
		expect(result.rejected[0]).toMatchObject({ name: '../../.env', reason: 'unsafe-path' });
	});

	it('keeps the good entries when the bad ones are ordinary rejects', async () => {
		const zip = makeZip([
			{ name: 'virus.exe', data: Buffer.from([0x4d, 0x5a, 0x00, 0x00]) },
			{ name: 'Perez_Juan_123.pdf', data: PDF_BYTES },
			{ name: 'bomba.pdf', data: Buffer.alloc(2 * 1024 * 1024, 0), deflate: true }
		]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted.map((entry) => entry.name)).toEqual(['Perez_Juan_123.pdf']);
		expect(result.rejected.map((entry) => entry.reason).sort()).toEqual([
			'suspicious-ratio',
			'unsupported-type'
		]);
	});

	it('rejects an entry whose declared size exceeds the per-entry limit', async () => {
		const zip = makeZip([{ name: 'grande.pdf', data: PDF_BYTES }]);

		const result = await extractSubmissionZip(zip, { ...ZIP_LIMITS, maxEntrySize: 10 });

		expect(result.rejected[0].reason).toBe('too-large');
	});

	it('rejects the entries that would push the archive past the total limit', async () => {
		const zip = makeZip([
			{ name: 'uno.pdf', data: PDF_BYTES },
			{ name: 'dos.pdf', data: PDF_BYTES }
		]);

		const result = await extractSubmissionZip(zip, {
			...ZIP_LIMITS,
			maxTotalUncompressed: PDF_BYTES.length + 5
		});

		expect(result.accepted).toHaveLength(1);
		expect(result.rejected[0].reason).toBe('total-too-large');
	});

	it('stops accepting once the entry count is exhausted', async () => {
		const zip = makeZip([
			{ name: 'a.pdf', data: PDF_BYTES },
			{ name: 'b.pdf', data: PDF_BYTES },
			{ name: 'c.pdf', data: PDF_BYTES }
		]);

		const result = await extractSubmissionZip(zip, { ...ZIP_LIMITS, maxEntries: 2 });

		expect(result.accepted).toHaveLength(2);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0].reason).toBe('too-many-entries');
	});
});

describe('extractSubmissionZip — content filters', () => {
	it('accepts only PDF and DOCX, reporting the rest with a reason', async () => {
		const zip = makeZip([
			{ name: 'Perez_Juan_123.pdf', data: PDF_BYTES },
			{ name: 'notas.txt', data: Buffer.from('hola') },
			{ name: 'carpeta/', data: Buffer.alloc(0) },
			{ name: '.DS_Store', data: Buffer.from([0x00, 0x01]) },
			{ name: '__MACOSX/._Perez_Juan_123.pdf', data: PDF_BYTES }
		]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted.map((entry) => entry.name)).toEqual(['Perez_Juan_123.pdf']);
		const reasons = result.rejected.map((entry) => entry.reason);
		expect(reasons).toContain('unsupported-type');
		expect(reasons).toContain('directory');
		expect(reasons).toContain('metadata');
	});

	it('rejects a .pdf that is really HTML', async () => {
		const zip = makeZip([{ name: 'Perez_Juan_123.pdf', data: HTML_BYTES }]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted).toEqual([]);
		expect(result.rejected[0].reason).toBe('type-mismatch');
	});

	it('rejects a .docx that is not a ZIP container', async () => {
		const zip = makeZip([{ name: 'Gomez_Ana_1.docx', data: Buffer.from('soy texto plano') }]);

		const result = await extractSubmissionZip(zip);

		expect(result.rejected[0].reason).toBe('type-mismatch');
	});

	it('accepts a large real PDF that compresses well enough to be legitimate', async () => {
		const zip = makeZip([
			{ name: 'Perez_Juan_123.pdf', data: incompressiblePdf(), deflate: true }
		]);

		const result = await extractSubmissionZip(zip);

		expect(result.accepted).toHaveLength(1);
	});
});
