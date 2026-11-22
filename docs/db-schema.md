# Esquema de base de datos — RevisIA

Postgres (Neon) + Drizzle. Todos los PK son `uuid` con `gen_random_uuid()`. Todas las fechas `timestamptz`.
Convención: `snake_case`, plural para tablas, FK con `on delete cascade` salvo que se indique lo contrario.

## Mapa de relaciones

```
user ──< session / account / verification            (Better Auth)
  │
  ├──< subject_teachers >── subject
  │                          │
  │                          ├──< student
  │                          │
  │                          └──< activity ──> rubric ──< rubric_criterion ──< rubric_level
  │                                 │
  │                                 └──< submission ──< submission_file
  │                                        │  │
  │                                        │  ├──< submission_member ──> student
  │                                        │  ├──< grade
  │                                        │  └──> student            (nullable)
  │
  ├──< rubric            (biblioteca reutilizable del docente)
  └──< api_key           (por docente o global)
```

## Autenticación (propiedad de Better Auth)

| Tabla | Columnas clave |
|---|---|
| `user` | `id`, `email` (unique), `name`, `email_verified`, `image`, **`role`** (`admin`\|`teacher`), **`active`**, **`default_provider`**, **`default_model`**, `created_at` |
| `session` | `id`, `user_id`, `token`, `expires_at`, `ip_address`, `user_agent` |
| `account` | credenciales de password (hash) — la maneja la librería |
| `verification` | tokens de verificación / reset |

Solo se extiende `user`; el resto queda como lo genera Better Auth.

## Organización académica

| Tabla | Columnas |
|---|---|
| `subject` | `id`, `name`, `code`, `term`, `description`, `created_at`, `deleted_at` |
| `subject_teachers` | `subject_id`, `teacher_id`, `assigned_at` — PK compuesta `(subject_id, teacher_id)` |

Un `admin` crea las asignaturas y asigna docentes (criterio 6). Un docente solo ve las suyas, vía `subject_teachers`.

## Actividad y contexto (criterio 3)

| Tabla | Columnas |
|---|---|
| `activity` | `id`, `subject_id` (nullable, FK → `subject`, `on delete set null`), `title`, `description`, `objectives`, `instructions`, `source_file_id` (FK → `file`), `rubric_id` (FK → `rubric`), `due_at`, `status` (`draft`\|`open`\|`closed`), `created_by`, `created_at`, `updated_at`, `deleted_at` |
| `activity_context` | `id`, `activity_id`, `tag` (unique por actividad), `label`, `content` (text), `position` |

`activity_context` son los bloques dinámicos que ya existen en la app (el "texto base" típico va acá). `source_file_id` es el documento fuente adjunto extraído de un PDF/DOCX.

`subject_id` es nullable a propósito: F5.2 (CRUD de asignaturas) llega después de F1, así que un docente puede crear actividades y asignarlas a una materia más tarde. La pertenencia se controla por `created_by`; si llega `subject_id`, se exige fila en `subject_teachers`. El puntaje total **no** se guarda en `activity`: se deriva de `sum(rubric_criterion.max_points)` de la rúbrica asociada, para que editarla no deje un total viejo.

## Rúbrica (criterio 5)

| Tabla | Columnas |
|---|---|
| `rubric` | `id`, `teacher_id`, `name`, `instruction`, `answer_tag`, `answer_label`, `created_at`, `updated_at`, `deleted_at` |
| `rubric_criterion` | `id`, `rubric_id`, `name`, `description`, `max_points` (numeric), `weight` (numeric, default 1), `position` |
| `rubric_context` | `id`, `rubric_id`, `tag`, `label`, `placeholder`, `position` — bloques de contexto por defecto de la plantilla; al crear una actividad se copian a `activity_context` |
| `rubric_level` | `id`, `criterion_id`, `label` (ej. "Excelente"), `points` (numeric), `description`, `position` |

`rubric_context` es la forma persistida de la "plantilla" del editor actual (`Template.contexts`). Los ids los asigna la base; al guardar se reconcilian criterios en su lugar (para no romper `grade.criterion_id`) y los contextos se reemplazan enteros.

`rubric_level` es opcional: si no hay niveles, se califica sobre `max_points` (comportamiento actual). Si hay niveles, el modelo elige una `label` y `points` se resuelve en código, no en el modelo.

## Estudiantes (criterio 2)

| Tabla | Columnas |
|---|---|
| `student` | `id`, `subject_id`, `name` (como se muestra), `match_key`, `email`, `external_id` (id en Moodle, nullable), `created_at`, `deleted_at` |

`match_key` se calcula **en código**: minúsculas, sin acentos ni signos, tokens ordenados alfabéticamente y unidos por espacio. Así `Pérez, Juan`, `juan perez` y `Juan Pérez` colapsan en la misma clave y el mismo estudiante.

Índice único parcial `(subject_id, match_key) where deleted_at is null`. El roster se carga a mano o se importa; al procesar una entrega se intenta enlazar por `match_key` y, si no hay match, la entrega queda con texto libre pendiente de resolución manual.

## Entregas (criterios 1 y 2)

| Tabla | Columnas |
|---|---|
| `file` | `id`, `storage_key`, `bucket`, `original_name`, `mime`, `size_bytes`, `sha256`, `extracted_text` (text), `extraction` (`pending`\|`ok`\|`empty`\|`failed`), `upload_context` (`submission`\|`submissionZip`\|`sourceDocument`\|`rubricImport`), `uploaded_by`, `created_at` |
| `submission` | `id`, `activity_id`, **`student_id`** (FK → `student`, nullable), `student_name` (nullable), `title`, `kind` (`individual`\|`group`), `source` (`zip`\|`pdf`\|`text`), `status` (`pending`\|`processing`\|`graded`\|`error`), `error_message`, `sha256`, `total_points`, `max_points`, `model`, `prompt_tokens`, `completion_tokens`, `graded_at`, `created_at`, `deleted_at` |
| `submission_file` | `submission_id`, `file_id`, `role` (`document`\|`support`), `position` |
| `submission_member` | `id`, `submission_id`, **`student_id`** (FK → `student`, nullable), `name`, `is_author` (bool), `position` |

`student_name` guarda el nombre **tal como se detectó** (evidencia cruda, nunca se pisa) y `student_id` es el enlace resuelto contra el roster. Si el docente corrige el nombre en la UI, se actualiza el enlace, no el crudo.

**Una entrega grupal es una sola fila** con N `submission_member`. Se califica una vez y el Excel exporta el trabajo con la lista de integrantes.

`file.sha256` y `submission.sha256` no son lo mismo: el primero hashea cada archivo subido; el segundo es el hash del **documento principal** de la entrega y es la identidad de la entrega. El índice único parcial `(activity_id, sha256) where deleted_at is null and sha256 is not null` hace que re-subir los mismos bytes a la misma actividad sea idempotente, sin impedir que el mismo PDF sea entrega de dos actividades distintas. El `sha256` se calcula server-side al confirmar la subida, nunca se toma del navegador; `deleted_at` permite borrar una entrega y volver a subirla.

## Calificación

| Tabla | Columnas |
|---|---|
| `grade` | `id`, `submission_id`, `criterion_id`, `level_label`, `points` (numeric), `max_points` (numeric), `feedback` (text) |
| `grading_cache` | `prompt_hash` (PK, sha256 de prompt+modelo), `response_json` (jsonb), `created_at` |

`grade` es una fila por criterio por entrega. `total_points` en `submission` se **recalcula siempre en código**, nunca se confía en el modelo.

`grading_cache` es la palanca de costo: si el hash ya existe, no se vuelve a pagar la llamada.

## Administración (criterio 6)

| Tabla | Columnas |
|---|---|
| `api_key` | `id`, `teacher_id` (null = global), `provider`, `label`, `ciphertext` (base64), `iv` (base64), `auth_tag` (base64), `last_four`, `active`, `created_by`, `created_at` |
| `audit_log` | `id`, `user_id`, `action`, `entity`, `entity_id`, `metadata` (jsonb), `created_at` |

Las API keys se guardan cifradas con AES-256-GCM usando `API_KEY_ENCRYPTION_KEY` del entorno. **Nunca se devuelven al cliente**: la API solo expone proveedor, label, estado y últimos 4 caracteres (`last_four`, guardado al crear la clave para no descifrar en cada listado).

Envelope (`src/lib/server/crypto.ts`): clave de 32 bytes en base64 (`openssl rand -base64 32`) o hex; IV aleatorio de 12 bytes por cifrado; auth tag de 16 bytes. `encryptSecret` / `decryptSecret` fallan con un error explícito si la clave falta, si no mide 32 bytes, o si el contenido fue alterado (GCM autentica antes de devolver texto plano). El repositorio (`src/lib/server/repositories/api-key.ts`) devuelve solo metadata en `listApiKeys`/`createApiKey`; el único camino que descifra es `getActiveSecret`, para una llamada server-side.

## Índices

```sql
student (subject_id, match_key) unique where deleted_at is null
submission (activity_id, sha256) unique where deleted_at is null and sha256 is not null
submission (activity_id, status)
submission (activity_id, created_at desc)
submission (student_id)
submission_member (student_id)
grade (submission_id)
grade (criterion_id)
file (sha256)
file (uploaded_by)
activity (subject_id, status)
activity (created_by)
subject_teachers (teacher_id)
session (user_id)
audit_log (user_id, created_at desc)
```

## Decisiones tomadas y por qué

1. **Postgres, no SQLite**: serverless no tiene filesystem persistente.
2. **Rúbrica reutilizable** con `activity.rubric_id`: una rúbrica se puede reusar en varias actividades del mismo docente sin duplicar criterios. Duplicar una actividad clona la rúbrica.
3. **Grupo = una entrega + N miembros**: calificar un trabajo grupal N veces sería pagar N llamadas por el mismo texto.
4. **Texto extraído en `file`**: pesa KB y permite re-renderizar el prompt sin volver a descargar el PDF de R2.
5. **`deleted_at` (soft delete)** en `subject`, `activity`, `rubric`: borrar una actividad no debe arrastrar las notas históricas sin querer.
6. **`grading_cache` separada de `grade`**: el cache es descartable, las notas no.
7. **Tokens y modelo en `submission`**: base para el reporte de uso del panel admin (F5.5) sin tabla extra.
8. **`student` como entidad con `match_key`**: el criterio 2 pide "identificación **y organización**" de estudiantes. Un string por entrega no permite libro de notas, historial semestral ni detectar duplicados (`Pérez, Juan` vs `juan perez`). El `match_key` ordenado por tokens resuelve ambos órdenes del nombre, y `submission.student_name` preserva el crudo para poder auditar el enlace.
9. **Roster por asignatura, no global**: un mismo estudiante cursa varias materias; `student.subject_id` evita que el libro de notas de una materia contamine otra.

## Notas de implementación (tarea 0.3)

Migración generada: `drizzle/0000_init_schema.sql` — 20 tablas, 24 FKs, 22 índices. Migración `drizzle/0001_greedy_cassandra_nova.sql` agrega `rubric_context` (21 tablas en total).

- **`user.id` es `text`, no `uuid`**: Better Auth genera identificadores string. Todas las FK hacia `user` son `text` en consecuencia. El resto de las tablas usa `uuid` con `gen_random_uuid()`.
- **Puntos como `real`**, no `numeric`: son notas humanas con 1–2 decimales, no dinero. `numeric` devuelve string en Drizzle y obligaría a convertir en cada lectura.
- **`api_key` en base64 sobre `text`**, no `bytea`: idéntico resultado con el driver TCP y con el HTTP de Neon, y `drizzle-kit` no necesita un `customType`.
- **Orden de declaración dentro de `academic.ts`**: `file` → `subject` → `student` → `rubric` → `activity`. Los thunks de `references()` se resuelven al construir el esquema, así que invertir ese orden rompe la carga.
- El índice único parcial de `student` se emitió correctamente: `WHERE "student"."deleted_at" is null`.
