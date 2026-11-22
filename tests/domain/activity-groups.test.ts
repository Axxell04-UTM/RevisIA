import { describe, expect, it } from 'vitest';
import {
	ACTIVITY_STATUS_LABEL,
	formatDueDate,
	groupActivitiesBySubject,
	NO_SUBJECT_KEY
} from '#lib/domain/activity-groups.js';
import type { Activity, SubjectSummary } from '#lib/domain/types.js';

function activity(overrides: Partial<Activity> & { id: string; title: string }): Activity {
	return {
		subjectId: null,
		description: '',
		objectives: '',
		instructions: '',
		sourceFileId: null,
		submissionsZip: null,
		rubricId: null,
		dueAt: null,
		status: 'draft',
		contexts: [],
		maxPoints: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

function subject(id: string, name: string): SubjectSummary {
	return { id, name, code: `${id.toUpperCase()}-01`, term: '2026-1' };
}

describe('groupActivitiesBySubject', () => {
	it('groups by subject in the subject order and keeps the input order inside each group', () => {
		const historia = subject('s1', 'Historia');
		const lengua = subject('s2', 'Lengua');

		const groups = groupActivitiesBySubject(
			[
				activity({ id: 'a1', title: 'Ensayo', subjectId: 's1' }),
				activity({ id: 'a2', title: 'TP 2', subjectId: 's2' }),
				activity({ id: 'a3', title: 'TP 1', subjectId: 's1' })
			],
			[historia, lengua]
		);

		expect(groups.map((group) => group.name)).toEqual(['Historia', 'Lengua']);
		expect(groups[0].activities.map((item) => item.id)).toEqual(['a1', 'a3']);
		expect(groups[1].activities.map((item) => item.id)).toEqual(['a2']);
		expect(groups[0].code).toBe('S1-01');
	});

	it('drops subjects without activities and puts unassigned activities in their own group', () => {
		const groups = groupActivitiesBySubject(
			[
				activity({ id: 'a1', title: 'Suelta' }),
				activity({ id: 'a2', title: 'Huérfana', subjectId: 'borrada' })
			],
			[subject('s1', 'Sin actividades')]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe(NO_SUBJECT_KEY);
		expect(groups[0].name).toBe('Sin asignatura');
		expect(groups[0].activities.map((item) => item.id)).toEqual(['a1', 'a2']);
	});

	it('returns no groups when there is nothing to show', () => {
		expect(groupActivitiesBySubject([], [])).toEqual([]);
	});
});

describe('formatDueDate', () => {
	it('formats a timestamp and keeps null as null', () => {
		const formatted = formatDueDate(Date.parse('2026-03-14T12:00:00.000Z'));

		expect(formatted).not.toBeNull();
		expect(formatted).toContain('2026');
		expect(formatDueDate(null)).toBeNull();
	});
});

describe('ACTIVITY_STATUS_LABEL', () => {
	it('labels every status in Spanish', () => {
		expect(ACTIVITY_STATUS_LABEL).toEqual({
			draft: 'Borrador',
			open: 'Abierta',
			closed: 'Cerrada'
		});
	});
});
