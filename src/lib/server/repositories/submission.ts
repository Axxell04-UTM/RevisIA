import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import {
	activity,
	activityFile,
	file,
	grade,
	rubricCriterion,
	student,
	subject,
	submission,
	submissionFile,
	submissionMember
} from '#lib/server/db/schema/index.js';
import type {
	PendingSubmissionFile,
	Submission,
	SubmissionCounts,
	SubmissionFileRef,
	SubmissionGrade,
	SubmissionKind,
	SubmissionListItem,
	SubmissionMemberRef,
	SubmissionSource,
	SubmissionStatus
} from '#lib/domain/types.js';
import {
	deserializeMembers,
	serializeMembers,
	type DocumentMetadata
} from '#lib/domain/metadata.js';
import { parseMoodleFileName, resolveRosterMatch } from '#lib/domain/roster.js';
import { isUuid } from './rubric.js';

/**
 * Repository for "entregas": one student — or one group — handing in for one
 * activity.
 *
 * A submission owns N files (`submission_file`) and N members
 * (`submission_member`). A group is ONE submission with several members, so
 * grading happens once per delivery, not once per student.
 *
 * Identity is `(activity_id, sha256)` where `sha256` is the hash of the main
 * document: the same bytes handed in twice for the same activity are the same
 * submission, so re-uploading is idempotent. The bytes themselves live in
 * `file`, which is also where the extracted text lives.
 */

export type SubmissionFileInput = {
	fileId: string;
	role?: 'document' | 'support';
};

export type SubmissionInput = {
	activityId: string;
	/** First entry is the main document: its hash is the delivery identity. */
	files: SubmissionFileInput[];
	/** Name as it appeared in the file or its header, before matching. */
	studentName?: string | null;
	title?: string | null;
	kind?: SubmissionKind;
	source?: SubmissionSource;
};

export type CreateSubmissionResult = {
	submission: Submission;
	/** True when an equivalent submission already existed and was returned as-is. */
	duplicate: boolean;
};

function toSubmission(row: typeof submission.$inferSelect): Submission {
	return {
		id: row.id,
		activityId: row.activityId,
		studentId: row.studentId,
		studentName: row.studentName,
		title: row.title,
		kind: row.kind as SubmissionKind,
		source: row.source as SubmissionSource,
		status: row.status as SubmissionStatus,
		errorMessage: row.errorMessage,
		sha256: row.sha256,
		totalPoints: row.totalPoints,
		maxPoints: row.maxPoints,
		gradingSummary: row.gradingSummary,
		createdAt: row.createdAt.getTime()
	};
}

/**
 * Registers one delivery.
 *
 * Rejects an activity or a file the teacher does not own, and a file that was
 * never confirmed (empty `sha256`): without the hash there is no dedupe and no
 * proof that the bytes are what the upload claimed.
 */
export async function createSubmission(
	teacherId: string,
	input: SubmissionInput
): Promise<CreateSubmissionResult> {
	if (!isUuid(input.activityId)) throw new Error('Actividad inválida');
	if (input.files.length === 0) throw new Error('La entrega necesita al menos un archivo');
	const fileIds = input.files.map((entry) => entry.fileId);
	if (fileIds.some((id) => !isUuid(id))) throw new Error('Archivo inválido');
	if (new Set(fileIds).size !== fileIds.length) throw new Error('Archivo repetido en la entrega');

	const db = getDb();

	return db.transaction(async (tx) => {
		const [ownedActivity] = await tx
			.select({ id: activity.id, subjectId: activity.subjectId })
			.from(activity)
			.where(
				and(
					eq(activity.id, input.activityId),
					eq(activity.createdBy, teacherId),
					isNull(activity.deletedAt)
				)
			)
			.limit(1);
		if (!ownedActivity) throw new Error('La actividad no existe o no pertenece a este docente');

		const ownedFiles = await tx
			.select({
				id: file.id,
				sha256: file.sha256,
				originalName: file.originalName
			})
			.from(file)
			.where(and(inArray(file.id, fileIds), eq(file.uploadedBy, teacherId)));
		if (ownedFiles.length !== fileIds.length) {
			throw new Error('Algún archivo no existe o no pertenece a este docente');
		}

		// A file staged for one activity cannot silently move to another: the
		// review screen groups files by activity and a cross-activity delivery
		// would put another activity's document under this rubric.
		const stagedElsewhere = await tx
			.select({ fileId: activityFile.fileId })
			.from(activityFile)
			.where(
				and(
					inArray(activityFile.fileId, fileIds),
					ne(activityFile.activityId, input.activityId)
				)
			)
			.limit(1);
		if (stagedElsewhere.length > 0) {
			throw new Error('Algún archivo pertenece a otra actividad');
		}

		const linked = await tx
			.select({ fileId: submissionFile.fileId })
			.from(submissionFile)
			.innerJoin(submission, eq(submission.id, submissionFile.submissionId))
			.where(and(inArray(submissionFile.fileId, fileIds), isNull(submission.deletedAt)));
		if (linked.length > 0) {
			throw new Error('Algún archivo ya está en otra entrega');
		}

		const byId = new Map(ownedFiles.map((row) => [row.id, row]));
		const mainSha = byId.get(fileIds[0])?.sha256 ?? '';
		if (!mainSha) {
			throw new Error('El archivo todavía no fue confirmado: subilo antes de registrar la entrega');
		}

		const [existing] = await tx
			.select()
			.from(submission)
			.where(
				and(
					eq(submission.activityId, input.activityId),
					eq(submission.sha256, mainSha),
					isNull(submission.deletedAt)
				)
			)
			.limit(1);
		if (existing) return { submission: toSubmission(existing), duplicate: true };

		// One file is an individual delivery. Several files remain supported for
		// legacy group deliveries, but the review screen creates one delivery per
		// file and never turns a selection into a group (F2 2.11: a group is one
		// delivery with several members).
		const suggested =
			fileIds.length === 1 ? parseMoodleFileName(byId.get(fileIds[0])?.originalName ?? '') : null;

		// A file name is a *hint*, not an identity: "Documento-RevisIA.pdf" is a
		// perfectly ordinary file name that no person is called. The name is only
		// accepted when it resolves to one roster student by canonical key, and
		// that match links the delivery in the same step. Without a match the
		// delivery stays "sin identificar" until the header pass or the teacher
		// says who it belongs to.
		let matched: { id: string; name: string } | null = null;
		if (suggested && ownedActivity.subjectId) {
			const roster = await tx
				.select({ id: student.id, name: student.name, matchKey: student.matchKey })
				.from(student)
				.where(and(eq(student.subjectId, ownedActivity.subjectId), isNull(student.deletedAt)));
			const match = resolveRosterMatch(suggested.name, roster);
			if (match) matched = roster.find((entry) => entry.id === match.studentId) ?? null;
		}

		const [created] = await tx
			.insert(submission)
			.values({
				activityId: input.activityId,
				sha256: mainSha,
				studentId: matched?.id ?? null,
				studentName: input.studentName?.trim() || matched?.name || null,
				title: input.title?.trim() || null,
				kind: input.kind ?? (input.files.length > 1 ? 'group' : 'individual'),
				source: input.source ?? 'pdf'
			})
			.returning();

		await tx
			.insert(activityFile)
			.values(fileIds.map((fileId) => ({ activityId: input.activityId, fileId })))
			.onConflictDoNothing();

		await tx.insert(submissionFile).values(
			input.files.map((entry, position) => ({
				submissionId: created.id,
				fileId: entry.fileId,
				role: entry.role ?? (position === 0 ? 'document' : 'support'),
				position
			}))
		);

		return { submission: toSubmission(created), duplicate: false };
	});
}

/** Submissions of one activity, oldest first so the review table is stable. */
export async function listSubmissions(
	teacherId: string,
	activityId: string
): Promise<SubmissionListItem[]> {
	if (!isUuid(activityId)) return [];

	const db = getDb();
	const rows = await db
		.select({ submission: submission, rosterName: student.name })
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.leftJoin(student, eq(student.id, submission.studentId))
		.where(
			and(
				eq(submission.activityId, activityId),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.orderBy(asc(submission.createdAt));

	if (rows.length === 0) return [];
	const submissionIds = rows.map((row) => row.submission.id);

	const fileRows = await db
		.select({
			submissionId: submissionFile.submissionId,
			fileId: file.id,
			fileName: file.originalName,
			mime: file.mime,
			role: submissionFile.role,
			extraction: file.extraction,
			extractedChars: sql<number>`coalesce(length(${file.extractedText}), 0)`,
			metadataName: file.metadataName
		})
		.from(submissionFile)
		.innerJoin(file, eq(file.id, submissionFile.fileId))
		.where(inArray(submissionFile.submissionId, submissionIds))
		.orderBy(asc(submissionFile.position));

	const memberRows = await db
		.select()
		.from(submissionMember)
		.where(inArray(submissionMember.submissionId, submissionIds))
		.orderBy(asc(submissionMember.position));

	// Persisted grades come from `grade`, ordered by the rubric's criterion
	// position so the report reads the same way the rubric does.
	const gradeRows = await db
		.select({
			submissionId: grade.submissionId,
			criterionId: grade.criterionId,
			criterionName: rubricCriterion.name,
			levelLabel: grade.levelLabel,
			points: grade.points,
			maxPoints: grade.maxPoints,
			feedback: grade.feedback
		})
		.from(grade)
		.innerJoin(rubricCriterion, eq(rubricCriterion.id, grade.criterionId))
		.where(inArray(grade.submissionId, submissionIds))
		.orderBy(asc(rubricCriterion.position));

	const filesBySubmission = new Map<string, SubmissionFileRef[]>();
	for (const row of fileRows) {
		const bucket = filesBySubmission.get(row.submissionId) ?? [];
		bucket.push({
			fileId: row.fileId,
			fileName: row.fileName,
			mime: row.mime,
			role: row.role as SubmissionFileRef['role'],
			extraction: row.extraction as SubmissionFileRef['extraction'],
			extractedChars: Number(row.extractedChars),
			metadataName: row.metadataName ?? null
		});
		filesBySubmission.set(row.submissionId, bucket);
	}

	const membersBySubmission = new Map<string, SubmissionMemberRef[]>();
	for (const row of memberRows) {
		const bucket = membersBySubmission.get(row.submissionId) ?? [];
		bucket.push({
			id: row.id,
			studentId: row.studentId,
			name: row.name,
			isAuthor: row.isAuthor
		});
		membersBySubmission.set(row.submissionId, bucket);
	}

	const gradesBySubmission = new Map<string, SubmissionGrade[]>();
	for (const row of gradeRows) {
		const bucket = gradesBySubmission.get(row.submissionId) ?? [];
		bucket.push({
			criterionId: row.criterionId,
			criterionName: row.criterionName,
			levelLabel: row.levelLabel,
			points: row.points,
			maxPoints: row.maxPoints,
			feedback: row.feedback
		});
		gradesBySubmission.set(row.submissionId, bucket);
	}

	return rows.map((row) => ({
		...toSubmission(row.submission),
		files: filesBySubmission.get(row.submission.id) ?? [],
		members: membersBySubmission.get(row.submission.id) ?? [],
		studentRosterName: row.rosterName ?? null,
		grades: gradesBySubmission.get(row.submission.id) ?? []
	}));
}

/**
 * Files extracted for one activity that are not part of a live delivery yet.
 *
 * The ZIP ingest intentionally does not create submissions: processing them is
 * the teacher's decision. This is the input for that decision, deduplicated by
 * `sha256` because processing the same archive twice stores the bytes again.
 * A file whose bytes already back a live delivery is not pending either.
 */
export async function listPendingSubmissionFiles(
	teacherId: string,
	activityId: string
): Promise<PendingSubmissionFile[]> {
	if (!isUuid(activityId)) return [];

	const rows = await getDb()
		.selectDistinctOn([file.sha256], {
			fileId: file.id,
			fileName: file.originalName,
			mime: file.mime,
			sizeBytes: file.sizeBytes,
			sha256: file.sha256,
			extraction: file.extraction,
			extractedChars: sql<number>`coalesce(length(${file.extractedText}), 0)`,
			createdAt: file.createdAt
		})
		.from(file)
		.innerJoin(activityFile, eq(activityFile.fileId, file.id))
		.innerJoin(activity, eq(activity.id, activityFile.activityId))
		.where(
			and(
				eq(activityFile.activityId, activityId),
				eq(file.uploadedBy, teacherId),
				eq(activity.createdBy, teacherId),
				isNull(activity.deletedAt),
				eq(file.uploadContext, 'submission'),
				sql`${file.sha256} <> ''`,
				sql`not exists (
					select 1
					from ${submissionFile} sf
					inner join ${submission} s on s.id = sf.submission_id
					where sf.file_id = ${file.id} and s.deleted_at is null
				)`,
				sql`not exists (
					select 1
					from ${submission} s
					where s.activity_id = ${activityFile.activityId}
						and s.sha256 = ${file.sha256}
						and s.deleted_at is null
				)`
			)
		)
		.orderBy(file.sha256, desc(file.createdAt));

	return rows.map((row) => ({
		fileId: row.fileId,
		fileName: row.fileName,
		mime: row.mime,
		sizeBytes: row.sizeBytes,
		sha256: row.sha256,
		extraction: row.extraction as PendingSubmissionFile['extraction'],
		extractedChars: Number(row.extractedChars),
		createdAt: row.createdAt.getTime()
	}));
}

/** A confirmed delivery file that was staged for one activity. */
export type StagedSubmissionFile = {
	fileId: string;
	fileName: string;
	sha256: string;
};

/**
 * Stages ONE already-confirmed delivery file in an activity.
 *
 * The ZIP ingest creates the `file` rows and links them itself; a single upload
 * arrives through the generic sign/confirm flow, so the link is the only missing
 * step before the review screen can list it as pending.
 *
 * Confirmed means `sha256` is non-empty: the bytes were downloaded, hashed and
 * sniffed on confirm. A pending row was never verified and must not become a
 * delivery, so it is rejected here.
 *
 * Re-staging the same file is a no-op instead of an error: `activity_file` is
 * keyed by `(activity_id, file_id)`, and the teacher may click twice.
 */
export async function linkSubmissionFileToActivity(
	teacherId: string,
	activityId: string,
	fileId: string
): Promise<StagedSubmissionFile | null> {
	if (!isUuid(activityId) || !isUuid(fileId)) return null;
	const db = getDb();

	const [owned] = await db
		.select({ id: activity.id })
		.from(activity)
		.where(
			and(
				eq(activity.id, activityId),
				eq(activity.createdBy, teacherId),
				isNull(activity.deletedAt)
			)
		)
		.limit(1);
	if (!owned) return null;

	const [record] = await db
		.select({ id: file.id, fileName: file.originalName, sha256: file.sha256 })
		.from(file)
		.where(
			and(
				eq(file.id, fileId),
				eq(file.uploadedBy, teacherId),
				eq(file.uploadContext, 'submission')
			)
		)
		.limit(1);
	if (!record || !record.sha256) return null;

	await db.insert(activityFile).values({ activityId, fileId }).onConflictDoNothing();

	return { fileId: record.id, fileName: record.fileName, sha256: record.sha256 };
}

/** How one file must be processed: as a new individual delivery or as a retry. */
export type FileProcessingState =
	| { status: 'pending' }
	| { status: 'linked'; submission: Submission };

/**
 * Resolves one submission file of the activity for processing.
 *
 * `pending` means the file is staged but owns no delivery: processing creates
 * its own individual delivery. `linked` means a live delivery already owns the
 * bytes, so processing only re-extracts the text (the retry path).
 *
 * Anything outside the teacher's activity, or uploaded by someone else, is
 * `null`: this endpoint must never reach another activity's files.
 */
export async function getFileProcessingState(
	teacherId: string,
	activityId: string,
	fileId: string
): Promise<FileProcessingState | null> {
	if (!isUuid(activityId) || !isUuid(fileId)) return null;
	const db = getDb();

	const [staged] = await db
		.select({ fileId: file.id })
		.from(file)
		.innerJoin(activityFile, eq(activityFile.fileId, file.id))
		.innerJoin(activity, eq(activity.id, activityFile.activityId))
		.where(
			and(
				eq(file.id, fileId),
				eq(file.uploadedBy, teacherId),
				eq(file.uploadContext, 'submission'),
				eq(activityFile.activityId, activityId),
				eq(activity.createdBy, teacherId),
				isNull(activity.deletedAt)
			)
		)
		.limit(1);
	if (!staged) return null;

	const [linkedRow] = await db
		.select({ submission: submission })
		.from(submissionFile)
		.innerJoin(submission, eq(submission.id, submissionFile.submissionId))
		.where(and(eq(submissionFile.fileId, fileId), isNull(submission.deletedAt)))
		.limit(1);
	if (linkedRow) {
		// A delivery of another activity would put these bytes under the wrong
		// rubric, so it is not a valid retry target here.
		if (linkedRow.submission.activityId !== activityId) return null;
		return { status: 'linked', submission: toSubmission(linkedRow.submission) };
	}

	return { status: 'pending' };
}

/**
 * Deliveries per activity, for the sidebar and the subject overview.
 *
 * Counts are scoped by the activity's owner so a caller that passes a stray id
 * cannot read another teacher's numbers. One grouped query for the whole list.
 */
export async function countSubmissionsByActivity(
	teacherId: string,
	activityIds: string[]
): Promise<Map<string, SubmissionCounts>> {
	const ids = activityIds.filter(isUuid);
	if (ids.length === 0) return new Map();

	const rows = await getDb()
		.select({
			activityId: submission.activityId,
			total: sql<number>`count(*)`,
			graded: sql<number>`count(*) filter (where ${submission.status} = 'graded')`
		})
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.where(
			and(
				inArray(submission.activityId, ids),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.groupBy(submission.activityId);

	return new Map(
		rows.map((row) => [row.activityId, { total: Number(row.total), graded: Number(row.graded) }])
	);
}

/**
 * Links a submission to a roster student, or clears the link with `null`.
 *
 * Clearing is the "sin match reversible" requirement (F2.9): a bad match must
 * be undoable without deleting the delivery.
 */
export async function attachStudent(
	teacherId: string,
	submissionId: string,
	studentId: string | null
): Promise<Submission | null> {
	if (!isUuid(submissionId)) return null;
	const db = getDb();

	const [owned] = await db
		.select({ id: submission.id })
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.where(
			and(
				eq(submission.id, submissionId),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.limit(1);
	if (!owned) return null;

	if (studentId) {
		if (!isUuid(studentId)) throw new Error('Estudiante inválido');
		const [studentRow] = await db
			.select({ id: student.id })
			.from(student)
			.where(and(eq(student.id, studentId), isNull(student.deletedAt)))
			.limit(1);
		if (!studentRow) throw new Error('El estudiante no existe');
	}

	const [updated] = await db
		.update(submission)
		.set({ studentId })
		.where(eq(submission.id, submissionId))
		.returning();
	return updated ? toSubmission(updated) : null;
}

/**
 * Adds the members of a group delivery. `studentId` stays optional because a
 * member may not be in the roster yet; `name` is always kept.
 */
export async function setMembers(
	teacherId: string,
	submissionId: string,
	members: { studentId?: string | null; name: string; isAuthor?: boolean }[]
): Promise<SubmissionMemberRef[]> {
	if (!isUuid(submissionId)) throw new Error('Entrega inválida');
	const db = getDb();

	const [owned] = await db
		.select({ id: submission.id })
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.where(
			and(
				eq(submission.id, submissionId),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.limit(1);
	if (!owned) throw new Error('La entrega no existe o no pertenece a este docente');

	await db.delete(submissionMember).where(eq(submissionMember.submissionId, submissionId));

	if (members.length > 0) {
		await db.insert(submissionMember).values(
			members.map((member, position) => ({
				submissionId,
				studentId: member.studentId ?? null,
				name: member.name.trim(),
				isAuthor: member.isAuthor ?? position === 0,
				position
			}))
		);
	}

	// The group is defined by its members, never by how many files arrived
	// together: one delivery with two or more members is a group delivery.
	await db
		.update(submission)
		.set({ kind: members.length > 1 ? 'group' : 'individual' })
		.where(eq(submission.id, submissionId));

	const rows = await db
		.select()
		.from(submissionMember)
		.where(eq(submissionMember.submissionId, submissionId))
		.orderBy(asc(submissionMember.position));

	return rows.map((row) => ({
		id: row.id,
		studentId: row.studentId,
		name: row.name,
		isAuthor: row.isAuthor
	}));
}

/** Soft delete: the files stay stored and the activity keeps its history. */
export async function deleteSubmission(teacherId: string, id: string): Promise<boolean> {
	if (!isUuid(id)) return false;
	const db = getDb();

	const [owned] = await db
		.select({ id: submission.id })
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.where(
			and(
				eq(submission.id, id),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.limit(1);
	if (!owned) return false;

	const rows = await db
		.update(submission)
		.set({ deletedAt: new Date() })
		.where(eq(submission.id, id))
		.returning({ id: submission.id });

	return rows.length > 0;
}

/**
 * Updates the editable details of a submission.
 *
 * `title` is the work's title and `studentName` is the name printed in the
 * document header: both are nullable and only the keys present in `input` are
 * written, so saving one never clears the other.
 */
export async function updateSubmissionDetails(
	teacherId: string,
	submissionId: string,
	input: { title?: string | null; studentName?: string | null }
): Promise<Submission | null> {
	if (!isUuid(submissionId)) return null;
	const db = getDb();

	const [owned] = await db
		.select({ id: submission.id })
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.where(
			and(
				eq(submission.id, submissionId),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.limit(1);
	if (!owned) return null;

	const values: { title?: string | null; studentName?: string | null } = {};
	if (input.title !== undefined) values.title = input.title;
	if (input.studentName !== undefined) values.studentName = input.studentName;

	const [updated] = await db
		.update(submission)
		.set(values)
		.where(eq(submission.id, submissionId))
		.returning();

	return updated ? toSubmission(updated) : null;
}

/** The document the header is read from, plus any metadata already extracted. */
export type SubmissionMainFile = {
	/** Activity the delivery belongs to; the grading pass needs its rubric. */
	activityId: string;
	/** Subject of the activity: its roster is what a header name can match. */
	subjectId: string | null;
	/** Activity the delivery belongs to plus its subject, as prompt reference. */
	activityTitle: string;
	subjectName: string | null;
	fileId: string;
	fileName: string;
	mime: string;
	extraction: 'pending' | 'ok' | 'empty' | 'failed';
	extractedText: string | null;
	/** Editable values already stored on the delivery. */
	title: string | null;
	studentId: string | null;
	/** Name detected on the delivery and the roster name it was linked to. */
	studentName: string | null;
	rosterName: string | null;
	metadata: DocumentMetadata;
};

/**
 * Main document of one delivery, scoped to the teacher who owns the activity.
 *
 * Metadata extraction reads the *main* file (position 0): a support file can be
 * a scan of something unrelated, so it must never define who the author is.
 */
export async function getSubmissionMainFile(
	teacherId: string,
	submissionId: string
): Promise<SubmissionMainFile | null> {
	if (!isUuid(submissionId)) return null;
	const db = getDb();

	const [row] = await db
		.select({
			activityId: submission.activityId,
			subjectId: activity.subjectId,
			activityTitle: activity.title,
			subjectName: subject.name,
			fileId: file.id,
			fileName: file.originalName,
			mime: file.mime,
			extraction: file.extraction,
			extractedText: file.extractedText,
			title: submission.title,
			studentId: submission.studentId,
			studentName: submission.studentName,
			rosterName: student.name,
			metadataName: file.metadataName,
			metadataIntegrantes: file.metadataIntegrantes,
			metadataTitulo: file.metadataTitulo
		})
		.from(submission)
		.innerJoin(activity, eq(activity.id, submission.activityId))
		.innerJoin(submissionFile, eq(submissionFile.submissionId, submission.id))
		.innerJoin(file, eq(file.id, submissionFile.fileId))
		.leftJoin(student, eq(student.id, submission.studentId))
		.leftJoin(subject, eq(subject.id, activity.subjectId))
		.where(
			and(
				eq(submission.id, submissionId),
				eq(activity.createdBy, teacherId),
				isNull(submission.deletedAt)
			)
		)
		.orderBy(asc(submissionFile.position))
		.limit(1);

	if (!row) return null;

	return {
		activityId: row.activityId,
		subjectId: row.subjectId ?? null,
		activityTitle: row.activityTitle,
		subjectName: row.subjectName ?? null,
		fileId: row.fileId,
		fileName: row.fileName,
		mime: row.mime,
		extraction: row.extraction as SubmissionMainFile['extraction'],
		extractedText: row.extractedText,
		title: row.title,
		studentId: row.studentId,
		studentName: row.studentName,
		rosterName: row.rosterName,
		metadata: {
			name: row.metadataName,
			members: deserializeMembers(row.metadataIntegrantes),
			title: row.metadataTitulo
		}
	};
}

/**
 * Stores a metadata suggestion on the file. Called only with values that came
 * from the model, and only for a file the teacher uploaded.
 */
export async function saveFileMetadata(
	teacherId: string,
	fileId: string,
	metadata: DocumentMetadata
): Promise<boolean> {
	if (!isUuid(fileId)) return false;
	const db = getDb();

	const rows = await db
		.update(file)
		.set({
			metadataName: metadata.name,
			metadataIntegrantes: serializeMembers(metadata.members),
			metadataTitulo: metadata.title
		})
		.where(and(eq(file.id, fileId), eq(file.uploadedBy, teacherId)))
		.returning({ id: file.id });

	return rows.length > 0;
}

export type SubmissionGradeInput = {
	/** One entry per rubric criterion. `criterionId` must be a real criterion row. */
	grades: {
		criterionId: string;
		levelLabel?: string | null;
		points: number;
		maxPoints: number;
		feedback?: string | null;
	}[];
	totalPoints: number;
	maxPoints: number;
	summary?: string | null;
	model?: string | null;
	promptTokens?: number | null;
	completionTokens?: number | null;
};

/**
 * Persists the grade of one delivery.
 *
 * `grade` is the per-criterion record and `submission` carries the totals, so
 * both are written in one transaction. A criterion that does not belong to the
 * activity's rubric is rejected instead of being inserted: the foreign key only
 * proves the criterion exists, not that it is the one this activity grades.
 *
 * Re-grading replaces the previous attempt: the old rows are deleted first, so
 * a delivery has exactly one grade per criterion and no stale feedback survives.
 */
export async function saveSubmissionGrades(
	teacherId: string,
	submissionId: string,
	input: SubmissionGradeInput
): Promise<Submission | null> {
	if (!isUuid(submissionId)) return null;
	if (!Array.isArray(input.grades) || input.grades.length === 0) {
		throw new Error('La calificación necesita al menos un criterio');
	}
	const criterionIds = input.grades.map((row) => row.criterionId);
	if (criterionIds.some((id) => !isUuid(id))) throw new Error('Criterio inválido');

	const db = getDb();

	return db.transaction(async (tx) => {
		const [owned] = await tx
			.select({ submissionId: submission.id, rubricId: activity.rubricId })
			.from(submission)
			.innerJoin(activity, eq(activity.id, submission.activityId))
			.where(
				and(
					eq(submission.id, submissionId),
					eq(activity.createdBy, teacherId),
					isNull(submission.deletedAt)
				)
			)
			.limit(1);
		if (!owned) return null;
		if (!owned.rubricId) throw new Error('La actividad no tiene rúbrica asignada');

		const validCriteria = await tx
			.select({ id: rubricCriterion.id })
			.from(rubricCriterion)
			.where(
				and(
					eq(rubricCriterion.rubricId, owned.rubricId),
					inArray(rubricCriterion.id, criterionIds)
				)
			);
		if (validCriteria.length !== new Set(criterionIds).size) {
			throw new Error('Algún criterio no pertenece a la rúbrica de la actividad');
		}

		await tx.delete(grade).where(eq(grade.submissionId, submissionId));

		await tx.insert(grade).values(
			input.grades.map((row) => ({
				submissionId,
				criterionId: row.criterionId,
				levelLabel: row.levelLabel ?? null,
				points: row.points,
				maxPoints: row.maxPoints,
				feedback: row.feedback ?? null
			}))
		);

		const [updated] = await tx
			.update(submission)
			.set({
				status: 'graded',
				totalPoints: input.totalPoints,
				maxPoints: input.maxPoints,
				gradingSummary: input.summary ?? null,
				model: input.model ?? null,
				promptTokens: input.promptTokens ?? null,
				completionTokens: input.completionTokens ?? null,
				gradedAt: new Date()
			})
			.where(eq(submission.id, submissionId))
			.returning();

		return updated ? toSubmission(updated) : null;
	});
}
