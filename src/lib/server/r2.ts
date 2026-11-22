import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';

const bucket = env.FILEBASE_BUCKET ?? env.R2_BUCKET ?? 'revisia';
const endpoint = env.FILEBASE_ENDPOINT ?? 'https://s3.filebase.com';
const accessKeyId = env.FILEBASE_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID ?? '';
const secretAccessKey = env.FILEBASE_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY ?? '';

if (!accessKeyId || !secretAccessKey) {
	// Import-time throw would take down every route that bundles this module,
	// including the build's SSR analysis. The signature call fails loudly instead.
	console.warn('[r2] Falta FILEBASE_ACCESS_KEY_ID / FILEBASE_SECRET_ACCESS_KEY: las URLs firmadas van a fallar');
}

const client = new S3Client({
	region: 'auto',
	endpoint,
	credentials: {
		accessKeyId,
		secretAccessKey
	},
	// SDK >= 3.729 adds a CRC32 checksum over the (empty) presign body and puts
	// it in the URL. A browser PUT then sends the real file and the checksum no
	// longer matches, so the upload is rejected. Presigned browser uploads must
	// not carry a request checksum; the confirm step verifies the real bytes.
	requestChecksumCalculation: 'WHEN_REQUIRED',
	responseChecksumValidation: 'WHEN_REQUIRED'
});

// ZIP MIME aliases that browsers may send. Normalize to the canonical type.
const ZIP_ALIASES = new Set([
	'application/zip',
	'application/x-zip-compressed',
	'application/x-zip',
	'multipart/x-zip'
]);

/** Allowed MIME types and max sizes (bytes) per upload context. */
export const UPLOAD_LIMITS = {
	submission: {
		allowedTypes: [
			'application/pdf',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		] as const,
		maxSize: 25 * 1024 * 1024 // 25 MB
	},
	/** A ZIP of many deliveries; one archive replaces N individual uploads. */
	submissionZip: {
		allowedTypes: ['application/zip'] as const,
		maxSize: 50 * 1024 * 1024 // 50 MB
	},
	sourceDocument: {
		allowedTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'] as const,
		maxSize: 25 * 1024 * 1024
	},
	rubricImport: {
		allowedTypes: ['application/json'] as const,
		maxSize: 1 * 1024 * 1024 // 1 MB
	}
} as const;

export type UploadContext = keyof typeof UPLOAD_LIMITS;

/** Normalize MIME type for upload validation.
 * Returns the canonical MIME type (e.g., ZIP aliases -> application/zip).
 */
export function normalizeMimeType(contentType: string): string {
	const normalized = contentType.trim().toLowerCase();
	if (ZIP_ALIASES.has(normalized)) {
		return 'application/zip';
	}
	return normalized;
}

export function validateUpload(
	contentType: string,
	size: number,
	context: UploadContext = 'submission'
): { ok: true; contentType: string } | { ok: false; error: string } {
	const limits = UPLOAD_LIMITS[context] ?? UPLOAD_LIMITS.submission;
	const allowed = limits.allowedTypes as readonly string[];
	// Normalize ZIP MIME aliases for comparison and storage
	const normalized = normalizeMimeType(contentType);
	const allowedNormalized = context === 'submissionZip'
		? ['application/zip']  // ZIP only after normalization
		: allowed;
	if (!allowedNormalized.includes(normalized)) {
		return { ok: false, error: `Tipo de archivo no permitido: ${contentType}. Permitidos: ${allowed.join(', ')}` };
	}
	if (size > limits.maxSize) {
		return { ok: false, error: `Archivo demasiado grande: ${(size / 1024 / 1024).toFixed(1)} MB. Máximo: ${limits.maxSize / 1024 / 1024} MB` };
	}
	return { ok: true, contentType: normalized };
}

/** Generate a unique, non-guessable storage key. */
export function makeStorageKey(prefix: string, originalName: string): string {
	// Only a short alphanumeric extension survives: the rest of the client
	// supplied name (slashes, dots, spaces) must never reach the key.
	const ext = /\.[a-z0-9]{1,12}$/i.exec(originalName.trim())?.[0].slice(1).toLowerCase() ?? 'bin';
	const hash = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16);
	return `${prefix}/${hash}.${ext}`;
}

/** 15-minute presigned PUT. The browser uploads directly; the function never
 *  touches the bytes, so Vercel's 4.5 MB body limit does not apply.
 *
 *  Only `content-type` is bound, never `content-length`: the browser owns that
 *  header (JS cannot set it) and Filebase answers 403 AccessDenied when the
 *  signed value does not come back byte for byte. The declared size is still
 *  enforced by `validateUpload`, and `confirm` checks the real stored size. */
export async function presignedPut(key: string, contentType: string) {
	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		ContentType: contentType
	});
	return getSignedUrl(client, command, { expiresIn: 900 });
}

export async function presignedGet(key: string) {
	return getSignedUrl(
		client,
		new GetObjectCommand({ Bucket: bucket, Key: key }),
		{ expiresIn: 900 }
	);
}

export async function putObject(key: string, body: Buffer, contentType: string) {
	return client.send(
		new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
	);
}

export async function getObject(key: string) {
	return client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Downloads an object into memory. Used on confirm to hash and sniff the real
 * bytes; callers must check the declared size first so a 25 MB cap still holds.
 */
export async function getObjectBuffer(key: string): Promise<Buffer> {
	const response = await getObject(key);
	const body = response.Body as
		| { transformToByteArray?: () => Promise<Uint8Array> }
		| undefined;
	if (!body) throw new Error('No se pudo leer el archivo desde el almacenamiento');

	if (typeof body.transformToByteArray === 'function') {
		const bytes = await body.transformToByteArray();
		return Buffer.from(bytes);
	}

	const chunks: Buffer[] = [];
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

export function getBucket() {
	return bucket;
}

export function getClient() {
	return client;
}