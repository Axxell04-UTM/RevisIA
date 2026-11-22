import type { Criterion, Answer, StudentGrade, CriterionScore } from './types.js';

function normalizeName(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseJsonLoose(text: string): unknown {
  const clean = text
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No se encontró JSON en la respuesta del modelo');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('Respuesta JSON inválida');
  }
}

export function normalizeGrades(raw: unknown, answers: Answer[], criteria: Criterion[]): StudentGrade[] {
  let data: any;
  try {
    if (typeof raw === 'string') data = parseJsonLoose(raw);
    else data = raw;
  } catch (e) {
    throw new Error((e as Error).message);
  }

  const evals = Array.isArray(data?.evaluaciones) ? data.evaluaciones : [];

  const grades: StudentGrade[] = [];

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    const modelEntry = evals.find(
      (e: any) => Number(e.indice) === i + 1
    ) ?? evals[i] ?? {};

    const scores: CriterionScore[] = [];

    for (let ci = 0; ci < criteria.length; ci++) {
      const c = criteria[ci];
      const modelCrit = Array.isArray(modelEntry.criterios)
        ? modelEntry.criterios.find((mc: any) => normalizeName(mc.criterio) === normalizeName(c.name))
        : undefined;

      const fallbackByPos = Array.isArray(modelEntry.criterios) ? modelEntry.criterios[ci] : undefined;
      const mc = modelCrit ?? fallbackByPos;

      let points = Number(mc?.puntaje);
      if (!Number.isFinite(points)) points = 0;
      points = Math.max(0, Math.min(points, c.maxPoints));
      points = Math.round(points * 100) / 100;

      scores.push({
        criterionId: c.id,
        criterionName: c.name,
        points,
        maxPoints: c.maxPoints,
        feedback: typeof mc?.retroalimentacion === 'string' && mc.retroalimentacion.trim()
          ? mc.retroalimentacion.trim()
          : 'Sin evaluación.',
      });
    }

    const total = scores.reduce((a, s) => a + s.points, 0);
    const maxTotal = criteria.reduce((a, c) => a + c.maxPoints, 0);
    const summary = typeof modelEntry?.resumen === 'string' && modelEntry.resumen.trim()
      ? modelEntry.resumen.trim()
      : '';

    grades.push({
      index: i + 1,
      student: answer.student?.trim() || `Estudiante ${i + 1}`,
      scores,
      total,
      maxTotal,
      summary,
    });
  }

  return grades;
}
