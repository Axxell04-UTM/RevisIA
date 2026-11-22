import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { getActivity, saveActivity, countActivitiesByRubric } from '#lib/server/repositories/activity.js';
import { deleteTemplate, listTemplates, saveTemplate } from '#lib/server/repositories/rubric.js';
import { resetDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * Deleting a rubric.
 *
 * The rubric row is soft-deleted so the grading history stays readable, but an
 * activity that pointed at it must not keep a dangling id: it would show up as
 * "sin rúbrica" in the picker while the database still claims otherwise. Both
 * changes happen in one transaction, and the caller learns how many activities
 * were unbound so the UI can say it.
 */

async function createRubric(teacherId: string, name = 'Rúbrica de prueba') {
	return saveTemplate(teacherId, {
		name,
		criteria: [{ name: 'Claridad', maxPoints: 10, weight: 1 }]
	});
}

beforeEach(async () => {
	await resetDb();
});

describe('countActivitiesByRubric', () => {
	it('counts the live activities of each rubric for one teacher', async () => {
		const teacher = await createUser();
		const first = await createRubric(teacher.id, 'Primera');
		const second = await createRubric(teacher.id, 'Segunda');

		await saveActivity(teacher.id, { title: 'TP 1', rubricId: first.id });
		await saveActivity(teacher.id, { title: 'TP 2', rubricId: first.id });
		await saveActivity(teacher.id, { title: 'TP 3', rubricId: second.id });
		await saveActivity(teacher.id, { title: 'Sin rúbrica' });

		const usage = await countActivitiesByRubric(teacher.id);
		expect(usage[first.id]).toBe(2);
		expect(usage[second.id]).toBe(1);
	});

	it('does not count another teacher activities', async () => {
		const teacher = await createUser();
		const other = await createUser();
		const mine = await createRubric(teacher.id, 'Mía');
		const theirs = await createRubric(other.id, 'Ajena');

		await saveActivity(teacher.id, { title: 'Mía', rubricId: mine.id });
		await saveActivity(other.id, { title: 'Ajena', rubricId: theirs.id });

		const usage = await countActivitiesByRubric(teacher.id);
		expect(usage[mine.id]).toBe(1);
		expect(usage[theirs.id]).toBeUndefined();
	});
});

describe('deleteTemplate', () => {
	it('soft-deletes the rubric and unbinds the activities that used it', async () => {
		const teacher = await createUser();
		const rubric = await createRubric(teacher.id);
		const first = await saveActivity(teacher.id, { title: 'TP 1', rubricId: rubric.id });
		const second = await saveActivity(teacher.id, { title: 'TP 2', rubricId: rubric.id });

		const result = await deleteTemplate(teacher.id, rubric.id);

		expect(result).toEqual({ deleted: true, unboundActivities: 2 });
		expect((await getActivity(teacher.id, first.id))?.rubricId).toBeNull();
		expect((await getActivity(teacher.id, second.id))?.rubricId).toBeNull();
		expect(await listTemplates(teacher.id)).toHaveLength(0);
	});

	it('reports zero unbound activities when nobody was using it', async () => {
		const teacher = await createUser();
		const rubric = await createRubric(teacher.id);

		expect(await deleteTemplate(teacher.id, rubric.id)).toEqual({
			deleted: true,
			unboundActivities: 0
		});
	});

	it('leaves another teacher rubric and activities untouched', async () => {
		const owner = await createUser();
		const intruder = await createUser();
		const rubric = await createRubric(owner.id);
		const activity = await saveActivity(owner.id, { title: 'TP 1', rubricId: rubric.id });

		expect(await deleteTemplate(intruder.id, rubric.id)).toEqual({
			deleted: false,
			unboundActivities: 0
		});
		expect(await listTemplates(owner.id)).toHaveLength(1);
		expect((await getActivity(owner.id, activity.id))?.rubricId).toBe(rubric.id);
	});

	it('is idempotent for the same teacher', async () => {
		const teacher = await createUser();
		const rubric = await createRubric(teacher.id);

		await deleteTemplate(teacher.id, rubric.id);
		expect(await deleteTemplate(teacher.id, rubric.id)).toEqual({
			deleted: false,
			unboundActivities: 0
		});
	});
});
