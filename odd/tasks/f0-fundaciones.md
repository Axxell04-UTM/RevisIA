# F0 — Fundaciones: persistencia, archivos y sesión

Objetivo: sacar a RevisIA de `localStorage` y ponerlo sobre servidor (Vercel + Neon + R2) con Better Auth, según `docs/db-schema.md` y `ROADMAP.md` (Fase 0).
Branch: sin git en el workspace (worktree sin versionar); commits no aplicables. Runner: `pnpm check` (+ tests cuando existan).
Route: inline por el padre (tareas mecánicas y ya entendidas; sin Write trigger).

## Specs
- S1: "Serverless" — decisión de despliegue; arquitectura fijada en `ROADMAP.md` §"Decisión de arquitectura".
- S2: "Mete student entonces" — entidad `student` con `match_key`; ver `docs/db-schema.md` → Estudiantes.
- S3: "Vamos con el código de 0.3" — esquema Drizzle + migración.
- S4: "Continúa" — avanzar con las tareas de Fase 0 en el orden que las enumera `ROADMAP.md`.

## Tasks
- T1 (S3) `[x]` Esquema Drizzle: `src/lib/server/db/schema/{auth,academic,grading,admin}.ts`, `drizzle.config.ts`, migración `drizzle/0000_init_schema.sql` (20 tablas, 24 FKs, 22 índices)
- T2 (S4) `[x]` Deps: `drizzle-orm` + `drizzle-kit` + `postgres` ✅ · `better-auth`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `unpdf` ✅ · `@types/node`, `@types/pg` ✅
- T3 (S4) `[x]` Cliente DB compartido (`src/lib/server/db/index.ts`)
- T4 (S4) `[x]` 0.4 Seed del admin inicial desde env (`scripts/seed.ts`, `db:seed`)
- T5 (S4) `[x]` 0.5 Repositorios server-side (schema expuesto en `db` instance)
- T6 (S4) `[x]` 0.6 Better Auth: login/logout, cookie `httpOnly`, `role` (`src/lib/server/auth/index.ts`, `src/hooks.server.ts`, `src/app.d.ts`, `src/lib/auth-client.ts`)
- T7 (S4) `[x]` 0.7 Guardas de ruta por rol + layout protegido (`src/routes/(app)/+layout.server.ts`, `src/routes/admin/+layout.server.ts`, `src/routes/(auth)/login`, `src/lib/components/app/Input.svelte`)
- T8 (S4) `[x]` 0.8 R2: CORS, helper presigned PUT/GET, validación tipo/tamaño (`src/lib/server/r2.ts`, `src/routes/(app)/api/uploads/sign/+server.ts`, `src/routes/(app)/api/uploads/confirm/+server.ts`)
- T9 (S4) `[x]` 0.9 `/api/uploads/sign` + confirmación en DB
- T10 (S4) `[x]` 0.10 Extracción `unpdf` + detección de PDF sin texto (`src/lib/server/pdf.ts`, `src/routes/(app)/api/files/process/+server.ts`)
- T11 (S4) `[x]` 0.11 Migrar plantillas de `localStorage` a DB (`src/lib/server/repositories/rubric.ts`, `src/routes/(app)/api/templates/*`, `rubric_context` + `drizzle/0001_*`, store reescrito sobre la API)
- T12 (S4) `[x]` 0.12 AES-256-GCM para API keys (`src/lib/server/crypto.ts`, `src/lib/server/repositories/api-key.ts`, `drizzle/0002_perfect_phalanx.sql`)
- T13 (S4) `[x]` 0.13 Tests de repos, auth y firma de URLs (`vitest.config.ts`, `tests/setup.ts`, `tests/helpers/*`, `tests/repositories/{rubric,api-key}.test.ts`, `tests/auth/{guards,config}.test.ts`, `tests/r2/urls.test.ts`)

## Log
- L1 (user, 2026-11-10): "Leé el archivo Especificaciones.md y crea una lista de estas especificaciones To-Do, para tener contemplado lo que ya se lleva realizado, con esta lista arma un plan para trabajar a largo plazo, y para cada fase de este plan, desglosalo en pequeñas tareas para ir completando y avanzando a medida de que yo te lo vaya diciendo"
- L2 (user): "Serverless" — decisión de despliegue; arquitectura cerrada en ROADMAP.
- L3 (user): "Mete student entonces" — se agregó `student` al esquema (docs actualizados, roadmap F2 renumerado).
- L4 (user): "Vamos con el código de 0.3" — se aprobó implementar el esquema.
- L5 (user): "Continúa" — avanzar con F0 en orden.
- L6 (user): "Sí" — completar 0.7 guards de ruta.
- L7 (user): "Sí" — completar 0.8 R2 presigned URLs.
- L8 (user): "Sí" — completar 0.10 extracción PDF con unpdf.
- L9 (user): "Continúa" — completar 0.11 migración de plantillas a DB.
- Evidencia F0.11: `drizzle-kit generate` → `drizzle/0001_greedy_cassandra_nova.sql` agrega `rubric_context` (21 tablas). `pnpm check` → 0 errores, 0 warnings. `pnpm build` → exit 0. `Store` ya no escribe plantillas en `localStorage`: `GET/POST /api/templates`, `GET/PUT/DELETE /api/templates/[id]`, `POST /api/templates/[id]/duplicate`; solo `runs` quedan locales hasta F3. Ids los asigna la DB (uuid); los criterios se reconcilian en su lugar para no romper `grade.criterion_id`.
- Evidencia build (bugs previos destapados): (a) `db/index.ts` y `r2.ts` hacían `throw` en import → rompían el análisis SSR de `vite build` sin env vars; ahora avisan y fallan en la primera consulta. (b) `(app)/+layout.server.ts` y `admin/+layout.server.ts` exportaban `actions`, inválido en SvelteKit; el logout se movió a `POST /logout`. (c) Se agregó el plugin `sveltekitCookies(getRequestEvent)` de Better Auth: sin él, `auth.api.signInEmail`/`signOut` no aplicaban las cookies de sesión en acciones server-side.
- Evidencia: `pnpm check` → 0 errores (2 warnings preexistentes en `+page.svelte`). `drizzle-kit generate` → 20 tablas, 24 FKs, 22 índices. Auth flow: login en `/login`, layout `(app)` protege rutas de la app, layout `admin` protege panel admin, ambos con logout funcional. R2 helper: `validateUpload()` con contextos `submission`/`sourceDocument`/`rubricImport`, `makeStorageKey()` único, `presignedPut`/`presignedGet` 15 min. Endpoints: `POST /api/uploads/sign` (devuelve `uploadUrl`, `fileId`, `key`), `POST /api/uploads/confirm` (verifica y actualiza `sha256` + `extraction: pending`), `POST /api/files/process` (descarga de R2, `unpdf` extrae texto, `mergePages: false` devuelve por página, detecta `hasTextLayer` con umbral 80 chars/página, actualiza `extractedText` + `extraction: ok|empty|failed`). Buckets lógicos por contexto.
- L10 (user, 2026-11-11): "Continua con 0.12 (AES-256-GCM para las API keys)".
- Evidencia F0.12: `src/lib/server/crypto.ts` (`encryptSecret`/`decryptSecret` AES-256-GCM, IV 12 B aleatorio, auth tag 16 B, base64; clave desde `API_KEY_ENCRYPTION_KEY` de 32 B en base64 o hex, leída lazy y cacheada, error explícito si falta o mide mal) y `src/lib/server/repositories/api-key.ts` (`createApiKey`, `listApiKeys`, `revokeApiKey`, `getActiveSecret`; metadata-only salvo el camino server-side que descifra). Migración `drizzle/0002_perfect_phalanx.sql` agrega `api_key.last_four` para exponer los últimos 4 sin descifrar en cada listado. `pnpm check` → 0 errores, 0 warnings. `pnpm build` → exit 0. Check funcional (script tsx fuera del worktree): 13 asserts — round-trip base64 y hex, IV único por cifrado, ciphertext/tag alterados rechazados, IV de tamaño inválido rechazado, clave distinta rechazada, clave ausente/corta falla con mensaje, secreto vacío rechazado, `secretLastFour` enmascara con ≤4 chars.
- Pendiente de 0.12: endpoints/UI de gestión (F5.3) y usar `getActiveSecret` desde `gradeWithAI` (hoy sigue leyendo `AI_API_KEY` del entorno; no hay `teacherId` en el request hasta F1/F3).
- L11 (user, 2026-11-11): "Continúa con 0.13 (tests de repos, auth y firma de URLs)".
- Evidencia F0.13: runner `vitest` 5.1 + `@electric-sql/pglite` 0.5 (Postgres real en WASM, en memoria, sin Docker ni Neon). `vitest.config.ts` separado de `vite.config.ts` (sin plugins de SvelteKit/Tailwind): alias `#lib` → `src/lib` y stub de `$app/server`. `tests/helpers/db.ts` aplica `drizzle/*.sql` verbatim sobre PGlite — si una migración no corre ahí, no corre en producción. `pnpm test` → 5 archivos, 56 tests, 0 fallos. `pnpm check` → 0 errores, 0 warnings. `pnpm build` → exit 0.
  - Repos (`tests/repositories/*`): `saveTemplate` (ids de DB, slug/dedupe de tags, posiciones, update in place conservando ids de criterios vivos y borrando los removidos, no adopta el uuid de otro docente, validaciones sin escribir), `getTemplate`/`listTemplates` (uuid inválido, aislamiento por docente, soft-delete excluido, orden por `updatedAt`), `deleteTemplate` (soft delete + scope), `duplicateTemplate`, `importTemplates`; `api-key` (ciphertext ≠ secreto, `lastFour` sin filtrar iv/tag/ciphertext, trim, proveedor inválido sin insertar, listados por scope, revoke con scope, `getActiveSecret` prioriza la key del docente sobre la global, fallback, null si todo revocado, y lanza ante ciphertext alterado).
  - Auth (`tests/auth/*`): guards de `(app)` y `admin` (anónimo → `/login`, docente → `/`, admin pasa) y allowlist exacta de campos del `user` (no filtra `image`/`defaultProvider`/`defaultModel`); config de Better Auth: `input: false` en `role`/`active`/`defaultProvider`/`defaultModel` (nadie se registra como admin), defaults `teacher`/`true`, `cookiePrefix` `revisia`, secreto de env (no el de desarrollo) y plugin `sveltekit-cookies` último.
  - Firma de URLs (`tests/r2/urls.test.ts`): `validateUpload` por contexto y límites exactos (25 MB / 1 MB), allowlists, fallback a `submission`; `makeStorageKey` (extensión en minúscula, unicidad, sin separadores inyectables); `presignedPut`/`presignedGet` (900 s, firma de 64 hex, host virtual `<bucket>.<account>.r2.cloudflarestorage.com`, binding a la key exacta).
- Bugs destapados por 0.13 (corregidos, con test que los cubre):
  1. `src/lib/server/r2.ts` firmaba contra `https://<account>.r2.cloudflare.com`, que no existe: era `r2.cloudflarestorage.com`. Toda URL presignada apuntaba a un host inválido, así que ninguna subida desde el navegador podía funcionar.
  2. `makeStorageKey()` derivaba la extensión con `name.split('.').pop()`, que para un nombre sin punto devuelve el nombre entero y dejaba que `/` y `..` del nombre del cliente entraran en la clave de storage. Ahora solo sobrevive una extensión alfanumérica de ≤12 chars; el resto cae a `bin`.
- Límites conocidos (no bloquean 0.13, sí antes de F1): la firma no incluye `content-type` (el SDK de S3 solo firma `host`), así que el tipo declarado en `/api/uploads/sign` es validación de entrada, no binding en el PUT; y un PUT presignado no tiene rango de tamaño, así que el máximo se controla en el cliente y en `confirm`, no en R2. Endurecer ambos requiere firma con `signableHeaders` y/o POST policy con `content-length-range`.