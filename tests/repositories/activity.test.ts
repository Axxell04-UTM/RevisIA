import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq } from 'drizzle-orm';
import { activity, file, subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import {
	deleteActivity,
	duplicateActivity,
	getActivity,
	getActivityPrompt,
	listActivities,
	listSubjects,
	renameActivity,
	saveActivity
} from '#lib/server/repositories/activity.js';
import { saveTemplate } from '#lib/server/repositories/rubric.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A subject assigned to `teacherId`, the only way a teacher may use one. */
async function createSubject(teacherId: string, name = 'Tecnologías Avanzadas') {
	const [row] = await testDb.insert(subject).values({ name, code: 'TAE-01' }).returning();
	await testDb.insert(subjectTeachers).values({ subjectId: row.id, teacherId });
	return row;
}

beforeEach(async () => {
	await resetDb();
});

describe('saveActivity', () => {
	it('creates an activity with database-assigned ids and normalized empty fields', async () => {
		const teacher = await createUser();

		const created = await saveActivity(teacher.id, { title: '  Ensayo 1  ' });

		expect(created.id).toMatch(UUID_RE);
		expect(created.title).toBe('Ensayo 1');
		expect(created.description).toBe('');
		expect(created.objectives).toBe('');
		expect(created.instructions).toBe('');
		expect(created.status).toBe('draft');
		expect(created.subjectId).toBeNull();
		expect(created.rubricId).toBeNull();
		expect(created.dueAt).toBeNull();
		expect(created.maxPoints).toBeNull();
		expect(created.contexts).toEqual([]);
	});

	it('rejects an activity without a title and does not write anything', async () => {
		const teacher = await createUser();

		await expect(saveActivity(teacher.id, { title: '   ' })).rejects.toThrow(
			'La actividad necesita un título'
		);
		expect(await listActivities(teacher.id)).toEqual([]);
	});

	it('slugifies and dedupes context tags, keeping their content', async () => {
		const teacher = await createUser();

		const created = await saveActivity(teacher.id, {
			title: 'Con contextos',
			contexts: [
				{ tag: 'Texto del estudiante', label: 'Texto', content: 'Hola' },
				{ tag: 'Texto del estudiante', label: 'Copia' },
				{ tag: '', label: '' }
			]
		});

		expect(created.contexts.map((c) => c.tag)).toEqual([
			'texto_del_estudiante',
			'texto_del_estudiante_2',
			'contexto'
		]);
		expect(created.contexts[0].content).toBe('Hola');
		expect(created.contexts[2].label).toBe('contexto');
	});

	it('derives the total score from the rubric criteria instead of storing it', async () => {
		const teacher = await createUser();
		const template = await saveTemplate(teacher.id, {
			name: 'Rúbrica',
			criteria: [
				{ name: 'A', maxPoints: 5 },
				{ name: 'B', maxPoints: 2.5 }
			]
		});

		const created = await saveActivity(teacher.id, { title: 'Con rúbrica', rubricId: template.id });

		expect(created.maxPoints).toBe(7.5);
	});

	it('copies the rubric context tags into a new activity when none were sent', async () => {
		const teacher = await createUser();
		const template = await saveTemplate(teacher.id, {
			name: 'Rúbrica',
			criteria: [{ name: 'A', maxPoints: 1 }],
			contexts: [
				{ tag: 'enunciado', label: 'Enunciado', placeholder: 'Pegá el enunciado' },
				{ tag: 'bibliografia', label: 'Bibliografía' }
			]
		});

		const created = await saveActivity(teacher.id, { title: 'Con plantilla', rubricId: template.id });

		expect(created.contexts.map((c) => c.tag)).toEqual(['enunciado', 'bibliografia']);
		expect(created.contexts.every((c) => c.content === '')).toBe(true);
	});

	it('parses the due date and rejects an unparseable one', async () => {
		const teacher = await createUser();

		const created = await saveActivity(teacher.id, {
			title: 'Con fecha',
			dueAt: '2026-11-20T23:59:00.000Z'
		});
		expect(created.dueAt).toBe(Date.parse('2026-11-20T23:59:00.000Z'));

		await expect(saveActivity(teacher.id, { title: 'Mala', dueAt: 'no-es-fecha' })).rejects.toThrow(
			'Fecha de entrega inválida'
		);
	});

	it('accepts a subject only when the teacher is assigned to it', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const mine = await createSubject(teacher.id);
		const foreign = await createSubject(other.id, 'Ajena');

		const created = await saveActivity(teacher.id, { title: 'Con materia', subjectId: mine.id });
		expect(created.subjectId).toBe(mine.id);

		await expect(
			saveActivity(teacher.id, { title: 'Ajena', subjectId: foreign.id })
		).rejects.toThrow('La asignatura no existe o no está asignada a este docente');
	});

	it('refuses a rubric owned by another teacher', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveTemplate(other.id, {
			name: 'Ajena',
			criteria: [{ name: 'A', maxPoints: 1 }]
		});

		await expect(
			saveActivity(teacher.id, { title: 'Con rúbrica ajena', rubricId: foreign.id })
		).rejects.toThrow('La rúbrica no existe');
	});

	it('updates in place, replacing contexts and refreshing updatedAt', async () => {
		const teacher = await createUser();
		const created = await saveActivity(teacher.id, {
			title: 'Original',
			contexts: [{ tag: 'uno', label: 'Uno', content: 'a' }]
		});

		const updated = await saveActivity(teacher.id, {
			id: created.id,
			title: 'Editada',
			status: 'open',
			contexts: [{ tag: 'dos', label: 'Dos', content: 'b' }]
		});

		expect(updated.id).toBe(created.id);
		expect(updated.title).toBe('Editada');
		expect(updated.status).toBe('open');
		expect(updated.contexts.map((c) => c.tag)).toEqual(['dos']);
		expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
		expect(await listActivities(teacher.id)).toHaveLength(1);
	});

	it('ignores the id of an activity owned by another teacher and creates a new row', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		const created = await saveActivity(teacher.id, { id: foreign.id, title: 'Mía' });

		expect(created.id).not.toBe(foreign.id);
		expect(created.title).toBe('Mía');
		expect((await getActivity(other.id, foreign.id))?.title).toBe('Ajena');
	});
});

describe('getActivity / listActivities', () => {
	it('returns null for a malformed id and hides other teachers rows', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		expect(await getActivity(teacher.id, 'no-es-uuid')).toBeNull();
		expect(await getActivity(teacher.id, foreign.id)).toBeNull();
	});

	it('orders by most recently updated and filters by subject', async () => {
		const teacher = await createUser();
		const subjectA = await createSubject(teacher.id, 'A');
		const subjectB = await createSubject(teacher.id, 'B');

		const first = await saveActivity(teacher.id, { title: 'Primera', subjectId: subjectA.id });
		await new Promise((r) => setTimeout(r, 5));
		await saveActivity(teacher.id, { title: 'Segunda', subjectId: subjectB.id });

		expect((await listActivities(teacher.id)).map((a) => a.title)).toEqual(['Segunda', 'Primera']);
		expect((await listActivities(teacher.id, { subjectId: subjectA.id })).map((a) => a.id)).toEqual([
			first.id
		]);
	});

	it('excludes soft-deleted rows', async () => {
		const teacher = await createUser();
		await saveActivity(teacher.id, { title: 'Borrada' });

		expect(await deleteActivity(teacher.id, (await listActivities(teacher.id))[0].id)).toBe(true);
		expect(await listActivities(teacher.id)).toEqual([]);
	});

	it('never deletes another teacher activity', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		expect(await deleteActivity(teacher.id, foreign.id)).toBe(false);
		expect(await deleteActivity(teacher.id, 'no-es-uuid')).toBe(false);
		expect(await getActivity(other.id, foreign.id)).not.toBeNull();
	});
});

describe('listSubjects', () => {
	it('returns only assigned, non-deleted subjects', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const mine = await createSubject(teacher.id, 'Mía');
		await createSubject(other.id, 'Ajena');
		const removed = await createSubject(teacher.id, 'Borrada');
		await testDb.update(subject).set({ deletedAt: new Date() }).where(eq(subject.id, removed.id));

		const subjects = await listSubjects(teacher.id);

		expect(subjects.map((s) => s.id)).toEqual([mine.id]);
		expect(subjects[0].code).toBe('TAE-01');
	});
});

describe('getActivityPrompt', () => {
	it('returns the activity with an empty source document when it has no file', async () => {
		const teacher = await createUser();
		const created = await saveActivity(teacher.id, { title: 'Sin archivo' });

		const result = await getActivityPrompt(teacher.id, created.id);

		expect(result?.activity.id).toBe(created.id);
		expect(result?.sourceDocument).toBe('');
	});

	it('returns the extracted text of the activity source document', async () => {
		const teacher = await createUser();
		const [fileRow] = await testDb
			.insert(file)
			.values({
				storageKey: 'uploads/doc.pdf',
				bucket: 'revisia',
				originalName: 'ensayo.pdf',
				mime: 'application/pdf',
				sizeBytes: 10,
				sha256: 'a'.repeat(64),
				extractedText: 'Texto extraído del ensayo',
				extraction: 'ok',
				uploadedBy: teacher.id
			})
			.returning();

		const created = await saveActivity(teacher.id, {
			title: 'Con archivo',
			sourceFileId: fileRow.id
		});

		const result = await getActivityPrompt(teacher.id, created.id);

		expect(result?.activity.sourceFileId).toBe(fileRow.id);
		expect(result?.sourceDocument).toBe('Texto extraído del ensayo');
	});

	it('returns null for an activity owned by another teacher', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const created = await saveActivity(teacher.id, { title: 'Privada' });

		expect(await getActivityPrompt(other.id, created.id)).toBeNull();
	});
});

describe('activity schema guards', () => {
	it('sets subject_id to null when the subject is hard-deleted', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await saveActivity(teacher.id, { title: 'Con materia', subjectId: subjectRow.id });

		await testDb.delete(subject).where(eq(subject.id, subjectRow.id));

		const [row] = await testDb.select().from(activity).where(eq(activity.id, created.id));
		expect(row.subjectId).toBeNull();
	});
});

describe('renameActivity', () => {
	it('changes only the title and keeps every other field', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const created = await saveActivity(teacher.id, {
			title: 'Original',
			subjectId: subjectRow.id,
			description: 'Descripción',
			objectives: 'Objetivos',
			instructions: 'Instrucciones',
			status: 'open',
			dueAt: '2026-05-01T00:00:00.000Z',
			contexts: [{ tag: 'texto', label: 'Texto', content: 'Contenido' }]
		});

		const renamed = await renameActivity(teacher.id, created.id, '  Nuevo título  ');

		expect(renamed.id).toBe(created.id);
		expect(renamed.title).toBe('Nuevo título');
		expect(renamed.description).toBe('Descripción');
		expect(renamed.objectives).toBe('Objetivos');
		expect(renamed.instructions).toBe('Instrucciones');
		expect(renamed.status).toBe('open');
		expect(renamed.subjectId).toBe(subjectRow.id);
		expect(renamed.dueAt).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
		expect(renamed.contexts).toHaveLength(1);
		expect(renamed.contexts[0].content).toBe('Contenido');
	});

	it('rejects an empty title without touching the row', async () => {
		const teacher = await createUser();
		const created = await saveActivity(teacher.id, { title: 'Intacta' });

		await expect(renameActivity(teacher.id, created.id, '   ')).rejects.toThrow(
			'La actividad necesita un título'
		);
		expect((await getActivity(teacher.id, created.id))?.title).toBe('Intacta');
	});

	it('refuses an activity owned by another teacher and non-uuid ids', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		await expect(renameActivity(teacher.id, foreign.id, 'Robada')).rejects.toThrow(
			'Actividad no encontrada'
		);
		await expect(renameActivity(teacher.id, 'no-es-uuid', 'X')).rejects.toThrow(
			'Actividad no encontrada'
		);
		expect((await getActivity(other.id, foreign.id))?.title).toBe('Ajena');
	});
});

describe('duplicateActivity', () => {
	it('copies the academic setup into a new draft, contexts included', async () => {
		const teacher = await createUser();
		const subjectRow = await createSubject(teacher.id);
		const source = await saveActivity(teacher.id, {
			title: 'Ensayo 1',
			subjectId: subjectRow.id,
			description: 'Descripción',
			objectives: 'Objetivos',
			instructions: 'Instrucciones',
			status: 'open',
			dueAt: '2026-05-01T00:00:00.000Z',
			contexts: [
				{ tag: 'texto', label: 'Texto', content: 'Uno' },
				{ tag: 'rubrica', label: 'Rúbrica', content: 'Dos' }
			]
		});

		const copy = await duplicateActivity(teacher.id, source.id);

		expect(copy.id).not.toBe(source.id);
		expect(copy.title).toBe('Ensayo 1 (copia)');
		expect(copy.status).toBe('draft');
		expect(copy.subjectId).toBe(subjectRow.id);
		expect(copy.description).toBe('Descripción');
		expect(copy.objectives).toBe('Objetivos');
		expect(copy.instructions).toBe('Instrucciones');
		expect(copy.dueAt).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
		expect(copy.contexts.map((c) => [c.tag, c.content])).toEqual([
			['texto', 'Uno'],
			['rubrica', 'Dos']
		]);

		// The source is untouched and both appear in the list.
		expect((await getActivity(teacher.id, source.id))?.title).toBe('Ensayo 1');
		expect((await listActivities(teacher.id)).map((a) => a.title).sort()).toEqual([
			'Ensayo 1',
			'Ensayo 1 (copia)'
		]);
	});

	it('refuses an activity owned by another teacher', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		await expect(duplicateActivity(teacher.id, foreign.id)).rejects.toThrow(
			'Actividad no encontrada'
		);
		expect(await listActivities(teacher.id)).toEqual([]);
	});
});
