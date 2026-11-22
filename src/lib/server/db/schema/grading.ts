import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { activity, file, rubricCriterion, student } from './academic';

/**
 * Submissions and grading.
 *
 * A group work is ONE submission row with N members: grading it N times would
 * pay N model calls for the same text.
 *
 * `sha256` is the hash of the main document and the identity of the delivery
 * (F2.5): the same bytes handed in twice for the same activity are the same
 * submission. It is nullable because rows created before F2 had no hash, and
 * because matching never depends on it. `deleted_at` keeps removals reversible
 * without losing grading history.
 */
export const submission = pgTable(
	'submission',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activity.id, { onDelete: 'cascade' }),
		/** Resolved roster link. Null means "no match yet" and stays reversible. */
		studentId: uuid('student_id').references(() => student.id, { onDelete: 'set null' }),
		/** Name exactly as detected. Never overwritten: it is the evidence trail. */
		studentName: text('student_name'),
		title: text('title'),
		kind: text('kind', { enum: ['individual', 'group'] }).notNull().default('individual'),
		source: text('source', { enum: ['zip', 'pdf', 'text'] }).notNull().default('pdf'),
		status: text('status', { enum: ['pending', 'processing', 'graded', 'error'] })
			.notNull()
			.default('pending'),
		errorMessage: text('error_message'),
		/** Hash of the main document; `(activity_id, sha256)` dedupes deliveries. */
		sha256: text('sha256'),
		totalPoints: real('total_points'),
		maxPoints: real('max_points'),
		/** Overall comment the model writes for the whole delivery. */
		gradingSummary: text('grading_summary'),
		model: text('model'),
		promptTokens: integer('prompt_tokens'),
		completionTokens: integer('completion_tokens'),
		gradedAt: timestamp('graded_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		index('submission_activity_status_idx').on(t.activityId, t.status),
		index('submission_activity_created_idx').on(t.activityId, t.createdAt),
		index('submission_student_idx').on(t.studentId),
		uniqueIndex('submission_activity_sha_uq')
			.on(t.activityId, t.sha256)
			.where(sql`${t.deletedAt} is null and ${t.sha256} is not null`)
	]
);

export const submissionFile = pgTable(
	'submission_file',
	{
		submissionId: uuid('submission_id')
			.notNull()
			.references(() => submission.id, { onDelete: 'cascade' }),
		fileId: uuid('file_id')
			.notNull()
			.references(() => file.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['document', 'support'] }).notNull().default('document'),
		position: integer('position').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.submissionId, t.fileId] })]
);

export const submissionMember = pgTable(
	'submission_member',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		submissionId: uuid('submission_id')
			.notNull()
			.references(() => submission.id, { onDelete: 'cascade' }),
		studentId: uuid('student_id').references(() => student.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		isAuthor: boolean('is_author').notNull().default(false),
		position: integer('position').notNull().default(0)
	},
	(t) => [
		index('submission_member_submission_idx').on(t.submissionId),
		index('submission_member_student_idx').on(t.studentId)
	]
);

export const grade = pgTable(
	'grade',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		submissionId: uuid('submission_id')
			.notNull()
			.references(() => submission.id, { onDelete: 'cascade' }),
		criterionId: uuid('criterion_id')
			.notNull()
			.references(() => rubricCriterion.id, { onDelete: 'cascade' }),
		levelLabel: text('level_label'),
		points: real('points').notNull(),
		maxPoints: real('max_points').notNull(),
		feedback: text('feedback')
	},
	(t) => [
		uniqueIndex('grade_submission_criterion_uq').on(t.submissionId, t.criterionId),
		index('grade_criterion_idx').on(t.criterionId)
	]
);

/**
 * Cost lever: keyed by sha256(prompt + model). A cache hit never pays again.
 * Disposable by design — grades live in `grade`, never here.
 */
export const gradingCache = pgTable('grading_cache', {
	promptHash: text('prompt_hash').primaryKey(),
	responseJson: jsonb('response_json').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
