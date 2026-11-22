import type { RequestHandler } from './$types';
import { getActivity } from '#lib/server/repositories/activity.js';
import { getTemplate, isUuid } from '#lib/server/repositories/rubric.js';
import { listSubmissions } from '#lib/server/repositories/submission.js';
import { buildGradeExport } from '#lib/domain/export.js';
import { buildGradeWorkbook } from '#lib/server/export-workbook.js';

/**
 * GET /api/activities/[id]/export — the grades of one activity as .xlsx.
 *
 * Rubric criterion 5: the export carries the student name, the work title and
 * the score of every criterion of the rubric used. Deliveries without a grade
 * still appear, with empty score cells and their status, so a partial export is
 * never mistaken for a complete one.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return new Response('No autenticado', { status: 401 });
	if (!isUuid(params.id)) return new Response('Actividad inválida', { status: 400 });

	const activity = await getActivity(locals.user.id, params.id);
	if (!activity) return new Response('La actividad no existe', { status: 404 });
	if (!activity.rubricId) {
		return new Response('La actividad no tiene rúbrica asignada', { status: 400 });
	}

	const template = await getTemplate(locals.user.id, activity.rubricId);
	if (!template) return new Response('La rúbrica de la actividad ya no existe', { status: 400 });

	const submissions = await listSubmissions(locals.user.id, activity.id);
	const exportData = buildGradeExport(activity, template.criteria, submissions);
	const buffer = await buildGradeWorkbook(exportData, template.criteria);

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${exportData.fileName}"`,
			'Cache-Control': 'no-store'
		}
	});
};
