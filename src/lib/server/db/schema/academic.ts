import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Academic structure: files, subjects, students, rubrics and activities.
 *
 * Tables are declared in dependency order so every `references()` thunk points
 * at an already-initialized table. Keep that order when adding tables here.
 */

/** Uploaded PDFs/DOCX. The binary lives in R2; the rows here are metadata. */
export const file = pgTable(
	'file',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		storageKey: text('storage_key').notNull(),
		bucket: text('bucket').notNull(),
		originalName: text('original_name').notNull(),
		mime: text('mime').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		sha256: text('sha256').notNull(),
		extractedText: text('extracted_text'),
		extraction: text('extraction', { enum: ['pending', 'ok', 'empty', 'failed'] })
			.notNull()
			.default('pending'),
		/** Why the file was uploaded; drives the size/type rules applied on confirm. */
		uploadContext: text('upload_context', {
			enum: ['submission', 'submissionZip', 'sourceDocument', 'rubricImport']
		})
			.notNull()
			.default('submission'),
		uploadedBy: text('uploaded_by')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

		/** Metadatos extraídos por visión LLM cuando el PDF no tiene capa de texto. */
		metadataName: text('metadata_name'),
		metadataIntegrantes: text('metadata_integrantes'),
		metadataTitulo: text('metadata_titulo')
	},
	(t) => [index('file_sha256_idx').on(t.sha256), index('file_uploaded_by_idx').on(t.uploadedBy)]
);

export const subject = pgTable('subject', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	code: text('code'),
	term: text('term'),
	description: text('description'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp('deleted_at', { withTimezone: true })
});

/** Many-to-many: one subject can be taught by several teachers. */
export const subjectTeachers = pgTable(
	'subject_teachers',
	{
		subjectId: uuid('subject_id')
			.notNull()
			.references(() => subject.id, { onDelete: 'cascade' }),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.subjectId, t.teacherId] }),
		index('subject_teachers_teacher_idx').on(t.teacherId)
	]
);

/**
 * Roster of a subject. `match_key` is computed in code: lowercase, no accents,
 * no punctuation, tokens sorted alphabetically. That makes "Pérez, Juan",
 * "juan perez" and "Juan Pérez" resolve to the same student.
 */
export const student = pgTable(
	'student',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		subjectId: uuid('subject_id')
			.notNull()
			.references(() => subject.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		matchKey: text('match_key').notNull(),
		email: text('email'),
		externalId: text('external_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		uniqueIndex('student_subject_match_key_uq')
			.on(t.subjectId, t.matchKey)
			.where(sql`${t.deletedAt} is null`),
		index('student_subject_idx').on(t.subjectId)
	]
);

/** Reusable grading rubric owned by a teacher. Activities reference it. */
export const rubric = pgTable(
	'rubric',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		instruction: text('instruction'),
		answerTag: text('answer_tag').notNull().default('respuesta'),
		answerLabel: text('answer_label').notNull().default('Respuesta'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [index('rubric_teacher_idx').on(t.teacherId)]
);

export const rubricCriterion = pgTable(
	'rubric_criterion',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		rubricId: uuid('rubric_id')
			.notNull()
			.references(() => rubric.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		maxPoints: real('max_points').notNull(),
		weight: real('weight').notNull().default(1),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('rubric_criterion_rubric_idx').on(t.rubricId)]
);

/**
 * Default context blocks of a rubric (the "rúbrica" in the UI). When an
 * activity is created from a rubric these are copied into `activity_context`,
 * which holds the real per-activity text.
 */
export const rubricContext = pgTable(
	'rubric_context',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		rubricId: uuid('rubric_id')
			.notNull()
			.references(() => rubric.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull(),
		label: text('label').notNull(),
		placeholder: text('placeholder').notNull().default(''),
		position: integer('position').notNull().default(0)
	},
	(t) => [
		uniqueIndex('rubric_context_tag_uq').on(t.rubricId, t.tag),
		index('rubric_context_rubric_idx').on(t.rubricId)
	]
);

/**
 * Optional scoring levels per criterion ("Excelente" 5, "Bueno" 1, "Deficiente" 0).
 * When levels exist the model picks a label and the points are resolved in code.
 */
export const rubricLevel = pgTable(
	'rubric_level',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		criterionId: uuid('criterion_id')
			.notNull()
			.references(() => rubricCriterion.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		points: real('points').notNull(),
		description: text('description'),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('rubric_level_criterion_idx').on(t.criterionId)]
);

export const activity = pgTable(
	'activity',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/**
		 * Optional while subjects have no CRUD of their own (F5.2): a teacher can
		 * draft activities and assign them to a subject later.
		 */
		subjectId: uuid('subject_id').references(() => subject.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		description: text('description'),
		objectives: text('objectives'),
		instructions: text('instructions'),
		sourceFileId: uuid('source_file_id').references(() => file.id, { onDelete: 'set null' }),
		/** ZIP of deliveries last processed for this activity, plus how many files it yielded. */
		submissionsZipFileId: uuid('submissions_zip_file_id').references(() => file.id, {
			onDelete: 'set null'
		}),
		submissionsZipFileCount: integer('submissions_zip_file_count').notNull().default(0),
		rubricId: uuid('rubric_id').references(() => rubric.id, { onDelete: 'set null' }),
		dueAt: timestamp('due_at', { withTimezone: true }),
		status: text('status', { enum: ['draft', 'open', 'closed'] }).notNull().default('draft'),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		index('activity_subject_status_idx').on(t.subjectId, t.status),
		index('activity_created_by_idx').on(t.createdBy)
	]
);

/**
 * Delivery files staged for one activity, before the teacher groups them into
 * submissions. The ZIP ingest writes here so `/revisar/[id]` can list what is
 * still pending; `submission_file` is the definitive grouping.
 */
export const activityFile = pgTable(
	'activity_file',
	{
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activity.id, { onDelete: 'cascade' }),
		fileId: uuid('file_id')
			.notNull()
			.references(() => file.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.activityId, t.fileId] }),
		index('activity_file_file_idx').on(t.fileId)
	]
);

/** Dynamic context blocks defined by the teacher (the "texto base" lives here). */
export const activityContext = pgTable(
	'activity_context',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activity.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull(),
		label: text('label').notNull(),
		content: text('content').notNull().default(''),
		position: integer('position').notNull().default(0)
	},
	(t) => [uniqueIndex('activity_context_tag_uq').on(t.activityId, t.tag)]
);
