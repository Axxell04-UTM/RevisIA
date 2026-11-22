export type Criterion = {
  id: string;
  name: string;
  description: string;
  maxPoints: number;
  weight: number;
  levels: RubricLevel[];
};

export type RubricLevel = {
  id: string;
  label: string;
  points: number;
  description: string;
  position: number;
};

export type ContextBlock = {
  id: string;
  tag: string;
  label: string;
  placeholder: string;
};

export type Template = {
  id: string;
  name: string;
  instruction: string;
  answerTag: string;
  answerLabel: string;
  contexts: ContextBlock[];
  criteria: Criterion[];
  createdAt: number;
  updatedAt: number;
};

export type Answer = {
  id: string;
  student: string;
  text: string;
};

export type CriterionScore = {
  criterionId: string;
  criterionName: string;
  points: number;
  maxPoints: number;
  feedback: string;
};

export type StudentGrade = {
  index: number;
  student: string;
  scores: CriterionScore[];
  total: number;
  maxTotal: number;
  summary: string;
};

/** One persisted criterion grade of one delivery. */
export type SubmissionGrade = {
  criterionId: string;
  criterionName: string;
  levelLabel: string | null;
  points: number;
  maxPoints: number;
  feedback: string | null;
};

export type Run = {
  id: string;
  templateId: string;
  templateName: string;
  contexts: Record<string, string>;
  answers: Answer[];
  grades: StudentGrade[];
  createdAt: number;
  model: string;
};

export type ActivityContextBlock = {
  id: string;
  tag: string;
  label: string;
  content: string;
};

export type ActivityStatus = 'draft' | 'open' | 'closed';

export type Activity = {
  id: string;
  subjectId: string | null;
  title: string;
  description: string;
  objectives: string;
  instructions: string;
  sourceFileId: string | null;
  /** Last deliveries ZIP processed for this activity; `null` until one succeeds. */
  submissionsZip: { fileId: string; fileCount: number } | null;
  rubricId: string | null;
  dueAt: number | null;
  status: ActivityStatus;
  contexts: ActivityContextBlock[];
  /** Derived from the rubric criteria; `null` when the activity has no rubric. */
  maxPoints: number | null;
  createdAt: number;
  updatedAt: number;
};

export type SubjectSummary = {
  id: string;
  name: string;
  code: string;
  term: string;
};

/** One student in a subject's roster. `matchKey` is derived, never edited. */
export type Student = {
	id: string;
	subjectId: string;
	name: string;
	/** Canonical form of `name`; the only thing delivery matching compares. */
	matchKey: string;
	email: string | null;
	externalId: string | null;
	createdAt: number;
};

export type SubmissionStatus = 'pending' | 'processing' | 'graded' | 'error';
export type SubmissionKind = 'individual' | 'group';
export type SubmissionSource = 'zip' | 'pdf' | 'text';

/** Delivery counters for one activity; `graded` is always a subset of `total`. */
export type SubmissionCounts = {
  total: number;
  graded: number;
};

export type Submission = {
  id: string;
  activityId: string;
  studentId: string | null;
  studentName: string | null;
  title: string | null;
  kind: SubmissionKind;
  source: SubmissionSource;
  status: SubmissionStatus;
  errorMessage: string | null;
  sha256: string | null;
  totalPoints: number | null;
  maxPoints: number | null;
  /** Overall comment of the last grading; `null` until the delivery is graded. */
  gradingSummary: string | null;
  createdAt: number;
};

/** One file attached to a submission; ZIP ingest produces several. */
export type SubmissionFileRef = {
  fileId: string;
  fileName: string;
  mime: string;
  role: 'document' | 'support',
  extraction: 'pending' | 'ok' | 'empty' | 'failed',
  extractedChars: number;
  /** Name the document header printed, as found by the metadata pass. */
  metadataName: string | null;
};

export type SubmissionMemberRef = {
  id: string;
  studentId: string | null;
  name: string;
  isAuthor: boolean;
};

/** A submission with its files, its group members and the roster student, if matched. */
export type SubmissionListItem = Submission & {
  files: SubmissionFileRef[];
  members: SubmissionMemberRef[];
  studentRosterName: string | null;
  /** Persisted per-criterion grades, in rubric order. Empty until graded. */
  grades: SubmissionGrade[];
};

/** A file extracted for an activity that is not grouped into a delivery yet. */
export type PendingSubmissionFile = {
  fileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  extraction: SubmissionFileRef['extraction'];
  extractedChars: number;
  createdAt: number;
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'tag';
}
