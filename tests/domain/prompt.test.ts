import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_RESERVE_TOKENS,
  buildPrompt,
  estimateTokens,
  renderPrompt
} from '../../src/lib/domain/prompt.js';
import type { Template } from '../../src/lib/domain/types.js';

/**
 * Prompt v2 render. The grading prompt is the only place where the academic
 * context (activity, source document, rubric) reaches the model, so these tests
 * pin the wire format: which blocks appear, in what order, that user text is
 * escaped, and that the token budget truncates instead of silently overflowing.
 */

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl-1',
    name: 'Resumen',
    instruction: 'Resumí el ensayo en 3 a 5 líneas.',
    answerTag: 'resumen',
    answerLabel: 'Resumen',
    contexts: [
      { id: 'ctx-1', tag: 'ensayo', label: 'Ensayo', placeholder: '' },
      { id: 'ctx-2', tag: 'pautas', label: 'Pautas', placeholder: '' }
    ],
    criteria: [
      {
        id: 'c-1',
        name: 'Claridad',
        description: 'Idea principal clara',
        maxPoints: 5,
        weight: 1,
        levels: [
          { id: 'l-1', label: 'Excelente', points: 5, description: 'Cumple', position: 0 },
          { id: 'l-2', label: 'Bueno', points: 2, description: 'Parcial', position: 1 },
          { id: 'l-3', label: 'Deficiente', points: 0, description: '', position: 2 }
        ]
      },
      { id: 'c-2', name: 'Originalidad', description: '', maxPoints: 5, weight: 2, levels: [] }
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

const answers = [{ student: 'Ana', text: 'Un resumen cualquiera.' }];

describe('buildPrompt — academic context', () => {
  it('renders the activity block with title, description, objectives and instructions', () => {
    const { prompt } = buildPrompt(template(), {}, answers, {
      extras: {
        title: 'Ensayo sobre redes',
        description: 'Trabajo práctico 2',
        objectives: 'Evaluar la comprensión lectora',
        instructions: 'Leé el ensayo y resumilo'
      }
    });

    expect(prompt).toContain('<actividad>');
    expect(prompt).toContain('Título: Ensayo sobre redes');
    expect(prompt).toContain('Descripción: Trabajo práctico 2');
    expect(prompt).toContain('Objetivos:\nEvaluar la comprensión lectora');
    expect(prompt).toContain('Instrucciones de la actividad:\nLeé el ensayo y resumilo');
    expect(prompt).toContain('</actividad>');
  });

  it('omits the activity block when there is no academic context', () => {
    const { prompt } = buildPrompt(template(), {}, answers);
    expect(prompt).not.toContain('<actividad>');
  });

  it('renders the source document and escapes XML special characters', () => {
    const { prompt } = buildPrompt(template(), {}, answers, {
      extras: { sourceDocument: 'Texto con <etiquetas> & símbolos' }
    });

    expect(prompt).toContain('<documento_fuente>');
    expect(prompt).toContain('Texto con &lt;etiquetas&gt; &amp; símbolos');
    expect(prompt).toContain('</documento_fuente>');
  });

  it('keeps the legacy template instruction inside <tarea>', () => {
    const { prompt } = buildPrompt(template(), {}, answers);
    expect(prompt).toContain('<tarea>\nResumí el ensayo en 3 a 5 líneas.\n</tarea>');
  });
});

describe('buildPrompt — contexts and answers', () => {
  it('renders filled context blocks and drops empty ones', () => {
    const { prompt } = buildPrompt(template(), { ensayo: 'Texto base', pautas: '   ' }, answers);
    expect(prompt).toContain('<ensayo>\nTexto base\n</ensayo>');
    expect(prompt).not.toContain('<pautas>');
  });

  it('renders context blocks the activity sends even when the rubric declares none', () => {
    const { prompt } = buildPrompt(
      template({ contexts: [] }),
      { texto_base: 'Fuente de la actividad' },
      answers
    );
    expect(prompt).toContain('<texto_base>\nFuente de la actividad\n</texto_base>');
  });

  it('numbers answers with the configured answer tag', () => {
    const { prompt } = buildPrompt(template(), {}, [
      { student: 'Ana', text: 'Primera' },
      { student: 'Beto', text: 'Segunda' }
    ]);
    expect(prompt).toContain('<resumen_1>\nPrimera\n</resumen_1>');
    expect(prompt).toContain('<resumen_2>\nSegunda\n</resumen_2>');
  });
});

describe('buildPrompt — rubric', () => {
  it('lists criteria with max points, weight and levels', () => {
    const { prompt } = buildPrompt(template(), {}, answers);
    expect(prompt).toContain('Criterio 1: Claridad (Idea principal clara) | Puntos máximos: 5');
    expect(prompt).toContain('Niveles: Deficiente=0, Bueno=2 (Parcial), Excelente=5 (Cumple)');
    expect(prompt).toContain('Criterio 2: Originalidad | Puntos máximos: 5 | Peso: 2');
  });

  it('omits the levels suffix when a criterion has no levels', () => {
    const { prompt } = buildPrompt(template(), {}, answers);
    const originalityLine = prompt.split('\n').find((line) => line.includes('Criterio 2:')) ?? '';
    expect(originalityLine).not.toContain('Niveles:');
  });
});

describe('buildPrompt — token budget', () => {
  it('estimates tokens from characters', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('truncates the source document first and reports a warning', () => {
    const bigDocument = 'x'.repeat(4_000);
    const built = buildPrompt(template(), { ensayo: 'texto base' }, answers, {
      extras: { sourceDocument: bigDocument },
      contextWindow: 1_000,
      reserveTokens: 200
    });

    expect(built.truncated).toBe(true);
    expect(built.warnings.some((w) => w.includes('documento fuente'))).toBe(true);
    // The context block and the answer are smaller than the document, so they survive.
    expect(built.prompt).toContain('<ensayo>\ntexto base\n</ensayo>');
    expect(built.prompt).toContain('Un resumen cualquiera.');
    // The prompt must fit the usable budget.
    expect(built.prompt.length).toBeLessThanOrEqual((1_000 - 200) * CHARS_PER_TOKEN);
    expect(built.estimatedTokens).toBeLessThanOrEqual(1_000 - 200);
  });

  it('does not truncate when everything fits', () => {
    const built = buildPrompt(template(), { ensayo: 'texto base' }, answers, {
      extras: { sourceDocument: 'documento corto' }
    });

    expect(built.truncated).toBe(false);
    expect(built.warnings).toEqual([]);
    expect(built.prompt).toContain('documento corto');
  });

  it('warns when the budget cannot be met even after truncating everything', () => {
    const built = buildPrompt(template(), { ensayo: 'y'.repeat(200) }, answers, {
      contextWindow: 100,
      reserveTokens: 90
    });

    expect(built.warnings.some((w) => w.includes('supera la ventana'))).toBe(true);
  });

  it('exposes the default budget numbers', () => {
    const built = buildPrompt(template(), {}, answers);
    expect(built.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(built.reserveTokens).toBe(DEFAULT_RESERVE_TOKENS);
  });
});

describe('renderPrompt — compatibility', () => {
  it('still returns a plain string and forwards extras', () => {
    const prompt = renderPrompt(template(), {}, answers, { objectives: 'Objetivo X' });
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('Objetivos:\nObjetivo X');
  });
});
