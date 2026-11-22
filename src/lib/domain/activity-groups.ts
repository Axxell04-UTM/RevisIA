import type { Activity, ActivityStatus, SubjectSummary } from './types.js';

/**
 * Activities grouped by subject, the way the sidebar and the overview render
 * them.
 *
 * `activities` is expected newest-first (the order `listActivities` returns), so
 * grouping preserves "última modificación arriba" inside every group. Subjects
 * with no activities are dropped here: an empty group is noise in a navigation
 * list, and the subject page is the place to see a subject with zero activity.
 */
export type ActivityGroup = {
  key: string;
  name: string;
  code: string;
  activities: Activity[];
};

/** Group key for activities without a subject (or with a stale subject id). */
export const NO_SUBJECT_KEY = '__sin_asignatura__';

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: 'Borrador',
  open: 'Abierta',
  closed: 'Cerrada'
};

export function groupActivitiesBySubject(
  activities: Activity[],
  subjects: SubjectSummary[]
): ActivityGroup[] {
  const known = new Set(subjects.map((subject) => subject.id));
  const bySubject = new Map<string, Activity[]>();
  const orphans: Activity[] = [];

  for (const activity of activities) {
    if (activity.subjectId && known.has(activity.subjectId)) {
      const bucket = bySubject.get(activity.subjectId) ?? [];
      bucket.push(activity);
      bySubject.set(activity.subjectId, bucket);
    } else {
      orphans.push(activity);
    }
  }

  const groups: ActivityGroup[] = subjects
    .filter((subject) => (bySubject.get(subject.id)?.length ?? 0) > 0)
    .map((subject) => ({
      key: subject.id,
      name: subject.name,
      code: subject.code,
      activities: bySubject.get(subject.id) ?? []
    }));

  if (orphans.length > 0) {
    groups.push({ key: NO_SUBJECT_KEY, name: 'Sin asignatura', code: '', activities: orphans });
  }

  return groups;
}

/** `2026-03-14` in the browser locale, or `null` when there is no date. */
export function formatDueDate(dueAt: number | null): string | null {
  if (dueAt === null) return null;
  return new Date(dueAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}
