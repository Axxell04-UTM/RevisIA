# F7 — /revisar absorbe a /evaluar

Objetivo: una sola vista de revisión. `/revisar/[id]` (por actividad) suma la rúbrica y la calificación por entrega; `/evaluar/[id]` desaparece.
Sin git en el workspace: la evidencia son los archivos tocados y `pnpm test` / `pnpm check`.
Test runner: `pnpm test` (vitest + PGlite).

## Specs

- **S1** — "Tengo dos rutas en la que ocurren cosas que debería ser una sola /evaluar/[id] y /revisar/[id] lleva las opciones de rúbrica y calificaciones a la vista de /revisar/[id]". `/revisar/[id]` es la única vista de revisión y calificación; `/evaluar/[id]` se elimina del código y del árbol de rutas.
- **S2** — La rúbrica de la actividad se muestra en `/revisar/[id]` en **solo lectura**: nombre, criterios (puntaje máximo, peso, niveles), total posible y el material de contexto de la actividad. Editarla sigue siendo tarea de `/actividades/[id]`.
- **S3** — Se califican las **entregas cargadas**: el texto extraído del documento principal de cada entrega, con el estudiante vinculado (o el nombre detectado) como etiqueta. No queda entrada manual de respuestas ni pegado masivo.
- **S4** — La calificación se **persiste por entrega**: filas en `grade` (una por criterio) y `submission.total_points`, `max_points`, `grading_summary`, `model`, `prompt_tokens`, `completion_tokens`, `graded_at`, `status = 'graded'`. Volver a calificar reemplaza la nota anterior, nunca la duplica.
- **S5** — Una actividad sin `rubric_id` no ofrece calificación: muestra el aviso y un enlace a `/actividades/[id]` para asignar rúbrica.
- **S6** — No queda ninguna referencia a `/evaluar` en la app: lista de plantillas, editor de plantilla y editor de actividad apuntan a `/revisar/[activityId]` o pierden el botón.

## Tasks

| ID | Tarea | Specs | Estado | Evidencia |
|----|-------|-------|--------|-----------|
| T1 | Migración `0011`: `submission.grading_summary` | S4 | done | `drizzle/0011_submission_grading.sql`, `schema/grading.ts` |
| T2 | Tipos: `Submission.gradingSummary`, `SubmissionGrade`, `SubmissionListItem.grades` | S4 | done | `domain/types.ts` |
| T3 | Repo: `saveSubmissionGrades` + `grades` en `listSubmissions` + `activityId`/`studentName`/`rosterName` en `getSubmissionMainFile` | S3,S4 | done | `repositories/submission.ts` |
| T4 | Tests de repo (PGlite): persistir, re-calificar, listar, criterio ajeno, docente ajeno | S3,S4 | done | `tests/repositories/submission-grading.test.ts`, 6 tests |
| T5 | Servicio `gradeSubmission` (construye prompt, llama al modelo, guarda) | S3,S4 | done | `server/grading.ts` |
| T6 | API `POST /api/submissions/[id]/grade` | S3,S4 | done | `api/submissions/[id]/grade/+server.ts` |
| T7 | `/revisar/[id]`: rúbrica en solo lectura, nota por fila, detalle, calificar pendientes, aviso sin rúbrica | S2,S5 | done | `revisar/[id]/+page.svelte`, `+page.server.ts` |
| T8 | Borrar `/evaluar/[id]` y corregir los 3 links | S1,S6 | done | ruta borrada; `plantillas/+page.svelte`, `plantillas/[id]/+page.svelte`, `ActivityEditor.svelte` |
| T9 | `pnpm test` + `pnpm check` | todas | done | 293/293 tests; `check`: 19 errores preexistentes en `admin/*`, ninguno en archivos tocados |

## Log

- **L1** (request original, verbatim): "Tengo dos rutas en la que ocurren cosas que debería ser una sola /evaluar/[id] y /revisar/[id] lleva las opciones de rúbrica y calificaciones a la vista de /revisar/[id], hazme las preguntas que creas conveniente"
- **L2** (decisiones del usuario): respuestas = entregas cargadas; nota = persistida por entrega; rúbrica = solo lectura; `/evaluar` = borrarla; sin rúbrica = aviso + link al editor.
- **L3** (hallazgos de exploración): `grade` ya existe con FK a `rubric_criterion` y `submission` ya tiene `total_points`/`max_points`/`model`/`prompt_tokens`/`completion_tokens`/`graded_at`; solo falta la columna del resumen y el cableado. `normalizeGrades` devuelve `criterionId` = id real de la rúbrica, así que se puede persistir sin mapeo. `activity.contexts` ya guarda el material con contenido, así que el `?activityId=` de `/evaluar` deja de ser necesario. El journal de drizzle está atrasado (0008/0010 se escribieron a mano); seguimos esa convención.
- **L4** (decidido en implementación): la calificación vive en el servidor. El endpoint no recibe prompt ni rúbrica: lee la entrega, el texto extraído, los contextos y la plantilla, así que el cliente no puede calificar contra una rúbrica inventada. Un fallo no toca la nota anterior.
- **L5** (decidido en implementación): `Calificar pendientes` usa el mismo pool acotado (3) que el procesamiento de archivos, y cada entrega es una llamada propia: un error queda en su fila sin cancelar el resto.
- **L6** (colateral): `/api/grade` quedó sin consumidores al borrar `/evaluar` y no tenía guard de auth (los `+layout.server.ts` no corren para endpoints). Se eliminó.
- **L7** (colateral): `tests/auth/guards.test.ts` fallaba de antes porque el guard de admin lee `url.pathname` y el test no pasaba `url`. Se agregó la URL al evento del test; no cambia comportamiento.
- **L8** (verificación): `pnpm test` → 21 archivos, 293 tests en verde (incluye 6 nuevos de persistencia de notas). `pnpm check` → 19 errores preexistentes en `admin/*`, ninguno en los archivos de esta feature. Sin verificación en navegador: no hay Postgres local ni sesión autenticada en este entorno.
