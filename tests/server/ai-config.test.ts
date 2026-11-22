import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { resolveAiConfig } from '#lib/server/ai-config.js';
import { createApiKey } from '#lib/server/repositories/api-key.js';
import { resetDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * The AI call must obey what /admin/api-keys and Admin → Ajustes save: the
 * teacher's provider/model, the active credential, and the fallback model
 * attached to that credential. Environment variables are only the last resort.
 */

beforeEach(async () => {
	await resetDb();
});

describe('resolveAiConfig', () => {
	it('uses the stored key and the teacher preferences', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser({
			defaultProvider: 'google',
			defaultModel: 'gemini-2.5-flash'
		});
		await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-1234',
			fallbackModel: 'gemini-3.5-flash-lite',
			createdBy: admin.id
		});

		const config = await resolveAiConfig(teacher.id);

		expect(config.provider).toBe('google');
		expect(config.primaryModel).toBe('gemini-2.5-flash');
		expect(config.fallbackModel).toBe('gemini-3.5-flash-lite');
		expect(config.apiKey).toBe('google-key-1234');
		expect(config.keySource).toBe('database');
	});

	it("prefers the teacher's own key over the global one", async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser({ defaultProvider: 'openai' });
		await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: 'global-key-0000',
			createdBy: admin.id
		});
		await createApiKey({
			teacherId: teacher.id,
			provider: 'openai',
			secret: 'teacher-key-9999',
			createdBy: teacher.id
		});

		const config = await resolveAiConfig(teacher.id);
		expect(config.apiKey).toBe('teacher-key-9999');
	});

	it('falls back to the provider default when the key has no override', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser({ defaultProvider: 'google' });
		await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-1234',
			createdBy: admin.id
		});

		const config = await resolveAiConfig(teacher.id);
		expect(config.fallbackModel).toBe('gemini-3.5-flash-lite');
	});

	it('drops a fallback that is the same model as the primary', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser({
			defaultProvider: 'google',
			defaultModel: 'gemini-3.5-flash-lite'
		});
		await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-1234',
			fallbackModel: 'gemini-3.5-flash-lite',
			createdBy: admin.id
		});

		const config = await resolveAiConfig(teacher.id);
		// Retrying the same name after a 503 only burns time.
		expect(config.fallbackModel).toBeNull();
	});

	it('reports a missing key instead of inventing one', async () => {
		const teacher = await createUser();

		const config = await resolveAiConfig(teacher.id);
		expect(config.apiKey).toBe('');
		expect(config.keySource).toBe('missing');
		expect(config.primaryModel).toBe('gpt-4.1-mini');
	});
});
