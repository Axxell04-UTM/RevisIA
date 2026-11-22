import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { user, subject, subjectTeachers, account } from '#lib/server/db/schema/index.js';
import { auth } from '#lib/server/auth/index.js';
import { hashPassword } from 'better-auth/crypto';

export interface TeacherListItem {
	id: string;
	email: string;
	name: string | null;
	role: string;
	active: boolean;
	mustChangePassword: boolean;
	createdAt: Date;
	updatedAt: Date;
	subjectCount: number;
	subjects: Array<{ id: string; name: string; code: string }>;
}

export interface TeacherDetail extends TeacherListItem {
	lastLoginAt: Date | null;
}

function rowToTeacherDetail(row: any): TeacherDetail {
	return {
		...rowToTeacherListItem(row),
		lastLoginAt: null // TODO: add lastLoginAt when session tracking is implemented
	};
}

export interface CreateTeacherInput {
	email: string;
	name: string;
	password: string;
	subjectIds: string[];
	createdBy: string;
}

export interface UpdateTeacherInput {
	name?: string;
	active?: boolean;
	subjectIds?: string[];
	mustChangePassword?: boolean;
}

export interface ListTeachersOptions {
	limit: number;
	offset: number;
	search?: string;
	active?: boolean;
	sortBy?: 'createdAt' | 'name' | 'email';
	sortOrder?: 'asc' | 'desc';
}

function rowToTeacherListItem(row: any): TeacherListItem {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		role: row.role,
		active: row.active,
		mustChangePassword: row.mustChangePassword,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		subjectCount: Number(row.subjectCount ?? 0),
		subjects: row.subjects ?? []
	};
}

export async function listTeachers(options: ListTeachersOptions): Promise<{
	items: TeacherListItem[];
	total: number;
}> {
	const { limit, offset, search, active, sortBy = 'createdAt', sortOrder = 'desc' } = options;
	const db = getDb();

	const where = and(
		eq(user.role, 'teacher'),
		active !== undefined ? eq(user.active, active) : undefined,
		search ? ilike(user.email, `%${search}%`) : undefined
	);

	const orderBy = sortOrder === 'asc' ? asc(user[sortBy]) : desc(user[sortBy]);

	const [items, [{ total }]] = await Promise.all([
		db
			.select({
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
				active: user.active,
				mustChangePassword: user.mustChangePassword,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
				subjectCount: sql<number>`count(${subjectTeachers.subjectId})`.as('subject_count'),
				subjects: sql<TeacherListItem['subjects']>`
					jsonb_agg(
						jsonb_build_object(
							'id', ${subject.id},
							'name', ${subject.name},
							'code', ${subject.code}
						)
					) filter (where ${subject.id} is not null)
				`.as('subjects')
			})
			.from(user)
			.leftJoin(subjectTeachers, eq(subjectTeachers.teacherId, user.id))
			.leftJoin(subject, eq(subject.id, subjectTeachers.subjectId))
			.where(where)
			.groupBy(user.id)
			.orderBy(orderBy)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)` })
			.from(user)
			.where(where)
	]);

	return {
		items: items.map(rowToTeacherListItem),
		total: Number(total)
	};
}

export async function getTeacherById(id: string): Promise<TeacherDetail | null> {
	const db = getDb();
	const result = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			active: user.active,
			mustChangePassword: user.mustChangePassword,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			subjectCount: sql<number>`count(${subjectTeachers.subjectId})`.as('subject_count'),
			subjects: sql<TeacherListItem['subjects']>`
				jsonb_agg(
					jsonb_build_object(
						'id', ${subject.id},
						'name', ${subject.name},
						'code', ${subject.code}
					)
				) filter (where ${subject.id} is not null)
			`.as('subjects')
		})
		.from(user)
		.leftJoin(subjectTeachers, eq(subjectTeachers.teacherId, user.id))
		.leftJoin(subject, eq(subject.id, subjectTeachers.subjectId))
		.where(and(eq(user.id, id), eq(user.role, 'teacher')))
		.groupBy(user.id)
		.limit(1);

	if (!result[0]) return null;
	return rowToTeacherDetail(result[0]);
}

export async function createTeacher(input: CreateTeacherInput): Promise<string> {
	const db = getDb();
	const hashedPassword = await hashPassword(input.password);

	return await db.transaction(async (tx) => {
		const teacherId = crypto.randomUUID();
		const now = new Date();

		await tx.insert(user).values({
			id: teacherId,
			email: input.email.toLowerCase(),
			name: input.name,
			role: 'teacher',
			active: true,
			mustChangePassword: true,
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		});

		await tx.insert(account).values({
			id: crypto.randomUUID(),
			accountId: teacherId,
			providerId: 'credential',
			userId: teacherId,
			password: hashedPassword
		});

		if (input.subjectIds.length > 0) {
			await tx.insert(subjectTeachers).values(
				input.subjectIds.map((subjectId) => ({
					subjectId,
					teacherId,
					createdAt: now
				}))
			);
		}

		return teacherId;
	});
}

export async function updateTeacher(id: string, input: UpdateTeacherInput): Promise<void> {
	const db = getDb();
	const now = new Date();

	await db.transaction(async (tx) => {
		const updateData: Record<string, unknown> = { updatedAt: now };
		if (input.name !== undefined) updateData.name = input.name;
		if (input.active !== undefined) updateData.active = input.active;
		if (input.mustChangePassword !== undefined) updateData.mustChangePassword = input.mustChangePassword;

		if (Object.keys(updateData).length > 1) {
			await tx.update(user).set(updateData).where(eq(user.id, id));
		}

		if (input.subjectIds !== undefined) {
			await tx.delete(subjectTeachers).where(eq(subjectTeachers.teacherId, id));
			if (input.subjectIds.length > 0) {
				await tx.insert(subjectTeachers).values(
					input.subjectIds.map((subjectId) => ({
						subjectId,
						teacherId: id,
						createdAt: now
					}))
				);
			}
		}
	});
}

export async function setTeacherActive(id: string, active: boolean): Promise<void> {
	const db = getDb();
	await db.update(user).set({ active, updatedAt: new Date() }).where(eq(user.id, id));
}

export async function deleteTeacherSoft(id: string): Promise<void> {
	await setTeacherActive(id, false);
}