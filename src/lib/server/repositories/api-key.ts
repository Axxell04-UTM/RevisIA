import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { apiKey } from '#lib/server/db/schema/admin.js';
import { decryptSecret, encryptSecret, secretLastFour } from '#lib/server/crypto.js';

/**
 * Repository for provider credentials.
 *
 * The plaintext secret enters once (`createApiKey`) and leaves only through
 * `getActiveSecret` for a server-side call. Everything else is metadata plus
 * `lastFour`: no ciphertext, IV or tag ever crosses the API boundary.
 *
 * `teacherId === null` means a global key managed by an admin; a teacher's own
 * active key wins over the global one.
 */

export type ApiKeyProvider = 'openai' | 'anthropic' | 'google';

export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ['openai', 'anthropic', 'google'];

const PROVIDER_LABELS: Record<ApiKeyProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google'
};

export function isApiKeyProvider(value: unknown): value is ApiKeyProvider {
	return typeof value === 'string' && (API_KEY_PROVIDERS as readonly string[]).includes(value);
}

/** Wire shape: safe to return to the client. */
export type ApiKeySummary = {
	id: string;
	teacherId: string | null;
	provider: ApiKeyProvider;
	providerLabel: string;
	label: string | null;
	lastFour: string | null;
	/** Model retried when the primary one fails transiently; null = provider default. */
	fallbackModel: string | null;
	active: boolean;
	createdAt: number;
};

export type CreateApiKeyInput = {
	/** null = global key. */
	teacherId: string | null;
	provider: ApiKeyProvider;
	label?: string | null;
	/** Plaintext secret; encrypted before it touches the database. */
	secret: string;
	/** Optional model to retry with when the primary one is unavailable. */
	fallbackModel?: string | null;
	createdBy: string;
};

/** Model names are short; anything longer is a pasted sentence, not a model. */
const FALLBACK_MODEL_MAX = 120;

function cleanFallbackModel(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, FALLBACK_MODEL_MAX) : null;
}

function toSummary(row: typeof apiKey.$inferSelect): ApiKeySummary {
	const provider = row.provider as ApiKeyProvider;
	return {
		id: row.id,
		teacherId: row.teacherId,
		provider,
		providerLabel: PROVIDER_LABELS[provider] ?? provider,
		label: row.label,
		lastFour: row.lastFour,
		fallbackModel: row.fallbackModel,
		active: row.active,
		createdAt: row.createdAt.getTime()
	};
}

function validate(input: CreateApiKeyInput) {
	if (!input || typeof input !== 'object') throw new Error('API key inválida');
	if (!isApiKeyProvider(input.provider)) {
		throw new Error(`Proveedor no soportado: ${String(input.provider)}`);
	}
	const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
	if (!secret) throw new Error('La API key no puede estar vacía');
	const label = (input.label ?? '').trim();
	return {
		teacherId: input.teacherId ?? null,
		provider: input.provider,
		label: label || null,
		secret,
		fallbackModel: cleanFallbackModel(input.fallbackModel),
		createdBy: input.createdBy
	};
}

/** Create a key for a teacher, or a global one when `teacherId` is null. */
export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeySummary> {
	const value = validate(input);
	const sealed = encryptSecret(value.secret);
	const [row] = await getDb()
		.insert(apiKey)
		.values({
			teacherId: value.teacherId,
			provider: value.provider,
			label: value.label,
			fallbackModel: value.fallbackModel,
			ciphertext: sealed.ciphertext,
			iv: sealed.iv,
			authTag: sealed.authTag,
			lastFour: secretLastFour(value.secret),
			active: true,
			createdBy: value.createdBy
		})
		.returning();
	return toSummary(row);
}

/** Metadata-only listing for the owner of the keys (or the global set). */
export async function listApiKeys(teacherId: string | null): Promise<ApiKeySummary[]> {
	const rows = await getDb()
		.select()
		.from(apiKey)
		.where(teacherId === null ? isNull(apiKey.teacherId) : eq(apiKey.teacherId, teacherId))
		.orderBy(desc(apiKey.createdAt));
	return rows.map(toSummary);
}

/**
 * Turns one key on or off. Ownership is part of the WHERE clause, so a scoped
 * caller can never flip a key outside its own scope.
 */
export async function setApiKeyActive(options: {
	id: string;
	teacherId: string | null;
	active: boolean;
}): Promise<boolean> {
	const owner =
		options.teacherId === null ? isNull(apiKey.teacherId) : eq(apiKey.teacherId, options.teacherId);
	const rows = await getDb()
		.update(apiKey)
		.set({ active: options.active })
		.where(and(eq(apiKey.id, options.id), owner))
		.returning({ id: apiKey.id });
	return rows.length > 0;
}

/** Deactivate a key. The row stays for audit; ciphertext is never rewritten. */
export async function revokeApiKey(options: { id: string; teacherId: string | null }): Promise<boolean> {
	return setApiKeyActive({ ...options, active: false });
}

/**
 * Sets the model a key retries with when the primary one is unavailable.
 * Same ownership rule as every other write: the scope is part of the WHERE.
 */
export async function updateApiKeyFallback(options: {
	id: string;
	teacherId: string | null;
	fallbackModel: string | null;
}): Promise<boolean> {
	const owner =
		options.teacherId === null ? isNull(apiKey.teacherId) : eq(apiKey.teacherId, options.teacherId);
	const rows = await getDb()
		.update(apiKey)
		.set({ fallbackModel: cleanFallbackModel(options.fallbackModel) })
		.where(and(eq(apiKey.id, options.id), owner))
		.returning({ id: apiKey.id });
	return rows.length > 0;
}

/**
 * Decrypt the key to use for a server-side call: the teacher's active key for
 * that provider, else the global one. Returns null when neither exists.
 *
 * `fallbackModel` travels with the credential because it is configured on the
 * same screen and only makes sense for the key that will be used.
 */
export async function getActiveSecret(options: {
	teacherId: string | null;
	provider: ApiKeyProvider;
}): Promise<{ id: string; secret: string; fallbackModel: string | null } | null> {
	const scope = options.teacherId
		? or(eq(apiKey.teacherId, options.teacherId), isNull(apiKey.teacherId))
		: isNull(apiKey.teacherId);

	const rows = await getDb()
		.select()
		.from(apiKey)
		.where(and(eq(apiKey.provider, options.provider), eq(apiKey.active, true), scope))
		// ASC keeps NULLs last, so a teacher's own key wins over the global one.
		.orderBy(asc(apiKey.teacherId), desc(apiKey.createdAt))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		secret: decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }),
		fallbackModel: row.fallbackModel
	};
}
