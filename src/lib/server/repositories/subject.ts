import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import { user } from '#lib/server/db/schema/auth.js';
import { isUuid } from './rubric.js';

export interface SubjectSummary {
	id: string;
	name: string;
	code: string | null;
	term: string | null;
	description: string | null;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
	teacherCount: number;
	teachers: Array<{ id: string; name: string | null; email: string }>;
}

export interface SubjectDetail extends SubjectSummary {}

export interface ListSubjectsOptions {
	limit: number;
	offset: number;
	search?: string;
	deleted?: boolean;
	sortBy?: 'createdAt' | 'name' | 'code';
	sortOrder?: 'asc' | 'desc';
}

export interface CreateSubjectInput {
	name: string;
	code?: string | null;
	term?: string | null;
	description?: string | null;
	teacherIds?: string[];
	createdBy: string;
}

export interface UpdateSubjectInput {
	name?: string;
	code?: string | null;
	term?: string | null;
	description?: string | null;
	teacherIds?: string[];
}

function rowToSubjectSummary(row: any): SubjectSummary {
	return {
		id: row.id,
		name: row.name,
		code: row.code,
		term: row.term,
		description: row.description,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt ?? null,
		teacherCount: Number(row.teacherCount ?? 0),
		teachers: row.teachers ?? []
	};
}

export async function listSubjects(options: ListSubjectsOptions): Promise<{
	items: SubjectSummary[];
	total: number;
}> {
	const { limit, offset, search, deleted, sortBy = 'createdAt', sortOrder = 'desc' } = options;
	const db = getDb();

	const where = and(
		deleted ? undefined : isNull(subject.deletedAt),
		search ? ilike(subject.name, `%${search}%`) : undefined
	);

	const orderBy = sortOrder === 'asc' ? asc(subject[sortBy]) : desc(subject[sortBy]);

	const [items, [{ total }]] = await Promise.all([
		db
			.select({
				id: subject.id,
				name: subject.name,
				code: subject.code,
				term: subject.term,
				description: subject.description,
				createdAt: subject.createdAt,
				updatedAt: subject.updatedAt,
				deletedAt: subject.deletedAt,
				teacherCount: sql<number>`count(${subjectTeachers.teacherId})`.as('teacher_count'),
				teachers: sql<any[]>`
					jsonb_agg(
						jsonb_build_object(
							'id', ${user.id},
							'name', ${user.name},
							'email', ${user.email}
						)
					) filter (where ${user.id} is not null)
				`.as('teachers')
			})
			.from(subject)
			.leftJoin(subjectTeachers, eq(subjectTeachers.subjectId, subject.id))
			.leftJoin(user, eq(user.id, subjectTeachers.teacherId))
			.where(where)
			.groupBy(subject.id)
			.orderBy(orderBy)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)` })
			.from(subject)
			.where(where)
	]);

	return {
		items: items.map(rowToSubjectSummary),
		total: Number(total)
	};
}

export async function getSubjectById(id: string): Promise<SubjectDetail | null> {
	if (!isUuid(id)) return null;
	const db = getDb();
	const result = await getDb()
		.select({
			id: subject.id,
			name: subject.name,
			code: subject.code,
			term: subject.term,
			description: subject.description,
			createdAt: subject.createdAt,
			updatedAt: subject.updatedAt,
			deletedAt: subject.deletedAt,
			teacherCount: sql<number>`count(${subjectTeachers.teacherId})`.as('teacher_count'),
			teachers: sql<any[]>`
				jsonb_agg(
					jsonb_build_object(
						'id', ${user.id},
						'name', ${user.name},
						'email', ${user.email}
					)
				) filter (where ${user.id} is not null)
			`.as('teachers')
		})
		.from(subject)
		.leftJoin(subjectTeachers, eq(subjectTeachers.subjectId, subject.id))
		.leftJoin(user, eq(user.id, subjectTeachers.teacherId))
		.where(and(eq(subject.id, id), isNull(subject.deletedAt)))
		.groupBy(subject.id)
		.limit(1);

	if (!result[0]) return null;
	return rowToSubjectSummary(result[0]);
}

export async function createSubject(input: CreateSubjectInput): Promise<string> {
	const db = getDb();
	const now = new Date();

	return await db.transaction(async (tx) => {
		const [subj] = await tx.insert(subject).values({
			name: input.name,
			code: input.code?.trim() || null,
			term: input.term?.trim() || null,
			description: input.description?.trim() || null,
			createdAt: now,
			updatedAt: now
		}).returning({ id: subject.id });

		const subjectId = subj.id;

		if (input.teacherIds && input.teacherIds.length > 0) {
			await tx.insert(subjectTeachers).values(
				input.teacherIds.map((teacherId) => ({
					subjectId,
					teacherId,
					assignedAt: now
				}))
			);
		}

		return subjectId;
	});
}

export async function updateSubject(id: string, input: UpdateSubjectInput): Promise<void> {
	if (!isUuid(id)) throw new Error('ID de asignatura inválido');
	const db = getDb();
	const now = new Date();

	await db.transaction(async (tx) => {
		const updateData: Record<string, unknown> = { updatedAt: now };
		if (input.name !== undefined) updateData.name = input.name;
		if (input.code !== undefined) updateData.code = input.code?.trim() || null;
		if (input.term !== undefined) updateData.term = input.term?.trim() || null;
		if (input.description !== undefined) updateData.description = input.description?.trim() || null;

		if (Object.keys(updateData).length > 1) {
			await tx.update(subject).set(updateData).where(eq(subject.id, id));
		}

		if (input.teacherIds !== undefined) {
			await tx.delete(subjectTeachers).where(eq(subjectTeachers.subjectId, id));
			if (input.teacherIds.length > 0) {
				await tx.insert(subjectTeachers).values(
					input.teacherIds.map((teacherId) => ({
						subjectId: id,
						teacherId,
						assignedAt: now
					}))
				);
			}
		}
	});
}

export async function deleteSubjectSoft(id: string): Promise<void> {
	if (!isUuid(id)) throw new Error('ID de asignatura inválido');
	const db = getDb();
	await db.update(subject).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(subject.id, id));
}

export async function restoreSubject(id: string): Promise<void> {
	if (!isUuid(id)) throw new Error('ID de asignatura inválido');
	const db = getDb();
	await db.update(subject).set({ deletedAt: null, updatedAt: new Date() }).where(eq(subject.id, id));
}

export async function assignTeachers(subjectId: string, teacherIds: string[], assignedBy: string): Promise<void> {
	if (!isUuid(subjectId)) throw new Error('ID de asignatura inválido');
	const db = getDb();
	const now = new Date();

	await db.transaction(async (tx) => {
		await tx.delete(subjectTeachers).where(eq(subjectTeachers.subjectId, subjectId));
		if (teacherIds.length > 0) {
			await tx.insert(subjectTeachers).values(
				teacherIds.map((teacherId) => ({
					subjectId,
					teacherId,
					assignedAt: now
				}))
			);
		}
	});
}

export async function listAvailableTeachers(): Promise<Array<{ id: string; name: string | null; email: string }>> {
	const db = getDb();
	const rows = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(and(eq(user.role, 'teacher'), eq(user.active, true)))
		.orderBy(asc(user.name));
	return rows;
}

export async function getSubjects(): Promise<Array<{ id: string; name: string; code: string | null }>> {
	const db = getDb();
	const rows = await db
		.select({ id: subject.id, name: subject.name, code: subject.code })
		.from(subject)
		.where(isNull(subject.deletedAt))
		.orderBy(asc(subject.name));
	return rows;
}

/**
 * Legacy function kept for backward compatibility.
 * Returns subjects a teacher is assigned to.
 */
export async function listTeacherSubjects(teacherId: string): Promise<Array<{ id: string; name: string; code: string; term: string }>> {
	const rows = await getDb()
		.select({
			id: subject.id,
			name: subject.name,
			code: subject.code,
			term: subject.term
		})
		.from(subject)
		.innerJoin(subjectTeachers, eq(subjectTeachers.subjectId, subject.id))
		.where(and(eq(subjectTeachers.teacherId, teacherId), isNull(subject.deletedAt)))
		.orderBy(asc(subject.name));

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		code: row.code ?? '',
		term: row.term ?? ''
	}));
}

/** True when the teacher is assigned to that subject. */
export async function teacherTeachesSubject(
	teacherId: string,
	subjectId: string
): Promise<boolean> {
	if (!isUuid(subjectId)) return false;

	const [row] = await getDb()
		.select({ subjectId: subjectTeachers.subjectId })
		.from(subjectTeachers)
		.innerJoin(subject, eq(subject.id, subjectTeachers.subjectId))
		.where(
			and(
				eq(subjectTeachers.teacherId, teacherId),
				eq(subjectTeachers.subjectId, subjectId),
				isNull(subject.deletedAt)
			)
		)
		.limit(1);

	return Boolean(row);
}

/** Set subject active/inactive state (alias for delete/restore). */
export async function setSubjectActive(id: string, active: boolean): Promise<void> {
	if (active) {
		await restoreSubject(id);
	} else {
		await deleteSubjectSoft(id);
	}
}