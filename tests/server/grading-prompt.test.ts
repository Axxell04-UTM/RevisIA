import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

// The provider is not the subject here: the prompt built before the call is.
const captured = vi.hoisted(() => ({
	prompt: '',
	attachments: [] as { mimeType: string; data: string; filename?: string }[]
}));

// The bytes never leave R2 in a unit test; the failure flag exercises the
// degrade-to-text path.
const storage = vi.hoisted(() => ({ fail: false }));

vi.mock('#lib/server/ai.js', () => ({
	MAX_ATTACHED_PDF_BYTES: 12 * 1024 * 1024,
	gradeWithAI: async ({
		prompt,
		attachments
	}: {
		prompt: string;
		attachments?: { mimeType: string; data: string; filename?: string }[];
	}) => {
		captured.prompt = prompt;
		captured.attachments = attachments ?? [];
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

import { eq } from 'drizzle-orm';
import { file } from '#lib/server/db/schema/academic.js';
import { gradeSubmission } from '#lib/server/grading.js';
import { saveActivity } from '#lib/server/repositories/activity.js';
import { saveTemplate } from '#lib/server/repositories/rubric.js';
import { createSubmission } from '#lib/server/repositories/submission.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

vi.mock('#lib/server/r2.js', () => ({
	getObjectBuffer: async () => {
		if (storage.fail) throw new Error('storage down');
		return Buffer.from('%PDF-1.4 entrega de prueba');
	}
}));

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
	input: {
		context: 'sourceDocument' | 'submission';
		text: string;
		name: string;
		sha: string;
		mime?: string;
		sizeBytes?: number;
	}
) {
	const [row] = await testDb
		.insert(file)
		.values({
			storageKey: `${input.context}/${input.sha.slice(0, 8)}-${input.name}`,
			bucket: input.context === 'sourceDocument' ? 'sourceDocument' : 'submissions',
			originalName: input.name,
			mime: input.mime ?? 'application/pdf',
			sizeBytes: input.sizeBytes ?? 1024,
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

	return { teacher, rubric, activity, submission, delivery };
}

beforeEach(async () => {
	await resetDb();
	captured.prompt = '';
	captured.attachments = [];
	storage.fail = false;
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

describe('gradeSubmission — PDF adjunto', () => {
	it('attaches the delivery PDF and points the prompt at it', async () => {
		const { teacher, submission } = await createScenario();

		await gradeSubmission(teacher.id, submission.id);

		expect(captured.attachments).toHaveLength(1);
		expect(captured.attachments[0].mimeType).toBe('application/pdf');
		expect(captured.attachments[0].filename).toBe('Entrega.pdf');
		expect(captured.attachments[0].data).toBe(
			Buffer.from('%PDF-1.4 entrega de prueba').toString('base64')
		);
		expect(captured.prompt).toContain('<documento_adjunto>');
	});

	it('does not attach the activity source document, only the delivery', async () => {
		const { teacher, submission } = await createScenario();

		await gradeSubmission(teacher.id, submission.id);

		expect(captured.attachments).toHaveLength(1);
	});

	it('grades from the text alone when the PDF is too big to attach', async () => {
		const { teacher, submission, delivery } = await createScenario();
		await testDb
			.update(file)
			.set({ sizeBytes: 13 * 1024 * 1024 })
			.where(eq(file.id, delivery.id));

		const result = await gradeSubmission(teacher.id, submission.id);

		expect(captured.attachments).toHaveLength(0);
		expect(captured.prompt).not.toContain('<documento_adjunto>');
		expect(result.warnings.join(' ')).toMatch(/tamaño/i);
	});

	it('grades from the text alone when the stored PDF cannot be read', async () => {
		const { teacher, submission } = await createScenario();
		storage.fail = true;

		const result = await gradeSubmission(teacher.id, submission.id);

		expect(captured.attachments).toHaveLength(0);
		expect(captured.prompt).not.toContain('<documento_adjunto>');
		expect(result.warnings.join(' ')).toMatch(/no se pudo leer/i);
	});

	it('does not attach a DOCX delivery: it is graded from its extracted text', async () => {
		const teacher = await createUser();
		const rubric = await saveTemplate(teacher.id, {
			name: 'Rúbrica DOCX',
			criteria: [{ name: 'Criterio A', maxPoints: 10, weight: 1 }]
		});
		const delivery = await createFileRow(teacher.id, {
			context: 'submission',
			text: DELIVERY_TEXT,
			name: 'Entrega.docx',
			sha: 'd'.repeat(64),
			mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		});
		const activity = await saveActivity(teacher.id, { title: 'TP 3', rubricId: rubric.id });
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: delivery.id }]
		});

		await gradeSubmission(teacher.id, submission.id);

		expect(captured.attachments).toHaveLength(0);
		expect(captured.prompt).not.toContain('<documento_adjunto>');
		expect(captured.prompt).toContain(DELIVERY_TEXT);
	});
});
