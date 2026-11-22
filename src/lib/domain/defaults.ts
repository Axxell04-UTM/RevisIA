import { slugify } from './types.js';
import type { Template, Criterion, RubricLevel } from './types.js';

export function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultLevels(maxPoints: number): RubricLevel[] {
  return [
    { id: makeId(), label: 'Excelente', points: maxPoints, description: 'Cumple completamente', position: 0 },
    { id: makeId(), label: 'Bueno', points: Math.round(maxPoints / 2), description: 'Cumple parcialmente', position: 1 },
    { id: makeId(), label: 'Deficiente', points: 0, description: 'No cumple', position: 2 }
  ];
}

function criterion(
  name: string,
  description: string,
  maxPoints: number
): Criterion {
  return {
    id: makeId(),
    name,
    description,
    maxPoints,
    weight: 1,
    levels: defaultLevels(maxPoints)
  };
}

function template(
  input: Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'criteria' | 'contexts'> & {
    criteria: Criterion[];
    contexts: { tag: string; label: string; placeholder: string }[];
  }
): Template {
  const now = Date.now();
  return {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    ...input,
    contexts: input.contexts.map((c) => ({ id: makeId(), ...c }))
  };
}

/** Sum of the criterion maxima; every preset keeps this inside its own total. */
export function templateTotal(row: Template): number {
  return row.criteria.reduce((sum, c) => sum + c.maxPoints, 0);
}

export function createStarterTemplate(): Template {
  return template({
    name: 'Resumen de ensayo',
    instruction:
      'Considerando el ensayo proporcionado, deberá realizar un resumen en un párrafo entre 3 y 5 líneas.',
    answerTag: slugify('resumen_estudiante'),
    answerLabel: 'Resumen',
    contexts: [
      { tag: 'ensayo', label: 'Ensayo', placeholder: 'Pegá el texto base del ensayo aquí...' }
    ],
    criteria: [
      criterion(
        'Claridad y precisión en la idea principal',
        'El resumen identifica y comunica con exactitud la tesis central.',
        5
      ),
      criterion(
        'Inclusión de detalles relevantes del texto base',
        'Incorpora los elementos clave del ensayo sin introducir información ajena.',
        5
      ),
      criterion(
        'Uso adecuado del lenguaje y gramática',
        'Redacción clara, correcta y coherente, con escasa (o nula) presencia de errores.',
        5
      ),
      criterion(
        'Originalidad en la redacción',
        'El resumen está redactado con propias palabras y no copia literalmente.',
        5
      )
    ]
  });
}

export function createLabReportTemplate(): Template {
  return template({
    name: 'Informe de laboratorio',
    instruction:
      'A partir de la guía del trabajo práctico y de los datos registrados, redactá un informe de laboratorio que describa el objetivo, el procedimiento, los resultados y su interpretación.',
    answerTag: slugify('informe_estudiante'),
    answerLabel: 'Informe',
    contexts: [
      {
        tag: 'consigna',
        label: 'Guía del trabajo práctico',
        placeholder: 'Pegá la consigna y el objetivo del práctico...'
      },
      {
        tag: 'datos',
        label: 'Datos y mediciones',
        placeholder: 'Pegá la tabla de datos obtenidos en el laboratorio...'
      }
    ],
    criteria: [
      criterion(
        'Objetivo y fundamento teórico',
        'Explica qué se busca comprobar y con qué marco teórico lo sostiene.',
        4
      ),
      criterion(
        'Metodología y procedimiento',
        'Describe materiales, pasos y condiciones experimentales de forma reproducible.',
        4
      ),
      criterion(
        'Registro y análisis de resultados',
        'Presenta los datos obtenidos, calcula lo que corresponde y los interpreta.',
        6
      ),
      criterion(
        'Conclusiones',
        'Responde al objetivo y distingue lo observado de lo inferido.',
        4
      ),
      criterion(
        'Presentación y referencias',
        'Formato, claridad, unidades correctas y fuentes citadas.',
        2
      )
    ]
  });
}

export function createProblemSolvingTemplate(): Template {
  return template({
    name: 'Resolución de problema',
    instruction:
      'Resolvé el problema planteado mostrando el razonamiento completo: interpretación, estrategia, desarrollo y verificación del resultado.',
    answerTag: slugify('resolucion_estudiante'),
    answerLabel: 'Resolución',
    contexts: [
      {
        tag: 'enunciado',
        label: 'Enunciado',
        placeholder: 'Pegá el enunciado del problema...'
      }
    ],
    criteria: [
      criterion(
        'Interpretación del enunciado',
        'Identifica los datos, las incógnitas y las restricciones del problema.',
        3
      ),
      criterion(
        'Planteo y estrategia',
        'Elige un camino de resolución válido y justifica por qué lo es.',
        5
      ),
      criterion(
        'Desarrollo y cálculo',
        'Aplica correctamente los pasos, con unidades y sin errores de cuenta.',
        7
      ),
      criterion(
        'Verificación del resultado',
        'Comprueba que la respuesta sea razonable y responde exactamente lo pedido.',
        3
      ),
      criterion(
        'Claridad de la exposición',
        'Orden, notación y legibilidad del procedimiento.',
        2
      )
    ]
  });
}

export function createEmptyTemplate(): Template {
  return template({
    name: 'Nueva rúbrica',
    instruction: '',
    answerTag: slugify('respuesta'),
    answerLabel: 'Respuesta',
    contexts: [
      { tag: 'contexto', label: 'Contexto', placeholder: 'Texto de referencia...' }
    ],
    criteria: [criterion('Claridad', '', 5)]
  });
}

/** One starting point offered when the teacher creates a rubric. */
export type StarterPreset = {
  /** Stable identifier for the UI (never sent to the server). */
  key: string;
  name: string;
  /** One line explaining when this preset fits. */
  description: string;
  create: () => Template;
};

/**
 * Starting points, in the order the picker shows them: the blank one first
 * because it is the honest default, then the three concrete rubrics.
 */
export const STARTER_PRESETS: StarterPreset[] = [
  {
    key: 'en-blanco',
    name: 'En blanco',
    description: 'Un criterio mínimo para armar la rúbrica desde cero.',
    create: createEmptyTemplate
  },
  {
    key: 'resumen-ensayo',
    name: 'Resumen de ensayo',
    description: '4 criterios de comprensión y redacción sobre un ensayo base.',
    create: createStarterTemplate
  },
  {
    key: 'informe-laboratorio',
    name: 'Informe de laboratorio',
    description: '5 criterios: fundamento, método, resultados, conclusiones y presentación.',
    create: createLabReportTemplate
  },
  {
    key: 'resolucion-problema',
    name: 'Resolución de problema',
    description: '5 criterios: interpretación, planteo, desarrollo, verificación y claridad.',
    create: createProblemSolvingTemplate
  }
];
