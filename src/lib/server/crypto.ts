import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * AES-256-GCM envelope for secrets at rest (provider API keys).
 *
 * The key comes from `API_KEY_ENCRYPTION_KEY` and must be 32 bytes, encoded as
 * base64 (`openssl rand -base64 32`) or hex. It is read lazily so bundling and
 * `svelte-check` work without env vars; a missing or malformed key fails on the
 * first seal/open, never at import time.
 *
 * `ciphertext`, `iv` and `authTag` are base64 because the `api_key` columns are
 * `text` (see docs/db-schema.md): identical bytes with the TCP and HTTP drivers.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const AUTH_TAG_BYTES = 16;

export type SealedSecret = {
	ciphertext: string;
	iv: string;
	authTag: string;
};

let cachedKey: Buffer | null = null;
let cachedRaw: string | null = null;

function parseKey(raw: string): Buffer {
	const hex = /^[0-9a-f]{64}$/i.test(raw);
	const key = Buffer.from(raw, hex ? 'hex' : 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error(
			'API_KEY_ENCRYPTION_KEY inválida: se esperan 32 bytes en base64 o hex ' +
				'(generala con: openssl rand -base64 32)'
		);
	}
	return key;
}

/** Resolve the encryption key, failing loudly when it is absent. */
export function encryptionKey(): Buffer {
	const raw = (env.API_KEY_ENCRYPTION_KEY ?? '').trim();
	if (!raw) {
		throw new Error(
			'Falta API_KEY_ENCRYPTION_KEY: sin esa clave no se pueden guardar ni leer API keys'
		);
	}
	if (cachedKey && cachedRaw === raw) return cachedKey;
	cachedKey = parseKey(raw);
	cachedRaw = raw;
	return cachedKey;
}

/** True when a usable key is configured; lets callers degrade instead of throwing. */
export function isEncryptionConfigured(): boolean {
	try {
		encryptionKey();
		return true;
	} catch {
		return false;
	}
}

/** Seal a UTF-8 secret. A fresh random IV is used on every call. */
export function encryptSecret(plaintext: string, key: Buffer = encryptionKey()): SealedSecret {
	if (typeof plaintext !== 'string' || plaintext.length === 0) {
		throw new Error('No se puede cifrar un secreto vacío');
	}
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return {
		ciphertext: ciphertext.toString('base64'),
		iv: iv.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64')
	};
}

/**
 * Open a sealed secret. Throws when the key changed or any byte was altered:
 * GCM authenticates before returning plaintext, so a tampered row never leaks.
 */
export function decryptSecret(sealed: SealedSecret, key: Buffer = encryptionKey()): string {
	const iv = Buffer.from(sealed.iv, 'base64');
	const authTag = Buffer.from(sealed.authTag, 'base64');
	if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
		throw new Error('Secreto cifrado inválido: IV o auth tag con tamaño inesperado');
	}
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
		decipher.setAuthTag(authTag);
		const plaintext = Buffer.concat([
			decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
			decipher.final()
		]);
		return plaintext.toString('utf8');
	} catch {
		throw new Error(
			'No se pudo descifrar la API key: la clave de cifrado no coincide o el dato fue alterado'
		);
	}
}

/** Last four characters, the only fragment allowed to reach the client. */
export function secretLastFour(secret: string): string {
	const value = secret.trim();
	return value.length > 4 ? value.slice(-4) : '****';
}
