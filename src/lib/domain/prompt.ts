import type { Template } from './types.js';

/**
 * Academic context that is not part of the template: an activity carries its
 * own title, description, objectives, instructions, and the extracted text of
 * an uploaded source document (essay, case study, paper).
 */
export type PromptExtras = {
  title?: string;
  description?: string;
  objectives?: string;
  instructions?: string;
  sourceDocument?: string;
  /**
   * True when the delivery's original file travels with the prompt as an
   * attachment. The prompt then points the model at it for everything the
   * extracted text cannot represent: images, charts, tables, formulas.
   */
  deliveryDocument?: boolean;
};

export type PromptBuildOptions = {
  extras?: PromptExtras;
  /** Model context window in tokens. Defaults to a conservative 128k. */
  contextWindow?: number;
  /** Tokens kept free for the response and provider overhead. */
  reserveTokens?: number;
};

export type PromptBuild = {
  prompt: string;
  estimatedTokens: number;
  contextWindow: number;
  reserveTokens: number;
  /** True when at least one section had to be shortened to fit. */
  truncated: boolean;
  warnings: string[];
};

export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_RESERVE_TOKENS = 8_000;
/** Rough, provider-agnostic approximation: ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;
const TRUNCATION_MARKER = '[... texto recortado por límite de tokens ...]';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Renders the prompt as a string. Kept as the plain entry point for callers
 * that do not care about token accounting; `buildPrompt` is the one that
 * reports truncation and warnings.
 */
export function renderPrompt(
  t: Template,
  contexts: Record<string, string>,
  answers: Array<{ student: string; text: string }>,
  extras?: PromptExtras
): string {
  return buildPrompt(t, contexts, answers, { extras }).prompt;
}

/**
 * Builds the grading prompt and enforces a token budget.
 *
 * When the rendered prompt exceeds `contextWindow - reserveTokens`, sections are
 * shortened in order of expendability: the source document first, then the
 * largest context block, then the largest student answer. Every cut is reported
 * in `warnings` so the UI can show it instead of silently grading partial text.
 */
export function buildPrompt(
  t: Template,
  contexts: Record<string, string>,
  answers: Array<{ student: string; text: string }>,
  options: PromptBuildOptions = {}
): PromptBuild {
  const extras = options.extras ?? {};
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const reserveTokens = options.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  const limitChars = Math.max(0, (contextWindow - reserveTokens) * CHARS_PER_TOKEN);

  const sourceHolder = { text: (extras.sourceDocument ?? '').trim() };
  const contextValues = new Map<string, string>();
  for (const c of t.contexts) {
    contextValues.set(c.tag, (contexts[c.tag] ?? '').trim());
  }
  // Context blocks belong to the activity: every tag the caller sends is
  // rendered even when the rubric declares none. Template tags keep their
  // original order, activity-only tags follow in insertion order.
  for (const [tag, value] of Object.entries(contexts)) {
    if (!contextValues.has(tag)) contextValues.set(tag, (value ?? '').trim());
  }
  const answerValues = answers.map((a) => (a.text ?? '').trim());

  const truncatedLabels = new Map<string, string>();
  const warnings: string[] = [];

  const render = () =>
    compose(t, extras, sourceHolder.text, contextValues, answerValues, truncatedLabels);

  let prompt = render();

  if (prompt.length > limitChars) {
    const candidates: Array<{ getLength: () => number; cut: (remove: number) => void }> = [];

    if (sourceHolder.text) {
      candidates.push({
        getLength: () => sourceHolder.text.length,
        cut: (remove) => {
          sourceHolder.text = shorten(sourceHolder.text, remove);
          truncatedLabels.set('__source', 'El documento fuente');
        }
      });
    }

    const sortedContexts = [...contextValues.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [tag] of sortedContexts) {
      const value = contextValues.get(tag) ?? '';
      if (!value) continue;
      let current = value;
      candidates.push({
        getLength: () => current.length,
        cut: (remove) => {
          current = shorten(current, remove);
          contextValues.set(tag, current);
          truncatedLabels.set(tag, `El bloque de contexto "${tag}"`);
        }
      });
    }

    const answerOrder = answerValues
      .map((text, index) => ({ index, length: text.length }))
      .sort((a, b) => b.length - a.length);
    for (const { index } of answerOrder) {
      if (!answerValues[index]) continue;
      candidates.push({
        getLength: () => answerValues[index].length,
        cut: (remove) => {
          answerValues[index] = shorten(answerValues[index], remove);
          truncatedLabels.set(
            `answer:${index}`,
            `La respuesta del estudiante ${answers[index]?.student?.trim() || index + 1}`
          );
        }
      });
    }

    // Re-render after every cut until it fits or nothing else can be shortened.
    for (let pass = 0; pass < 8 && prompt.length > limitChars; pass++) {
      const excess = prompt.length - limitChars;
      let removed = 0;
      for (const candidate of candidates) {
        if (removed >= excess) break;
        const available = candidate.getLength();
        if (available === 0) continue;
        const take = Math.min(available, excess - removed);
        if (take <= 0) continue;
        candidate.cut(take);
        removed += take;
      }
      if (removed === 0) break;
      prompt = render();
    }

    for (const label of truncatedLabels.values()) {
      warnings.push(`${label} se recortó para respetar el límite de tokens del modelo.`);
    }

    if (prompt.length > limitChars) {
      warnings.push(
        `El contenido supera la ventana del modelo (~${contextWindow} tokens) incluso después de recortar. Acortá el documento o dividí las respuestas en varios lotes.`
      );
    }
  }

  const estimatedTokens = estimateTokens(prompt);

  return {
    prompt,
    estimatedTokens,
    contextWindow,
    reserveTokens,
    truncated: truncatedLabels.size > 0,
    warnings
  };
}

function shorten(content: string, removeChars: number): string {
  if (removeChars <= 0) return content;
  const markerIndex = content.indexOf(TRUNCATION_MARKER);
  const body = markerIndex >= 0 ? content.slice(0, markerIndex).trimEnd() : content;
  const keep = Math.max(0, body.length - removeChars);
  if (keep === 0) return TRUNCATION_MARKER;
  return `${body.slice(0, keep).trimEnd()}\n${TRUNCATION_MARKER}`;
}

function compose(
  t: Template,
  extras: PromptExtras,
  sourceText: string,
  contextValues: Map<string, string>,
  answerValues: string[],
  truncatedLabels: Map<string, string>
): string {
  const header =
    'Actuá como un revisor y analizador de textos. Calificá la siguiente tarea enviada a los estudiantes.\n';

  const activity = renderActivity(extras);

  const tarea = (t.instruction ?? '').trim() ? `<tarea>\n${escapeXml(t.instruction.trim())}\n</tarea>\n` : '';

  const sourceDocument = sourceText
    ? `<documento_fuente>\n${escapeXml(maybeMarker(sourceText, truncatedLabels.has('__source')))}\n</documento_fuente>\n`
    : '';

  const contextBlocks = [...contextValues.entries()]
    .map(([tag, raw]) => {
      if (!tag || !raw) return '';
      const value = maybeMarker(raw, truncatedLabels.has(tag));
      return `<${tag}>\n${escapeXml(value)}\n</${tag}>\n`;
    })
    .filter(Boolean)
    .join('\n');

  const answersBlocks = answerValues
    .map((value, i) => {
      if (!value) return '';
      const tag = `${t.answerTag || 'respuesta'}_${i + 1}`;
      const text = maybeMarker(value, truncatedLabels.has(`answer:${i}`));
      return `<${tag}>\n${escapeXml(text)}\n</${tag}>\n`;
    })
    .filter(Boolean)
    .join('\n');

  const criteriaList = t.criteria.map((c, i) => renderCriterion(c, i + 1)).join('\n');

  const rubrica = `<rubrica>\n${criteriaList}\n</rubrica>\n`;

  const attachedDocument = extras.deliveryDocument
    ? `<documento_adjunto>
La entrega original viaja adjunta como archivo PDF. Leela completa: las imágenes, gráficos, tablas, fórmulas y diagramas que el texto de arriba no puede representar están solo ahí. Si el texto extraído y el PDF difieren, el PDF es la fuente de verdad.
</documento_adjunto>
`
    : '';

  const instructions = `
Devolvé **únicamente** un objeto JSON válido que respete el esquema solicitado.
Para cada respuesta, devolvé en el mismo orden recibido una entrada con:
- indice (1-based)
- estudiante
- criterios: arreglo con { criterio: nombre exacto del criterio, puntaje: número entre 0 y el máximo del criterio, retroalimentacion: texto breve claro }
- resumen: una frase de cierre para el estudiante

Si un criterio define niveles, elegí el nivel que corresponda y usá sus puntos exactos.
No agregues texto adicional fuera del JSON.
`.trim();

  return [header, activity, tarea, sourceDocument, contextBlocks, answersBlocks, attachedDocument, rubrica, instructions]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

function renderActivity(extras: PromptExtras): string {
  const lines: string[] = [];
  const title = (extras.title ?? '').trim();
  const description = (extras.description ?? '').trim();
  const objectives = (extras.objectives ?? '').trim();
  const instructions = (extras.instructions ?? '').trim();
  if (!title && !description && !objectives && !instructions) return '';

  if (title) lines.push(`Título: ${escapeXml(title)}`);
  if (description) lines.push(`Descripción: ${escapeXml(description)}`);
  if (objectives) lines.push(`Objetivos:\n${escapeXml(objectives)}`);
  if (instructions) lines.push(`Instrucciones de la actividad:\n${escapeXml(instructions)}`);
  return `<actividad>\n${lines.join('\n')}\n</actividad>\n`;
}

function renderCriterion(c: Template['criteria'][number], position: number): string {
  const description = c.description?.trim() ? ` (${c.description.trim()})` : '';
  const weight = c.weight && c.weight !== 1 ? ` | Peso: ${c.weight}` : '';
  const base = `Criterio ${position}: ${c.name}${description} | Puntos máximos: ${c.maxPoints}${weight}`;
  if (!c.levels || c.levels.length === 0) return base;
  const levels = [...c.levels]
    .sort((a, b) => a.points - b.points)
    .map((l) => `${l.label}=${l.points}${l.description ? ` (${l.description})` : ''}`)
    .join(', ');
  return `${base} | Niveles: ${levels}`;
}

function maybeMarker(value: string, wasTruncated: boolean): string {
  if (!wasTruncated || value.includes(TRUNCATION_MARKER)) return value;
  return `${value}\n${TRUNCATION_MARKER}`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
