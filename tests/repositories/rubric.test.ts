import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { eq, sql } from 'drizzle-orm';
import { rubric, rubricCriterion } from '#lib/server/db/schema/academic.js';
import {
	deleteTemplate,
	duplicateTemplate,
	getTemplate,
	importTemplates,
	isUuid,
	listTemplates,
	saveTemplate
} from '#lib/server/repositories/rubric.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneCriterion = [{ name: 'Claridad', maxPoints: 5 }];

beforeEach(async () => {
	await resetDb();
});

describe('saveTemplate', () => {
	it('creates a template and lets the database assign every id', async () => {
		const teacher = await createUser();

		const created = await saveTemplate(teacher.id, { name: '  Ensayo  ', criteria: oneCriterion });

		expect(created.id).toMatch(UUID_RE);
		expect(created.name).toBe('Ensayo');
		expect(created.answerTag).toBe('respuesta');
		expect(created.answerLabel).toBe('Respuesta');
		expect(created.criteria).toHaveLength(1);
		expect(created.criteria[0].id).toMatch(UUID_RE);
		expect(created.criteria[0].description).toBe('');
	});

	it('slugifies and dedupes context tags so the prompt stays unambiguous', async () => {
		const teacher = await createUser();

		const created = await saveTemplate(teacher.id, {
			name: 'Con contextos',
			criteria: oneCriterion,
			contexts: [
				{ tag: 'Texto del estudiante', label: 'Texto' },
				{ tag: 'Texto del estudiante', label: 'Copia' },
				{ tag: '', label: '' }
			]
		});

		expect(created.contexts.map((c) => c.tag)).toEqual([
			'texto_del_estudiante',
			'texto_del_estudiante_2',
			'contexto'
		]);
		expect(created.contexts[2].label).toBe('contexto');
	});

	it('keeps criterion positions in the submitted order', async () => {
		const teacher = await createUser();

		const created = await saveTemplate(teacher.id, {
			name: 'Orden',
			criteria: [
				{ name: 'Primero', maxPoints: 1 },
				{ name: 'Segundo', maxPoints: 2 },
				{ name: 'Tercero', maxPoints: 3 }
			]
		});

		expect(created.criteria.map((c) => c.name)).toEqual(['Primero', 'Segundo', 'Tercero']);
	});

	it('updates in place, reusing the ids of the criteria that survive', async () => {
		const teacher = await createUser();
		const first = await saveTemplate(teacher.id, {
			name: 'Plantilla',
			criteria: [
				{ name: 'A', maxPoints: 5 },
				{ name: 'B', maxPoints: 5 }
			]
		});
		const [kept, removed] = first.criteria;

		const updated = await saveTemplate(teacher.id, {
			id: first.id,
			name: 'Plantilla mejorada',
			criteria: [
				{ id: kept.id, name: 'A mejorado', maxPoints: 8 },
				{ name: 'C', maxPoints: 2 }
			]
		});

		expect(updated.id).toBe(first.id);
		expect(updated.name).toBe('Plantilla mejorada');
		expect(updated.criteria.map((c) => c.name)).toEqual(['A mejorado', 'C']);
		expect(updated.criteria[0].id).toBe(kept.id);

		const orphans = await testDb
			.select()
			.from(rubricCriterion)
			.where(eq(rubricCriterion.id, removed.id));
		expect(orphans).toHaveLength(0);
	});

	it('never adopts an id that belongs to another teacher', async () => {
		const owner = await createUser();
		const intruder = await createUser();
		const victim = await saveTemplate(owner.id, { name: 'Ajena', criteria: oneCriterion });

		const created = await saveTemplate(intruder.id, {
			id: victim.id,
			name: 'Intento de secuestro',
			criteria: oneCriterion
		});

		expect(created.id).not.toBe(victim.id);
		const original = await getTemplate(owner.id, victim.id);
		expect(original?.name).toBe('Ajena');
	});

	it('rejects invalid templates before touching the database', async () => {
		const teacher = await createUser();

		await expect(saveTemplate(teacher.id, { name: '', criteria: oneCriterion })).rejects.toThrow(
			'La rúbrica necesita un nombre'
		);
		await expect(saveTemplate(teacher.id, { name: 'Sin criterios', criteria: [] })).rejects.toThrow(
			'La rúbrica necesita al menos un criterio'
		);
		await expect(
			saveTemplate(teacher.id, { name: 'Puntaje', criteria: [{ name: 'A', maxPoints: -1 }] })
		).rejects.toThrow('Puntaje inválido en el criterio "A"');
		await expect(
			saveTemplate(teacher.id, { name: 'Sin nombre de criterio', criteria: [{ name: ' ', maxPoints: 1 }] })
		).rejects.toThrow('Todos los criterios necesitan un nombre');

		expect(await listTemplates(teacher.id)).toHaveLength(0);
	});
});

describe('getTemplate', () => {
	it('returns null for a malformed id instead of querying', async () => {
		const teacher = await createUser();

		expect(await getTemplate(teacher.id, 'no-es-un-uuid')).toBeNull();
	});

	it('does not expose another teacher template', async () => {
		const owner = await createUser();
		const other = await createUser();
		const created = await saveTemplate(owner.id, { name: 'Privada', criteria: oneCriterion });

		expect(await getTemplate(other.id, created.id)).toBeNull();
	});

	it('treats a soft-deleted template as missing', async () => {
		const teacher = await createUser();
		const created = await saveTemplate(teacher.id, { name: 'Borrada', criteria: oneCriterion });

		expect(await deleteTemplate(teacher.id, created.id)).toEqual({
			deleted: true,
			unboundActivities: 0
		});

		expect(await getTemplate(teacher.id, created.id)).toBeNull();
	});
});

describe('listTemplates', () => {
	it('lists only live templates of that teacher, most recently updated first', async () => {
		const teacher = await createUser();
		const other = await createUser();

		const older = await saveTemplate(teacher.id, { name: 'Vieja', criteria: oneCriterion });
		await saveTemplate(other.id, { name: 'De otro', criteria: oneCriterion });
		const deleted = await saveTemplate(teacher.id, { name: 'Eliminada', criteria: oneCriterion });
		await saveTemplate(teacher.id, { name: 'Nueva', criteria: oneCriterion });
		await deleteTemplate(teacher.id, deleted.id);

		// Deterministic ordering: push the "old" row behind every other one.
		await testDb
			.update(rubric)
			.set({ updatedAt: sql`now() - interval '1 day'` })
			.where(eq(rubric.id, older.id));

		const names = (await listTemplates(teacher.id)).map((t) => t.name);

		expect(names).toHaveLength(2);
		expect(names).toEqual(['Nueva', 'Vieja']);
	});

	it('returns an empty list for a teacher with no templates', async () => {
		const teacher = await createUser();

		expect(await listTemplates(teacher.id)).toEqual([]);
	});
});

describe('deleteTemplate', () => {
	it('soft deletes and keeps the row for history', async () => {
		const teacher = await createUser();
		const created = await saveTemplate(teacher.id, { name: 'Histórica', criteria: oneCriterion });

		expect(await deleteTemplate(teacher.id, created.id)).toEqual({
			deleted: true,
			unboundActivities: 0
		});

		const [row] = await testDb
			.select({ deletedAt: rubric.deletedAt })
			.from(rubric)
			.where(eq(rubric.id, created.id));
		expect(row.deletedAt).not.toBeNull();
		expect(await deleteTemplate(teacher.id, created.id)).toEqual({
			deleted: false,
			unboundActivities: 0
		});
	});

	it('refuses to delete another teacher template', async () => {
		const owner = await createUser();
		const other = await createUser();
		const created = await saveTemplate(owner.id, { name: 'Mía', criteria: oneCriterion });

		expect(await deleteTemplate(other.id, created.id)).toEqual({
			deleted: false,
			unboundActivities: 0
		});
		expect(await getTemplate(owner.id, created.id)).not.toBeNull();
	});
});

describe('duplicateTemplate', () => {
	it('copies name, criteria and contexts into a brand new template', async () => {
		const teacher = await createUser();
		const source = await saveTemplate(teacher.id, {
			name: 'Base',
			instruction: 'Corregí con criterio',
			answerTag: 'ensayo',
			answerLabel: 'Ensayo',
			criteria: [
				{ name: 'A', maxPoints: 4, description: 'detalle' },
				{ name: 'B', maxPoints: 6 }
			],
			contexts: [{ tag: 'consigna', label: 'Consigna', placeholder: 'Pegá la consigna' }]
		});

		const copy = await duplicateTemplate(teacher.id, source.id);

		expect(copy).not.toBeNull();
		expect(copy!.id).not.toBe(source.id);
		expect(copy!.name).toBe('Base (copia)');
		expect(copy!.instruction).toBe('Corregí con criterio');
		expect(copy!.answerTag).toBe('ensayo');
		expect(copy!.criteria.map((c) => c.name)).toEqual(['A', 'B']);
		expect(copy!.criteria[0].id).not.toBe(source.criteria[0].id);
		expect(copy!.contexts.map((c) => c.tag)).toEqual(['consigna']);
	});

	it('returns null when the source does not exist', async () => {
		const teacher = await createUser();

		expect(await duplicateTemplate(teacher.id, '00000000-0000-4000-8000-000000000000')).toBeNull();
	});
});

describe('importTemplates', () => {
	it('creates new rows even when the JSON carries ids', async () => {
		const teacher = await createUser();
		const existing = await saveTemplate(teacher.id, { name: 'Existente', criteria: oneCriterion });

		const [imported] = await importTemplates(teacher.id, [
			{ id: existing.id, name: 'Importada', criteria: oneCriterion }
		]);

		expect(imported.id).not.toBe(existing.id);
		expect((await getTemplate(teacher.id, existing.id))?.name).toBe('Existente');
	});

	it('rejects an empty import', async () => {
		const teacher = await createUser();

		await expect(importTemplates(teacher.id, [])).rejects.toThrow('El archivo no contiene rúbricas');
	});
});

describe('isUuid', () => {
	it('accepts canonical uuids in any case', () => {
		expect(isUuid('8F0F1E4C-1A2B-4C3D-8E9F-0A1B2C3D4E5F')).toBe(true);
	});

	it('rejects anything else', () => {
		for (const value of ['', '123', null, undefined, 42, '8f0f1e4c1a2b4c3d8e9f0a1b2c3d4e5f']) {
			expect(isUuid(value)).toBe(false);
		}
	});
});
