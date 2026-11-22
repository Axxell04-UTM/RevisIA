import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviderRequest, completeJson, type StructuredRequest } from '#lib/server/ai.js';

/**
 * Every feature that asks for JSON goes through the same provider path, so the
 * wire shape is pinned here once: a change in headers or schema placement that
 * silently breaks grading or metadata extraction must fail a test first.
 */

const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['nombre'],
	properties: { nombre: { type: 'string' } }
};

function request(overrides: Partial<StructuredRequest> = {}): StructuredRequest {
	return {
		provider: 'openai',
		apiKey: 'sk-test',
		model: 'gpt-4.1-mini',
		baseUrl: '',
		prompt: 'Extraé el encabezado',
		schema: SCHEMA,
		system: 'Respondé JSON',
		temperature: 0,
		toolName: 'extraer_metadatos',
		toolDescription: 'Devuelve los metadatos',
		schemaName: 'metadatos',
		...overrides
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('buildProviderRequest', () => {
	it('sends OpenAI a strict json_schema named by the caller', () => {
		const built = buildProviderRequest(request());

		expect(built.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(built.headers.Authorization).toBe('Bearer sk-test');
		expect(built.body.model).toBe('gpt-4.1-mini');
		expect(built.body.temperature).toBe(0);
		expect((built.body as any).response_format.json_schema.name).toBe('metadatos');
		expect((built.body as any).response_format.json_schema.strict).toBe(true);
		expect((built.body as any).messages[0].content).toBe('Respondé JSON');
		expect((built.body as any).messages[1].content).toBe('Extraé el encabezado');
	});

	it('honours a custom OpenAI base URL', () => {
		const built = buildProviderRequest(request({ baseUrl: 'https://proxy.test/v1' }));
		expect(built.url).toBe('https://proxy.test/v1/chat/completions');
	});

	it('forces the Anthropic tool call and sends the key in x-api-key', () => {
		const built = buildProviderRequest(request({ provider: 'anthropic', model: 'claude-sonnet-4-5' }));

		expect(built.url).toBe('https://api.anthropic.com/v1/messages');
		expect(built.headers['x-api-key']).toBe('sk-test');
		expect(built.headers['anthropic-version']).toBe('2023-06-01');
		expect((built.body as any).tool_choice).toEqual({ type: 'tool', name: 'extraer_metadatos' });
		expect((built.body as any).tools[0].input_schema).toEqual(SCHEMA);
	});

	it('sends Google the response schema without unsupported keywords', () => {
		const built = buildProviderRequest(request({ provider: 'google', model: 'gemini-3.8-flash' }));

		expect(built.url).toContain('/models/gemini-3.8-flash:generateContent');
		expect(built.url).toContain('key=sk-test');
		const config = (built.body as any).generationConfig;
		expect(config.temperature).toBe(0);
		expect(config.responseMimeType).toBe('application/json');
		expect(config.responseSchema.additionalProperties).toBeUndefined();
		expect(config.responseSchema.properties.nombre).toEqual({ type: 'string' });
	});
});

describe('completeJson', () => {
	it('parses the OpenAI JSON answer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"nombre":"Ana"}' } }] })))
		);

		const result = await completeJson({ prompt: 'x', schema: SCHEMA, provider: 'openai', apiKey: 'k', model: 'm' });
		expect(result.raw).toEqual({ nombre: 'Ana' });
	});

	it('reads the tool call input from Anthropic', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { nombre: 'Ana' } }] }))
			)
		);

		const result = await completeJson({ prompt: 'x', schema: SCHEMA, provider: 'anthropic', apiKey: 'k', model: 'm' });
		expect(result.raw).toEqual({ nombre: 'Ana' });
	});

	it('surfaces the provider status and body on an error', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })));

		await expect(
			completeJson({ prompt: 'x', schema: SCHEMA, provider: 'openai', apiKey: 'k', model: 'm' })
		).rejects.toThrow(/OpenAI 401: bad key/);
	});

	it('refuses to call without a key', async () => {
		await expect(
			completeJson({ prompt: 'x', schema: SCHEMA, provider: 'openai', apiKey: '', model: 'm' })
		).rejects.toThrow(/AI_API_KEY/);
	});
});

describe('completeJson — fallback model', () => {
	const GOOGLE_503 = JSON.stringify({
		error: {
			code: 503,
			message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
			status: 'UNAVAILABLE'
		}
	});

	const GOOGLE_OK = JSON.stringify({
		candidates: [{ content: { parts: [{ text: '{"nombre":"Ana"}' }] } }]
	});

	function stubSequence(responses: (() => Response)[]) {
		const urls: string[] = [];
		const fetchMock = vi.fn(async (url: string) => {
			urls.push(String(url));
			const next = responses[Math.min(urls.length - 1, responses.length - 1)];
			return next();
		});
		vi.stubGlobal('fetch', fetchMock);
		return { urls, fetchMock };
	}

	it('retries with the fallback model when Google answers 503 UNAVAILABLE', async () => {
		const { urls, fetchMock } = stubSequence([
			() => new Response(GOOGLE_503, { status: 503 }),
			() => new Response(GOOGLE_OK)
		]);

		const result = await completeJson({
			prompt: 'x',
			schema: SCHEMA,
			provider: 'google',
			apiKey: 'k',
			model: 'gemini-2.5-flash',
			fallbackModel: 'gemini-3.5-flash-lite'
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(urls[0]).toContain('gemini-2.5-flash');
		expect(urls[1]).toContain('gemini-3.5-flash-lite');
		// The caller must know which model actually answered.
		expect(result.model).toBe('gemini-3.5-flash-lite');
		expect(result.raw).toEqual({ nombre: 'Ana' });
	});

	it('does not retry a credential failure', async () => {
		const { fetchMock } = stubSequence([() => new Response('forbidden', { status: 403 })]);

		await expect(
			completeJson({
				prompt: 'x',
				schema: SCHEMA,
				provider: 'google',
				apiKey: 'k',
				model: 'gemini-2.5-flash',
				fallbackModel: 'gemini-3.5-flash-lite'
			})
		).rejects.toThrow(/Google 403/);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries after a network failure', async () => {
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				calls += 1;
				if (calls === 1) throw new TypeError('fetch failed');
				return new Response(GOOGLE_OK);
			})
		);

		const result = await completeJson({
			prompt: 'x',
			schema: SCHEMA,
			provider: 'google',
			apiKey: 'k',
			model: 'gemini-2.5-flash',
			fallbackModel: 'gemini-3.5-flash-lite'
		});

		expect(calls).toBe(2);
		expect(result.model).toBe('gemini-3.5-flash-lite');
	});

	it('names both models when the fallback also fails', async () => {
		const { fetchMock } = stubSequence([
			() => new Response(GOOGLE_503, { status: 503 }),
			() => new Response(GOOGLE_503, { status: 503 })
		]);

		await expect(
			completeJson({
				prompt: 'x',
				schema: SCHEMA,
				provider: 'google',
				apiKey: 'k',
				model: 'gemini-2.5-flash',
				fallbackModel: 'gemini-3.5-flash-lite'
			})
		).rejects.toThrow(/gemini-2\.5-flash → gemini-3\.5-flash-lite/);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
