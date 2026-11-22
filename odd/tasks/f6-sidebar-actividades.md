# F6 — Barra lateral de actividades (estilo ChatGPT)

Objetivo: dar al docente una barra lateral persistente que liste sus actividades de revisión agrupadas por asignatura, y reorganizar la navegación completa de la app alrededor de ella.
Sin git en el workspace: la evidencia son los archivos tocados y `pnpm test` / `pnpm check`.
Test runner: `pnpm test` (vitest).

## Specs

- **S1** — "Quiero una barra lateral como las que tienen los chats de IA modernos como ChatGPT o Gemini, para la getión de las actividades de cada docente."
  Barra visible en escritorio, drawer en móvil, con la lista de actividades del docente.
- **S2** — Navegación completa: Actividades + Plantillas + Asignaturas + Admin en la misma barra. Reemplaza el nav superior actual.
- **S3** — Agrupación por asignatura, grupos colapsables; dentro de cada grupo, orden por última modificación (desc). Actividades sin asignatura van a un grupo "Sin asignatura".
- **S4** — Cada ítem muestra título + asignatura (o el estado si no tiene asignatura).
- **S5** — Click abre la actividad (`/revisar/[id]`); menú ⋯ por ítem con Renombrar (inline), Duplicar y Eliminar (con confirmación inline).
- **S6** — Ítem "Asignaturas" abre una página nueva del docente en `/asignaturas`.
- **S7** — `/` pasa a ser el panorama de actividades; la lista de plantillas se mueve a `/plantillas`; el logo lleva a Inicio.
- **S8** — Se preserva: guard de auth + redirect de primer login (`(app)/+layout.server.ts`), theme toggle, logout, nombre/rol del docente visible.

## Tasks

| ID | Tarea | Specs | Estado | Evidencia |
|----|-------|-------|--------|-----------|
| T1 | Repo: `renameActivity`, `duplicateActivity` + tests | S5 | done | `activity.ts` (rename/duplicate), 5 tests nuevos en `activity.test.ts` |
| T2 | Repo: conteo de entregas por actividad + tests | S6 | done | `countSubmissionsByActivity` en `submission.ts`, 2 tests en `submission.test.ts` |
| T3 | API: `PATCH /api/activities/[id]`, `POST /api/activities/[id]/duplicate` | S5 | done | `api/activities/[id]/+server.ts`, `api/activities/[id]/duplicate/+server.ts` |
| T4 | Layout server load: actividades + asignaturas | S1,S3 | done | `(app)/+layout.server.ts` + guard test actualizado |
| T5 | Tokens `--sidebar-*` en layout.css (light/dark) | S2 | done | `layout.css` |
| T6 | Componente `AppSidebar.svelte` (nav, grupos, menú, footer) | S1-S5 | done | `AppSidebar.svelte`, `SidebarActivityItem.svelte` |
| T7 | Layout `(app)`: barra en flujo (desktop) + drawer (móvil) + toggle persistido | S1,S2 | done | `(app)/+layout.svelte` |
| T8 | Mover plantillas a `/plantillas` y corregir "Volver" de plantillas/evaluar | S7 | done | `plantillas/+page.svelte`, links corregidos |
| T9 | Nueva home `/` = panorama de actividades agrupado por asignatura | S7 | done | `(app)/+page.svelte`, `+page.server.ts` |
| T10 | Nueva página `/asignaturas` (materias + actividades + entregas) | S6 | done | `asignaturas/+page.server.ts`, `+page.svelte` |
| T11 | `pnpm test` + `pnpm check` | todas | done | 268/268 tests; `check` sin errores nuevos (97 preexistentes en admin/actividades) |

## Log

- **L1** (request original, verbatim): "Quiero una barra lateral como las que tienen los chats de IA modernos como ChatGPT o Gemini, para la getión de las actividades de cada docente. Por ejemplo en esas apps cada conversación tiene una pestaña de registro de la conversación permitiendo acceder rapidamente a cada conversación que se ha tenido, en este caso sería cada actividad de revisión, hazme las preguntas que necesites"
- **L2** (decisiones del usuario): Alcance = Navegación completa. Agrupación = Por asignatura. Detalle del ítem = Título + asignatura. Acciones = Navegar + menú (renombrar, duplicar, eliminar con confirmación).
- **L3** (decisiones del usuario): "Asignaturas" = página nueva del docente (`/asignaturas`), no la de admin. Home `/` = Actividades; plantillas se mueve a `/plantillas`.
- **L4** (hallazgos de exploración): no existía ninguna lista de actividades en la UI; `GET /api/activities` ya existía sin consumidores; `GET/PUT/DELETE /api/activities/[id]` existe; no hay flujo de creación de actividad en UI (fuera de alcance: el usuario eligió "Navegar + menú", no "Navegar + crear"). `submission` tiene índice `(activity_id, status)`, así que el conteo es barato. Roles: `admin` | `teacher`.
- **L5** (decidido en implementación): el renombre inline y la confirmación de borrado son estado local del ítem, sin diálogo nuevo. `duplicateActivity` copia todo excepto timestamps, con título + " (copia)" y estado `draft`.
- **L6** (verificación): `pnpm test` → 18 archivos, 268 tests en verde. `pnpm check` sigue con 97 errores preexistentes en `admin/*` y `(app)/actividades/[id]`; los archivos nuevos no aportan ninguno. Dos ajustes colaterales necesarios: el guard test de `(app)` ahora mockea el repo de actividades (el layout consulta la DB), y un test de `teacher.test.ts` era flaky (`.sort()` de un solo lado con UUIDs aleatorios) y se corrigió. Sin verificación en navegador: no hay Postgres local ni sesión autenticada en este entorno.
