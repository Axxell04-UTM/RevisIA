import { GRADE_JSON_SCHEMA } from '#lib/domain/schema.js';
import { parseJsonLoose } from '#lib/domain/normalize.js';
import {
	buildModelAttempts,
	exhaustedMessage,
	isRetryableStatus,
	type ProviderAttempt
} from '#lib/domain/ai-retry.js';

/**
 * One structured-completion path shared by every feature that needs JSON from
 * the model (grading, metadata extraction).
 *
 * The provider differences live in `buildProviderRequest`, which is pure and
 * therefore testable without network: OpenAI uses `json_schema`, Anthropic uses
 * a forced tool call, Google uses `responseSchema`. `completeJson` adds the
 * credential/model resolution, the fetch, the fallback retry and the tolerant
 * JSON parse.
 */

export type ProviderName = 'openai' | 'anthropic' | 'google';

const PROVIDER_NAMES: readonly string[] = ['openai', 'anthropic', 'google'];

export function isProviderName(value: unknown): value is ProviderName {
	return typeof value === 'string' && PROVIDER_NAMES.includes(value);
}

export type StructuredRequest = {
	provider: ProviderName;
	apiKey: string;
	model: string;
	baseUrl: string;
	prompt: string;
	schema: object;
	system: string;
	temperature: number;
	/** Provider tool name for Anthropic's forced tool call. */
	toolName: string;
	toolDescription: string;
	/** OpenAI names the JSON schema; kept separate from the Anthropic tool name. */
	schemaName: string;
};

export type ProviderRequest = {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
};

export type StructuredResult = {
	raw: unknown;
	provider: ProviderName;
	model: string;
};

export type JsonCompletionOptions = {
	prompt: string;
	schema: object;
	system?: string;
	temperature?: number;
	toolName?: string;
	toolDescription?: string;
	schemaName?: string;
	/** Owner of the call: their configured provider/model and their API key. */
	teacherId?: string | null;
	/** Forces the retry model, overriding the configured fallback. */
	fallbackModel?: string | null;
	/** Optional overrides so tests never depend on the ambient environment. */
	provider?: ProviderName;
	apiKey?: string;
	model?: string;
	baseUrl?: string;
};

export type GradeRequest = { prompt: string; schema: object; teacherId?: string | null };

/**
 * A provider answered with an HTTP error.
 *
 * `retryable` is decided once, from the status, so the retry loop does not
 * re-derive policy from error text.
 */
export class ProviderHttpError extends Error {
	constructor(
		readonly provider: ProviderName,
		readonly model: string,
		readonly status: number,
		readonly body: string
	) {
		super(`${providerLabel(provider)} ${status}: ${body.slice(0, 400)}`);
		this.name = 'ProviderHttpError';
	}

	get retryable(): boolean {
		return isRetryableStatus(this.status);
	}
}

const DEFAULT_SYSTEM = 'Respondé únicamente con JSON válido.';

export async function gradeWithAI({ prompt, schema, teacherId }: GradeRequest): Promise<StructuredResult> {
	return completeJson({
		prompt,
		schema,
		teacherId,
		system: 'Sos un revisor académico riguroso. Respondé únicamente con JSON válido.',
		temperature: 0.2,
		toolName: 'calificar',
		toolDescription: 'Califica las respuestas según la rúbrica',
		schemaName: 'calificacion'
	});
}

/** Everything one attempt needs, resolved once per call. */
type ResolvedSettings = {
	provider: ProviderName;
	apiKey: string;
	model: string;
	fallbackModel: string | null;
	baseUrl: string;
};

/**
 * Resolves who to call and with which model.
 *
 * A caller that passes provider + key + model (tests, scripts) is taken at its
 * word and never touches the database. Everything else resolves through the
 * stored configuration: the teacher's own provider/model, the active key from
 * /admin/api-keys, and the fallback model attached to that credential.
 */
async function resolveSettings(options: JsonCompletionOptions): Promise<ResolvedSettings> {
	const givenProvider = options.provider;
	const givenKey = options.apiKey !== undefined;
	const givenModel = options.model !== undefined;

	if (givenProvider && givenKey && givenModel) {
		return {
			provider: givenProvider,
			apiKey: options.apiKey ?? '',
			model: options.model ?? '',
			fallbackModel: options.fallbackModel ?? null,
			baseUrl: options.baseUrl ?? ''
		};
	}

	const { resolveAiConfig } = await import('./ai-config.js');
	const config = await resolveAiConfig(options.teacherId ?? null);

	return {
		provider: givenProvider ?? config.provider,
		apiKey: givenKey ? (options.apiKey ?? '') : config.apiKey,
		model: givenModel ? (options.model ?? '') : config.primaryModel,
		fallbackModel: options.fallbackModel !== undefined ? options.fallbackModel : config.fallbackModel,
		baseUrl: options.baseUrl ?? config.baseUrl
	};
}

/**
 * Asks the provider for JSON, retrying once with the fallback model when the
 * failure is the kind another model can fix (503 high demand, 429, 5xx,
 * model-not-found, network).
 *
 * The model that actually answered is returned, so grading stores the truth
 * instead of the model the caller asked for.
 */
export async function completeJson(options: JsonCompletionOptions): Promise<StructuredResult> {
	const settings = await resolveSettings(options);

	if (!settings.apiKey) {
		throw new Error(
			`Falta una API key para ${providerLabel(settings.provider)}: cargala en /admin/api-keys o definí AI_API_KEY`
		);
	}

	const attempts = buildModelAttempts(settings.model, settings.fallbackModel);
	const failures: { model: string; message: string }[] = [];

	for (const [index, attempt] of attempts.entries()) {
		try {
			return await requestOnce(settings, options, attempt);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push({ model: attempt.model, message });

			const next = attempts[index + 1];
			const retryable = error instanceof ProviderHttpError ? error.retryable : true;
			if (!next || !retryable) throw new Error(exhaustedMessage(failures));

			console.warn(
				`[ai] ${providerLabel(settings.provider)} falló con ${attempt.model}; reintentando con ${next.model}: ${message}`
			);
		}
	}

	throw new Error(exhaustedMessage(failures));
}

async function requestOnce(
	settings: ResolvedSettings,
	options: JsonCompletionOptions,
	attempt: ProviderAttempt
): Promise<StructuredResult> {
	const request = buildProviderRequest({
		provider: settings.provider,
		apiKey: settings.apiKey,
		model: attempt.model,
		baseUrl: settings.baseUrl,
		prompt: options.prompt,
		schema: options.schema,
		system: options.system ?? DEFAULT_SYSTEM,
		temperature: options.temperature ?? 0.2,
		toolName: options.toolName ?? 'responder',
		toolDescription: options.toolDescription ?? 'Devuelve la respuesta estructurada',
		schemaName: options.schemaName ?? 'respuesta'
	});

	const res = await fetch(request.url, {
		method: 'POST',
		headers: request.headers,
		body: JSON.stringify(request.body)
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new ProviderHttpError(settings.provider, attempt.model, res.status, text);
	}

	const data = (await res.json()) as Record<string, any>;
	const raw = extractRaw(settings.provider, data);
	return { raw, provider: settings.provider, model: attempt.model };
}

/**
 * Pure request construction. Kept exported so tests can pin the exact wire
 * shape of every provider — a regression here breaks grading silently.
 */
export function buildProviderRequest(request: StructuredRequest): ProviderRequest {
	switch (request.provider) {
		case 'anthropic':
			return buildAnthropicRequest(request);
		case 'google':
			return buildGoogleRequest(request);
		case 'openai':
		default:
			return buildOpenAIRequest(request);
	}
}

function buildOpenAIRequest({
	apiKey,
	model,
	baseUrl,
	prompt,
	schema,
	system,
	temperature,
	schemaName
}: StructuredRequest): ProviderRequest {
	return {
		url: `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
		body: {
			model,
			temperature,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: prompt }
			],
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: schemaName,
					strict: true,
					schema
				}
			}
		}
	};
}

function buildAnthropicRequest({
	apiKey,
	model,
	prompt,
	schema,
	system,
	temperature,
	toolName,
	toolDescription
}: StructuredRequest): ProviderRequest {
	return {
		url: 'https://api.anthropic.com/v1/messages',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01'
		},
		body: {
			model,
			max_tokens: 4096,
			temperature,
			system,
			messages: [{ role: 'user', content: prompt }],
			tools: [
				{
					name: toolName,
					description: toolDescription,
					input_schema: schema
				}
			],
			tool_choice: { type: 'tool', name: toolName }
		}
	};
}

function buildGoogleRequest({
	apiKey,
	model,
	prompt,
	schema,
	temperature
}: StructuredRequest): ProviderRequest {
	return {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
		headers: { 'Content-Type': 'application/json' },
		body: {
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
			generationConfig: {
				temperature,
				responseMimeType: 'application/json',
				responseSchema: stripUnsupported(schema)
			}
		}
	};
}

function extractRaw(provider: ProviderName, data: Record<string, any>): unknown {
	if (provider === 'anthropic') {
		const toolCall = data?.content?.find((c: any) => c.type === 'tool_use');
		if (!toolCall?.input) throw new Error('Anthropic no devolvió la respuesta estructurada');
		return toolCall.input;
	}

	const text =
		provider === 'google'
			? data?.candidates?.[0]?.content?.parts?.[0]?.text
			: data?.choices?.[0]?.message?.content;

	if (!text) throw new Error(`Respuesta vacía de ${providerLabel(provider)}`);
	try {
		return JSON.parse(text);
	} catch {
		return parseJsonLoose(text);
	}
}

function providerLabel(provider: ProviderName): string {
	if (provider === 'google') return 'Google';
	if (provider === 'anthropic') return 'Anthropic';
	return 'OpenAI';
}

export function defaultModel(provider: ProviderName): string {
	switch (provider) {
		case 'anthropic':
			return 'claude-sonnet-4-5';
		case 'google':
			return 'gemini-2.5-flash';
		default:
			return 'gpt-4.1-mini';
	}
}

/**
 * Models to retry with when the configured one is rejected by a transient
 * failure (Google 503 `UNAVAILABLE`, a 429, a 5xx).
 *
 * They are deliberately a different, cheaper model of the same provider: the
 * point is to keep grading when the primary model is overloaded, and a
 * different family would change the answer shape under the same schema. They
 * are only a default — `/admin/api-keys` can set the fallback on the credential
 * itself (`api_key.fallback_model`) and `AI_FALLBACK_MODEL` overrides them for
 * env-only deployments.
 */
export const PROVIDER_FALLBACK_MODELS: Record<ProviderName, string> = {
	openai: 'gpt-4o-mini',
	anthropic: 'claude-haiku-5-5',
	google: 'gemini-3.5-flash-lite'
};

function stripUnsupported(schema: any): any {
	if (Array.isArray(schema)) return schema.map(stripUnsupported);
	if (schema && typeof schema === 'object') {
		const out: any = {};
		for (const k of Object.keys(schema)) {
			if (k === 'additionalProperties' || k === '$schema' || k === 'description') continue;
			out[k] = stripUnsupported(schema[k]);
		}
		return out;
	}
	return schema;
}
