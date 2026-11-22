import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { activity, rubric, rubricContext, rubricCriterion, rubricLevel } from '#lib/server/db/schema/academic.js';
import { slugify } from '#lib/domain/types.js';
import type { Template, Criterion, RubricLevel } from '#lib/domain/types.js';

/**
 * Repository for "rúbricas": a rubric plus its default context blocks.
 *
 * The client `Template` type is the wire/domain shape; the tables are
 * `rubric` + `rubric_criterion` + `rubric_context`. Ids are assigned by the
 * database, so a client id is only a hint: a value that is not an existing
 * rubric of this teacher always creates a new row.
 */

export type TemplateInput = {
	id?: string;
	name: string;
	instruction?: string;
	answerTag?: string;
	answerLabel?: string;
	contexts?: { id?: string; tag: string; label: string; placeholder?: string }[];
	criteria: {
		id?: string;
		name: string;
		description?: string;
		maxPoints: number;
		weight?: number;
		levels?: { id?: string; label: string; points: number; description?: string; position?: number }[];
	}[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_RE.test(value);
}

/** Tags must be unique per rubric and usable as `<tag>` in the prompt. */
function normalizeTags(contexts: TemplateInput['contexts']): { tag: string; label: string; placeholder: string }[] {
	const seen = new Map<string, number>();
	return (contexts ?? []).map((c) => {
		const base = slugify(c.tag || c.label || 'contexto');
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return {
			tag: count === 1 ? base : `${base}_${count}`,
			label: (c.label ?? '').trim() || base,
			placeholder: c.placeholder ?? ''
		};
	});
}

function validate(input: TemplateInput) {
	if (!input || typeof input !== 'object') throw new Error('Rúbrica inválida');
	const name = (input.name ?? '').trim();
	if (!name) throw new Error('La rúbrica necesita un nombre');
	if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
		throw new Error('La rúbrica necesita al menos un criterio');
	}
	let totalWeight = 0;
	for (const c of input.criteria) {
		if (!(c.name ?? '').trim()) throw new Error('Todos los criterios necesitan un nombre');
		if (!Number.isFinite(c.maxPoints) || c.maxPoints < 0) {
			throw new Error(`Puntaje inválido en el criterio "${c.name}"`);
		}
		if (c.weight !== undefined && (!Number.isFinite(c.weight) || c.weight <= 0)) {
			throw new Error(`Peso inválido en el criterio "${c.name}": debe ser un número positivo`);
		}
		totalWeight += c.weight ?? 1;
		if (c.levels && Array.isArray(c.levels)) {
			let prevPoints = -1;
			for (const [idx, lvl] of c.levels.entries()) {
				if (!(lvl.label ?? '').trim()) throw new Error(`Nivel ${idx + 1} del criterio "${c.name}" necesita una etiqueta`);
				if (!Number.isFinite(lvl.points) || lvl.points < 0 || lvl.points > c.maxPoints) {
					throw new Error(`Puntos inválidos en nivel "${lvl.label}" del criterio "${c.name}": debe ser entre 0 y ${c.maxPoints}`);
				}
				if (lvl.points <= prevPoints) {
					throw new Error(`Los niveles del criterio "${c.name}" deben tener puntos estrictamente crecientes`);
				}
				prevPoints = lvl.points;
			}
		}
	}
	// Validación global: pesos deben sumar > 0
	if (totalWeight <= 0) throw new Error('La suma de pesos debe ser mayor a 0');

	return {
		name,
		instruction: input.instruction ?? '',
		answerTag: slugify(input.answerTag || 'respuesta') || 'respuesta',
		answerLabel: (input.answerLabel ?? '').trim() || 'Respuesta',
		criteria: input.criteria.map((c) => ({
			id: isUuid(c.id) ? c.id : null,
			name: c.name.trim(),
			description: c.description ?? '',
			maxPoints: c.maxPoints,
			weight: c.weight ?? 1,
			levels: (c.levels ?? []).map((l, pos) => ({
				id: isUuid(l.id) ? l.id : null,
				label: l.label.trim(),
				points: l.points,
				description: l.description ?? '',
				position: l.position ?? pos
			}))
		})),
		contexts: normalizeTags(input.contexts)
	};
}

function toTemplate(
	row: typeof rubric.$inferSelect,
	criteria: (typeof rubricCriterion.$inferSelect)[],
	contexts: (typeof rubricContext.$inferSelect)[],
	levels: (typeof rubricLevel.$inferSelect)[]
): Template {
	return {
		id: row.id,
		name: row.name,
		instruction: row.instruction ?? '',
		answerTag: row.answerTag,
		answerLabel: row.answerLabel,
		contexts: contexts.map((c) => ({ id: c.id, tag: c.tag, label: c.label, placeholder: c.placeholder })),
		criteria: criteria.map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description ?? '',
			maxPoints: c.maxPoints,
			weight: c.weight ?? 1,
			levels: levels
				.filter((l) => l.criterionId === c.id)
				.map((l) => ({
					id: l.id,
					label: l.label,
					points: l.points,
					description: l.description ?? '',
					position: l.position
				}))
		})),
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

/** Hydrate a set of rubric rows with their criteria, contexts, and levels. */
async function hydrate(rows: (typeof rubric.$inferSelect)[]): Promise<Template[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const allCriteria = await getDb()
		.select()
		.from(rubricCriterion)
		.where(inArray(rubricCriterion.rubricId, ids))
		.orderBy(asc(rubricCriterion.position));
	const allContexts = await getDb()
		.select()
		.from(rubricContext)
		.where(inArray(rubricContext.rubricId, ids))
		.orderBy(asc(rubricContext.position));
	const criterionIds = allCriteria.map((c) => c.id);
	const allLevels = criterionIds.length > 0
		? await getDb()
			.select()
			.from(rubricLevel)
			.where(inArray(rubricLevel.criterionId, criterionIds))
			.orderBy(asc(rubricLevel.position))
		: [];
	return rows.map((row) =>
		toTemplate(
			row,
			allCriteria.filter((c) => c.rubricId === row.id),
			allContexts.filter((c) => c.rubricId === row.id),
			allLevels.filter((l) => allCriteria.some((c) => c.id === l.criterionId && c.rubricId === row.id))
		)
	);
}

export async function listTemplates(teacherId: string): Promise<Template[]> {
	const rows = await getDb()
		.select()
		.from(rubric)
		.where(and(eq(rubric.teacherId, teacherId), isNull(rubric.deletedAt)))
		.orderBy(desc(rubric.updatedAt));
	return hydrate(rows);
}

export async function getTemplate(teacherId: string, id: string): Promise<Template | null> {
	if (!isUuid(id)) return null;
	const [row] = await getDb()
		.select()
		.from(rubric)
		.where(and(eq(rubric.id, id), eq(rubric.teacherId, teacherId), isNull(rubric.deletedAt)))
		.limit(1);
	if (!row) return null;
	const [template] = await hydrate([row]);
	return template;
}

/**
 * Create or update. Criteria and contexts are reconciled in place so existing
 * `grade` rows keep pointing at the same `rubric_criterion` ids.
 *
 * Removing a criterion deletes its rows, and `grade` cascades: the grades of a
 * rubric that changed are no longer comparable, so they go with it.
 */
export async function saveTemplate(teacherId: string, input: TemplateInput): Promise<Template> {
	const data = validate(input);
	const db = getDb();

	return db.transaction(async (tx) => {
		let rubricId: string | null = null;
		if (isUuid(input.id)) {
			const [existing] = await tx
				.select({ id: rubric.id })
				.from(rubric)
				.where(and(eq(rubric.id, input.id), eq(rubric.teacherId, teacherId), isNull(rubric.deletedAt)))
				.limit(1);
			rubricId = existing?.id ?? null;
		}

		if (rubricId) {
			await tx
				.update(rubric)
				.set({
					name: data.name,
					instruction: data.instruction,
					answerTag: data.answerTag,
					answerLabel: data.answerLabel,
					updatedAt: new Date()
				})
				.where(eq(rubric.id, rubricId));
		} else {
			const [created] = await tx
				.insert(rubric)
				.values({
					teacherId,
					name: data.name,
					instruction: data.instruction,
					answerTag: data.answerTag,
					answerLabel: data.answerLabel
				})
				.returning({ id: rubric.id });
			rubricId = created.id;
		}

		// --- criteria: update in place, insert new, delete removed ---
		const current = await tx
			.select({ id: rubricCriterion.id })
			.from(rubricCriterion)
			.where(eq(rubricCriterion.rubricId, rubricId));
		const currentIds = new Set(current.map((c) => c.id));
		const keptIds = new Set<string>();

		for (const [position, c] of data.criteria.entries()) {
			if (c.id && currentIds.has(c.id)) {
				keptIds.add(c.id);
				await tx
					.update(rubricCriterion)
					.set({ name: c.name, description: c.description, maxPoints: c.maxPoints, weight: c.weight, position })
					.where(eq(rubricCriterion.id, c.id));
			} else {
				await tx
					.insert(rubricCriterion)
					.values({ rubricId, name: c.name, description: c.description, maxPoints: c.maxPoints, weight: c.weight, position });
			}
		}
		const removed = [...currentIds].filter((id) => !keptIds.has(id));
		if (removed.length > 0) {
			await tx.delete(rubricCriterion).where(inArray(rubricCriterion.id, removed));
		}

		// --- levels: replace wholesale per criterion ---
		const finalCriteria = await tx
			.select({ id: rubricCriterion.id })
			.from(rubricCriterion)
			.where(eq(rubricCriterion.rubricId, rubricId));
		for (const [, c] of data.criteria.entries()) {
			const criterionId = c.id && currentIds.has(c.id) ? c.id
				: finalCriteria.find((fc) => fc.id === c.id)?.id;
			if (criterionId) {
				await tx.delete(rubricLevel).where(eq(rubricLevel.criterionId, criterionId));
				if (c.levels && c.levels.length > 0) {
					await tx.insert(rubricLevel).values(
						c.levels.map((l, pos) => ({
							criterionId,
							label: l.label,
							points: l.points,
							description: l.description,
							position: l.position ?? pos
						}))
					);
				}
			}
		}

		// --- contexts: small and position-only, replace wholesale ---
		await tx.delete(rubricContext).where(eq(rubricContext.rubricId, rubricId));
		if (data.contexts.length > 0) {
			await tx
				.insert(rubricContext)
				.values(data.contexts.map((c, position) => ({ rubricId: rubricId as string, ...c, position })));
		}

		const [row] = await tx.select().from(rubric).where(eq(rubric.id, rubricId)).limit(1);
		const criteria = await tx
			.select()
			.from(rubricCriterion)
			.where(eq(rubricCriterion.rubricId, rubricId))
			.orderBy(asc(rubricCriterion.position));
		const contexts = await tx
			.select()
			.from(rubricContext)
			.where(eq(rubricContext.rubricId, rubricId))
			.orderBy(asc(rubricContext.position));
		const levels = await tx
			.select()
			.from(rubricLevel)
			.where(inArray(rubricLevel.criterionId, criteria.map((c) => c.id)))
			.orderBy(asc(rubricLevel.position));
		return toTemplate(row, criteria, contexts, levels);
	});
}

/** Soft delete: `grade` rows and activities keep their rubric history. */
export type DeleteTemplateResult = {
	/** False when the rubric does not exist or belongs to someone else. */
	deleted: boolean;
	/** Activities that pointed at it and now point at nothing. */
	unboundActivities: number;
};

/**
 * Soft-deletes a rubric and unbinds the activities that used it.
 *
 * Leaving `activity.rubric_id` pointing at a deleted row would be a lie the
 * picker hides: the activity would look unlinked while the database still
 * claims a rubric. Both writes share one transaction, and the caller gets the
 * number of unbound activities so the UI can report it.
 */
export async function deleteTemplate(
	teacherId: string,
	id: string
): Promise<DeleteTemplateResult> {
	if (!isUuid(id)) return { deleted: false, unboundActivities: 0 };
	const db = getDb();

	return db.transaction(async (tx) => {
		const [owned] = await tx
			.select({ id: rubric.id })
			.from(rubric)
			.where(and(eq(rubric.id, id), eq(rubric.teacherId, teacherId), isNull(rubric.deletedAt)))
			.limit(1);
		if (!owned) return { deleted: false, unboundActivities: 0 };

		const unbound = await tx
			.update(activity)
			.set({ rubricId: null })
			.where(and(eq(activity.rubricId, id), eq(activity.createdBy, teacherId)))
			.returning({ id: activity.id });

		await tx.update(rubric).set({ deletedAt: new Date() }).where(eq(rubric.id, id));

		return { deleted: true, unboundActivities: unbound.length };
	});
}

export async function duplicateTemplate(teacherId: string, id: string): Promise<Template | null> {
	const source = await getTemplate(teacherId, id);
	if (!source) return null;
	return saveTemplate(teacherId, {
		name: `${source.name} (copia)`,
		instruction: source.instruction,
		answerTag: source.answerTag,
		answerLabel: source.answerLabel,
		contexts: source.contexts.map(({ tag, label, placeholder }) => ({ tag, label, placeholder })),
		criteria: source.criteria.map(({ name, description, maxPoints, weight, levels }) => ({
			name,
			description,
			maxPoints,
			weight: weight ?? 1,
			levels: (levels ?? []).map(({ label, points, description }) => ({ label, points, description }))
		}))
	});
}

/** Bulk upsert used by the JSON import. New rows always win over ids. */
export async function importTemplates(teacherId: string, templates: TemplateInput[]): Promise<Template[]> {
	if (!Array.isArray(templates) || templates.length === 0) {
		throw new Error('El archivo no contiene rúbricas');
	}
	const saved: Template[] = [];
	for (const t of templates) {
		saved.push(await saveTemplate(teacherId, { ...t, id: undefined }));
	}
	return saved;
}
