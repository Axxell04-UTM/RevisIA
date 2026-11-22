import { describe, expect, it } from 'vitest';
import { buildModelAttempts, exhaustedMessage, isRetryableStatus } from '#lib/domain/ai-retry.js';

/**
 * The retry policy decides whether a failure costs a second model call.
 * Retrying a 401 doubles the wait for the same error; not retrying a 503
 * leaves a whole batch ungraded for a spike that another model would survive.
 */

describe('isRetryableStatus', () => {
	it('retries the transient answers another model can fix', () => {
		for (const status of [404, 408, 429, 500, 502, 503, 504]) {
			expect(isRetryableStatus(status), `status ${status}`).toBe(true);
		}
	});

	it('does not retry a credential or malformed-request problem', () => {
		for (const status of [400, 401, 403, 422]) {
			expect(isRetryableStatus(status), `status ${status}`).toBe(false);
		}
	});
});

describe('buildModelAttempts', () => {
	it('tries the primary model and then the fallback', () => {
		expect(buildModelAttempts('gemini-2.5-flash', 'gemini-3.5-flash-lite')).toEqual([
			{ model: 'gemini-2.5-flash', role: 'primary' },
			{ model: 'gemini-3.5-flash-lite', role: 'fallback' }
		]);
	});

	it('does not repeat the same model', () => {
		expect(buildModelAttempts('gemini-2.5-flash', 'gemini-2.5-flash')).toHaveLength(1);
		expect(buildModelAttempts('gemini-2.5-flash', '   ')).toHaveLength(1);
		expect(buildModelAttempts('gemini-2.5-flash', null)).toHaveLength(1);
		expect(buildModelAttempts('gemini-2.5-flash', undefined)).toHaveLength(1);
	});

	it('trims the fallback name before comparing', () => {
		expect(buildModelAttempts('gemini-2.5-flash', ' gemini-3.5-flash-lite ')).toEqual([
			{ model: 'gemini-2.5-flash', role: 'primary' },
			{ model: 'gemini-3.5-flash-lite', role: 'fallback' }
		]);
	});
});

describe('exhaustedMessage', () => {
	it('keeps a single failure verbatim', () => {
		expect(exhaustedMessage([{ model: 'a', message: 'OpenAI 401: bad key' }])).toBe(
			'OpenAI 401: bad key'
		);
	});

	it('names every model that was tried when there was a fallback', () => {
		const message = exhaustedMessage([
			{ model: 'gemini-2.5-flash', message: 'Google 503: UNAVAILABLE' },
			{ model: 'gemini-3.5-flash-lite', message: 'Google 429: quota' }
		]);
		expect(message).toContain('Google 429: quota');
		expect(message).toContain('gemini-2.5-flash → gemini-3.5-flash-lite');
	});

	it('has a message even with no attempts', () => {
		expect(exhaustedMessage([])).toContain('No se pudo consultar al modelo');
	});
});
