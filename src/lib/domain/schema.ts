export const GRADE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluaciones'],
  properties: {
    evaluaciones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['indice', 'estudiante', 'criterios', 'resumen'],
        properties: {
          indice: { type: 'integer', minimum: 1 },
          estudiante: { type: 'string' },
          criterios: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['criterio', 'puntaje', 'retroalimentacion'],
              properties: {
                criterio: { type: 'string' },
                puntaje: { type: 'number' },
                retroalimentacion: { type: 'string' },
              },
            },
          },
          resumen: { type: 'string' },
        },
      },
    },
  },
} as const;
