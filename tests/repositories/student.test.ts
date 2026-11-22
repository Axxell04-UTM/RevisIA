import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq } from 'drizzle-orm';
import { student, subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import {
	createStudent,
	deleteStudent,
	importStudents,
	listStudents,
	updateStudent
} from '#lib/server/repositories/student.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * The roster is what a delivery is matched against, so these tests pin the
 * three behaviours that keep it trustworthy: ownership by subject, uniqueness by
 * `match_key` (not by name spelling), and reversibility — a removed student
 * comes back instead of forking into a second row.
 */

async function createSubject(teacherId: string, name = 'Programación I') {
	const [row] = await testDb.insert(subject).values({ name }).returning();
	await testDb.insert(subjectTeachers).values({ subjectId: row.id, teacherId });
	return row;
}

beforeEach(async () => {
	await resetDb();
});

describe('createStudent', () => {
	it('stores the canonical match key derived from the name', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);

		const created = await createStudent(teacher.id, subjectRow.id, {
			name: 'Pérez, Juan',
			email: 'juan@uni.edu',
			externalId: '12345'
		});

		expect(created).toMatchObject({
			subjectId: subjectRow.id,
			name: 'Pérez, Juan',
			matchKey: 'juan perez',
			email: 'juan@uni.edu',
			externalId: '12345'
		});
	});

	it('normalizes whitespace in the stored name', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);

		const created = await createStudent(teacher.id, subjectRow.id, { name: '  Juan   Pérez  ' });

		expect(created.name).toBe('Juan Pérez');
	});

	it('rejects a second active student with the same key', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });

		await expect(
			createStudent(teacher.id, subjectRow.id, { name: 'PEREZ JUAN' })
		).rejects.toThrow('Ya existe un estudiante');
	});

	it('revives a soft-deleted student with the same key instead of duplicating', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const first = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });
		await deleteStudent(teacher.id, subjectRow.id, first.id);

		const revived = await createStudent(teacher.id, subjectRow.id, {
			name: 'Juan Pérez',
			externalId: '999'
		});

		expect(revived.id).toBe(first.id);
		expect(revived.externalId).toBe('999');

		const rows = await testDb.select().from(student);
		expect(rows).toHaveLength(1);
	});

	it('rejects a teacher who does not teach the subject', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const subjectRow = await createSubject(teacher.id);

		await expect(
			createStudent(stranger.id, subjectRow.id, { name: 'Juan Pérez' })
		).rejects.toThrow('no pertenece a este docente');
	});

	it('rejects a name without letters', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);

		await expect(createStudent(teacher.id, subjectRow.id, { name: '  ...  ' })).rejects.toThrow(
			'no tiene letras'
		);
	});
});

describe('listStudents', () => {
	it('returns the active roster alphabetically and hides deleted rows', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);

		await createStudent(teacher.id, subjectRow.id, { name: 'Zoe Alvarez' });
		await createStudent(teacher.id, subjectRow.id, { name: 'Ana Gomez' });
		const removed = await createStudent(teacher.id, subjectRow.id, { name: 'Bruno Diaz' });
		await deleteStudent(teacher.id, subjectRow.id, removed.id);

		const roster = await listStudents(teacher.id, subjectRow.id);

		expect(roster.map((entry) => entry.name)).toEqual(['Ana Gomez', 'Zoe Alvarez']);
	});

	it('returns an empty list for another teacher', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const subjectRow = await createSubject(teacher.id);
		await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });

		expect(await listStudents(stranger.id, subjectRow.id)).toEqual([]);
	});

	it('returns an empty list for a malformed id instead of querying', async () => {
		const teacher = await createUser();

		expect(await listStudents(teacher.id, 'not-a-uuid')).toEqual([]);
	});
});

describe('updateStudent', () => {
	it('recomputes the match key when the name changes', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Peres' });

		const updated = await updateStudent(teacher.id, subjectRow.id, created.id, {
			name: 'Juan Pérez'
		});

		expect(updated).toMatchObject({ name: 'Juan Pérez', matchKey: 'juan perez' });
	});

	it('rejects a rename that collides with another active student', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });
		const other = await createStudent(teacher.id, subjectRow.id, { name: 'Ana Gomez' });

		await expect(
			updateStudent(teacher.id, subjectRow.id, other.id, { name: 'Pérez, Juan' })
		).rejects.toThrow('Ya existe un estudiante');
	});

	it('allows renaming a student to a different spelling-free variant of itself', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Perez' });

		const updated = await updateStudent(teacher.id, subjectRow.id, created.id, {
			name: 'PEREZ, JUAN'
		});

		expect(updated?.name).toBe('PEREZ, JUAN');
		expect(updated?.matchKey).toBe('juan perez');
	});

	it('updates email and external id without touching the key', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });

		const updated = await updateStudent(teacher.id, subjectRow.id, created.id, {
			email: 'j@uni.edu',
			externalId: '777'
		});

		expect(updated).toMatchObject({
			name: 'Juan Pérez',
			matchKey: 'juan perez',
			email: 'j@uni.edu',
			externalId: '777'
		});
	});

	it('returns null for a student of another subject', async () => {
		const teacher = await createUser();
		const subjectA = await createSubject(teacher.id, 'Materia A');
		const subjectB = await createSubject(teacher.id, 'Materia B');
		const created = await createStudent(teacher.id, subjectA.id, { name: 'Juan Pérez' });

		expect(
			await updateStudent(teacher.id, subjectB.id, created.id, { name: 'Otro Nombre' })
		).toBeNull();
	});
});

describe('deleteStudent', () => {
	it('soft deletes so the row survives for past submissions', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });

		expect(await deleteStudent(teacher.id, subjectRow.id, created.id)).toBe(true);
		expect(await deleteStudent(teacher.id, subjectRow.id, created.id)).toBe(false);

		const [row] = await testDb.select().from(student).where(eq(student.id, created.id));
		expect(row.deletedAt).not.toBeNull();
	});

	it('refuses to delete through another teacher', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await createStudent(teacher.id, subjectRow.id, { name: 'Juan Pérez' });

		expect(await deleteStudent(stranger.id, subjectRow.id, created.id)).toBe(false);
	});
});

describe('importStudents', () => {
	it('creates the roster from a CSV and reports each row', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const csv = 'Nombre completo,Legajo\n"Pérez, Juan",12345\nGómez Ana,67890';

		const result = await importStudents(teacher.id, subjectRow.id, csv);

		expect(result.errors).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.created.map((entry) => entry.name)).toEqual(['Pérez, Juan', 'Gómez Ana']);
		expect(result.created[0]).toMatchObject({ matchKey: 'juan perez', externalId: '12345' });
	});

	it('is idempotent: importing the same file twice creates nothing the second time', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const csv = 'Nombre\nJuan Pérez\nAna Gomez';

		const first = await importStudents(teacher.id, subjectRow.id, csv);
		const second = await importStudents(teacher.id, subjectRow.id, csv);

		expect(first.created).toHaveLength(2);
		expect(second.created).toEqual([]);
		expect(second.skipped).toHaveLength(2);
		expect(second.skipped[0].reason).toContain('Ya estaba');

		const rows = await testDb.select().from(student);
		expect(rows).toHaveLength(2);
	});

	it('does not resurrect a soft-deleted student on re-import', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const csv = 'Nombre\nJuan Pérez';
		const first = await importStudents(teacher.id, subjectRow.id, csv);
		await deleteStudent(teacher.id, subjectRow.id, first.created[0].id);

		const second = await importStudents(teacher.id, subjectRow.id, csv);

		expect(second.created).toEqual([]);
		expect(second.skipped).toHaveLength(1);
		const roster = await listStudents(teacher.id, subjectRow.id);
		expect(roster).toEqual([]);
	});

	it('imports the good rows even when one line is broken', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const csv = 'Nombre,Legajo\nJuan Pérez,1\n,2\nAna Gomez,3';

		const result = await importStudents(teacher.id, subjectRow.id, csv);

		expect(result.created.map((entry) => entry.name)).toEqual(['Juan Pérez', 'Ana Gomez']);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({ line: 3, reason: 'Fila sin nombre' });
	});

	it('reports a repeated name in the same file with its real line', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const csv = 'Nombre\nJuan Pérez\nJuan Perez';

		const result = await importStudents(teacher.id, subjectRow.id, csv);

		expect(result.created).toHaveLength(1);
		expect(result.errors[0].line).toBe(3);
	});

	it('rejects an import from another teacher', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const subjectRow = await createSubject(teacher.id);

		await expect(
			importStudents(stranger.id, subjectRow.id, 'Nombre\nJuan Pérez')
		).rejects.toThrow('no pertenece a este docente');
	});
});
