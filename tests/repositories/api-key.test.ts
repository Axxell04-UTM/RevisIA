import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq } from 'drizzle-orm';
import { apiKey } from '#lib/server/db/schema/admin.js';
import {
	createApiKey,
	getActiveSecret,
	listApiKeys,
	revokeApiKey,
	setApiKeyActive,
	updateApiKeyFallback
} from '#lib/server/repositories/api-key.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

const OPENAI_KEY = 'sk-proj-super-secret-value-1234';

beforeEach(async () => {
	await resetDb();
});

describe('createApiKey', () => {
	it('stores ciphertext only and exposes just the last four characters', async () => {
		const admin = await createUser({ role: 'admin' });

		const summary = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		expect(summary.teacherId).toBeNull();
		expect(summary.providerLabel).toBe('OpenAI');
		expect(summary.lastFour).toBe('1234');
		expect(summary.active).toBe(true);

		// Nothing that could be reconstructed may cross the wire.
		expect(summary).not.toHaveProperty('ciphertext');
		expect(summary).not.toHaveProperty('iv');
		expect(summary).not.toHaveProperty('authTag');

		const [row] = await testDb.select().from(apiKey).where(eq(apiKey.id, summary.id));
		expect(row.ciphertext).not.toContain('super-secret');
		expect(row.ciphertext).not.toBe(OPENAI_KEY);
		expect(row.iv.length).toBeGreaterThan(0);
		expect(row.authTag.length).toBeGreaterThan(0);
	});

	it('trims the secret before sealing and masking it', async () => {
		const admin = await createUser({ role: 'admin' });

		const summary = await createApiKey({
			teacherId: null,
			provider: 'anthropic',
			secret: `   ${OPENAI_KEY}   `,
			createdBy: admin.id
		});

		expect(summary.lastFour).toBe('1234');
		expect(await getActiveSecret({ teacherId: null, provider: 'anthropic' })).toMatchObject({
			id: summary.id,
			secret: OPENAI_KEY
		});
	});

	it('keeps an empty label as null', async () => {
		const admin = await createUser({ role: 'admin' });

		const summary = await createApiKey({
			teacherId: null,
			provider: 'google',
			label: '   ',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		expect(summary.label).toBeNull();
	});

	it('masks secrets of four characters or fewer entirely', async () => {
		const admin = await createUser({ role: 'admin' });

		const summary = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: 'abcd',
			createdBy: admin.id
		});

		expect(summary.lastFour).toBe('****');
	});

	it('rejects unknown providers and blank secrets without inserting anything', async () => {
		const admin = await createUser({ role: 'admin' });

		await expect(
			createApiKey({
				teacherId: null,
				// @ts-expect-error deliberately outside the allowed union
				provider: 'cohere',
				secret: OPENAI_KEY,
				createdBy: admin.id
			})
		).rejects.toThrow('Proveedor no soportado: cohere');

		await expect(
			createApiKey({ teacherId: null, provider: 'openai', secret: '   ', createdBy: admin.id })
		).rejects.toThrow('La API key no puede estar vacía');

		expect(await testDb.select().from(apiKey)).toHaveLength(0);
	});
});

describe('listApiKeys', () => {
	it('separates the global set from each teacher set', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacherA = await createUser();
		const teacherB = await createUser();

		await createApiKey({ teacherId: null, provider: 'openai', secret: OPENAI_KEY, createdBy: admin.id });
		await createApiKey({
			teacherId: teacherA.id,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: teacherA.id
		});

		expect((await listApiKeys(null)).map((k) => k.teacherId)).toEqual([null]);
		expect((await listApiKeys(teacherA.id)).map((k) => k.teacherId)).toEqual([teacherA.id]);
		expect(await listApiKeys(teacherB.id)).toEqual([]);
	});
});

describe('revokeApiKey', () => {
	it('deactivates the row instead of deleting it', async () => {
		const admin = await createUser({ role: 'admin' });
		const key = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		expect(await revokeApiKey({ id: key.id, teacherId: null })).toBe(true);

		const [row] = await testDb.select().from(apiKey).where(eq(apiKey.id, key.id));
		expect(row.active).toBe(false);
		expect((await listApiKeys(null))[0].active).toBe(false);
	});

	it('refuses to touch a key owned by a different scope', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();
		const globalKey = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});
		const teacherKey = await createApiKey({
			teacherId: teacher.id,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: teacher.id
		});

		expect(await revokeApiKey({ id: globalKey.id, teacherId: teacher.id })).toBe(false);
		expect(await revokeApiKey({ id: teacherKey.id, teacherId: null })).toBe(false);
		expect((await listApiKeys(null))[0].active).toBe(true);
	});
});

describe('setApiKeyActive', () => {
	it('revives a revoked key so it becomes usable again', async () => {
		const admin = await createUser({ role: 'admin' });
		const key = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		await revokeApiKey({ id: key.id, teacherId: null });
		expect(await getActiveSecret({ teacherId: null, provider: 'openai' })).toBeNull();

		expect(await setApiKeyActive({ id: key.id, teacherId: null, active: true })).toBe(true);
		expect((await listApiKeys(null))[0].active).toBe(true);
		expect(await getActiveSecret({ teacherId: null, provider: 'openai' })).toMatchObject({
			id: key.id,
			secret: OPENAI_KEY
		});
	});

	it('refuses to flip a key owned by a different scope', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();
		const key = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});
		await revokeApiKey({ id: key.id, teacherId: null });

		expect(await setApiKeyActive({ id: key.id, teacherId: teacher.id, active: true })).toBe(false);
		expect((await listApiKeys(null))[0].active).toBe(false);
	});
});

describe('getActiveSecret', () => {
	it("prefers the teacher's own key over the global one", async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();

		await createApiKey({ teacherId: null, provider: 'openai', secret: 'global-key-0000', createdBy: admin.id });
		const own = await createApiKey({
			teacherId: teacher.id,
			provider: 'openai',
			secret: 'teacher-key-9999',
			createdBy: teacher.id
		});

		expect(await getActiveSecret({ teacherId: teacher.id, provider: 'openai' })).toMatchObject({
			id: own.id,
			secret: 'teacher-key-9999'
		});
	});

	it('falls back to the global key when the teacher has none', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();
		const global = await createApiKey({
			teacherId: null,
			provider: 'anthropic',
			secret: 'global-key-0000',
			createdBy: admin.id
		});

		expect(await getActiveSecret({ teacherId: teacher.id, provider: 'anthropic' })).toMatchObject({
			id: global.id,
			secret: 'global-key-0000'
		});
	});

	it('returns null when every candidate is revoked or the provider never had one', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();
		const own = await createApiKey({
			teacherId: teacher.id,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: teacher.id
		});
		const global = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		await revokeApiKey({ id: own.id, teacherId: teacher.id });
		await revokeApiKey({ id: global.id, teacherId: null });

		expect(await getActiveSecret({ teacherId: teacher.id, provider: 'openai' })).toBeNull();
		expect(await getActiveSecret({ teacherId: teacher.id, provider: 'google' })).toBeNull();
	});

	it('throws instead of returning tampered ciphertext as plaintext', async () => {
		const admin = await createUser({ role: 'admin' });
		const key = await createApiKey({
			teacherId: null,
			provider: 'openai',
			secret: OPENAI_KEY,
			createdBy: admin.id
		});

		await testDb.update(apiKey).set({ ciphertext: 'AAAA' }).where(eq(apiKey.id, key.id));

		await expect(getActiveSecret({ teacherId: null, provider: 'openai' })).rejects.toThrow(
			'No se pudo descifrar la API key'
		);
	});
});

describe('fallback model', () => {
	it('travels with the credential that will be used', async () => {
		const admin = await createUser({ role: 'admin' });

		const summary = await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-0000',
			fallbackModel: '  gemini-3.5-flash-lite  ',
			createdBy: admin.id
		});

		expect(summary.fallbackModel).toBe('gemini-3.5-flash-lite');
		expect((await listApiKeys(null))[0].fallbackModel).toBe('gemini-3.5-flash-lite');
		expect(await getActiveSecret({ teacherId: null, provider: 'google' })).toMatchObject({
			secret: 'google-key-0000',
			fallbackModel: 'gemini-3.5-flash-lite'
		});
	});

	it('is null when the admin leaves it empty', async () => {
		const admin = await createUser({ role: 'admin' });
		const key = await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-0000',
			fallbackModel: '   ',
			createdBy: admin.id
		});

		expect(key.fallbackModel).toBeNull();
	});

	it('is editable and can be cleared back to the provider default', async () => {
		const admin = await createUser({ role: 'admin' });
		const key = await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-0000',
			createdBy: admin.id
		});

		expect(
			await updateApiKeyFallback({
				id: key.id,
				teacherId: null,
				fallbackModel: 'gemini-3.5-flash-lite'
			})
		).toBe(true);
		expect((await listApiKeys(null))[0].fallbackModel).toBe('gemini-3.5-flash-lite');

		expect(await updateApiKeyFallback({ id: key.id, teacherId: null, fallbackModel: '' })).toBe(true);
		expect((await listApiKeys(null))[0].fallbackModel).toBeNull();
	});

	it('refuses to write it on a key outside the caller scope', async () => {
		const admin = await createUser({ role: 'admin' });
		const teacher = await createUser();
		const globalKey = await createApiKey({
			teacherId: null,
			provider: 'google',
			secret: 'google-key-0000',
			createdBy: admin.id
		});

		expect(
			await updateApiKeyFallback({
				id: globalKey.id,
				teacherId: teacher.id,
				fallbackModel: 'gemini-3.5-flash-lite'
			})
		).toBe(false);
		expect((await listApiKeys(null))[0].fallbackModel).toBeNull();
	});
});
