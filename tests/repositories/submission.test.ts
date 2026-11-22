import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq } from 'drizzle-orm';
import { activityFile, file, student, subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import { submission as submissionTable } from '#lib/server/db/schema/grading.js';
import {
	attachStudent,
	countSubmissionsByActivity,
	createSubmission,
	deleteSubmission,
	getFileProcessingState,
	linkSubmissionFileToActivity,
	listPendingSubmissionFiles,
	listSubmissions,
	setMembers
} from '#lib/server/repositories/submission.js';
import { saveActivity } from '#lib/server/repositories/activity.js';
import { normalizeMatchKey } from '#lib/domain/roster.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * Deliveries are identified by the bytes: `(activity_id, sha256)` is unique, so
 * a re-upload is idempotent. These tests pin that dedupe, the ownership checks
 * that keep one teacher's activity out of another's hands, the N-files/N-members
 * shape of a group delivery, and the reversible student link F2.9 needs.
 */

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

async function createFile(
	teacherId: string,
	sha256 = SHA_A,
	extraction: 'pending' | 'ok' = 'ok',
	name = 'Entrega.pdf',
	activityId: string | null = null
) {
	const [row] = await testDb
		.insert(file)
		.values({
			storageKey: `submission/${sha256.slice(0, 8)}-${name}.pdf`,
			bucket: 'submissions',
			originalName: name,
			mime: 'application/pdf',
			sizeBytes: 1024,
			sha256,
			extractedText: extraction === 'ok' ? 'Texto extraído de la entrega' : null,
			extraction,
			uploadContext: 'submission',
			uploadedBy: teacherId
		})
		.returning();
	if (activityId) {
		await testDb.insert(activityFile).values({ activityId, fileId: row.id });
	}
	return row;
}

async function createRoster(teacherId: string, name = 'Juan Pérez') {
	const [subjectRow] = await testDb.insert(subject).values({ name: 'Programación I' }).returning();
	await testDb.insert(subjectTeachers).values({ subjectId: subjectRow.id, teacherId });
	const [studentRow] = await testDb
		.insert(student)
		.values({ subjectId: subjectRow.id, name, matchKey: normalizeMatchKey(name) })
		.returning();
	return { subjectRow, studentRow };
}

beforeEach(async () => {
	await resetDb();
});

describe('createSubmission', () => {
	it('registers a confirmed file as one pending individual delivery', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);

		const { submission, duplicate } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }],
			studentName: 'Juan Pérez'
		});

		expect(duplicate).toBe(false);
		expect(submission.sha256).toBe(SHA_A);
		expect(submission.studentName).toBe('Juan Pérez');
		expect(submission.studentId).toBeNull();
		expect(submission.kind).toBe('individual');
		expect(submission.status).toBe('pending');
	});

	it('marks a multi-file delivery as a group', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP grupal' });
		const main = await createFile(teacher.id, SHA_A, 'ok', 'Informe.pdf');
		const annex = await createFile(teacher.id, SHA_B, 'ok', 'Anexo.pdf');

		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: main.id }, { fileId: annex.id }]
		});

		expect(submission.kind).toBe('group');
		const [row] = await listSubmissions(teacher.id, activity.id);
		expect(row.files.map((entry) => entry.fileName)).toEqual(['Informe.pdf', 'Anexo.pdf']);
		expect(row.files.map((entry) => entry.role)).toEqual(['document', 'support']);
	});

	it('is idempotent: the same main document for the same activity returns the same row', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const first = await createFile(teacher.id, SHA_A);
		const second = await createFile(teacher.id, SHA_A);

		const created = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: first.id }]
		});
		const retried = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: second.id }]
		});

		expect(retried.duplicate).toBe(true);
		expect(retried.submission.id).toBe(created.submission.id);
	});

	it('allows the same bytes in two different activities', async () => {
		const teacher = await createUser();
		const activityOne = await saveActivity(teacher.id, { title: 'TP 1' });
		const activityTwo = await saveActivity(teacher.id, { title: 'TP 2' });
		const fileOne = await createFile(teacher.id, SHA_A);
		const fileTwo = await createFile(teacher.id, SHA_A);

		const one = await createSubmission(teacher.id, {
			activityId: activityOne.id,
			files: [{ fileId: fileOne.id }]
		});
		const two = await createSubmission(teacher.id, {
			activityId: activityTwo.id,
			files: [{ fileId: fileTwo.id }]
		});

		expect(two.duplicate).toBe(false);
		expect(two.submission.id).not.toBe(one.submission.id);
	});

	it('rejects a file that was never confirmed', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const unconfirmed = await createFile(teacher.id, '');

		await expect(
			createSubmission(teacher.id, {
				activityId: activity.id,
				files: [{ fileId: unconfirmed.id }]
			})
		).rejects.toThrow('no fue confirmado');
	});

	it('rejects a delivery with no files or with the same file twice', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);

		await expect(
			createSubmission(teacher.id, { activityId: activity.id, files: [] })
		).rejects.toThrow('al menos un archivo');
		await expect(
			createSubmission(teacher.id, {
				activityId: activity.id,
				files: [{ fileId: uploaded.id }, { fileId: uploaded.id }]
			})
		).rejects.toThrow('Archivo repetido');
	});

	it('rejects an activity owned by another teacher', async () => {
		const owner = await createUser();
		const intruder = await createUser();
		const activity = await saveActivity(owner.id, { title: 'Privada' });
		const uploaded = await createFile(intruder.id);

		await expect(
			createSubmission(intruder.id, {
				activityId: activity.id,
				files: [{ fileId: uploaded.id }]
			})
		).rejects.toThrow('no pertenece a este docente');
	});

	it('rejects a file owned by another teacher', async () => {
		const owner = await createUser();
		const intruder = await createUser();
		const activity = await saveActivity(intruder.id, { title: 'TP' });
		const foreignFile = await createFile(owner.id);

		await expect(
			createSubmission(intruder.id, {
				activityId: activity.id,
				files: [{ fileId: foreignFile.id }]
			})
		).rejects.toThrow('no pertenece a este docente');
	});
});

describe('listSubmissions', () => {
	it('returns the files, the members and the resolved roster student', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);
		const { studentRow } = await createRoster(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});
		await attachStudent(teacher.id, submission.id, studentRow.id);
		await setMembers(teacher.id, submission.id, [
			{ name: 'Juan Pérez', studentId: studentRow.id },
			{ name: 'Ana Gómez' }
		]);

		const rows = await listSubmissions(teacher.id, activity.id);

		expect(rows).toHaveLength(1);
		expect(rows[0].files).toHaveLength(1);
		expect(rows[0].files[0].extractedChars).toBe('Texto extraído de la entrega'.length);
		expect(rows[0].studentRosterName).toBe('Juan Pérez');
		expect(rows[0].members.map((member) => member.name)).toEqual(['Juan Pérez', 'Ana Gómez']);
		expect(rows[0].members[0].isAuthor).toBe(true);
	});

	it('returns nothing for another teacher', async () => {
		const owner = await createUser();
		const other = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP 1' });
		const uploaded = await createFile(owner.id);
		await createSubmission(owner.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		expect(await listSubmissions(other.id, activity.id)).toEqual([]);
	});
});

describe('attachStudent', () => {
	it('sets and clears the student link (reversible match)', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);
		const { studentRow } = await createRoster(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		const attached = await attachStudent(teacher.id, submission.id, studentRow.id);
		expect(attached?.studentId).toBe(studentRow.id);

		const cleared = await attachStudent(teacher.id, submission.id, null);
		expect(cleared?.studentId).toBeNull();
	});

	it('refuses a student that is not in the roster', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		await expect(
			attachStudent(teacher.id, submission.id, '00000000-0000-0000-0000-000000000000')
		).rejects.toThrow('no existe');
	});
});

describe('setMembers', () => {
	it('replaces the member list on every call and keeps the order', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP grupal' });
		const uploaded = await createFile(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		await setMembers(teacher.id, submission.id, [{ name: 'Ana' }, { name: 'Beto' }]);
		const replaced = await setMembers(teacher.id, submission.id, [
			{ name: 'Ana' },
			{ name: 'Beto' },
			{ name: 'Caro' }
		]);

		expect(replaced.map((member) => member.name)).toEqual(['Ana', 'Beto', 'Caro']);
		expect(replaced.map((member) => member.isAuthor)).toEqual([true, false, false]);
	});

	it('refuses a submission owned by another teacher', async () => {
		const owner = await createUser();
		const other = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP' });
		const uploaded = await createFile(owner.id);
		const { submission } = await createSubmission(owner.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		await expect(setMembers(other.id, submission.id, [{ name: 'X' }])).rejects.toThrow(
			'no pertenece a este docente'
		);
	});

	it('derives the group kind from the member count', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP' });
		const uploaded = await createFile(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});
		expect(submission.kind).toBe('individual');

		await setMembers(teacher.id, submission.id, [{ name: 'Ana' }, { name: 'Beto' }]);
		const [grouped] = await listSubmissions(teacher.id, activity.id);
		expect(grouped.kind).toBe('group');

		await setMembers(teacher.id, submission.id, [{ name: 'Ana' }]);
		const [back] = await listSubmissions(teacher.id, activity.id);
		expect(back.kind).toBe('individual');
	});
});

describe('getFileProcessingState', () => {
	it('reports a staged file with no delivery as pending', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP' });
		const staged = await createFile(teacher.id, SHA_A, 'pending', 'entrega.pdf', activity.id);

		expect(await getFileProcessingState(teacher.id, activity.id, staged.id)).toEqual({
			status: 'pending'
		});
	});

	it('reports the live delivery of a file so a failed extraction can retry', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP' });
		const staged = await createFile(teacher.id, SHA_A, 'pending', 'entrega.pdf', activity.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});

		const state = await getFileProcessingState(teacher.id, activity.id, staged.id);
		expect(state?.status).toBe('linked');
		if (state?.status === 'linked') expect(state.submission.id).toBe(submission.id);
	});

	it('returns the file to pending after a soft delete', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP' });
		const staged = await createFile(teacher.id, SHA_A, 'pending', 'entrega.pdf', activity.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});
		await deleteSubmission(teacher.id, submission.id);

		expect(await getFileProcessingState(teacher.id, activity.id, staged.id)).toEqual({
			status: 'pending'
		});
	});

	it('returns null for a file of another activity or another teacher', async () => {
		const owner = await createUser();
		const other = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP' });
		const otherActivity = await saveActivity(owner.id, { title: 'TP 2' });
		const foreign = await createFile(owner.id, SHA_A, 'pending', 'ajena.pdf', otherActivity.id);

		expect(await getFileProcessingState(owner.id, activity.id, foreign.id)).toBeNull();
		expect(await getFileProcessingState(other.id, activity.id, foreign.id)).toBeNull();
	});
});

describe('deleteSubmission', () => {
	it('soft deletes and frees the hash for a new delivery', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const first = await createFile(teacher.id, SHA_A);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: first.id }]
		});

		expect(await deleteSubmission(teacher.id, submission.id)).toBe(true);
		expect(await listSubmissions(teacher.id, activity.id)).toEqual([]);

		const second = await createFile(teacher.id, SHA_A);
		const recreated = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: second.id }]
		});
		expect(recreated.duplicate).toBe(false);
	});

	it('does not delete a submission owned by another teacher', async () => {
		const owner = await createUser();
		const other = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP 1' });
		const uploaded = await createFile(owner.id);
		const { submission } = await createSubmission(owner.id, {
			activityId: activity.id,
			files: [{ fileId: uploaded.id }]
		});

		expect(await deleteSubmission(other.id, submission.id)).toBe(false);
		const [row] = await testDb.select().from(file).where(eq(file.id, uploaded.id));
		expect(row).toBeDefined();
	});
});

describe('listPendingSubmissionFiles', () => {
	it('lists only files of the activity that are not deliveries yet, deduped by sha256', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const otherActivity = await saveActivity(teacher.id, { title: 'TP 2' });

		// Same bytes stored twice (the ZIP was processed twice): the newest wins.
		await createFile(teacher.id, SHA_A, 'ok', 'viejo.pdf', activity.id);
		await createFile(teacher.id, SHA_A, 'ok', 'nuevo.pdf', activity.id);
		await createFile(teacher.id, SHA_B, 'ok', 'otro.pdf', activity.id);
		// Belongs to another activity, and one file with no activity at all.
		await createFile(teacher.id, 'c'.repeat(64), 'ok', 'ajena.pdf', otherActivity.id);
		await createFile(teacher.id, 'd'.repeat(64), 'ok', 'suelta.pdf');

		const pending = await listPendingSubmissionFiles(teacher.id, activity.id);

		expect(pending.map((entry) => entry.fileName).sort()).toEqual(['nuevo.pdf', 'otro.pdf']);
		expect(pending.every((entry) => entry.extractedChars > 0)).toBe(true);
	});

	it('drops a file once its bytes back a live delivery and returns it after a soft delete', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const staged = await createFile(teacher.id, SHA_A, 'ok', 'entrega.pdf', activity.id);

		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});

		expect(await listPendingSubmissionFiles(teacher.id, activity.id)).toEqual([]);

		await deleteSubmission(teacher.id, submission.id);

		const back = await listPendingSubmissionFiles(teacher.id, activity.id);
		expect(back.map((entry) => entry.fileName)).toEqual(['entrega.pdf']);
	});

	it('returns nothing for another teacher', async () => {
		const owner = await createUser();
		const other = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP 1' });
		await createFile(owner.id, SHA_A, 'ok', 'entrega.pdf', activity.id);

		expect(await listPendingSubmissionFiles(other.id, activity.id)).toEqual([]);
	});
});

describe('createSubmission file scope', () => {
	it('rejects a file staged for another activity', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const otherActivity = await saveActivity(teacher.id, { title: 'TP 2' });
		const foreign = await createFile(teacher.id, SHA_A, 'ok', 'ajena.pdf', otherActivity.id);

		await expect(
			createSubmission(teacher.id, {
				activityId: activity.id,
				files: [{ fileId: foreign.id }]
			})
		).rejects.toThrow('otra actividad');
	});

	it('rejects a file that already belongs to a live delivery', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const staged = await createFile(teacher.id, SHA_A, 'ok', 'entrega.pdf', activity.id);
		await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});

		await expect(
			createSubmission(teacher.id, {
				activityId: activity.id,
				files: [{ fileId: staged.id }]
			})
		).rejects.toThrow('ya está en otra entrega');
	});

	it('stamps the activity on files that had none and links the Moodle name to the roster', async () => {
		const teacher = await createUser();
		const { subjectRow, studentRow } = await createRoster(teacher.id, 'Sofía Zambrano');
		const activity = await saveActivity(teacher.id, {
			title: 'TP 1',
			subjectId: subjectRow.id
		});
		const staged = await createFile(teacher.id, SHA_A, 'ok', '01_Sofia_Zambrano_5001.pdf');

		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});

		expect(submission.studentId).toBe(studentRow.id);
		expect(submission.studentName).toBe('Sofía Zambrano');
		const [link] = await testDb
			.select()
			.from(activityFile)
			.where(eq(activityFile.fileId, staged.id));
		expect(link.activityId).toBe(activity.id);
	});

	it('does not turn a file name into a student when the roster has nobody by that name', async () => {
		const teacher = await createUser();
		const { subjectRow } = await createRoster(teacher.id);
		const activity = await saveActivity(teacher.id, {
			title: 'TP 1',
			subjectId: subjectRow.id
		});
		const staged = await createFile(teacher.id, SHA_A, 'ok', 'Documento-RevisIA.pdf');

		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }]
		});

		// "Documento-RevisIA" is a file name, not a person: the delivery stays
		// unidentified until the header pass or the teacher says who it belongs to.
		expect(submission.studentId).toBeNull();
		expect(submission.studentName).toBeNull();
	});

	it('keeps an explicitly provided student name over the roster guess', async () => {
		const teacher = await createUser();
		const { subjectRow } = await createRoster(teacher.id, 'Sofía Zambrano');
		const activity = await saveActivity(teacher.id, {
			title: 'TP 1',
			subjectId: subjectRow.id
		});
		const staged = await createFile(teacher.id, SHA_A, 'ok', 'Documento-RevisIA.pdf');

		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: staged.id }],
			studentName: 'Sofía Zambrano'
		});

		expect(submission.studentName).toBe('Sofía Zambrano');
		expect(submission.studentId).toBeNull();
	});
});

describe('countSubmissionsByActivity', () => {
	it('counts deliveries and graded ones per activity, scoped to the owner', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const tp1 = await saveActivity(teacher.id, { title: 'TP 1' });
		const tp2 = await saveActivity(teacher.id, { title: 'TP 2' });
		const foreign = await saveActivity(other.id, { title: 'Ajena' });

		const pendingFile = await createFile(teacher.id, SHA_A, 'ok', 'a.pdf');
		const gradedFile = await createFile(teacher.id, SHA_B, 'ok', 'b.pdf');
		const keptFile = await createFile(teacher.id, 'c'.repeat(64), 'ok', 'c.pdf');
		const deletedFile = await createFile(teacher.id, 'd'.repeat(64), 'ok', 'd.pdf');
		const foreignFile = await createFile(other.id, 'e'.repeat(64), 'ok', 'e.pdf');

		const pending = await createSubmission(teacher.id, {
			activityId: tp1.id,
			files: [{ fileId: pendingFile.id }]
		});
		const graded = await createSubmission(teacher.id, {
			activityId: tp1.id,
			files: [{ fileId: gradedFile.id }]
		});
		await createSubmission(teacher.id, {
			activityId: tp2.id,
			files: [{ fileId: keptFile.id }]
		});
		const removed = await createSubmission(teacher.id, {
			activityId: tp2.id,
			files: [{ fileId: deletedFile.id }]
		});
		await createSubmission(other.id, {
			activityId: foreign.id,
			files: [{ fileId: foreignFile.id }]
		});

		await testDb
			.update(submissionTable)
			.set({ status: 'graded' })
			.where(eq(submissionTable.id, graded.submission.id));
		await deleteSubmission(teacher.id, removed.submission.id);

		const counts = await countSubmissionsByActivity(teacher.id, [tp1.id, tp2.id, foreign.id]);

		expect(counts.get(tp1.id)).toEqual({ total: 2, graded: 1 });
		expect(counts.get(tp2.id)).toEqual({ total: 1, graded: 0 });
		// The other teacher's activity never leaks through an explicit id.
		expect(counts.get(foreign.id)).toBeUndefined();
		expect(pending.submission.status).toBe('pending');
	});

	it('returns an empty map for an empty or invalid id list', async () => {
		const teacher = await createUser();

		expect((await countSubmissionsByActivity(teacher.id, [])).size).toBe(0);
		expect((await countSubmissionsByActivity(teacher.id, ['no-es-uuid'])).size).toBe(0);
	});
});

describe('linkSubmissionFileToActivity', () => {
	it('stages a confirmed single upload so the review screen can list it', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id, SHA_A, 'ok', 'Gomez_Ana_12345.pdf');

		const staged = await linkSubmissionFileToActivity(teacher.id, activity.id, uploaded.id);

		expect(staged).toEqual({
			fileId: uploaded.id,
			fileName: 'Gomez_Ana_12345.pdf',
			sha256: SHA_A
		});
		// Staging is not grading: no delivery exists until the teacher processes it.
		expect(await listSubmissions(teacher.id, activity.id)).toEqual([]);
		const pending = await listPendingSubmissionFiles(teacher.id, activity.id);
		expect(pending.map((entry) => entry.fileId)).toEqual([uploaded.id]);
	});

	it('is idempotent: staging the same file twice keeps one row', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const uploaded = await createFile(teacher.id);

		await linkSubmissionFileToActivity(teacher.id, activity.id, uploaded.id);
		const again = await linkSubmissionFileToActivity(teacher.id, activity.id, uploaded.id);

		expect(again?.fileId).toBe(uploaded.id);
		const links = await testDb
			.select()
			.from(activityFile)
			.where(eq(activityFile.activityId, activity.id));
		expect(links).toHaveLength(1);
	});

	it('rejects a file that was never confirmed', async () => {
		const teacher = await createUser();
		const activity = await saveActivity(teacher.id, { title: 'TP 1' });
		const unconfirmed = await createFile(teacher.id, '');

		expect(await linkSubmissionFileToActivity(teacher.id, activity.id, unconfirmed.id)).toBeNull();
	});

	it('rejects a file or an activity that belongs to another teacher', async () => {
		const owner = await createUser();
		const intruder = await createUser();
		const activity = await saveActivity(owner.id, { title: 'TP 1' });
		const owned = await createFile(owner.id);
		const foreignActivity = await saveActivity(intruder.id, { title: 'Ajena' });
		const foreignFile = await createFile(intruder.id, SHA_B);

		expect(await linkSubmissionFileToActivity(intruder.id, activity.id, owned.id)).toBeNull();
		expect(
			await linkSubmissionFileToActivity(owner.id, foreignActivity.id, foreignFile.id)
		).toBeNull();
		expect(await linkSubmissionFileToActivity(owner.id, 'no-es-uuid', owned.id)).toBeNull();
	});
});
