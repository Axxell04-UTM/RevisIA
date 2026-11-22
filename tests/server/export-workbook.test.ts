import { describe, expect, it } from 'vitest';
import { buildGradeExport } from '../../src/lib/domain/export.js';
import { buildGradeWorkbook } from '../../src/lib/server/export-workbook.js';
import type { Criterion, SubmissionListItem } from '../../src/lib/domain/types.js';

/**
 * The download is a binary, so the export is only trustworthy if the workbook
 * reads back with the same columns it advertises. This test writes the file,
 * opens it again and checks the cells the rubric asks for.
 */

const criteria: Criterion[] = [
  { id: 'c-1', name: 'Claridad', description: '', maxPoints: 5, weight: 1, levels: [] },
  { id: 'c-2', name: 'Síntesis', description: '', maxPoints: 10, weight: 1, levels: [] }
];

const submission: SubmissionListItem = {
  id: 'sub-1',
  activityId: 'act-1',
  studentId: 'stu-1',
  studentName: 'juan perez',
  studentRosterName: 'Juan Pérez',
  title: 'Resumen del ensayo',
  kind: 'individual',
  source: 'pdf',
  status: 'graded',
  errorMessage: null,
  sha256: null,
  totalPoints: 12,
  maxPoints: 15,
  gradingSummary: 'Buen trabajo',
  createdAt: 0,
  files: [
    {
      fileId: 'file-1',
      fileName: 'Pérez_Juan_12345.pdf',
      mime: 'application/pdf',
      role: 'document',
      extraction: 'ok',
      extractedChars: 1200
    }
  ],
  members: [],
  grades: [
    { criterionId: 'c-1', criterionName: 'Claridad', levelLabel: null, points: 4, maxPoints: 5, feedback: null },
    { criterionId: 'c-2', criterionName: 'Síntesis', levelLabel: null, points: 8, maxPoints: 10, feedback: null }
  ]
};

describe('buildGradeWorkbook', () => {
  it('writes a readable sheet with a column per criterion and the scores', async () => {
    const exportData = buildGradeExport({ title: 'TP 1' }, criteria, [submission]);
    const buffer = await buildGradeWorkbook(exportData, criteria);

    // Every .xlsx is a zip container.
    expect(Buffer.from(buffer).subarray(0, 2).toString('latin1')).toBe('PK');

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Notas');

    expect(sheet).toBeTruthy();
    const header = sheet!.getRow(1);
    expect(header.getCell(1).value).toBe('Estudiante');
    expect(header.getCell(2).value).toBe('Título del trabajo');
    expect(header.getCell(4).value).toBe('Claridad (5)');
    expect(header.getCell(5).value).toBe('Síntesis (10)');

    const first = sheet!.getRow(2);
    expect(first.getCell(1).value).toBe('Juan Pérez');
    expect(first.getCell(2).value).toBe('Resumen del ensayo');
    expect(first.getCell(3).value).toBe('Calificada');
    expect(first.getCell(4).value).toBe(4);
    expect(first.getCell(5).value).toBe(8);
    expect(first.getCell(6).value).toBe(12);

    // Header plus one delivery row.
    expect(sheet!.rowCount).toBe(2);
    // The first cold import of exceljs is slow; keep the timeout out of the way.
  }, 30_000);
});
