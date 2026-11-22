import { submissionStudentName } from './roster.js';
import { slugify } from './types.js';
import type { Criterion, SubmissionListItem } from './types.js';

/**
 * Excel export of one activity (rubric criterion 5).
 *
 * Pure data shaping, no workbook: the route turns this into a sheet, so the
 * columns and the score mapping can be tested without writing a binary.
 * One column per criterion of the rubric actually used, plus the total.
 */

export type GradeExportRow = {
	student: string;
	title: string;
	status: string;
	/** Points per criterion id; `null` when the delivery was never graded. */
	criteria: Record<string, number | null>;
	total: number | null;
	maxTotal: number | null;
	summary: string;
};

export type GradeExport = {
	header: string[];
	rows: GradeExportRow[];
	fileName: string;
};

const STATUS_LABELS: Record<string, string> = {
	pending: 'Pendiente',
	processing: 'En proceso',
	graded: 'Calificada',
	error: 'Error'
};

export function buildGradeExport(
	activity: { title: string },
	criteria: Criterion[],
	submissions: SubmissionListItem[]
): GradeExport {
	const maxTotal = criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);

	const header = [
		'Estudiante',
		'Título del trabajo',
		'Estado',
		...criteria.map((criterion) => `${criterion.name} (${criterion.maxPoints})`),
		`Total (${maxTotal})`,
		'Resumen'
	];

	const rows = submissions.map((submission) => {
		const byCriterion: Record<string, number | null> = {};
		for (const criterion of criteria) {
			const grade = submission.grades.find((entry) => entry.criterionId === criterion.id);
			byCriterion[criterion.id] = grade ? grade.points : null;
		}

		// The exported grade sheet is an official document: an unlinked delivery is
		// exported as "sin identificar" instead of guessing a person from a file
		// name ("Documento-RevisIA.pdf" is not a student).
		const student = submissionStudentName(submission) ?? 'Sin identificar';
		const graded = submission.grades.length > 0;

		return {
			student,
			title: submission.title ?? '',
			status: STATUS_LABELS[submission.status] ?? submission.status,
			criteria: byCriterion,
			total: graded ? (submission.totalPoints ?? 0) : null,
			maxTotal: graded ? (submission.maxPoints ?? maxTotal) : null,
			summary: submission.gradingSummary ?? ''
		};
	});

	return {
		header,
		rows,
		fileName: `notas-${slugify(activity.title).replace(/_/g, '-')}.xlsx`
	};
}
