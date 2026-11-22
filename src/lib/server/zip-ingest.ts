import yauzl from 'yauzl';
import { detectMimeType, sha256Of } from './file-signature.js';

/**
 * Safe ZIP ingest for student deliveries.
 *
 * A ZIP from a student is untrusted input in three ways at once:
 *
 * 1. **Zip-slip**: an entry named `../../.env` or `/etc/passwd`. We never write
 *    to disk, but the name becomes `file.original_name` and feeds the Moodle
 *    parser, so only a clean basename survives.
 * 2. **Zip bomb**: a few KB that expand to gigabytes. `yauzl` reads the central
 *    directory first, so the declared size is checked *before* inflating; and
 *    while inflating we count real bytes and abort at the limit, because a
 *    malicious header can lie about `uncompressedSize`.
 * 3. **Type spoofing**: `TP.pdf` that is really HTML. The extension only
 *    selects a candidate; the magic bytes decide.
 *
 * `yauzl` is used instead of an in-memory unzip precisely because of (2): a
 * one-shot `unzipSync` has already expanded the bomb by the time you can look.
 *
 * Two `yauzl` behaviours shape this module:
 *
 * - Its own path validation is **fatal for the whole archive** (`invalid
 *   relative path`). One hostile entry therefore rejects the entire ZIP instead
 *   of being skipped: a delivery set that tries to escape the extraction root is
 *   not partially trustworthy, and silently importing the rest would hide it.
 * - `validateEntrySizes: false` is required so an encrypted entry can be
 *   *classified* instead of crashing the scan. Size enforcement is ours: the
 *   declared size is checked before inflating and the real byte count is capped
 *   during inflation, so a lying header still cannot expand past the limit.
 */

export const ZIP_LIMITS = {
	/** Directories and files combined; a class upload is dozens, not thousands. */
	maxEntries: 500,
	/** One inflated delivery. Matches the single-PDF upload limit. */
	maxEntrySize: 25 * 1024 * 1024,
	/** Total inflated bytes for the whole ZIP. */
	maxTotalUncompressed: 100 * 1024 * 1024,
	/** Deflate ratios above this, on a large entry, are a bomb signature. */
	maxCompressionRatio: 100,
	/** Ratios are meaningless on small files: a 200-byte text file can be 1:400. */
	minRatioCheckSize: 1024 * 1024
} as const;

export type ZipLimits = {
	maxEntries: number;
	maxEntrySize: number;
	maxTotalUncompressed: number;
	maxCompressionRatio: number;
	minRatioCheckSize: number;
};

export type ZipRejectionReason =
	| 'directory'
	| 'metadata'
	| 'unsafe-path'
	| 'encrypted'
	| 'too-many-entries'
	| 'too-large'
	| 'total-too-large'
	| 'suspicious-ratio'
	| 'unsupported-type'
	| 'type-mismatch'
	| 'read-error';

export type RejectedEntry = {
	/** Raw name from the ZIP, so the teacher can see what was dropped. */
	name: string;
	reason: ZipRejectionReason;
	message: string;
};

export type AcceptedEntry = {
	/** Sanitized basename, extension preserved: the Moodle parser needs it. */
	name: string;
	mime: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	bytes: Buffer;
	sha256: string;
};

export type ZipIngestResult = {
	accepted: AcceptedEntry[];
	rejected: RejectedEntry[];
	/** Inflation total, for logs and to explain a `total-too-large` rejection. */
	totalUncompressed: number;
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const METADATA_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

const MESSAGES: Record<ZipRejectionReason, string> = {
	directory: 'Es una carpeta, no un archivo',
	metadata: 'Archivo de sistema del ZIP (.DS_Store, Thumbs.db)',
	'unsafe-path': 'El nombre intenta salir de la carpeta o trae una ruta absoluta',
	encrypted: 'El archivo está cifrado con contraseña',
	'too-many-entries': 'El ZIP tiene más archivos de los permitidos',
	'too-large': 'El archivo supera el tamaño máximo permitido',
	'total-too-large': 'El ZIP descomprimido supera el tamaño total permitido',
	'suspicious-ratio': 'El archivo se expande demasiado: posible bomba de descompresión',
	'unsupported-type': 'Solo se aceptan PDF o DOCX',
	'type-mismatch': 'La extensión no coincide con el contenido real del archivo',
	'read-error': 'No se pudo leer la entrada del ZIP'
};

/** The header fields the classification depends on, so it can be tested alone. */
export type EntryHeader = {
	fileName: string;
	generalPurposeBitFlag: number;
	uncompressedSize: number;
	compressedSize: number;
};

export type EntryDecision =
	| { action: 'accept'; baseName: string; extension: 'pdf' | 'docx' }
	| { action: 'reject'; reason: ZipRejectionReason };

export type ClassificationState = {
	/** Entries seen so far, including this one. */
	seen: number;
	/** Bytes already accepted in this archive. */
	totalAccepted: number;
};

/** Returns the clean basename, or `null` when the path is unsafe. */
export function safeBasename(rawName: string): string | null {
	if (rawName.includes('\0')) return null;

	const normalized = rawName.replace(/\\/g, '/');
	if (normalized.startsWith('/')) return null;
	if (/^[a-zA-Z]:/.test(normalized)) return null;

	const segments = normalized.split('/');
	if (segments.some((segment) => segment === '..')) return null;

	const base = segments.filter((segment) => segment !== '').pop();
	if (!base || base === '.' || base === '..') return null;
	return base;
}

function extensionOf(name: string): 'pdf' | 'docx' | null {
	const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
	const extension = match?.[1].toLowerCase();
	if (extension === 'pdf') return 'pdf';
	if (extension === 'docx') return 'docx';
	return null;
}

/**
 * Decides an entry from its header alone — no inflation, no I/O.
 *
 * This is where zip-slip, encrypted entries and zip-bomb ratios are rejected,
 * which is why it is pure: the interesting cases are exactly the ones that must
 * be caught before a single byte is decompressed.
 */
export function classifyEntry(
	header: EntryHeader,
	state: ClassificationState,
	limits: ZipLimits = ZIP_LIMITS
): EntryDecision {
	const rawName = header.fileName;

	if (rawName.endsWith('/')) return { action: 'reject', reason: 'directory' };

	const baseName = safeBasename(rawName);
	if (!baseName) return { action: 'reject', reason: 'unsafe-path' };

	if (rawName.replace(/\\/g, '/').startsWith('__MACOSX/') || METADATA_NAMES.has(baseName.toLowerCase())) {
		return { action: 'reject', reason: 'metadata' };
	}

	if (state.seen > limits.maxEntries) return { action: 'reject', reason: 'too-many-entries' };

	// Bit 0 of the general purpose flag marks an encrypted entry.
	if ((header.generalPurposeBitFlag & 0x1) !== 0) {
		return { action: 'reject', reason: 'encrypted' };
	}

	const extension = extensionOf(baseName);
	if (!extension) return { action: 'reject', reason: 'unsupported-type' };

	if (header.uncompressedSize > limits.maxEntrySize) {
		return { action: 'reject', reason: 'too-large' };
	}

	if (state.totalAccepted + header.uncompressedSize > limits.maxTotalUncompressed) {
		return { action: 'reject', reason: 'total-too-large' };
	}

	const ratio = header.uncompressedSize / Math.max(header.compressedSize, 1);
	if (header.uncompressedSize >= limits.minRatioCheckSize && ratio > limits.maxCompressionRatio) {
		return { action: 'reject', reason: 'suspicious-ratio' };
	}

	return { action: 'accept', baseName, extension };
}

function reject(name: string, reason: ZipRejectionReason): RejectedEntry {
	return { name, reason, message: MESSAGES[reason] };
}

/** Opens a ZIP held in memory without inflating anything yet. */
function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
	return new Promise((resolve, rejectPromise) => {
		yauzl.fromBuffer(
			buffer,
			// Size enforcement is ours: see the module comment.
			{ lazyEntries: true, autoClose: true, validateEntrySizes: false },
			(error, zipfile) => {
				if (error || !zipfile) rejectPromise(error ?? new Error('ZIP ilegible'));
				else resolve(zipfile);
			}
		);
	});
}

/** Pulls the next central-directory entry, or `null` at the end. */
function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
	return new Promise((resolve, rejectPromise) => {
		const cleanup = () => {
			zip.removeListener('entry', onEntry);
			zip.removeListener('end', onEnd);
			zip.removeListener('error', onError);
		};
		const onEntry = (entry: yauzl.Entry) => {
			cleanup();
			resolve(entry);
		};
		const onEnd = () => {
			cleanup();
			resolve(null);
		};
		const onError = (error: Error) => {
			cleanup();
			rejectPromise(error);
		};

		zip.once('entry', onEntry);
		zip.once('end', onEnd);
		zip.once('error', onError);
		zip.readEntry();
	});
}

class EntryTooLarge extends Error {}

/**
 * Inflates one entry, aborting the moment the real byte count passes the limit.
 * The declared size was already checked, but a hostile header can under-report.
 */
function readEntryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, rejectPromise) => {
		zip.openReadStream(entry, (error, stream) => {
			if (error || !stream) {
				rejectPromise(error ?? new Error('stream'));
				return;
			}

			const chunks: Buffer[] = [];
			let size = 0;
			let settled = false;

			const fail = (failure: Error) => {
				if (settled) return;
				settled = true;
				stream.destroy();
				rejectPromise(failure);
			};

			stream.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxBytes) {
					fail(new EntryTooLarge());
					return;
				}
				chunks.push(chunk);
			});
			stream.on('end', () => {
				if (settled) return;
				settled = true;
				resolve(Buffer.concat(chunks));
			});
			stream.on('error', (failure: Error) => fail(failure));
		});
	});
}

/** `yauzl` refuses to continue after a hostile name; surface what it saw. */
function describeFatalError(error: Error): RejectedEntry {
	const unsafe = /invalid relative path: (.+)$/.exec(error.message);
	if (unsafe) return reject(unsafe[1].trim(), 'unsafe-path');
	return reject('(ZIP completo)', 'read-error');
}

/**
 * Extracts the PDF/DOCX entries of a ZIP, rejecting everything else with a
 * reason the teacher can act on. Never throws on a bad entry: a ZIP with two
 * valid deliveries and one `.exe` returns the two and reports the third.
 *
 * The one exception is a traversal attempt: `yauzl` aborts the archive, and we
 * report it as a whole-archive rejection rather than importing the rest.
 */
export async function extractSubmissionZip(
	buffer: Buffer,
	limits: ZipLimits = ZIP_LIMITS
): Promise<ZipIngestResult> {
	if (detectMimeType(buffer) !== 'application/zip') {
		throw new Error('El archivo no es un ZIP válido');
	}

	const accepted: AcceptedEntry[] = [];
	const rejected: RejectedEntry[] = [];
	let totalUncompressed = 0;
	let seen = 0;

	const zip = await openZip(buffer);

	while (true) {
		let entry: yauzl.Entry | null;
		try {
			entry = await nextEntry(zip);
		} catch (error) {
			rejected.push(describeFatalError(error instanceof Error ? error : new Error(String(error))));
			break;
		}
		if (!entry) break;

		seen += 1;

		const decision = classifyEntry(
			{
				fileName: entry.fileName,
				generalPurposeBitFlag: entry.generalPurposeBitFlag,
				uncompressedSize: entry.uncompressedSize,
				compressedSize: entry.compressedSize
			},
			{ seen, totalAccepted: totalUncompressed },
			limits
		);

		if (decision.action === 'reject') {
			rejected.push(reject(entry.fileName, decision.reason));
			continue;
		}

		let bytes: Buffer;
		try {
			bytes = await readEntryBuffer(zip, entry, limits.maxEntrySize);
		} catch (error) {
			rejected.push(
				reject(entry.fileName, error instanceof EntryTooLarge ? 'too-large' : 'read-error')
			);
			continue;
		}

		const detected = detectMimeType(bytes);
		const expectedMime = decision.extension === 'pdf' ? 'application/pdf' : DOCX_MIME;
		const matches =
			decision.extension === 'pdf' ? detected === 'application/pdf' : detected === 'application/zip';
		if (!matches) {
			rejected.push(reject(entry.fileName, 'type-mismatch'));
			continue;
		}

		totalUncompressed += bytes.length;
		accepted.push({
			name: decision.baseName,
			mime: expectedMime,
			bytes,
			sha256: sha256Of(bytes)
		});
	}

	return { accepted, rejected, totalUncompressed };
}
