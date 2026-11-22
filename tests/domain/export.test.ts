import { describe, expect, it } from 'vitest';
import { buildGradeExport } from '../../src/lib/domain/export.js';
import type { Criterion, SubmissionListItem } from '../../src/lib/domain/types.js';

/**
 * Excel export of one activity (rubric criterion 5).
 *
 * The spec asks the export to carry the student name, the work title and the
 * score of every criterion of the rubric used. These tests pin that shape: one
 * column per criterion in rubric order, the score matched by criterion id (not
 * by position), and a clear gap for deliveries that were never graded.
 */

function criterion(id: string, name: string, maxPoints: number): Criterion {
  return { id, name, description: '', maxPoints, weight: 1, levels: [] };
}

const criteria = [
  criterion('c-1', 'Claridad', 5),
  criterion('c-2', 'Síntesis', 10)
];

function submission(overrides: Partial<SubmissionListItem> = {}): SubmissionListItem {
  return {
    id: 'sub-1',
    activityId: 'act-1',
    studentId: null,
    studentName: null,
    studentRosterName: null,
    title: null,
    kind: 'individual',
    source: 'pdf',
    status: 'pending',
    errorMessage: null,
    sha256: null,
    totalPoints: null,
    maxPoints: null,
    gradingSummary: null,
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
    grades: [],
    ...overrides
  };
}

function graded(overrides: Partial<SubmissionListItem> = {}): SubmissionListItem {
  return submission({
    status: 'graded',
    totalPoints: 12,
    maxPoints: 15,
    gradingSummary: 'Buen trabajo',
    grades: [
      { criterionId: 'c-1', criterionName: 'Claridad', levelLabel: null, points: 4, maxPoints: 5, feedback: 'ok' },
      { criterionId: 'c-2', criterionName: 'Síntesis', levelLabel: null, points: 8, maxPoints: 10, feedback: 'ok' }
    ],
    ...overrides
  });
}

describe('buildGradeExport', () => {
  it('puts one column per criterion in rubric order', () => {
    const { header } = buildGradeExport({ title: 'TP 1' }, criteria, []);

    expect(header).toEqual([
      'Estudiante',
      'Título del trabajo',
      'Estado',
      'Claridad (5)',
      'Síntesis (10)',
      'Total (15)',
      'Resumen'
    ]);
  });

  it('maps each score by criterion id, not by array position', () => {
    const { rows } = buildGradeExport({ title: 'TP 1' }, criteria, [
      graded({
        grades: [
          { criterionId: 'c-2', criterionName: 'Síntesis', levelLabel: null, points: 9, maxPoints: 10, feedback: null },
          { criterionId: 'c-1', criterionName: 'Claridad', levelLabel: null, points: 3, maxPoints: 5, feedback: null }
        ]
      })
    ]);

    expect(rows[0].criteria).toEqual({ 'c-1': 3, 'c-2': 9 });
  });

  it('leaves an ungraded delivery with empty scores and its status', () => {
    const { rows } = buildGradeExport({ title: 'TP 1' }, criteria, [submission()]);

    expect(rows[0].criteria).toEqual({ 'c-1': null, 'c-2': null });
    expect(rows[0].total).toBeNull();
    expect(rows[0].status).toBe('Pendiente');
  });

  it('prefers the roster name and keeps the work title', () => {
    const { rows } = buildGradeExport({ title: 'TP 1' }, criteria, [
      graded({ studentName: 'juan perez', studentRosterName: 'Juan Pérez', title: 'Resumen del ensayo' })
    ]);

    expect(rows[0].student).toBe('Juan Pérez');
    expect(rows[0].title).toBe('Resumen del ensayo');
  });

  it('never invents the student from the file name', () => {
    // A file name is a hint, not an identity: an unlinked delivery exports as
    // "sin identificar" even when the name follows the Moodle convention.
    const fromFile = buildGradeExport({ title: 'TP 1' }, criteria, [submission()]);
    expect(fromFile.rows[0].student).toBe('Sin identificar');

    // Rows written by an older version stored that guess in `student_name`.
    const legacy = buildGradeExport({ title: 'TP 1' }, criteria, [
      submission({ studentName: 'Pérez Juan' })
    ]);
    expect(legacy.rows[0].student).toBe('Sin identificar');

    const nothing = buildGradeExport({ title: 'TP 1' }, criteria, [
      submission({ files: [] })
    ]);
    expect(nothing.rows[0].student).toBe('Sin identificar');
  });

  it('builds a safe file name from the activity title', () => {
    const { fileName } = buildGradeExport({ title: 'TP N°1 — Redes & Ensayo' }, criteria, []);
    expect(fileName).toBe('notas-tp-n-1-redes-ensayo.xlsx');
  });
});
