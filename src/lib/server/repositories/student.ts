import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { student } from '#lib/server/db/schema/academic.js';
import type { Student } from '#lib/domain/types.js';
import {
	normalizeMatchKey,
	parseRosterCsv,
	type RosterCsvRow
} from '#lib/domain/roster.js';
import { isUuid } from './rubric.js';
import { teacherTeachesSubject } from './subject.js';

/**
 * Repository for the roster of a subject.
 *
 * The roster exists to answer one question: which row does a delivery belong to?
 * That makes `match_key` the important column — it is derived from the name,
 * never supplied by the client, so "Pérez, Juan" and "Juan Perez" cannot drift
 * into two different students.
 *
 * Two rules shape the API:
 *
 * - A duplicate active key is a **rejection**, not a silent merge. Importing the
 *   same file twice must not create twins.
 * - A duplicate with a **soft-deleted** row is a **revival**, because removing a
 *   student and adding them back is a correction, not a new person.
 */

export type StudentInput = {
	name: string;
	email?: string | null;
	externalId?: string | null;
};

export type ImportOutcome = {
	created: Student[];
	/** Rows that already existed with the same key, so nothing was written. */
	skipped: { line: number; name: string; reason: string }[];
	/** Rows the CSV parser or the database rejected, with the offending line. */
	errors: { line: number; name: string; reason: string }[];
};

function toStudent(row: typeof student.$inferSelect): Student {
	return {
		id: row.id,
		subjectId: row.subjectId,
		name: row.name,
		matchKey: row.matchKey,
		email: row.email,
		externalId: row.externalId,
		createdAt: row.createdAt.getTime()
	};
}

function cleanName(name: string): string {
	return name.replace(/\s+/g, ' ').trim();
}

/** Roster of a subject, alphabetical, active rows only. */
export async function listStudents(teacherId: string, subjectId: string): Promise<Student[]> {
	if (!isUuid(subjectId)) return [];
	if (!(await teacherTeachesSubject(teacherId, subjectId))) return [];

	const rows = await getDb()
		.select()
		.from(student)
		.where(and(eq(student.subjectId, subjectId), isNull(student.deletedAt)))
		.orderBy(asc(student.name));

	return rows.map(toStudent);
}

/**
 * Adds one student.
 *
 * Ownership is checked against the subject, not against the row: a teacher who
 * does not teach the subject cannot write to its roster.
 */
export async function createStudent(
	teacherId: string,
	subjectId: string,
	input: StudentInput
): Promise<Student> {
	if (!isUuid(subjectId)) throw new Error('Materia inválida');
	if (!(await teacherTeachesSubject(teacherId, subjectId))) {
		throw new Error('La materia no existe o no pertenece a este docente');
	}

	const name = cleanName(input.name ?? '');
	if (!name) throw new Error('El nombre del estudiante es obligatorio');

	const matchKey = normalizeMatchKey(name);
	if (!matchKey) throw new Error(`El nombre "${name}" no tiene letras ni números`);

	const db = getDb();

	const [active] = await db
		.select({ id: student.id })
		.from(student)
		.where(
			and(
				eq(student.subjectId, subjectId),
				eq(student.matchKey, matchKey),
				isNull(student.deletedAt)
			)
		)
		.limit(1);
	if (active) throw new Error(`Ya existe un estudiante con el mismo nombre: "${name}"`);

	// A previously deleted row with the same key is revived instead of duplicated;
	// the partial unique index only covers active rows, so a plain insert would
	// succeed and leave two rows for one person.
	const [deleted] = await db
		.select({ id: student.id })
		.from(student)
		.where(
			and(
				eq(student.subjectId, subjectId),
				eq(student.matchKey, matchKey),
				isNotNull(student.deletedAt)
			)
		)
		.limit(1);

	if (deleted) {
		const [revived] = await db
			.update(student)
			.set({
				name,
				email: input.email?.trim() || null,
				externalId: input.externalId?.trim() || null,
				deletedAt: null
			})
			.where(eq(student.id, deleted.id))
			.returning();
		return toStudent(revived);
	}

	const [created] = await db
		.insert(student)
		.values({
			subjectId,
			name,
			matchKey,
			email: input.email?.trim() || null,
			externalId: input.externalId?.trim() || null
		})
		.returning();

	return toStudent(created);
}

/**
 * Updates the editable fields of a student.
 *
 * Renaming recomputes `match_key`, and a rename that collides with another
 * active student is rejected rather than merged: the roster has two people and
 * the teacher has to decide which one is which.
 */
export async function updateStudent(
	teacherId: string,
	subjectId: string,
	studentId: string,
	input: Partial<StudentInput>
): Promise<Student | null> {
	if (!isUuid(subjectId) || !isUuid(studentId)) return null;
	if (!(await teacherTeachesSubject(teacherId, subjectId))) return null;

	const db = getDb();
	const [current] = await db
		.select()
		.from(student)
		.where(
			and(
				eq(student.id, studentId),
				eq(student.subjectId, subjectId),
				isNull(student.deletedAt)
			)
		)
		.limit(1);
	if (!current) return null;

	const patch: Partial<typeof student.$inferInsert> = {};

	if (input.name !== undefined) {
		const name = cleanName(input.name);
		if (!name) throw new Error('El nombre del estudiante es obligatorio');

		const matchKey = normalizeMatchKey(name);
		if (!matchKey) throw new Error(`El nombre "${name}" no tiene letras ni números`);

		if (matchKey !== current.matchKey) {
			const [collision] = await db
				.select({ id: student.id })
				.from(student)
				.where(
					and(
						eq(student.subjectId, subjectId),
						eq(student.matchKey, matchKey),
						isNull(student.deletedAt),
						ne(student.id, studentId)
					)
				)
				.limit(1);
			if (collision) throw new Error(`Ya existe un estudiante con el mismo nombre: "${name}"`);
		}

		patch.name = name;
		patch.matchKey = matchKey;
	}

	if (input.email !== undefined) patch.email = input.email?.trim() || null;
	if (input.externalId !== undefined) patch.externalId = input.externalId?.trim() || null;

	if (Object.keys(patch).length === 0) return toStudent(current);

	const [updated] = await db
		.update(student)
		.set(patch)
		.where(eq(student.id, studentId))
		.returning();

	return updated ? toStudent(updated) : null;
}

/**
 * Soft delete. The row stays so a delivery already matched to it keeps a name,
 * and re-adding the same person revives it instead of forking the history.
 */
export async function deleteStudent(
	teacherId: string,
	subjectId: string,
	studentId: string
): Promise<boolean> {
	if (!isUuid(subjectId) || !isUuid(studentId)) return false;
	if (!(await teacherTeachesSubject(teacherId, subjectId))) return false;

	const rows = await getDb()
		.update(student)
		.set({ deletedAt: new Date() })
		.where(
			and(
				eq(student.id, studentId),
				eq(student.subjectId, subjectId),
				isNull(student.deletedAt)
			)
		)
		.returning({ id: student.id });

	return rows.length > 0;
}

/** Writes one parsed CSV row, translating a duplicate into a skip. */
async function writeImportedRow(
	subjectId: string,
	row: RosterCsvRow
): Promise<{ student: Student } | { skipped: string }> {
	const matchKey = normalizeMatchKey(row.name);

	const db = getDb();
	const [existing] = await db
		.select({ id: student.id, deletedAt: student.deletedAt })
		.from(student)
		.where(and(eq(student.subjectId, subjectId), eq(student.matchKey, matchKey)))
		.limit(1);

	// Duplicates cover the soft-deleted row too: importing the roster again after
	// someone was removed must not resurrect them behind the teacher's back, and
	// must not fail the whole import either.
	if (existing) {
		return {
			skipped: existing.deletedAt
				? 'Estaba en la lista pero fue eliminado; agregalo a mano si querés reactivarlo'
				: 'Ya estaba en la lista'
		};
	}

	const [created] = await db
		.insert(student)
		.values({
			subjectId,
			name: row.name,
			matchKey,
			email: row.email,
			externalId: row.externalId
		})
		.returning();

	return { student: toStudent(created) };
}

/**
 * Imports a roster CSV.
 *
 * Idempotent by `match_key`: importing the same file twice reports the second
 * run as skipped and writes nothing. A bad line does not abort the import —
 * a 40-student roster with one broken row must still bring in the other 39 —
 * and every rejection keeps its line number so the teacher can fix the file.
 */
export async function importStudents(
	teacherId: string,
	subjectId: string,
	csvText: string
): Promise<ImportOutcome> {
	if (!isUuid(subjectId)) throw new Error('Materia inválida');
	if (!(await teacherTeachesSubject(teacherId, subjectId))) {
		throw new Error('La materia no existe o no pertenece a este docente');
	}

	const parsed = parseRosterCsv(csvText);

	const outcome: ImportOutcome = { created: [], skipped: [], errors: [] };

	for (const error of parsed.errors) {
		outcome.errors.push({ line: error.line, name: '', reason: error.message });
	}

	for (const row of parsed.rows) {
		try {
			const result = await writeImportedRow(subjectId, row);
			if ('student' in result) outcome.created.push(result.student);
			else outcome.skipped.push({ line: row.line, name: row.name, reason: result.skipped });
		} catch (error) {
			outcome.errors.push({
				line: row.line,
				name: row.name,
				reason: error instanceof Error ? error.message : 'Error desconocido'
			});
		}
	}

	return outcome;
}
