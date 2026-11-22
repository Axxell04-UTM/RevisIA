# F2 — Procesar archivos pendientes en cola (sin agrupar por selección)

Objetivo: que la selección múltiple de archivos pendientes en `/revisar/[id]` sirva solo para procesarlos en lote, con una entrega individual y extracción de texto por archivo, en cola. Branch: sin git. Runner: `pnpm vitest run`, `pnpm check`, `pnpm build`.

## Specs

- S1: La selección múltiple de archivos pendientes en `/revisar/[id]` solo arma una cola de procesamiento. Nunca crea una entrega grupal ni vincula los archivos entre sí.
- S2: Procesar un archivo pendiente crea SU PROPIA entrega individual (`kind='individual'`, un solo `fileId`) y extrae su texto con el extractor existente.
- S3: El procesamiento de un lote es individual y secuencial (en cola): un archivo por invocación, uno detrás de otro, para permitir procesar grandes volúmenes en una sola orden. Un archivo que falla no cancela el resto.
- S4: `POST /api/activities/[id]/files/[fileId]/process` procesa un archivo de la actividad del docente. Un archivo ya vinculado a una entrega viva de esa actividad solo se re-extrae (reintento); un archivo de otra actividad o de otro docente responde 404.
- S5: La entrega grupal se arma después, desde Integrantes: una entrega con más de un integrante es `kind='group'`; con uno o ninguno es `kind='individual'`.
- S6: La tabla de entregas permite reintentar la extracción de texto de un archivo cuyo estado no es `ok`, con el mismo endpoint de S4.
- S7: Al procesar, el archivo deja de aparecer como pendiente y la entrega aparece en la tabla; un error de extracción se informa por archivo sin abortar la cola.
- S8: El lote usa concurrencia acotada (máximo 3 archivos a la vez): el pool nunca supera el límite, respeta el orden de inicio, procesa todos los archivos aunque alguno falle y devuelve los fallos con su archivo.

## Tasks

- T1 (S4,S5) `[x]` repo: `getFileProcessingState` + derivación de `kind` en `setMembers`. Tests primero.
- T2 (S4) `[x]` ruta `POST /api/activities/[id]/files/[fileId]/process`.
- T3 (S1,S2,S3,S7) `[x]` panel de pendientes: selección = cola, acciones "Procesar seleccionados" / "Procesar todos" / "Procesar" por fila, progreso y errores por archivo.
- T4 (S6) `[x]` reintento de texto por archivo en la tabla de entregas.
- T5 (S1) `[x]` copy y comentarios: se elimina el lenguaje de "agrupar"/"entrega grupal" por selección.
- T6 (S8) `[x]` `runConcurrently` en `src/lib/domain/pool.ts` con tests; `processFiles` procesa de a 3 como máximo.

## Log

- L1 (user): "Mejora el flujo de /revisar/[id] y la mecánica de agrupar para procesar, lo de agrupar está siendo un problema, la selección múltiple de archivos únicamente debe servir para procesar todos esos archivos a la vez, pero esto no debe relacionarlos a nivel grupal, pero en cuanto al procesamiento del texto de cada archivo esto debe ser individual pero en cola, para permitir procesar grandes volúmenes en una sola orden"
- L2 (agente, decisión del usuario vía pregunta): "Procesar" = cada archivo seleccionado crea su propia entrega individual y extrae su texto, en cola; la entrega grupal se arma después desde Integrantes sobre un único archivo.
- L3 (agente, hallazgo): `ROADMAP.md` 2.11 ya define el trabajo grupal como "varios integrantes → una sola entrega y una sola calificación"; agrupar por selección de archivos contradecía esa definición.
- L4 (agente, alcance): `createSubmission` sigue aceptando varios archivos para no romper datos/contratos existentes, pero la pantalla de revisión nunca envía más de uno.
- L5 (agente, implementación): `getFileProcessingState` distingue `pending` (crear entrega individual y extraer) de `linked` (solo re-extraer, para reintentos) y devuelve `null` para archivos de otra actividad u otro docente. `setMembers` deriva `kind` del conteo de integrantes. La cola corre en el cliente, un `fetch` por archivo y en orden; el estado por archivo queda en DB, así que cerrar la pestaña no pierde lo ya procesado: los archivos restantes siguen pendientes al reabrir.
- Evidencia: `src/lib/server/repositories/submission.ts` (`getFileProcessingState`, `kind` en `setMembers`), `src/routes/(app)/api/activities/[id]/files/[fileId]/process/+server.ts`, `src/routes/(app)/revisar/[id]/+page.svelte` (cola, progreso, errores por archivo, reintento de texto), `tests/repositories/submission.test.ts` (5 tests nuevos).
- Verificación: RED observado con 5 tests fallando (24 existentes verdes) antes de implementar; después `pnpm vitest run tests/repositories/submission.test.ts` 29/29; suite completa 282/283 (falla preexistente `tests/auth/guards.test.ts > admin layout guard > sends authenticated teachers back to the app root`); `pnpm check` 19 errores preexistentes, sin errores nuevos ni en la ruta nueva; `pnpm build` OK.
- Pendiente conocido: el endpoint nuevo no se ejercitó contra R2/Neon reales (los tests cubren el estado del repo, no la descarga/extracción). Probar con un ZIP real antes del demo.
- L6 (user): "Si estaría bien probar con algo de concurrencia"
- L7 (agente, implementación): se extrajo `runConcurrently(items, limit, worker)` a `src/lib/domain/pool.ts`: arranca en orden, mantiene como máximo `limit` en vuelo, captura el rechazo de cada ítem y sigue con el resto. `processFiles` usa tope 3; el progreso ahora cuenta terminados (no el índice del archivo actual) porque hay varios en vuelo.
- Verificación (concurrencia): RED del pool (módulo inexistente); GREEN 4/4 en `tests/domain/pool.test.ts` (todos los ítems una vez, tope respetado, un fallo no corta el lote, lista vacía); `pool.test.ts` + `submission.test.ts` 33/33; suite 286/287 (misma falla preexistente de guards); `pnpm check` 19 errores preexistentes; `pnpm build` OK.
