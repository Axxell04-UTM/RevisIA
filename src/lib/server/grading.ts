import { gradeWithAI, MAX_ATTACHED_PDF_BYTES, type DocumentAttachment } from './ai.js';
import { getObjectBuffer } from './r2.js';
import { buildPrompt } from '#lib/domain/prompt.js';
import type { PromptExtras } from '#lib/domain/prompt.js';
import { normalizeGrades } from '#lib/domain/normalize.js';
import { GRADE_JSON_SCHEMA } from '#lib/domain/schema.js';
import type { Answer, StudentGrade } from '#lib/domain/types.js';
import { getActivityPrompt } from './repositories/activity.js';
import { getTemplate } from './repositories/rubric.js';
import { getSubmissionMainFile, saveSubmissionGrades } from './repositories/submission.js';

/**
 * Grading one delivery, server side.
 *
 * Before this, the grading screen sent the template, the contexts and the
 * answers from the browser and kept the result in memory. Now the delivery, its
 * extracted text and the activity it belongs to are already on the server, so
 * the prompt is built here and the grade is persisted in the same request:
 * nothing the client sends can change what the model sees.
 */

export type SubmissionGradingResult = {
	grade: StudentGrade;
	provider: string;
	model: string;
	promptTokens: number;
	truncated: boolean;
	warnings: string[];
};

/** Activity contexts keyed by tag, which is how `buildPrompt` reads them. */
function contextsByTag(activity: { contexts: { tag: string; content: string }[] }) {
	return Object.fromEntries(activity.contexts.map((c) => [c.tag, c.content ?? '']));
}

/**
 * Reads the delivery's original PDF so it can travel with the prompt.
 *
 * The extracted text is a transcription: images, charts and formulas inside the
 * document never reach it. Attaching the file itself is what lets the model see
 * them, so a failure here is reported as a warning and the delivery is still
 * graded from its text instead of failing the whole call.
 */
async function loadDeliveryAttachment(
	main: { mime: string; storageKey: string; sizeBytes: number; fileName: string }
): Promise<{ attachment?: DocumentAttachment; warning?: string }> {
	if (main.mime !== 'application/pdf') return {};
	if (main.sizeBytes > MAX_ATTACHED_PDF_BYTES) {
		return {
			warning:
				'El PDF original supera el tamaño que se puede adjuntar al modelo: se calificó con el texto extraído.'
		};
	}

	try {
		const bytes = await getObjectBuffer(main.storageKey);
		return {
			attachment: {
				mimeType: 'application/pdf',
				data: bytes.toString('base64'),
				filename: main.fileName
			}
		};
	} catch {
		return {
			warning:
				'No se pudo leer el PDF original desde el almacenamiento: se calificó con el texto extraído.'
		};
	}
}

/**
 * Grades one delivery of one activity.
 *
 * Rejects instead of guessing when the delivery has no usable text or when the
 * activity has no rubric: a grade built from a half-empty prompt looks valid and
 * is not. Context blocks belong to the activity, so they are included when the
 * teacher filled them and never block grading when they are empty.
 */
export async function gradeSubmission(
	teacherId: string,
	submissionId: string
): Promise<SubmissionGradingResult> {
	const main = await getSubmissionMainFile(teacherId, submissionId);
	if (!main) throw new Error('La entrega no existe o no pertenece a este docente');
	if (main.extraction !== 'ok' || !main.extractedText?.trim()) {
		throw new Error('El documento todavía no tiene texto extraído');
	}

	const found = await getActivityPrompt(teacherId, main.activityId);
	if (!found) throw new Error('La actividad no existe o no pertenece a este docente');
	const { activity, sourceDocument } = found;
	if (!activity.rubricId) throw new Error('La actividad no tiene rúbrica asignada');

	const template = await getTemplate(teacherId, activity.rubricId);
	if (!template) throw new Error('La rúbrica de la actividad ya no existe');

	const contexts = contextsByTag(activity);

	const label =
		main.rosterName ??
		main.studentName ??
		'Entrega sin identificar';

	const answer: Answer = { id: `sub-${submissionId}`, student: label, text: main.extractedText };

	// The PDF goes with the prompt when it fits: the extracted text cannot carry
	// the images, charts or formulas the document contains.
	const { attachment, warning: attachmentWarning } = await loadDeliveryAttachment(main);

	const extras: PromptExtras = {
		title: activity.title,
		description: activity.description,
		objectives: activity.objectives,
		instructions: activity.instructions,
		sourceDocument,
		deliveryDocument: Boolean(attachment)
	};

	const built = buildPrompt(template, contexts, [{ student: answer.student, text: answer.text }], {
		extras
	});

	const { raw, provider, model } = await gradeWithAI({
		prompt: built.prompt,
		schema: GRADE_JSON_SCHEMA,
		teacherId,
		attachments: attachment ? [attachment] : undefined
	});

	const [grade] = normalizeGrades(raw, [answer], template.criteria);
	if (!grade) throw new Error('El modelo no devolvió una evaluación para la entrega');

	const saved = await saveSubmissionGrades(teacherId, submissionId, {
		grades: grade.scores.map((score) => ({
			criterionId: score.criterionId,
			levelLabel: null,
			points: score.points,
			maxPoints: score.maxPoints,
			feedback: score.feedback
		})),
		totalPoints: grade.total,
		maxPoints: grade.maxTotal,
		summary: grade.summary || null,
		model,
		promptTokens: built.estimatedTokens
	});
	if (!saved) throw new Error('No se pudo guardar la calificación');

	return {
		grade,
		provider,
		model,
		promptTokens: built.estimatedTokens,
		truncated: built.truncated,
		warnings: attachmentWarning ? [...built.warnings, attachmentWarning] : built.warnings
	};
}
