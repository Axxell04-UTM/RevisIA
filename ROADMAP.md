# RevisIA — Roadmap de cumplimiento

Derivado de `Especificaciones.md` (rúbrica del proyecto, 30 pts: 5 / 1 / 0 por criterio).
Leyenda: `[x]` hecho · `[~]` parcial · `[ ]` pendiente · `(B)` bloqueante para otras fases.

## Estado actual frente a la rúbrica

| # | Criterio | Pts | Estado | Qué falta |
|---|----------|-----|--------|-----------|
| 1 | Importación de actividades/tareas desde Moodle (PDF **y** ZIP) | 4 / 5 | `[~]` Casi | PDF + ZIP + extracción + dedupe `sha256`; falta prueba manual con un ZIP real de Moodle |
| 2 | Identificación y organización de estudiantes | 4 / 5 | `[~]` Casi | Roster + CSV, parseo Moodle, matching reversible, metadatos por LLM desde el encabezado y trabajos grupales; falta prueba manual con entregas reales |
| 3 | Gestión de contexto académico | 4 / 5 | `[~]` Casi | Actividad + editor + documento + niveles + prompt v2 con presupuesto de tokens; falta OCR para PDFs escaneados |
| 4 | Evaluación individual y masiva | 3 / 5 | `[~]` Parcial | Individual sí; "masiva" es solo pegado con `---` en una sola llamada, sin cola ni progreso |
| 5 | Calificación por rúbrica + informe Excel | 3 / 5 | `[~]` Parcial | Califica por criterio y recalcula total; export solo JSON, sin Excel |
| 6 | Gestión de administración | 0 / 5 | `[ ]` No existe | Sin usuarios, roles, asignaturas; API key vive en `.env` |

**Estimación actual: ~14 / 30.**

### Ya construido (v1)

- [x] SvelteKit 3 + Svelte 5 runes + Tailwind 4 + shadcn-svelte
- [x] Diseñador de plantillas/rúbricas (criterios con nombre, descripción, puntos)
- [x] Bloques de contexto dinámicos (tag / label)
- [x] Render de prompt etiquetado + vista previa
- [x] Endpoint `/api/grade` multi-proveedor (OpenAI-compatible, Anthropic, Google)
- [x] API key server-side (`$app/env/private`)
- [x] Normalización de la respuesta del modelo + recálculo de totales en código
- [x] Carga de varias respuestas por pegado (`---`)
- [x] Resultados por criterio con retroalimentación
- [x] Persistencia `localStorage` + export/import JSON

---

## Decisión de arquitectura: despliegue serverless

Despliegue confirmado en **serverless**. Los archivos **no** viven en el servidor de la aplicación; se separan del cómputo.

| Pieza | Tecnología | Free tier |
|---|---|---|
| Cómputo | Vercel Functions | 2 GB RAM, 300 s máx, 1 M invocaciones |
| Base de datos | Neon Postgres | autosuspende y **despierta sola** (sin pausa manual) |
| Archivos (PDF/ZIP) | Cloudflare R2 | 10 GB, egress $0 |
| ORM | Drizzle | — |
| Auth | Better Auth (email/password + rol) | — |
| Extracción PDF | `unpdf` | — |

**Descartado Supabase**: su free tier pausa el proyecto a los 7 días de inactividad y hay que restaurarlo a mano desde el panel. Un demo en aula no puede depender de eso.

### Flujo de subida (evita el límite de 4.5 MB de Vercel)

```
1. Cliente ──POST /api/uploads/sign──> Función  (devuelve URL firmada de R2)
2. Cliente ──PUT directo──────────────> R2       (el archivo NUNCA pasa por Vercel)
3. Cliente ──POST /api/process {fileId}─> Función (descarga de R2 → extrae → LLM → DB)
```

Reglas:
- Presigned URL para subir y para descargar. El bucket es **privado**.
- `export const config = { maxDuration: 300 }` — pero cada invocación procesa **una sola entrega** (10–30 s).
- **`/tmp` es efímero**: no guardar entregas ahí.
- La evaluación masiva la orquesta el cliente (concurrencia 3–5), con el estado de cada entrega persistido en DB para reanudar si se cierra la pestaña.
- Vercel Cron en Hobby es 1 vez/día → prohibido depender de cron para la cola.

Variables de entorno: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `AI_PROVIDER`, `AI_API_KEY`, `API_KEY_ENCRYPTION_KEY`.

## Fase 0 — Fundaciones: persistencia, archivos y sesión `(B)`

Hoy todo vive en `localStorage` y la clave API en `.env`. Sin servidor de datos no hay admin (criterio 6) ni almacenamiento de PDFs/ZIPs (criterios 1 y 2). Se migra de SQLite a **Postgres**, porque serverless no tiene filesystem persistente.

- [ ] 0.1 Provisionar Neon (Postgres), bucket R2 (privado) y proyecto Vercel; documentar las env vars
- [x] 0.2 Dependencias: `drizzle-orm`, `drizzle-kit`, `postgres` ✅ · `better-auth`, `@aws-sdk/client-s3` + `s3-request-presigner`, `unpdf` ✅ · `@types/node`, `@types/pg` ✅
- [x] 0.3 Esquema Drizzle (20 tablas) + migración `drizzle/0000_init_schema.sql` + scripts `db:generate` / `db:migrate` / `db:studio`
- [x] 0.4 Seed del admin inicial desde env (`scripts/seed.ts`, `db:seed`)
- [x] 0.5 Cliente DB compartido (`src/lib/server/db/index.ts`)
- [x] 0.6 Better Auth: login/logout, cookie `httpOnly`, `role` (`src/lib/server/auth/index.ts`, `src/hooks.server.ts`, `src/app.d.ts`, `src/lib/auth-client.ts`)
- [x] 0.7 Guardas de ruta por rol + layout protegido (`src/routes/(app)/+layout.server.ts`, `src/routes/admin/+layout.server.ts`, `src/routes/(auth)/login`, `src/lib/components/app/Input.svelte`)
- [x] 0.8 R2: CORS, helper presigned PUT/GET, validación tipo/tamaño (`src/lib/server/r2.ts`, `src/routes/(app)/api/uploads/sign/+server.ts`, `src/routes/(app)/api/uploads/confirm/+server.ts`)
- [x] 0.9 `/api/uploads/sign` + confirmación en DB (`api/uploads/{sign,confirm}/+server.ts`)
- [x] 0.10 Extracción `unpdf` + detección de PDF sin texto (`src/lib/server/pdf.ts`, `src/routes/(app)/api/files/process/+server.ts`)
- [x] 0.11 Migrar plantillas de `localStorage` a DB (`src/lib/server/repositories/rubric.ts`, `api/templates/*`, `rubric_context` en `drizzle/0001_*`)
- [x] 0.12 AES-256-GCM para API keys (`src/lib/server/crypto.ts`, `src/lib/server/repositories/api-key.ts`, `last_four` en `drizzle/0002_*`)
- [x] 0.13 Tests de repos, auth y firma de URLs (`vitest.config.ts`, `tests/**`; Vitest + PGlite en memoria)

## Fase 1 — Contexto académico completo (criterio 3)

- [x] 1.1 Entidad `Actividad`: título, descripción, objetivos, instrucciones, fecha, puntaje total (`src/lib/server/repositories/activity.ts`, `api/activities/*`, migración `0003_*`)
- [x] 1.2 Editor de actividad en UI (`src/routes/(app)/actividades/[id]/*`, formulario completo con vista previa)
- [x] 1.3 Subida de documento fuente (PDF / DOCX / TXT) + extracción de texto (`src/lib/server/file-extraction.ts`, `src/routes/(app)/api/files/process/+server.ts`, UI en editor)
- [x] 1.4 Contextos adicionales ilimitados con tag/label persistidos por actividad (`activity_context`)
- [x] 1.5 Rúbrica: niveles configurables por criterio (ej. 5 / 1 / 0) además de `maxPoints` (`rubric_level`, repo + UI en plantillas)
- [x] 1.6 Rúbrica: validación (suma de puntos, criterios sin nombre, pesos, niveles crecientes)
- [x] 1.7 Prompt v2: incluye objetivos, instrucciones y documento fuente (`src/lib/domain/prompt.ts`, preview en editor + `GET /api/activities/[id]/prompt`)
- [x] 1.8 Presupuesto de tokens: recorte/aviso cuando el contexto excede la ventana del modelo (`buildPrompt`: recorta documento → contextos → respuestas, con warnings)
- [x] 1.9 Tests de render de prompt (`tests/domain/prompt.test.ts`, 14 casos)

## Fase 2 — Ingesta e identificación (criterios 1 y 2 → 10 pts)

- [x] 2.1 Subida de PDF individual
- [x] 2.2 Extracción de texto server-side (`unpdf`) con límites de tamaño
- [x] 2.3 PDF sin capa de texto (escaneado/foto) → fallback a visión del modelo; decidir y documentar
- [x] 2.4 Subida de ZIP: descompresión segura (bloquear zip-slip y bombas), filtrar PDF/DOCX
- [x] 2.5 Agrupación por entrega + detección de duplicados por `sha256`
- [x] 2.6 Roster de estudiantes: alta manual + importación CSV, con `match_key` normalizado
- [x] 2.7 Parseo de nombre de archivo con patrones Moodle (`Nombre_Apellido_12345.pdf`)
- [x] 2.8 Extracción de metadatos con LLM desde el encabezado del documento (nombre, integrantes, título)
- [x] 2.9 Resolución nombre → `student_id` por `match_key`, con estado "sin match" reversible
- [x] 2.10 UI de revisión previa: tabla editable de archivo / estudiante / título
- [x] 2.11 Trabajos grupales: varios integrantes → una sola entrega y una sola calificación
- [x] 2.12 Tests de extracción, ZIP malicioso, parseo de nombres y matching

## Fase 3 — Evaluación individual y masiva (criterio 4)

- [ ] 3.1 Evaluación individual con progreso visible
- [ ] 3.2 Orquestación masiva desde el cliente: concurrencia 3–5, una entrega por invocación, reintentos con backoff
- [ ] 3.3 Estado por entrega (`pendiente` / `en curso` / `listo` / `error`) persistido
- [ ] 3.4 Reintento selectivo sin recalificar las que ya están OK
- [ ] 3.5 Estimación de tokens/costo antes de lanzar el lote
- [ ] 3.6 Evaluación grupal (un resultado por grupo)
- [ ] 3.7 UI de resultados con filtros y estados
- [ ] 3.8 Tests del orquestador de cola (éxito, error, reintento)

## Fase 4 — Calificación por rúbrica y Excel (criterio 5)

- [ ] 4.1 Calificación por niveles de rúbrica con puntos mapeados (5 / 1 / 0)
- [ ] 4.2 Totales ponderados + validación de límites
- [ ] 4.3 Export `.xlsx` con: estudiante, título, calificación por criterio, total, retroalimentación
- [ ] 4.4 Export por actividad y por asignatura (hojas múltiples)
- [ ] 4.5 Export CSV alternativo
- [ ] 4.6 (Opcional) Reporte PDF de retroalimentación individual
- [ ] 4.7 Tests del generador Excel (lectura del archivo producido)

## Fase 5 — Administración (criterio 6)

- [ ] 5.1 CRUD de docentes (alta, desactivar, reset de contraseña)
- [ ] 5.2 CRUD de asignaturas y asignación docente ↔ asignatura
- [ ] 5.3 Gestión de API keys: alta/baja por proveedor, cifrada en reposo, nunca devuelta al cliente
- [ ] 5.4 Proveedor/modelo por defecto: global y por docente
- [ ] 5.5 Registro de uso (tokens y costo por docente/actividad)
- [ ] 5.6 Panel admin con métricas básicas
- [ ] 5.7 Tests de permisos (un docente no accede a rutas de admin)

## Fase 6 — Calidad y entrega del curso

- [ ] 6.1 Tests unitarios del dominio + integración de `/api/grade`
- [ ] 6.2 E2E con Playwright del flujo completo (subir ZIP → calificar → exportar Excel)
- [ ] 6.3 Manejo de errores de proveedor, rate limit y mensajes claros al usuario
- [ ] 6.4 Deploy (adapter-node o Vercel) + `.env` de producción
- [ ] 6.5 Manual de usuario con capturas
- [ ] 6.6 Documento: Introducción y Objetivos
- [ ] 6.7 Documento: Arquitectura y Tecnologías utilizadas
- [ ] 6.8 Documento: Procesos con diagramas BPMN
- [ ] 6.9 Documento: Codificación (fragmentos representativos)
- [ ] 6.10 Guion de demo para la revisión en aula

---

## Orden recomendado y justificación

```
F0 ──> F1 ──> F2 ──> F3 ──> F4 ──> F5 ──> F6
```

- **F0 primero**: los criterios 1 y 2 exigen archivos en servidor. Sin esto, F2 se construiría dos veces.
- **F1 antes de F2**: la actividad define dónde cuelgan las entregas; hoy el "contexto" es texto suelto.
- **F2 + F3 + F4 seguidas**: son el mismo flujo (`archivo → entrega → calificación → Excel`) y suman 15 pts.
- **F5 al final**: criterio 6 es independiente y no bloquea la demo de los demás.

Si el tiempo aprieta antes de la revisión, el corte con mejor relación puntos/esfuerzo es **F0 + F1 + F2 + F4** (~20 pts) dejando F3 y F5 después.

## Riesgos abiertos

1. **Costo de la evaluación masiva**: un lote de 40 entregas con contexto largo puede ser caro. Mitigación: F3.5 (estimación previa) y prompt con presupuesto de tokens (F1.8).
2. **PDFs escaneados**: si los alumnos entregan fotos, la extracción de texto devuelve vacío. Hay que decidir visión vs OCR (F2.3) antes de prometer el criterio 1.
3. **ZIP de Moodle**: los nombres de archivo reales son inconsistentes; la extracción por LLM debe tener siempre corrección manual (F2.8).
4. **Migración localStorage → DB**: el import JSON actual permite no perder plantillas, pero hay que probarlo (F0.11).
5. **Lote interrumpido**: si el docente cierra la pestaña, la evaluación masiva se detiene. Mitigación: estado por entrega en DB (F3.3) y reanudación al reabrir.
6. **R2 no es backup**: el free tier no incluye versionado ni retención. Para la entrega del curso, exportar un dump de Postgres y una copia de los PDFs antes del demo.
