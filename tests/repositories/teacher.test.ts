import { describe, expect, it, beforeEach, vi } from 'vitest';
import { testDb, resetDb } from '../helpers/db.js';
import { user, subject, subjectTeachers, account, session } from '#lib/server/db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { listTeachers, getTeacherById, createTeacher, updateTeacher, setTeacherActive, deleteTeacherSoft } from '#lib/server/repositories/teacher.js';
import { randomUUID } from 'node:crypto';

vi.mock('#lib/server/db/index.js', async () => {
	const actual = await vi.importActual('#lib/server/db/index.js');
	return {
		...actual,
		getDb: () => testDb
	};
});

// Fixed UUIDs for consistent test data
const SUB_1 = randomUUID();
const SUB_2 = randomUUID();
const SUB_3 = randomUUID();
const TEACHER_1 = randomUUID();
const TEACHER_2 = randomUUID();
const TEACHER_3 = randomUUID();
const ADMIN_1 = randomUUID();

describe('teacher repository', () => {
	beforeEach(async () => {
		await resetDb();
		// Create test subjects
		await testDb.insert(subject).values([
			{ id: SUB_1, name: 'Matemáticas', code: 'MAT-101', term: '2026-1', createdAt: new Date(), updatedAt: new Date() },
			{ id: SUB_2, name: 'Física', code: 'FIS-101', term: '2026-1', createdAt: new Date(), updatedAt: new Date() },
			{ id: SUB_3, name: 'Química', code: 'QUI-101', term: '2026-1', createdAt: new Date(), updatedAt: new Date() }
		]);
		// Create test teachers
		await testDb.insert(user).values([
			{
				id: TEACHER_1,
				email: 'teacher1@test.com',
				name: 'Teacher One',
				role: 'teacher',
				active: true,
				mustChangePassword: true,
				emailVerified: true,
				createdAt: new Date('2026-01-01'),
				updatedAt: new Date('2026-01-01')
			},
			{
				id: TEACHER_2,
				email: 'teacher2@test.com',
				name: 'Teacher Two',
				role: 'teacher',
				active: true,
				mustChangePassword: false,
				emailVerified: true,
				createdAt: new Date('2026-01-02'),
				updatedAt: new Date('2026-01-02')
			},
			{
				id: TEACHER_3,
				email: 'teacher3@test.com',
				name: 'Teacher Three',
				role: 'teacher',
				active: false,
				mustChangePassword: false,
				emailVerified: true,
				createdAt: new Date('2026-01-03'),
				updatedAt: new Date('2026-01-03')
			},
			{
				id: ADMIN_1,
				email: 'admin@test.com',
				name: 'Admin User',
				role: 'admin',
				active: true,
				mustChangePassword: false,
				emailVerified: true,
				createdAt: new Date('2026-01-04'),
				updatedAt: new Date('2026-01-04')
			}
		]);
		// Link subjects to teachers
		await testDb.insert(subjectTeachers).values([
			{ subjectId: SUB_1, teacherId: TEACHER_1, createdAt: new Date() },
			{ subjectId: SUB_2, teacherId: TEACHER_1, createdAt: new Date() },
			{ subjectId: SUB_3, teacherId: TEACHER_2, createdAt: new Date() }
		]);
	});

	describe('listTeachers', () => {
		it('returns paginated teachers with subject info', async () => {
			const result = await listTeachers({ limit: 10, offset: 0 });
			expect(result.items).toHaveLength(3);
			expect(result.total).toBe(3);
			
			const t1 = result.items.find(t => t.id === TEACHER_1);
			expect(t1).toBeDefined();
			expect(t1!.subjectCount).toBe(2);
			expect(t1!.subjects).toHaveLength(2);
			expect(t1!.subjects.map(s => s.code).sort()).toEqual(['FIS-101', 'MAT-101']);
			
			const t2 = result.items.find(t => t.id === TEACHER_2);
			expect(t2!.subjectCount).toBe(1);
			expect(t2!.subjects[0].code).toBe('QUI-101');
			
			const t3 = result.items.find(t => t.id === TEACHER_3);
			expect(t3!.subjectCount).toBe(0);
			expect(t3!.subjects).toHaveLength(0);
		});

		it('paginates correctly', async () => {
			const page1 = await listTeachers({ limit: 2, offset: 0 });
			expect(page1.items).toHaveLength(2);
			expect(page1.total).toBe(3);
			
			const page2 = await listTeachers({ limit: 2, offset: 2 });
			expect(page2.items).toHaveLength(1);
		});

		it('filters by active status', async () => {
			const activeOnly = await listTeachers({ limit: 10, offset: 0, active: true });
			expect(activeOnly.items).toHaveLength(2);
			expect(activeOnly.items.every(t => t.active)).toBe(true);
			
			const inactiveOnly = await listTeachers({ limit: 10, offset: 0, active: false });
			expect(inactiveOnly.items).toHaveLength(1);
			expect(inactiveOnly.items[0].id).toBe(TEACHER_3);
		});

		it('searches by email', async () => {
			const result = await listTeachers({ limit: 10, offset: 0, search: 'teacher1' });
			expect(result.items).toHaveLength(1);
			expect(result.items[0].email).toBe('teacher1@test.com');
		});

		it('sorts by createdAt desc by default', async () => {
			const result = await listTeachers({ limit: 10, offset: 0 });
			expect(result.items[0].id).toBe(TEACHER_3); // newest first
			expect(result.items[2].id).toBe(TEACHER_1);
		});

		it('sorts by name asc when requested', async () => {
			const result = await listTeachers({ limit: 10, offset: 0, sortBy: 'name', sortOrder: 'asc' });
			// Alphabetical: "Teacher One" < "Teacher Three" < "Teacher Two"
			expect(result.items[0].name).toBe('Teacher One');
			expect(result.items[1].name).toBe('Teacher Three');
			expect(result.items[2].name).toBe('Teacher Two');
		});

		it('excludes admin users', async () => {
			const result = await listTeachers({ limit: 10, offset: 0 });
			expect(result.items.find(t => t.role === 'admin')).toBeUndefined();
		});
	});

	describe('getTeacherById', () => {
		it('returns teacher with subjects', async () => {
			// Debug: check subjectTeachers table
			const st = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, TEACHER_1));
			console.log('subjectTeachers for TEACHER_1:', st);
			
			const teacher = await getTeacherById(TEACHER_1);
			expect(teacher).not.toBeNull();
			expect(teacher!.id).toBe(TEACHER_1);
			expect(teacher!.email).toBe('teacher1@test.com');
			expect(teacher!.subjectCount).toBe(2);
			expect(teacher!.subjects).toHaveLength(2);
		});

		it('returns null for non-existent id', async () => {
			const teacher = await getTeacherById('non-existent-uuid-' + randomUUID());
			expect(teacher).toBeNull();
		});

		it('returns null for admin user', async () => {
			const teacher = await getTeacherById(ADMIN_1);
			expect(teacher).toBeNull();
		});
	});

	describe('createTeacher', () => {
		it('creates teacher with credential account and subjects', async () => {
			const teacherId = await createTeacher({
				email: 'new@test.com',
				name: 'New Teacher',
				password: 'TempPass123!',
				subjectIds: [SUB_1, SUB_3],
				createdBy: ADMIN_1
			});
			
			expect(teacherId).toBeDefined();
			
			const created = await testDb.select().from(user).where(eq(user.id, teacherId)).limit(1);
			expect(created).toHaveLength(1);
			expect(created[0].email).toBe('new@test.com');
			expect(created[0].name).toBe('New Teacher');
			expect(created[0].role).toBe('teacher');
			expect(created[0].active).toBe(true);
			expect(created[0].mustChangePassword).toBe(true);
			expect(created[0].emailVerified).toBe(true);
			
			// Verify credential account created
			const accounts = await testDb.select().from(account).where(eq(account.userId, teacherId));
			expect(accounts).toHaveLength(1);
			expect(accounts[0].providerId).toBe('credential');
			expect(accounts[0].password).toBeDefined();
			
			// Verify subject links
			const links = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, teacherId));
			expect(links).toHaveLength(2);
			expect(links.map(l => l.subjectId).sort()).toEqual([SUB_1, SUB_3].sort());
		});

		it('creates teacher without subjects', async () => {
			const teacherId = await createTeacher({
				email: 'nosubject@test.com',
				name: 'No Subject Teacher',
				password: 'TempPass123!',
				subjectIds: [],
				createdBy: ADMIN_1
			});
			
			const links = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, teacherId));
			expect(links).toHaveLength(0);
		});
	});

	describe('updateTeacher', () => {
		it('updates name and active status', async () => {
			await updateTeacher(TEACHER_1, { name: 'Updated Name', active: false });
			
			const updated = await testDb.select().from(user).where(eq(user.id, TEACHER_1)).limit(1);
			expect(updated[0].name).toBe('Updated Name');
			expect(updated[0].active).toBe(false);
		});

		it('syncs subjectTeachers (replaces)', async () => {
			await updateTeacher(TEACHER_1, { subjectIds: [SUB_3] });
			
			const links = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, TEACHER_1));
			expect(links).toHaveLength(1);
			expect(links[0].subjectId).toBe(SUB_3);
		});

		it('clears subjects when empty array', async () => {
			await updateTeacher(TEACHER_1, { subjectIds: [] });
			
			const links = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, TEACHER_1));
			expect(links).toHaveLength(0);
		});

		it('does not update user table if only subjectIds provided (only subjectTeachers sync)', async () => {
			const before = await testDb.select({ updatedAt: user.updatedAt }).from(user).where(eq(user.id, TEACHER_1)).limit(1);
			await updateTeacher(TEACHER_1, { subjectIds: [SUB_1] });
			const after = await testDb.select({ updatedAt: user.updatedAt }).from(user).where(eq(user.id, TEACHER_1)).limit(1);
			// updatedAt should NOT change because only subjectTeachers sync, no user fields updated
			expect(after[0].updatedAt.getTime()).toBe(before[0].updatedAt.getTime());
			
			// But subjectTeachers should be synced
			const links = await testDb.select().from(subjectTeachers).where(eq(subjectTeachers.teacherId, TEACHER_1));
			expect(links).toHaveLength(1);
			expect(links[0].subjectId).toBe(SUB_1);
		});
	});

	describe('setTeacherActive', () => {
		it('sets active to false', async () => {
			await setTeacherActive(TEACHER_1, false);
			const updated = await testDb.select({ active: user.active }).from(user).where(eq(user.id, TEACHER_1)).limit(1);
			expect(updated[0].active).toBe(false);
		});

		it('sets active to true', async () => {
			await setTeacherActive(TEACHER_3, true);
			const updated = await testDb.select({ active: user.active }).from(user).where(eq(user.id, TEACHER_3)).limit(1);
			expect(updated[0].active).toBe(true);
		});
	});

	describe('deleteTeacherSoft', () => {
		it('sets active to false', async () => {
			await deleteTeacherSoft(TEACHER_1);
			const updated = await testDb.select({ active: user.active }).from(user).where(eq(user.id, TEACHER_1)).limit(1);
			expect(updated[0].active).toBe(false);
		});
	});
});