import { env } from '$env/dynamic/private';
import { defaultModel, isProviderName, PROVIDER_FALLBACK_MODELS, type ProviderName } from './ai.js';

/**
 * Resolves the provider, credential and models for one AI call.
 *
 * The precedence is the one the admin screens promise:
 * 1. the teacher's own `defaultProvider` / `defaultModel` (Admin → Ajustes),
 * 2. otherwise `AI_PROVIDER` / `AI_MODEL` from the environment,
 * 3. otherwise the provider's built-in default.
 *
 * The credential comes from `/admin/api-keys` (`getActiveSecret`): the
 * teacher's own active key wins over the global one. `AI_API_KEY` is only used
 * when no stored key exists **and** it belongs to the same provider — sending a
 * Google key to OpenAI would fail with a confusing 401.
 *
 * The fallback model is attached to the credential (`api_key.fallback_model`),
 * then `AI_FALLBACK_MODEL`, then the provider default. A fallback equal to the
 * primary model is dropped: retrying the same name cannot help.
 */

export type AiKeySource = 'database' | 'env' | 'missing';

export type ResolvedAiConfig = {
	provider: ProviderName;
	apiKey: string;
	primaryModel: string;
	fallbackModel: string | null;
	baseUrl: string;
	keySource: AiKeySource;
};

type StoredPreference = { provider: string | null; model: string | null };

/**
 * Resolves the provider, credential and models for one AI call.
 *
 * `forcedProvider` keeps a feature on one provider (PDF vision only works on
 * Gemini): the model and key are then resolved *for that provider*, and a
 * preference saved for another provider is ignored instead of being sent to
 * the wrong API.
 */
export async function resolveAiConfig(
	teacherId: string | null,
	forcedProvider?: ProviderName
): Promise<ResolvedAiConfig> {
	const preference = await readPreference(teacherId);

	const envProvider = isProviderName(env.AI_PROVIDER) ? env.AI_PROVIDER : 'openai';
	const preferredProvider = isProviderName(preference.provider) ? preference.provider : null;
	const provider = forcedProvider ?? preferredProvider ?? envProvider;

	const preferenceModel =
		preferredProvider === null || preferredProvider === provider ? preference.model : null;
	const envModel = envProvider === provider ? env.AI_MODEL : null;
	const primaryModel = firstNonEmpty(preferenceModel, envModel) || defaultModel(provider);

	const stored = await readStoredSecret(teacherId, provider);
	const envKey = envProvider === provider ? (env.AI_API_KEY ?? '').trim() : '';
	const apiKey = (stored?.secret ?? envKey).trim();

	const configuredFallback =
		firstNonEmpty(stored?.fallbackModel, env.AI_FALLBACK_MODEL) || PROVIDER_FALLBACK_MODELS[provider];
	const fallbackModel = configuredFallback !== primaryModel ? configuredFallback : null;

	return {
		provider,
		apiKey,
		primaryModel,
		fallbackModel,
		baseUrl: (env.AI_BASE_URL ?? '').trim(),
		keySource: stored ? 'database' : envKey ? 'env' : 'missing'
	};
}

function firstNonEmpty(...values: (string | null | undefined)[]): string {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return '';
}

/**
 * The teacher's saved preference. A missing row (admin calls, a deleted user)
 * is not an error: it just means "no preference".
 */
async function readPreference(teacherId: string | null): Promise<StoredPreference> {
	if (!teacherId) return { provider: null, model: null };
	try {
		const [{ eq }, { getDb }, { user }] = await Promise.all([
			import('drizzle-orm'),
			import('./db/index.js'),
			import('./db/schema/index.js')
		]);
		const [row] = await getDb()
			.select({ provider: user.defaultProvider, model: user.defaultModel })
			.from(user)
			.where(eq(user.id, teacherId))
			.limit(1);
		return { provider: row?.provider ?? null, model: row?.model ?? null };
	} catch {
		return { provider: null, model: null };
	}
}

/**
 * The active key for that provider, if the key store is reachable.
 *
 * A database problem must not take grading down when the environment already
 * carries a key: the warning keeps the failure visible without turning it into
 * a request failure.
 */
async function readStoredSecret(
	teacherId: string | null,
	provider: ProviderName
): Promise<{ secret: string; fallbackModel: string | null } | null> {
	try {
		const { getActiveSecret } = await import('./repositories/api-key.js');
		return await getActiveSecret({ teacherId, provider });
	} catch (error) {
		console.warn('[ai] no se pudo leer la API key configurada:', error);
		return null;
	}
}
