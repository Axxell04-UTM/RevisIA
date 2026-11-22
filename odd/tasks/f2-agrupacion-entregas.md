# F2 — Agrupación de archivos en entregas (panel de pendientes)

Objetivo: que los archivos extraídos del ZIP aparezcan en `/revisar/[id]` como pendientes de agrupar y el docente pueda convertirlos en entregas desde ahí. Branch: sin git. Runner: `pnpm test`, `pnpm check`, `pnpm build`.

## Specs

- S1: Los archivos extraídos del ZIP quedan ligados a la actividad con `file.activity_id`. Un archivo sin actividad sigue siendo válido para las rutas existentes.
- S2: `GET /api/activities/[id]/pending-files` devuelve los archivos `uploadContext='submission'` de esa actividad que todavía no pertenecen a una entrega viva, deduplicados por `sha256` (se conserva el más reciente).
- S3: El docente selecciona uno o más archivos pendientes y crea UNA entrega: `POST /api/activities/[id]/submissions` con `{ fileIds }`. Un archivo seleccionado = entrega individual; varios = grupal.
- S4: Se rechaza crear una entrega con un archivo de otra actividad o ya vinculado a una entrega viva. Un archivo cuyo `sha256` ya es una entrega viva de la actividad deja de aparecer como pendiente.
- S5: Al borrar una entrega (soft delete), sus archivos vuelven a la lista de pendientes.
- S6: Los archivos ya extraídos antes del cambio se backfillean con la actividad del ZIP vigente.

## Tasks

- T1 (S1) `[x]` schema `activity_file` (tabla de vínculo) + migración `0010_file_activity_link.sql` + ZIP ingest la llena.
- T2 (S2,S4) `[x]` repo `listPendingSubmissionFiles` y guardas en `createSubmission`.
- T3 (S3) `[x]` `GET /api/activities/[id]/pending-files`, `POST /api/activities/[id]/submissions`.
- T4 (S2,S3,S5) `[x]` UI panel de pendientes en `/revisar/[id]` con selección múltiple y creación de entrega.
- T5 (S6) `[x]` backfill en Neon de los 10 archivos del ZIP vigente.
- T6 `[x]` tests de repo para pendientes, dedupe, aislamiento por actividad y vuelta al borrar.

## Log

- L1 (user): "En la vista de /actividades/[id] si consta y se mantienen los archivos de actividades por calificar, pero en /revisar/[id] no se refleja nada 'No hay entregas para esta actividad.'"
- L2 (agente, diagnóstico): el ZIP solo inserta filas en `file`; `createSubmission` nunca se llama y `file` no tiene vínculo con la actividad. `/revisar` solo lee `submission`, que está vacía. Elegido el panel de pendientes + agrupación (decisión del usuario).
- L3 (agente, corrección): el primer intento puso `file.activity_id` con FK a `activity`, lo que crea un ciclo `file ↔ activity` y rompe la inferencia de tipos de Drizzle (`implicitly has type 'any'`). Se reemplazó por la tabla `activity_file (activity_id, file_id)`.
- Evidencia: `drizzle/0010_file_activity_link.sql`, `src/lib/server/db/schema/academic.ts` (`activityFile`), `src/lib/server/repositories/submission.ts` (`listPendingSubmissionFiles`, guardas de actividad/entrega viva y `studentName` sugerido desde el nombre Moodle), `src/routes/(app)/api/activities/[id]/pending-files/+server.ts`, `src/routes/(app)/api/activities/[id]/submissions/+server.ts` (POST), `src/routes/(app)/api/uploads/zip/+server.ts` (inserta `activity_file`), `src/routes/(app)/revisar/[id]/+page.svelte` (panel de pendientes y recarga cruzada), `src/lib/domain/types.ts` (`PendingSubmissionFile`), tests en `tests/repositories/submission.test.ts`.
- Verificación: `pnpm vitest run tests/repositories/submission.test.ts` 24/24; suite completa 277/278 (falla preexistente `tests/auth/guards.test.ts > admin layout guard`); `pnpm build` OK. Neon: `activity_file` creada, 10 archivos ligados, `listPendingSubmissionFiles()` real devuelve los 10 PDFs y 0 entregas.
- Pendiente conocido: `pnpm check` reporta 19 errores preexistentes en `admin/*` y `activity.ts`, ajenos a este cambio; los archivos tocados no aportan errores nuevos.
