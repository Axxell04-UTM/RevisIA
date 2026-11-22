import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createApiKey,
	listApiKeys,
	revokeApiKey,
	setApiKeyActive,
	updateApiKeyFallback
} from '#lib/server/repositories/api-key.js';
import { PROVIDER_FALLBACK_MODELS } from '#lib/server/ai.js';
import { listAvailableTeachers } from '#lib/server/repositories/subject.js';
import { logAudit } from '#lib/server/repositories/audit.js';

/**
 * Postgres 42703 = a column the code expects does not exist in this database.
 *
 * Deploying code before its migration is the usual cause, and a blank 500 sends
 * the admin looking in the wrong place: say which file is missing instead.
 */
function isMissingColumnError(cause: unknown): boolean {
	return typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === '42703';
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const page = Number(url.searchParams.get('page')) || 1;
	const limit = 20;
	const offset = (page - 1) * limit;
	const provider = url.searchParams.get('provider');
	const active = url.searchParams.get('active');

	let allKeys;
	let teachers;
	try {
		[allKeys, teachers] = await Promise.all([
			listApiKeys(locals.user.role === 'admin' ? null : locals.user.id),
			listAvailableTeachers()
		]);
	} catch (cause) {
		if (isMissingColumnError(cause)) {
			error(
				500,
				'Falta aplicar la migración drizzle/0012_api_key_fallback_model.sql (columna api_key.fallback_model). Corré `pnpm db:migrate` o el ALTER TABLE de ese archivo.'
			);
		}
		throw cause;
	}

	// Filter in memory for compatibility with UI filters
	let filtered = allKeys;
	if (provider) {
		filtered = filtered.filter(k => k.provider === provider);
	}
	if (active === 'true') {
		filtered = filtered.filter(k => k.active === true);
	} else if (active === 'false') {
		filtered = filtered.filter(k => k.active === false);
	}

	const total = filtered.length;
	const keys = filtered.slice(offset, offset + limit);

	return {
		keys,
		total,
		page,
		totalPages: Math.ceil(total / limit) || 1,
		provider,
		active: active ?? 'all',
		teachers,
		/** What each provider retries with when no override is set on the key. */
		defaultFallbacks: PROVIDER_FALLBACK_MODELS
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const formData = await request.formData();
		const provider = formData.get('provider') as string;
		const label = formData.get('label') as string;
		const secret = formData.get('secret') as string;
		const teacherId = formData.get('teacherId') as string;
		const fallbackModel = (formData.get('fallbackModel') as string) ?? '';

		if (!provider || !secret) {
			return fail(400, { error: 'Proveedor y clave son requeridos' });
		}

		try {
			const keyId = await createApiKey({
				teacherId: locals.user.role === 'admin' && teacherId ? teacherId : null,
				provider: provider as any,
				label: label || null,
				secret,
				fallbackModel,
				createdBy: locals.user.id
			});
			await logAudit({ action: 'apikey.create', entity: 'api_key', entityId: keyId.id, metadata: { provider, label, teacherId, fallbackModel }, userId: locals.user.id });
			// The admin supplies the secret, so there is no generated password to
			// hand back. createApiKey() returns wire-safe metadata only.
			return { success: true, keyId: keyId.id };
		} catch (e: any) {
			return fail(400, { error: e.message || 'Error al crear API key' });
		}
	},

	/**
	 * Sets the model a key falls back to when the provider rejects the primary
	 * one with a transient failure (Google 503 UNAVAILABLE, 429, 5xx).
	 *
	 * An empty value clears the override and the provider default applies.
	 */
	setFallback: async ({ request, locals }) => {
		const formData = await request.formData();
		const keyId = formData.get('keyId') as string;
		const fallbackModel = ((formData.get('fallbackModel') as string) ?? '').trim() || null;

		if (!keyId) {
			return fail(400, { error: 'Falta la API key' });
		}

		const updated = await updateApiKeyFallback({
			id: keyId,
			teacherId: locals.user.role === 'admin' ? null : locals.user.id,
			fallbackModel
		});
		if (!updated) {
			return fail(404, { error: 'La API key no existe o no pertenece a tu alcance' });
		}

		await logAudit({ action: 'apikey.fallback', entity: 'api_key', entityId: keyId, metadata: { fallbackModel }, userId: locals.user.id });
		return { success: true, fallbackModel };
	},

	toggleActive: async ({ request, locals }) => {
		const formData = await request.formData();
		const keyId = formData.get('keyId') as string;
		const active = formData.get('active') === 'true';

		const updated = await setApiKeyActive({
			id: keyId,
			teacherId: locals.user.role === 'admin' ? null : locals.user.id,
			active
		});
		if (!updated) {
			return fail(404, { error: 'La API key no existe o no pertenece a tu alcance' });
		}

		await logAudit({ action: active ? 'apikey.activate' : 'apikey.revoke', entity: 'api_key', entityId: keyId, userId: locals.user.id });
		return { success: true, active };
	},

	delete: async ({ request, locals }) => {
		const formData = await request.formData();
		const keyId = formData.get('keyId') as string;

		const removed = await revokeApiKey({
			id: keyId,
			teacherId: locals.user.role === 'admin' ? null : locals.user.id
		});
		if (!removed) {
			return fail(404, { error: 'La API key no existe o no pertenece a tu alcance' });
		}

		await logAudit({ action: 'apikey.delete', entity: 'api_key', entityId: keyId, userId: locals.user.id });
		return { success: true };
	}
};