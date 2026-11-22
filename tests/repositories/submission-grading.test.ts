import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq } from 'drizzle-orm';
import { file } from '#lib/server/db/schema/academic.js';
import { grade as gradeTable } from '#lib/server/db/schema/grading.js';
import {
	createSubmission,
	listSubmissions,
	saveSubmissionGrades
} from '#lib/server/repositories/submission.js';
import { saveActivity } from '#lib/server/repositories/activity.js';
import { saveTemplate } from '#lib/server/repositories/rubric.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * Grading persistence for the review screen.
 *
 * A delivery is graded once even when it is a group, the grade is one row per
 * rubric criterion, and re-grading replaces the previous attempt instead of
 * stacking a second history nobody asked for. These tests pin that shape plus
 * the two ownership checks that keep a stray id from writing into someone
 * else's activity or into another rubric's criteria.
 */

const SHA_A = 'a'.repeat(64);

async function createFileWithText(teacherId: string, text = 'Texto extraído de la entrega') {
	const [row] = await testDb
		.insert(file)
		.values({
			storageKey: `submission/${SHA_A.slice(0, 8)}-entrega.pdf`,
			bucket: 'submissions',
			originalName: 'Entrega.pdf',
			mime: 'application/pdf',
			sizeBytes: 1024,
			sha256: SHA_A,
			extractedText: text,
			extraction: 'ok',
			uploadContext: 'submission',
			uploadedBy: teacherId
		})
		.returning();
	return row;
}

async function createRubric(teacherId: string, prefix = 'Criterio') {
	return saveTemplate(teacherId, {
		name: 'Rúbrica de prueba',
		criteria: [
			{ name: `${prefix} A`, maxPoints: 10, weight: 1 },
			{ name: `${prefix} B`, maxPoints: 5, weight: 1 }
		]
	});
}

async function createGradedScenario() {
	const teacher = await createUser();
	const rubric = await createRubric(teacher.id);
	const activity = await saveActivity(teacher.id, { title: 'TP 1', rubricId: rubric.id });
	const uploaded = await createFileWithText(teacher.id);
	const { submission } = await createSubmission(teacher.id, {
		activityId: activity.id,
		files: [{ fileId: uploaded.id }],
		studentName: 'Juan Pérez'
	});
	return { teacher, rubric, activity, submission };
}

beforeEach(async () => {
	await resetDb();
});

describe('saveSubmissionGrades', () => {
	it('persists one row per criterion and marks the delivery as graded', async () => {
		const { teacher, rubric, submission } = await createGradedScenario();

		const saved = await saveSubmissionGrades(teacher.id, submission.id, {
			grades: rubric.criteria.map((criterion, index) => ({
				criterionId: criterion.id,
				levelLabel: null,
				points: index === 0 ? 8 : 4,
				maxPoints: criterion.maxPoints,
				feedback: `Feedback ${criterion.name}`
			})),
			totalPoints: 12,
			maxPoints: 15,
			summary: 'Buen trabajo en general.',
			model: 'test-model',
			promptTokens: 1200,
			completionTokens: 300
		});

		expect(saved?.status).toBe('graded');
		expect(saved?.totalPoints).toBe(12);
		expect(saved?.maxPoints).toBe(15);
		expect(saved?.gradingSummary).toBe('Buen trabajo en general.');

		const rows = await testDb
			.select()
			.from(gradeTable)
			.where(eq(gradeTable.submissionId, submission.id));
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.points).sort((a, b) => a - b)).toEqual([4, 8]);
	});

	it('replaces the previous grade when the delivery is graded again', async () => {
		const { teacher, rubric, submission } = await createGradedScenario();
		const gradeOnce = () => ({
			grades: rubric.criteria.map((criterion) => ({
				criterionId: criterion.id,
				levelLabel: null,
				points: 1,
				maxPoints: criterion.maxPoints,
				feedback: null
			})),
			totalPoints: 2,
			maxPoints: 15,
			summary: null,
			model: 'test-model',
			promptTokens: null,
			completionTokens: null
		});

		await saveSubmissionGrades(teacher.id, submission.id, gradeOnce());
		await saveSubmissionGrades(teacher.id, submission.id, {
			...gradeOnce(),
			totalPoints: 15,
			summary: 'Segunda evaluación.'
		});

		const rows = await testDb
			.select()
			.from(gradeTable)
			.where(eq(gradeTable.submissionId, submission.id));
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.points === 1)).toBe(true);

		const [listed] = await listSubmissions(teacher.id, submission.activityId);
		expect(listed.totalPoints).toBe(15);
		expect(listed.gradingSummary).toBe('Segunda evaluación.');
	});

	it('rejects a criterion that does not belong to the activity rubric', async () => {
		const { teacher, submission } = await createGradedScenario();
		const otherRubric = await createRubric(teacher.id, 'Otro');

		await expect(
			saveSubmissionGrades(teacher.id, submission.id, {
				grades: [
					{
						criterionId: otherRubric.criteria[0].id,
						levelLabel: null,
						points: 3,
						maxPoints: 10,
						feedback: null
					}
				],
				totalPoints: 3,
				maxPoints: 10,
				summary: null,
				model: null,
				promptTokens: null,
				completionTokens: null
			})
		).rejects.toThrow(/rúbrica/i);
	});

	it('returns null for a delivery owned by another teacher', async () => {
		const { rubric, submission } = await createGradedScenario();
		const intruder = await createUser();

		const saved = await saveSubmissionGrades(intruder.id, submission.id, {
			grades: [
				{
					criterionId: rubric.criteria[0].id,
					levelLabel: null,
					points: 3,
					maxPoints: 10,
					feedback: null
				}
			],
			totalPoints: 3,
			maxPoints: 10,
			summary: null,
			model: null,
			promptTokens: null,
			completionTokens: null
		});

		expect(saved).toBeNull();
	});
});

describe('listSubmissions grades', () => {
	it('returns the saved grades per delivery, in rubric order', async () => {
		const { teacher, rubric, activity, submission } = await createGradedScenario();

		await saveSubmissionGrades(teacher.id, submission.id, {
			grades: [
				{
					criterionId: rubric.criteria[1].id,
					levelLabel: null,
					points: 5,
					maxPoints: 5,
					feedback: 'Completo'
				},
				{
					criterionId: rubric.criteria[0].id,
					levelLabel: null,
					points: 7,
					maxPoints: 10,
					feedback: 'Falta desarrollo'
				}
			],
			totalPoints: 12,
			maxPoints: 15,
			summary: null,
			model: 'test-model',
			promptTokens: null,
			completionTokens: null
		});

		const [listed] = await listSubmissions(teacher.id, activity.id);
		expect(listed.grades.map((row) => row.criterionName)).toEqual([
			`${rubric.criteria[0].name}`,
			`${rubric.criteria[1].name}`
		]);
		expect(listed.grades[0].feedback).toBe('Falta desarrollo');
	});

	it('returns an empty grade list for a delivery nobody graded yet', async () => {
		const { teacher, activity } = await createGradedScenario();

		const [listed] = await listSubmissions(teacher.id, activity.id);
		expect(listed.grades).toEqual([]);
		expect(listed.totalPoints).toBeNull();
	});
});
