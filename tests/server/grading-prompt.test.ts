import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

// The provider is not the subject here: the prompt built before the call is.
const captured = vi.hoisted(() => ({ prompt: '' }));

vi.mock('#lib/server/ai.js', () => ({
	gradeWithAI: async ({ prompt }: { prompt: string }) => {
		captured.prompt = prompt;
		return {
			raw: {
				evaluaciones: [
					{
						indice: 1,
						estudiante: 'Juan Pérez',
						criterios: [
							{ criterio: 'Criterio A', puntaje: 8, retroalimentacion: 'Claro' },
							{ criterio: 'Criterio B', puntaje: 4, retroalimentacion: 'Casi' }
						],
						resumen: 'Buen trabajo.'
					}
				]
			},
			provider: 'openai',
			model: 'test-model'
		};
	}
}));

import { file } from '#lib/server/db/schema/academic.js';
import { gradeSubmission } from '#lib/server/grading.js';
import { saveActivity } from '#lib/server/repositories/activity.js';
import { saveTemplate } from '#lib/server/repositories/rubric.js';
import { createSubmission } from '#lib/server/repositories/submission.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * What the grading prompt actually carries.
 *
 * The preview in the activity editor is a mock-up; this is the request the model
 * receives when a delivery is graded. The rubric criterion 3 asks for the source
 * document to be part of the academic context, so the document must reach the
 * prompt, next to the student's extracted text.
 */

const SOURCE_TEXT = 'Texto base del ensayo que los estudiantes debían resumir.';
const DELIVERY_TEXT = 'Resumen entregado por el estudiante.';

async function createFileRow(
	teacherId: string,
	input: { context: 'sourceDocument' | 'submission'; text: string; name: string; sha: string }
) {
	const [row] = await testDb
		.insert(file)
		.values({
			storageKey: `${input.context}/${input.sha.slice(0, 8)}-${input.name}`,
			bucket: input.context === 'sourceDocument' ? 'sourceDocument' : 'submissions',
			originalName: input.name,
			mime: 'application/pdf',
			sizeBytes: 1024,
			sha256: input.sha,
			extractedText: input.text,
			extraction: 'ok',
			uploadContext: input.context,
			uploadedBy: teacherId
		})
		.returning();
	return row;
}

async function createScenario() {
	const teacher = await createUser();
	const rubric = await saveTemplate(teacher.id, {
		name: 'Rúbrica de prueba',
		criteria: [
			{ name: 'Criterio A', maxPoints: 10, weight: 1 },
			{ name: 'Criterio B', maxPoints: 5, weight: 1 }
		]
	});

	const source = await createFileRow(teacher.id, {
		context: 'sourceDocument',
		text: SOURCE_TEXT,
		name: 'texto-base.pdf',
		sha: 'b'.repeat(64)
	});
	const delivery = await createFileRow(teacher.id, {
		context: 'submission',
		text: DELIVERY_TEXT,
		name: 'Entrega.pdf',
		sha: 'a'.repeat(64)
	});

	const activity = await saveActivity(teacher.id, {
		title: 'TP 1',
		rubricId: rubric.id,
		sourceFileId: source.id
	});
	const { submission } = await createSubmission(teacher.id, {
		activityId: activity.id,
		files: [{ fileId: delivery.id }],
		studentName: 'Juan Pérez'
	});

	return { teacher, rubric, activity, submission };
}

beforeEach(async () => {
	await resetDb();
	captured.prompt = '';
});

describe('gradeSubmission — prompt content', () => {
	it('sends the activity source document to the model', async () => {
		const { teacher, submission } = await createScenario();

		await gradeSubmission(teacher.id, submission.id);

		expect(captured.prompt).toContain('<documento_fuente>');
		expect(captured.prompt).toContain(SOURCE_TEXT);
	});

	it('sends the student text of the delivery being graded', async () => {
		const { teacher, submission } = await createScenario();

		await gradeSubmission(teacher.id, submission.id);

		expect(captured.prompt).toContain(DELIVERY_TEXT);
	});

	it('grades when the activity has no source document', async () => {
		const teacher = await createUser();
		const rubric = await saveTemplate(teacher.id, {
			name: 'Sin documento',
			criteria: [{ name: 'Criterio A', maxPoints: 10, weight: 1 }]
		});
		const delivery = await createFileRow(teacher.id, {
			context: 'submission',
			text: DELIVERY_TEXT,
			name: 'Entrega.pdf',
			sha: 'c'.repeat(64)
		});
		const activity = await saveActivity(teacher.id, { title: 'TP 2', rubricId: rubric.id });
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: delivery.id }]
		});

		const result = await gradeSubmission(teacher.id, submission.id);

		expect(result.grade.student).toBeTruthy();
		expect(captured.prompt).not.toContain('<documento_fuente>');
	});
});
