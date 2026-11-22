import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
	const h = await import('../helpers/db.js');
	return { getDb: () => h.testDb, db: h.testDb, schema: h.schema };
});

import { file, subject, subjectTeachers } from '#lib/server/db/schema/academic.js';
import {
	createSubmission,
	deleteSubmission,
	getSubmissionMainFile,
	saveFileMetadata
} from '#lib/server/repositories/submission.js';
import { saveActivity } from '#lib/server/repositories/activity.js';
import {
	extractMetadataFromHeader,
	extractSubmissionMetadata,
	MetadataExtractionError
} from '#lib/server/metadata-extraction.js';
import { resetDb, testDb } from '../helpers/db.js';
import { createUser } from '../helpers/fixtures.js';

/**
 * Metadata extraction reads the *main* document of a delivery, stores its
 * suggestion on the file, and never touches the submission. These tests pin
 * ownership, the cache that avoids paying for the same header twice, and the
 * failure the teacher sees when a scanned PDF has no text yet.
 */

const SHA_MAIN = 'c'.repeat(64);
const SHA_SUPPORT = 'd'.repeat(64);

const HEADER_TEXT = 'Ana Gómez\nTrabajo Práctico 2\nComisión 3';

async function createFile(
	teacherId: string,
	options: {
		sha256?: string;
		name?: string;
		extraction?: 'pending' | 'ok' | 'empty' | 'failed';
		text?: string | null;
	} = {}
) {
	const { sha256 = SHA_MAIN, name = 'Ana_Gomez_TP2.pdf', extraction = 'ok', text = HEADER_TEXT } = options;
	const [row] = await testDb
		.insert(file)
		.values({
			storageKey: `submission/${sha256.slice(0, 8)}-${name}`,
			bucket: 'submissions',
			originalName: name,
			mime: 'application/pdf',
			sizeBytes: 1024,
			sha256,
			extractedText: text,
			extraction,
			uploadContext: 'submission',
			uploadedBy: teacherId
		})
		.returning();
	return row;
}

async function createDelivery(
	teacherId: string,
	files: { fileId: string; role?: 'document' | 'support' }[]
) {
	const activity = await saveActivity(teacherId, { title: 'TP 2' });
	const purposes = files.map((entry) => ({ fileId: entry.fileId, role: entry.role }));
	const { submission } = await createSubmission(teacherId, {
		activityId: activity.id,
		files: purposes
	});
	return { activity, submission };
}

beforeEach(async () => {
	await resetDb();
});

describe('getSubmissionMainFile', () => {
	it('returns the document at position 0, not a support file', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id);
		const support = await createFile(teacher.id, { sha256: SHA_SUPPORT, name: 'anexo.pdf', text: 'Anexo' });
		const { submission } = await createDelivery(teacher.id, [
			{ fileId: main.id },
			{ fileId: support.id, role: 'support' }
		]);

		const document = await getSubmissionMainFile(teacher.id, submission.id);
		expect(document?.fileId).toBe(main.id);
		expect(document?.fileName).toBe('Ana_Gomez_TP2.pdf');
		expect(document?.metadata).toEqual({ name: null, members: [], title: null });
	});

	it('hides the delivery from another teacher and from a soft-deleted one', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const main = await createFile(teacher.id);
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		expect(await getSubmissionMainFile(stranger.id, submission.id)).toBeNull();
		await deleteSubmission(teacher.id, submission.id);
		expect(await getSubmissionMainFile(teacher.id, submission.id)).toBeNull();
	});
});

describe('saveFileMetadata', () => {
	it('stores the three fields and round-trips the member list', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id);

		const stored = await saveFileMetadata(teacher.id, main.id, {
			name: 'Ana Gómez',
			members: ['Luis Díaz', 'Pedro Ruiz'],
			title: 'Trabajo Práctico 2'
		});
		expect(stored).toBe(true);

		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);
		const document = await getSubmissionMainFile(teacher.id, submission.id);
		expect(document?.metadata).toEqual({
			name: 'Ana Gómez',
			members: ['Luis Díaz', 'Pedro Ruiz'],
			title: 'Trabajo Práctico 2'
		});
	});

	it('refuses to write on a file the teacher does not own', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const main = await createFile(teacher.id);

		const stored = await saveFileMetadata(stranger.id, main.id, {
			name: 'Intruso',
			members: [],
			title: null
		});
		expect(stored).toBe(false);
	});
});

describe('extractSubmissionMetadata', () => {
	it('asks the model once and returns the cached suggestion afterwards', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id);
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		const complete = vi.fn(async () => ({
			raw: { nombre: 'Ana Gómez', integrantes: ['Luis Díaz'], titulo: 'Trabajo Práctico 2' },
			provider: 'openai' as const,
			model: 'test'
		}));

		const first = await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(first.source).toBe('model');
		expect(first.metadata).toEqual({
			name: 'Ana Gómez',
			members: ['Luis Díaz'],
			title: 'Trabajo Práctico 2'
		});
		expect(complete).toHaveBeenCalledTimes(1);

		const second = await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(second.source).toBe('cache');
		expect(second.metadata).toEqual(first.metadata);
		expect(complete).toHaveBeenCalledTimes(1);

		const forced = await extractSubmissionMetadata(teacher.id, submission.id, { complete, force: true });
		expect(forced.source).toBe('model');
		expect(complete).toHaveBeenCalledTimes(2);
	});

	it('reads only the header, so a name on page 4 never becomes the author', async () => {
		const teacher = await createUser();
		const lateText = 'A'.repeat(2500) + '\nNOMBRE_EN_PAGINA_4';
		const main = await createFile(teacher.id, { text: lateText });
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		let promptSeen = '';
		const complete = vi.fn(async (options: { prompt: string }) => {
			promptSeen = options.prompt;
			return { raw: { nombre: '', integrantes: [], titulo: '' }, provider: 'openai' as const, model: 'test' };
		});

		await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(promptSeen).not.toContain('NOMBRE_EN_PAGINA_4');
	});

	it('rejects a delivery whose document has no extracted text', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id, { extraction: 'empty', text: null });
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		await expect(extractSubmissionMetadata(teacher.id, submission.id)).rejects.toMatchObject({
			code: 'no_text'
		});
	});

	it('rejects a delivery owned by someone else', async () => {
		const teacher = await createUser();
		const stranger = await createUser();
		const main = await createFile(teacher.id);
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		await expect(extractSubmissionMetadata(stranger.id, submission.id)).rejects.toBeInstanceOf(
			MetadataExtractionError
		);
		await expect(extractSubmissionMetadata(stranger.id, submission.id)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('sends the activity and the subject to the prompt as reference only', async () => {
		const teacher = await createUser();
		const [subjectRow] = await testDb
			.insert(subject)
			.values({ name: 'Análisis Matemático II' })
			.returning();
		await testDb.insert(subjectTeachers).values({ subjectId: subjectRow.id, teacherId: teacher.id });
		const activity = await saveActivity(teacher.id, {
			title: 'TP 2: Límites',
			subjectId: subjectRow.id
		});
		const main = await createFile(teacher.id);
		const { submission } = await createSubmission(teacher.id, {
			activityId: activity.id,
			files: [{ fileId: main.id }]
		});

		let promptSeen = '';
		const complete = vi.fn(async (options: { prompt: string }) => {
			promptSeen = options.prompt;
			return {
				raw: { nombre: 'Ana Gómez', integrantes: [], titulo: 'TP 2' },
				provider: 'openai' as const,
				model: 'test'
			};
		});

		await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(promptSeen).toContain('Actividad: TP 2: Límites');
		expect(promptSeen).toContain('Asignatura: Análisis Matemático II');
	});

	it('re-extracts a stored suggestion that no longer survives the guards', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id);
		await saveFileMetadata(teacher.id, main.id, {
			name: 'Docente: Pedro Ruiz',
			members: [],
			title: 'Materia: Análisis'
		});
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		const complete = vi.fn(async () => ({
			raw: { nombre: 'Ana Gómez', integrantes: [], titulo: 'Trabajo Práctico 2' },
			provider: 'openai' as const,
			model: 'test'
		}));

		const result = await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(complete).toHaveBeenCalledTimes(1);
		expect(result.source).toBe('model');
		expect(result.metadata).toEqual({
			name: 'Ana Gómez',
			members: [],
			title: 'Trabajo Práctico 2'
		});
	});

	it('keeps a stored suggestion that still passes the guards', async () => {
		const teacher = await createUser();
		const main = await createFile(teacher.id);
		await saveFileMetadata(teacher.id, main.id, {
			name: 'Ana Gómez',
			members: ['Luis Díaz'],
			title: 'Trabajo Práctico 2'
		});
		const { submission } = await createDelivery(teacher.id, [{ fileId: main.id }]);

		const complete = vi.fn();
		const result = await extractSubmissionMetadata(teacher.id, submission.id, { complete });
		expect(complete).not.toHaveBeenCalled();
		expect(result.source).toBe('cache');
	});
});

describe('extractMetadataFromHeader', () => {
	it('returns empty metadata for a blank header without calling the model', async () => {
		const complete = vi.fn();
		const metadata = await extractMetadataFromHeader('   \n\n', complete);
		expect(metadata).toEqual({ name: null, members: [], title: null });
		expect(complete).not.toHaveBeenCalled();
	});

	it('normalises whatever the model returned', async () => {
		const complete = vi.fn(async () => ({
			raw: { nombre: 'Ana Gómez', integrantes: ['ana gomez', 'Luis Díaz'], titulo: 'TP 2' },
			provider: 'openai' as const,
			model: 'test'
		}));

		const metadata = await extractMetadataFromHeader(HEADER_TEXT, complete);
		expect(metadata).toEqual({ name: 'Ana Gómez', members: ['Luis Díaz'], title: 'TP 2' });
	});
});
