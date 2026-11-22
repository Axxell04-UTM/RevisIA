import { completeJson, type JsonCompletionOptions, type StructuredResult } from './ai.js';
import {
	buildMetadataPrompt,
	hasMetadata,
	headerSlice,
	metadataEquals,
	METADATA_JSON_SCHEMA,
	normalizeMetadata,
	planMetadataApplication,
	sanitizeMetadata,
	type DocumentMetadata,
	type MetadataContext
} from '#lib/domain/metadata.js';
import {
	getSubmissionMainFile,
	attachStudent,
	saveFileMetadata,
	updateSubmissionDetails
} from './repositories/submission.js';
import { listStudents } from './repositories/student.js';

/**
 * Metadata extraction from the header of a delivery's main document (F2/S9).
 *
 * Three rules keep this honest:
 * - The model only ever sees the header slice, never the whole document, so a
 *   name printed on page 6 cannot become the author by accident.
 * - The result is a *suggestion* stored next to the file. Nothing writes to the
 *   submission here; the teacher confirms in the review table.
 * - A stored suggestion is only reused when it still survives the current
 *   guards; a suggestion from an older, looser prompt is re-extracted instead of
 *   being shown as if it were fresh.
 */

export type MetadataErrorCode = 'not_found' | 'no_text' | 'model';

export class MetadataExtractionError extends Error {
	constructor(
		message: string,
		readonly code: MetadataErrorCode
	) {
		super(message);
		this.name = 'MetadataExtractionError';
	}
}

export type SubmissionMetadataResult = {
	metadata: DocumentMetadata;
	/** `cache` means the suggestion was already stored for this file. */
	source: 'model' | 'cache';
	fileId: string;
	fileName: string;
};

export type Complete = (options: JsonCompletionOptions) => Promise<StructuredResult>;

/** Prompt + provider call + normalisation. Injected `complete` keeps tests offline. */
export async function extractMetadataFromHeader(
	text: string,
	complete: Complete = completeJson,
	context: MetadataContext = {},
	teacherId: string | null = null
): Promise<DocumentMetadata> {
	const header = headerSlice(text);
	if (!header) return { name: null, members: [], title: null };

	const result = await complete({
		prompt: buildMetadataPrompt(header, context),
		schema: METADATA_JSON_SCHEMA,
		system: 'Sos un asistente que extrae datos impresos de encabezados académicos. Respondé únicamente con JSON válido.',
		temperature: 0,
		toolName: 'extraer_metadatos',
		toolDescription: 'Devuelve los metadatos impresos en el encabezado',
		schemaName: 'metadatos',
		teacherId
	});

	return normalizeMetadata(result.raw, context);
}

/**
 * Reads the header of a delivery's main document and stores the suggestion.
 *
 * Without `force`, a stored suggestion is reused only when it still passes the
 * current guards: extracting costs a model call, and the same header does not
 * change between reloads, but an answer built by an older prompt must not
 * survive a precision fix.
 */
export async function extractSubmissionMetadata(
	teacherId: string,
	submissionId: string,
	options: { force?: boolean; complete?: Complete } = {}
): Promise<SubmissionMetadataResult> {
	const document = await getSubmissionMainFile(teacherId, submissionId);
	if (!document) {
		throw new MetadataExtractionError('La entrega no existe o no pertenece a este docente', 'not_found');
	}

	const context: MetadataContext = {
		activityTitle: document.activityTitle,
		subjectName: document.subjectName
	};

	if (!options.force && hasMetadata(document.metadata)) {
		const reusable = sanitizeMetadata(document.metadata, context);
		if (metadataEquals(reusable, document.metadata)) {
			return {
				metadata: document.metadata,
				source: 'cache',
				fileId: document.fileId,
				fileName: document.fileName
			};
		}
	}

	const text = document.extractedText?.trim() ?? '';
	if (document.extraction !== 'ok' || !text) {
		throw new MetadataExtractionError(
			'El documento no tiene texto extraído. Procesá el archivo (o usá visión si está escaneado) antes de extraer metadatos.',
			'no_text'
		);
	}

	let metadata: DocumentMetadata;
	try {
		metadata = await extractMetadataFromHeader(text, options.complete, context, teacherId);
	} catch (error) {
		throw new MetadataExtractionError(
			error instanceof Error ? error.message : 'No se pudo consultar al modelo',
			'model'
		);
	}

	const stored = await saveFileMetadata(teacherId, document.fileId, metadata);
	if (!stored) {
		throw new MetadataExtractionError('No se pudo guardar la sugerencia en el archivo', 'not_found');
	}

	return { metadata, source: 'model', fileId: document.fileId, fileName: document.fileName };
}

export type SubmissionMetadataApplication = {
	metadata: DocumentMetadata;
	source: 'model' | 'cache';
	fileId: string;
	fileName: string;
	/** Short labels of the fields written on the delivery, empty when it had all of them. */
	applied: string[];
};

/**
 * Extraction plus the write the review table used to require a click for.
 *
 * It is the automatic path after processing a file and the bulk "complete all"
 * button: the header is read, gaps are filled and the delivery keeps whatever
 * the teacher already set. The rule lives in `planMetadataApplication` so this
 * function only decides *where* to write, never *what*.
 */
export async function applySubmissionMetadata(
	teacherId: string,
	submissionId: string,
	options: { force?: boolean; complete?: Complete } = {}
): Promise<SubmissionMetadataApplication> {
	const result = await extractSubmissionMetadata(teacherId, submissionId, options);

	const document = await getSubmissionMainFile(teacherId, submissionId);
	if (!document) {
		throw new MetadataExtractionError('La entrega no existe o no pertenece a este docente', 'not_found');
	}

	const roster = document.subjectId ? await listStudents(teacherId, document.subjectId) : [];
	const plan = planMetadataApplication({
		current: {
			title: document.title,
			studentName: document.studentName,
			studentId: document.studentId
		},
		metadata: result.metadata,
		fileName: result.fileName,
		roster: roster.map((entry) => ({ id: entry.id, matchKey: entry.matchKey }))
	});

	const details: { title?: string; studentName?: string } = {};
	if (plan.title !== null) details.title = plan.title;
	if (plan.studentName !== null) details.studentName = plan.studentName;
	if (Object.keys(details).length > 0) {
		await updateSubmissionDetails(teacherId, submissionId, details);
	}
	if (plan.studentId) await attachStudent(teacherId, submissionId, plan.studentId);

	return {
		metadata: result.metadata,
		source: result.source,
		fileId: result.fileId,
		fileName: result.fileName,
		applied: plan.applied
	};
}
