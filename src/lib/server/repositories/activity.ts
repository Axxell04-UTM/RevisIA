import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import {
	activity,
	activityContext,
	file,
	rubric,
	rubricContext,
	rubricCriterion,
	subject,
	subjectTeachers
} from '#lib/server/db/schema/academic.js';
import { slugify } from '#lib/domain/types.js';
import type { Activity, ActivityStatus, SubjectSummary } from '#lib/domain/types.js';
import { isUuid } from './rubric.js';

/**
 * Repository for "actividades": the academic context an evaluation hangs from.
 *
 * Ownership is `created_by` (a teacher), not the subject: subjects have no CRUD
 * yet (F5.2), so `subject_id` is optional and only validated when present.
 * The total score is never stored — it is derived from the rubric criteria so a
 * rubric edit cannot leave a stale total behind.
 */

export type ActivityInput = {
	id?: string;
	subjectId?: string | null;
	title: string;
	description?: string;
	objectives?: string;
	instructions?: string;
	sourceFileId?: string | null;
	rubricId?: string | null;
	/** ISO string or epoch millis; `null`/empty clears the due date. */
	dueAt?: string | number | null;
	status?: ActivityStatus;
	contexts?: { id?: string; tag: string; label: string; content?: string }[];
};

const STATUSES: ActivityStatus[] = ['draft', 'open', 'closed'];

/** Tags must be unique per activity and usable as `<tag>` in the prompt. */
function normalizeTags(
	contexts: ActivityInput['contexts']
): { tag: string; label: string; content: string }[] {
	const seen = new Map<string, number>();
	return (contexts ?? []).map((c) => {
		const base = slugify(c.tag || c.label || 'contexto');
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return {
			tag: count === 1 ? base : `${base}_${count}`,
			label: (c.label ?? '').trim() || base,
			content: c.content ?? ''
		};
	});
}

function parseDueAt(value: ActivityInput['dueAt']): Date | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Fecha de entrega inválida');
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) throw new Error('Fecha de entrega inválida');
		return date;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('Fecha de entrega inválida');
	return date;
}

function validate(input: ActivityInput) {
	if (!input || typeof input !== 'object') throw new Error('Actividad inválida');
	const title = (input.title ?? '').trim();
	if (!title) throw new Error('La actividad necesita un título');

	const status = input.status ?? 'draft';
	if (!STATUSES.includes(status)) throw new Error(`Estado inválido: ${status}`);

	return {
		subjectId: input.subjectId ? input.subjectId : null,
		title,
		description: (input.description ?? '').trim(),
		objectives: (input.objectives ?? '').trim(),
		instructions: (input.instructions ?? '').trim(),
		sourceFileId: input.sourceFileId ? input.sourceFileId : null,
		rubricId: input.rubricId ? input.rubricId : null,
		dueAt: parseDueAt(input.dueAt),
		status,
		contexts: normalizeTags(input.contexts)
	};
}

function toActivity(
	row: typeof activity.$inferSelect,
	contexts: (typeof activityContext.$inferSelect)[],
	maxPoints: number | null
): Activity {
	return {
		id: row.id,
		subjectId: row.subjectId,
		title: row.title,
		description: row.description ?? '',
		objectives: row.objectives ?? '',
		instructions: row.instructions ?? '',
		sourceFileId: row.sourceFileId,
		submissionsZip: row.submissionsZipFileId
			? { fileId: row.submissionsZipFileId, fileCount: row.submissionsZipFileCount }
			: null,
		rubricId: row.rubricId,
		dueAt: row.dueAt ? row.dueAt.getTime() : null,
		status: row.status,
		contexts: contexts.map((c) => ({ id: c.id, tag: c.tag, label: c.label, content: c.content })),
		maxPoints,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

/** Sum of the rubric criteria, or `null` when there is no rubric. */
async function rubricTotals(rubricIds: string[]): Promise<Map<string, number>> {
	if (rubricIds.length === 0) return new Map();
	const rows = await getDb()
		.select({
			rubricId: rubricCriterion.rubricId,
			total: sql<number>`sum(${rubricCriterion.maxPoints})`
		})
		.from(rubricCriterion)
		.where(inArray(rubricCriterion.rubricId, rubricIds))
		.groupBy(rubricCriterion.rubricId);
	return new Map(rows.map((r) => [r.rubricId, Number(r.total)]));
}

async function hydrate(rows: (typeof activity.$inferSelect)[]): Promise<Activity[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const rubricIds = [...new Set(rows.map((r) => r.rubricId).filter((id): id is string => !!id))];
	const [allContexts, totals] = await Promise.all([
		getDb()
			.select()
			.from(activityContext)
			.where(inArray(activityContext.activityId, ids))
			.orderBy(asc(activityContext.position)),
		rubricTotals(rubricIds)
	]);
	return rows.map((row) =>
		toActivity(
			row,
			allContexts.filter((c) => c.activityId === row.id),
			row.rubricId ? totals.get(row.rubricId) ?? 0 : null
		)
	);
}

/** Subjects this teacher is assigned to; drives the subject picker in the UI. */
export async function listSubjects(teacherId: string): Promise<SubjectSummary[]> {
	const rows = await getDb()
		.select({ id: subject.id, name: subject.name, code: subject.code, term: subject.term })
		.from(subject)
		.innerJoin(subjectTeachers, eq(subjectTeachers.subjectId, subject.id))
		.where(and(eq(subjectTeachers.teacherId, teacherId), isNull(subject.deletedAt)))
		.orderBy(asc(subject.name));
	return rows.map((r) => ({ id: r.id, name: r.name, code: r.code ?? '', term: r.term ?? '' }));
}

export async function listActivities(
	teacherId: string,
	options: { subjectId?: string | null } = {}
): Promise<Activity[]> {
	const filters = [eq(activity.createdBy, teacherId), isNull(activity.deletedAt)];
	if (options.subjectId) filters.push(eq(activity.subjectId, options.subjectId));
	const rows = await getDb()
		.select()
		.from(activity)
		.where(and(...filters))
		.orderBy(desc(activity.updatedAt));
	return hydrate(rows);
}

/**
 * Live activities per rubric for one teacher.
 *
 * The rubric list uses this to say "la usan N actividades" before deleting, so
 * the teacher knows what gets unbound. A plain object keeps it serializable
 * across the server/client boundary.
 */
export async function countActivitiesByRubric(teacherId: string): Promise<Record<string, number>> {
	const rows = await getDb()
		.select({ rubricId: activity.rubricId, total: sql<number>`count(*)` })
		.from(activity)
		.where(
			and(
				eq(activity.createdBy, teacherId),
				isNull(activity.deletedAt),
				sql`${activity.rubricId} is not null`
			)
		)
		.groupBy(activity.rubricId);

	const usage: Record<string, number> = {};
	for (const row of rows) {
		if (row.rubricId) usage[row.rubricId] = Number(row.total);
	}
	return usage;
}

export async function getActivity(teacherId: string, id: string): Promise<Activity | null> {
	if (!isUuid(id)) return null;
	const [row] = await getDb()
		.select()
		.from(activity)
		.where(and(eq(activity.id, id), eq(activity.createdBy, teacherId), isNull(activity.deletedAt)))
		.limit(1);
	if (!row) return null;
	const [result] = await hydrate([row]);
	return result;
}

/**
 * The activity plus the extracted text of its source document.
 *
 * Grading needs both: the academic context is rendered into the prompt, and the
 * source document is the material the students worked from. The text lives on
 * `file.extracted_text` (the binary stays in object storage), so it is read
 * here instead of being duplicated on the activity row.
 */
export async function getActivityPrompt(
	teacherId: string,
	id: string
): Promise<{ activity: Activity; sourceDocument: string } | null> {
	const found = await getActivity(teacherId, id);
	if (!found) return null;
	if (!found.sourceFileId) return { activity: found, sourceDocument: '' };

	const [row] = await getDb()
		.select({ extractedText: file.extractedText })
		.from(file)
		.where(and(eq(file.id, found.sourceFileId), eq(file.uploadedBy, teacherId)))
		.limit(1);

	return { activity: found, sourceDocument: row?.extractedText ?? '' };
}

/**
 * Create or update one activity.
 *
 * On create, the context blocks of the assigned rubric are copied in with empty
 * content so the teacher starts from the template's tags instead of retyping
 * them (the tags are what the prompt renders).
 */
export async function saveActivity(teacherId: string, input: ActivityInput): Promise<Activity> {
	const data = validate(input);
	const db = getDb();

	return db.transaction(async (tx) => {
		// --- ownership checks for every referenced row ---
		if (data.subjectId) {
			if (!isUuid(data.subjectId)) throw new Error('Asignatura inválida');
			const [row] = await tx
				.select({ id: subject.id })
				.from(subject)
				.innerJoin(subjectTeachers, eq(subjectTeachers.subjectId, subject.id))
				.where(
					and(
						eq(subject.id, data.subjectId),
						eq(subjectTeachers.teacherId, teacherId),
						isNull(subject.deletedAt)
					)
				)
				.limit(1);
			if (!row) throw new Error('La asignatura no existe o no está asignada a este docente');
		}

		if (data.rubricId) {
			if (!isUuid(data.rubricId)) throw new Error('Rúbrica inválida');
			const [row] = await tx
				.select({ id: rubric.id })
				.from(rubric)
				.where(
					and(eq(rubric.id, data.rubricId), eq(rubric.teacherId, teacherId), isNull(rubric.deletedAt))
				)
				.limit(1);
			if (!row) throw new Error('La rúbrica no existe');
		}

		if (data.sourceFileId) {
			if (!isUuid(data.sourceFileId)) throw new Error('Archivo inválido');
			const [row] = await tx
				.select({ id: file.id })
				.from(file)
				.where(and(eq(file.id, data.sourceFileId), eq(file.uploadedBy, teacherId)))
				.limit(1);
			if (!row) throw new Error('El archivo no existe');
		}

		// --- create or update the row itself ---
		let activityId: string | null = null;
		if (isUuid(input.id)) {
			const [existing] = await tx
				.select({ id: activity.id })
				.from(activity)
				.where(
					and(eq(activity.id, input.id), eq(activity.createdBy, teacherId), isNull(activity.deletedAt))
				)
				.limit(1);
			activityId = existing?.id ?? null;
		}

		const values = {
			subjectId: data.subjectId,
			title: data.title,
			description: data.description,
			objectives: data.objectives,
			instructions: data.instructions,
			sourceFileId: data.sourceFileId,
			rubricId: data.rubricId,
			dueAt: data.dueAt,
			status: data.status
		};

		let contexts = data.contexts;
		if (activityId) {
			await tx
				.update(activity)
				.set({ ...values, updatedAt: new Date() })
				.where(eq(activity.id, activityId));
		} else {
			const [created] = await tx
				.insert(activity)
				.values({ ...values, createdBy: teacherId })
				.returning({ id: activity.id });
			activityId = created.id;

			// Seed the prompt tags from the rubric template when the caller sent none.
			if (contexts.length === 0 && data.rubricId) {
				const templateContexts = await tx
					.select({ tag: rubricContext.tag, label: rubricContext.label })
					.from(rubricContext)
					.where(eq(rubricContext.rubricId, data.rubricId))
					.orderBy(asc(rubricContext.position));
				contexts = templateContexts.map((c) => ({ tag: c.tag, label: c.label, content: '' }));
			}
		}

		// --- contexts: replace wholesale (their content is the payload) ---
		await tx.delete(activityContext).where(eq(activityContext.activityId, activityId));
		if (contexts.length > 0) {
			await tx.insert(activityContext).values(
				contexts.map((c, position) => ({
					activityId: activityId as string,
					tag: c.tag,
					label: c.label,
					content: c.content,
					position
				}))
			);
		}

		const [row] = await tx.select().from(activity).where(eq(activity.id, activityId)).limit(1);
		const rows = await tx
			.select()
			.from(activityContext)
			.where(eq(activityContext.activityId, activityId))
			.orderBy(asc(activityContext.position));
		let maxPoints: number | null = null;
		if (row.rubricId) {
			const [total] = await tx
				.select({ total: sql<number>`sum(${rubricCriterion.maxPoints})` })
				.from(rubricCriterion)
				.where(eq(rubricCriterion.rubricId, row.rubricId));
			maxPoints = Number(total?.total ?? 0);
		}
		return toActivity(row, rows, maxPoints);
	});
}

/**
 * Rename only the title.
 *
 * `saveActivity` replaces every field, so using it to rename from the sidebar
 * would wipe description, objectives, instructions, due date and the context
 * blocks. This narrow update touches `title` and `updated_at` and nothing else.
 */
export async function renameActivity(
	teacherId: string,
	id: string,
	title: string
): Promise<Activity> {
	if (!isUuid(id)) throw new Error('Actividad no encontrada');
	const clean = (title ?? '').trim();
	if (!clean) throw new Error('La actividad necesita un título');

	const rows = await getDb()
		.update(activity)
		.set({ title: clean, updatedAt: new Date() })
		.where(and(eq(activity.id, id), eq(activity.createdBy, teacherId), isNull(activity.deletedAt)))
		.returning();

	if (rows.length === 0) throw new Error('Actividad no encontrada');
	const [result] = await hydrate(rows);
	return result;
}

/**
 * Copy one activity into a new draft.
 *
 * Everything except identity is copied (source document, rubric, due date and
 * the context blocks with their content), because the point of duplicating is
 * reusing the same academic setup for another cohort. The copy starts as a
 * `draft` so it never looks open before the teacher reviews it.
 */
export async function duplicateActivity(teacherId: string, id: string): Promise<Activity> {
	const source = await getActivity(teacherId, id);
	if (!source) throw new Error('Actividad no encontrada');
	const db = getDb();

	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(activity)
			.values({
				subjectId: source.subjectId,
				title: `${source.title} (copia)`,
				description: source.description,
				objectives: source.objectives,
				instructions: source.instructions,
				sourceFileId: source.sourceFileId,
				rubricId: source.rubricId,
				dueAt: source.dueAt === null ? null : new Date(source.dueAt),
				status: 'draft',
				createdBy: teacherId
			})
			.returning();

		if (source.contexts.length > 0) {
			await tx.insert(activityContext).values(
				source.contexts.map((context, position) => ({
					activityId: created.id,
					tag: context.tag,
					label: context.label,
					content: context.content,
					position
				}))
			);
		}

		const [row] = await tx.select().from(activity).where(eq(activity.id, created.id)).limit(1);
		const rows = await tx
			.select()
			.from(activityContext)
			.where(eq(activityContext.activityId, created.id))
			.orderBy(asc(activityContext.position));

		let maxPoints: number | null = null;
		if (row.rubricId) {
			const [total] = await tx
				.select({ total: sql<number>`sum(${rubricCriterion.maxPoints})` })
				.from(rubricCriterion)
				.where(eq(rubricCriterion.rubricId, row.rubricId));
			maxPoints = Number(total?.total ?? 0);
		}

		return toActivity(row, rows, maxPoints);
	});
}

/** Soft delete: submissions and grades keep their activity history. */
export async function deleteActivity(teacherId: string, id: string): Promise<boolean> {
	if (!isUuid(id)) return false;
	const rows = await getDb()
		.update(activity)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(activity.id, id), eq(activity.createdBy, teacherId), isNull(activity.deletedAt)))
		.returning({ id: activity.id });
	return rows.length > 0;
}
