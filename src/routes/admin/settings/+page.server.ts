import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { logAudit } from '#lib/server/repositories/audit.js';
import { env } from '$env/dynamic/private'; // ✅ Ruta correcta en SvelteKit

export const load: PageServerLoad = async ({ locals }) => {
	const currentUser = locals.user;

	const defaultProvider = currentUser?.defaultProvider || env.AI_PROVIDER || 'openai';
	const defaultModel =
		currentUser?.defaultModel ||
		env.AI_MODEL ||
		(defaultProvider === 'anthropic'
			? 'claude-sonnet-4-5'
			: defaultProvider === 'google'
				? 'gemini-2.5-flash'
				: 'gpt-4.1-mini');

	return {
		defaultProvider,
		defaultModel,
		envProvider: env.AI_PROVIDER || 'openai',
		envModel: env.AI_MODEL || ''
	};
};

export const actions: Actions = {
	/**
	 * Persists the admin's own default provider/model, the pair the grading
	 * pipeline reads when an activity does not override it.
	 *
	 * The form in the page targets `?/defaults`; without this action the submit
	 * 404s, which is why the page's success/error toasts never fired.
	 */
	defaults: async ({ request, locals }) => {
		const formData = await request.formData();
		const defaultProvider = String(formData.get('defaultProvider') ?? '').trim();
		const defaultModel = String(formData.get('defaultModel') ?? '').trim();

		if (!defaultProvider || !defaultModel) {
			return fail(400, { error: 'Proveedor y modelo son requeridos' });
		}

		await db
			.update(user)
			.set({ defaultProvider, defaultModel })
			.where(eq(user.id, locals.user.id));

		await logAudit({
			action: 'settings.defaults',
			entity: 'user',
			entityId: locals.user.id,
			metadata: { defaultProvider, defaultModel },
			userId: locals.user.id
		});

		return { success: true };
	}
};