import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isUuid } from '#lib/server/repositories/rubric.js';
import { setMembers } from '#lib/server/repositories/submission.js';

/**
 * POST /api/submissions/[id]/members
 * Body: { members: { studentId?: string | null; name: string; isAuthor?: boolean }[] }
 *
 * Replaces all members. For individual deliveries the array is usually empty or one.
 * For group work: multiple members with the same submissionId → one grade for all.
 * `studentId` is optional because a member may not be in the roster yet; `name` is always kept.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: 'No autenticado' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Entrega inválida' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as {
		members?: { studentId?: string | null; name: string; isAuthor?: boolean }[];
	};
	if (!Array.isArray(body.members)) {
		return json({ error: 'Enviá { members: [...] }' }, { status: 400 });
	}

	// Validate UUIDs
	for (const m of body.members) {
		if (m.studentId && !isUuid(m.studentId)) {
			return json({ error: 'Estudiante inválido en la lista' }, { status: 400 });
		}
		if (!m.name?.trim()) {
			return json({ error: 'Cada integrante necesita un nombre' }, { status: 400 });
		}
	}

	try {
		const members = await setMembers(locals.user.id, params.id, body.members);
		return json({ members });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Error guardando integrantes';
		return json({ error: message }, { status: 400 });
	}
};