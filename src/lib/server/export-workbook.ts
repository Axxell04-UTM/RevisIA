import type { GradeExport } from '#lib/domain/export.js';
import type { Criterion } from '#lib/domain/types.js';
import { resolveExcelJs } from './exceljs-module.js';

/**
 * Turns the export data into a real .xlsx buffer.
 *
 * Kept out of the route so the binary can be tested: a sheet that silently
 * loses a column still downloads fine, and that is exactly the failure this
 * function exists to prevent.
 */
export async function buildGradeWorkbook(exportData: GradeExport, criteria: Criterion[]) {
	const ExcelJS = resolveExcelJs(await import('exceljs'));
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Notas');

	sheet.addRow(exportData.header);
	sheet.getRow(1).font = { bold: true };
	sheet.views = [{ state: 'frozen', ySplit: 1 }];

	for (const row of exportData.rows) {
		sheet.addRow([
			row.student,
			row.title,
			row.status,
			...criteria.map((criterion) => row.criteria[criterion.id] ?? null),
			row.total,
			row.summary
		]);
	}

	sheet.columns.forEach((column, index) => {
		column.width = index === 0 ? 32 : index === 1 ? 44 : index === 2 ? 14 : 16;
	});

	return workbook.xlsx.writeBuffer();
}
