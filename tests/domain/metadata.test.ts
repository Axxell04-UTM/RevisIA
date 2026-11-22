import { describe, expect, it } from 'vitest';
import {
	buildMetadataPrompt,
	deserializeMembers,
	EMPTY_METADATA,
	hasMetadata,
	headerSlice,
	metadataEquals,
	METADATA_JSON_SCHEMA,
	needsMetadataCompletion,
	normalizeMetadata,
	planMetadataApplication,
	sanitizeMetadata,
	serializeMembers
} from '#lib/domain/metadata.js';
import { normalizeMatchKey } from '#lib/domain/roster.js';

/**
 * The metadata pass reads a header that may be a bad scan. These tests pin the
 * two halves that decide whether garbage reaches the review table: what the
 * model is allowed to see, and what survives normalisation.
 */

describe('headerSlice', () => {
	it('keeps the beginning of the document and drops the rest', () => {
		const text = 'A'.repeat(5000);
		expect(headerSlice(text)).toHaveLength(2000);
	});

	it('normalises CRLF and collapses runs of blank lines', () => {
		expect(headerSlice('Juan Pérez\r\n\r\n\r\n\r\nTP 1\r\n')).toBe('Juan Pérez\n\nTP 1');
	});

	it('strips control characters that break prompts', () => {
		expect(headerSlice('Juan\u0000 P\u0007érez')).toBe('Juan Pérez');
	});

	it('returns an empty string for whitespace-only input', () => {
		expect(headerSlice('   \n\n  ')).toBe('');
	});
});

describe('buildMetadataPrompt', () => {
	it('embeds the header and asks for the three fields', () => {
		const prompt = buildMetadataPrompt('Ana Gómez\nTrabajo Práctico 2');
		expect(prompt).toContain('Ana Gómez');
		expect(prompt).toContain('Trabajo Práctico 2');
		expect(prompt).toContain('"nombre"');
		expect(prompt).toContain('"integrantes"');
		expect(prompt).toContain('"titulo"');
	});

	it('forbids inventing data', () => {
		const prompt = buildMetadataPrompt('x');
		expect(prompt.toLowerCase()).toContain('no inventes');
	});

	it('names the lines that are not a title and not an author', () => {
		const prompt = buildMetadataPrompt('x');
		expect(prompt).toContain('Qué NO es el título');
		expect(prompt).toContain('Qué NO es un nombre de alumno');
		expect(prompt).toContain('comisión');
		expect(prompt).toContain('docente');
	});

	it('adds the activity as reference only when it is known', () => {
		const withContext = buildMetadataPrompt('x', {
			activityTitle: 'TP 2: Límites',
			subjectName: 'Análisis Matemático II'
		});
		expect(withContext).toContain('Actividad: TP 2: Límites');
		expect(withContext).toContain('Asignatura: Análisis Matemático II');
		expect(withContext).toContain('no están impresos necesariamente');

		const withoutContext = buildMetadataPrompt('x');
		expect(withoutContext).not.toContain('Datos de referencia');
	});
});

describe('normalizeMetadata — title precision', () => {
	it('keeps a full printed title with its number and subtitle', () => {
		const result = normalizeMetadata({ titulo: 'TP 2: Límites y continuidad' });
		expect(result.title).toBe('TP 2: Límites y continuidad');
	});

	it('strips the printed label but keeps the value', () => {
		expect(normalizeMetadata({ titulo: 'Título: Límites y continuidad' }).title).toBe(
			'Límites y continuidad'
		);
		expect(normalizeMetadata({ titulo: 'Tema - Sucesiones' }).title).toBe('Sucesiones');
	});

	it('drops a header line that declares itself to be the subject or the course', () => {
		expect(normalizeMetadata({ titulo: 'Materia: Análisis Matemático II' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: 'Comisión 3' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: 'Docente: Ing. Pedro Ruiz' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: 'Fecha: 12/05/2025' }).title).toBeNull();
	});

	it('does not over-reject a real title that starts with one of those words', () => {
		expect(normalizeMetadata({ titulo: 'Materia orgánica y reactividad' }).title).toBe(
			'Materia orgánica y reactividad'
		);
	});

	it('drops dates and bare years', () => {
		expect(normalizeMetadata({ titulo: '12/05/2025' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: '2025' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: 'Mayo de 2025' }).title).toBeNull();
		expect(normalizeMetadata({ titulo: '15 de mayo' }).title).toBeNull();
	});

	it('drops the subject name the model confused with the title', () => {
		const result = normalizeMetadata(
			{ titulo: 'Análisis Matemático II' },
			{ subjectName: 'Análisis Matemático II' }
		);
		expect(result.title).toBeNull();
	});

	it('drops a title that is just the author line repeated', () => {
		const result = normalizeMetadata({ nombre: 'Ana Gómez', titulo: 'Ana Gomez' });
		expect(result.title).toBeNull();
		expect(result.name).toBe('Ana Gómez');
	});

	it('drops a title that only repeats the activity name', () => {
		const context = { activityTitle: 'Ensayo fenómeno del niño' };
		expect(normalizeMetadata({ titulo: 'Ensayo fenómeno del niño' }, context).title).toBeNull();
		expect(normalizeMetadata({ titulo: 'ENSAYO FENOMENO DEL NINO' }, context).title).toBeNull();
	});

	it('keeps a real title that merely mentions the activity', () => {
		const context = { activityTitle: 'Ensayo fenómeno del niño' };
		expect(
			normalizeMetadata({ titulo: 'Ensayo sobre el fenómeno del niño en Ecuador' }, context).title
		).toBe('Ensayo sobre el fenómeno del niño en Ecuador');
	});
});

describe('normalizeMetadata — student name precision', () => {
	it('removes the printed label from the name', () => {
		expect(normalizeMetadata({ nombre: 'Alumno: Ana Gómez' }).name).toBe('Ana Gómez');
		expect(normalizeMetadata({ nombre: 'Integrante — Luis Díaz' }).name).toBe('Luis Díaz');
	});

	it('drops a line that is a role or an institution, not a student', () => {
		expect(normalizeMetadata({ nombre: 'Docente: Pedro Ruiz' }).name).toBeNull();
		expect(normalizeMetadata({ nombre: 'Universidad Nacional de La Plata' }).name).toBeNull();
		expect(normalizeMetadata({ nombre: 'JTP: María Sosa' }).name).toBeNull();
	});

	it('drops an email or a legajo instead of storing it as the author', () => {
		expect(normalizeMetadata({ nombre: 'ana.gomez@uni.edu' }).name).toBeNull();
		expect(normalizeMetadata({ nombre: '12345' }).name).toBeNull();
		expect(normalizeMetadata({ nombre: 'Legajo 12345' }).name).toBeNull();
	});

	it('removes a legajo glued to the end of the name', () => {
		expect(normalizeMetadata({ nombre: 'Ana Gómez 12345' }).name).toBe('Ana Gómez');
		expect(normalizeMetadata({ nombre: 'Ana Gómez - 12345' }).name).toBe('Ana Gómez');
	});

	it('applies the same rules to every member', () => {
		const result = normalizeMetadata({
			nombre: 'Ana Gómez',
			integrantes: ['Docente: Pedro Ruiz', 'Luis Díaz 12345', 'ana.gomez@uni.edu', 'Ana Gomez']
		});
		expect(result.members).toEqual(['Luis Díaz']);
	});

	it('splits words joined by underscores instead of merging them', () => {
		expect(normalizeMetadata({ nombre: 'Ana_Gómez' }).name).toBe('Ana Gómez');
	});
});

describe('sanitizeMetadata', () => {
	it('keeps a suggestion that still passes the guards', () => {
		const stored = { name: 'Ana Gómez', members: ['Luis Díaz'], title: 'TP 2' };
		expect(sanitizeMetadata(stored)).toEqual(stored);
		expect(metadataEquals(sanitizeMetadata(stored), stored)).toBe(true);
	});

	it('drops an old suggestion built by a looser pass', () => {
		const stored = { name: 'Docente: Pedro Ruiz', members: [], title: 'Materia: Análisis' };
		const cleaned = sanitizeMetadata(stored, { subjectName: 'Análisis' });
		expect(cleaned).toEqual(EMPTY_METADATA);
		expect(metadataEquals(cleaned, stored)).toBe(false);
	});
});

describe('normalizeMetadata', () => {
	it('reads the Spanish keys the prompt asks for', () => {
		expect(
			normalizeMetadata({ nombre: ' Ana Gómez ', integrantes: ['Luis Díaz'], titulo: 'TP 2' })
		).toEqual({ name: 'Ana Gómez', members: ['Luis Díaz'], title: 'TP 2' });
	});

	it('accepts English keys some providers prefer', () => {
		expect(normalizeMetadata({ name: 'Ana', members: ['Luis'], title: 'TP' })).toEqual({
			name: 'Ana',
			members: ['Luis'],
			title: 'TP'
		});
	});

	it('parses a fenced JSON string', () => {
		const raw = '```json\n{"nombre":"Ana","integrantes":["Luis"],"titulo":"TP"}\n```';
		expect(normalizeMetadata(raw).name).toBe('Ana');
	});

	it('treats placeholders as missing data', () => {
		expect(
			normalizeMetadata({ nombre: 'N/A', integrantes: ['', 'Sin datos'], titulo: '—' })
		).toEqual(EMPTY_METADATA);
	});

	it('deduplicates members ignoring accents and case', () => {
		const result = normalizeMetadata({
			nombre: 'Ana Gómez',
			integrantes: ['Luis Díaz', 'luis diaz', 'LUIS DÍAZ']
		});
		expect(result.members).toEqual(['Luis Díaz']);
	});

	it('does not repeat the author inside members', () => {
		const result = normalizeMetadata({
			nombre: 'Ana Gómez',
			integrantes: ['Ana Gomez', 'Luis Díaz']
		});
		expect(result.members).toEqual(['Luis Díaz']);
	});

	it('splits a string of members on newlines and semicolons only', () => {
		const result = normalizeMetadata({ nombre: '', integrantes: 'Luis Díaz\nAna Gómez; Pedro Ruiz', titulo: '' });
		expect(result.members).toEqual(['Luis Díaz', 'Ana Gómez', 'Pedro Ruiz']);
	});

	it('caps names and titles so a runaway answer cannot fill the table', () => {
		const result = normalizeMetadata({ nombre: 'x'.repeat(500), integrantes: [], titulo: 'y'.repeat(500) });
		expect(result.name).toHaveLength(200);
		expect(result.title).toHaveLength(300);
	});

	it('returns empty metadata for garbage instead of throwing', () => {
		expect(normalizeMetadata('no json here')).toEqual(EMPTY_METADATA);
		expect(normalizeMetadata(null)).toEqual(EMPTY_METADATA);
		expect(normalizeMetadata(42)).toEqual(EMPTY_METADATA);
		expect(normalizeMetadata({ integrantes: 42 }).members).toEqual([]);
		expect(normalizeMetadata({ integrantes: { a: 1 } }).members).toEqual([]);
	});

	it('reports whether a suggestion has anything usable', () => {
		expect(hasMetadata(EMPTY_METADATA)).toBe(false);
		expect(hasMetadata({ name: 'Ana', members: [], title: null })).toBe(true);
	});

	it('declares a strict schema with the three required fields', () => {
		expect(METADATA_JSON_SCHEMA.required).toEqual(['nombre', 'integrantes', 'titulo']);
		expect(METADATA_JSON_SCHEMA.additionalProperties).toBe(false);
	});
});

describe('member serialization', () => {
	it('round-trips through the text column', () => {
		const members = ['Luis Díaz', 'Ana Gómez'];
		expect(deserializeMembers(serializeMembers(members))).toEqual(members);
	});

	it('stores null for an empty list and tolerates corrupt data', () => {
		expect(serializeMembers([])).toBeNull();
		expect(deserializeMembers(null)).toEqual([]);
		expect(deserializeMembers('not json')).toEqual([]);
		expect(deserializeMembers('{"a":1}')).toEqual([]);
	});
});

/**
 * The automatic pass after processing a file and the bulk button both delegate
 * the decision to this function. These tests pin what it may write: gaps only,
 * a roster link only by canonical key, and the file name only as a last hint.
 */
describe('planMetadataApplication', () => {
	const roster = [
		{ id: 'student-ana', matchKey: normalizeMatchKey('Ana Gómez') },
		{ id: 'student-luis', matchKey: normalizeMatchKey('Luis Díaz') }
	];

	const empty = { title: null, studentName: null, studentId: null };

	it('fills the title and the printed name of an empty delivery', () => {
		const plan = planMetadataApplication({
			current: empty,
			metadata: { name: 'Ana Gómez', members: [], title: 'TP 2 — Análisis' },
			roster
		});

		expect(plan).toEqual({
			title: 'TP 2 — Análisis',
			studentName: 'Ana Gómez',
			studentId: 'student-ana',
			applied: ['título', 'nombre impreso', 'estudiante del padrón']
		});
	});

	it('never overwrites what the teacher already set', () => {
		const plan = planMetadataApplication({
			current: {
				title: 'Trabajo final',
				studentName: 'Nombre impreso corregido',
				studentId: 'student-luis'
			},
			metadata: { name: 'Ana Gómez', members: [], title: 'Otro título' },
			roster
		});

		expect(plan).toEqual({ title: null, studentName: null, studentId: null, applied: [] });
	});

	it('keeps a printed name when it is not in the roster', () => {
		const plan = planMetadataApplication({
			current: empty,
			metadata: { name: 'Persona Desconocida', members: [], title: null },
			roster
		});

		expect(plan.studentName).toBe('Persona Desconocida');
		expect(plan.studentId).toBeNull();
	});

	it('uses the file name only as a hint when the header has no name', () => {
		const plan = planMetadataApplication({
			current: { title: 'TP 2', studentName: null, studentId: null },
			metadata: { name: null, members: [], title: null },
			fileName: 'TP2_Gomez_Ana_12345.pdf',
			roster
		});

		expect(plan.title).toBeNull();
		expect(plan.studentName).toBeNull();
		expect(plan.studentId).toBe('student-ana');
		expect(plan.applied).toEqual(['estudiante del padrón (por el nombre del archivo)']);
	});

	it('does not link a file name that no student answers to', () => {
		const plan = planMetadataApplication({
			current: empty,
			metadata: EMPTY_METADATA,
			fileName: 'Documento-RevisIA.pdf',
			roster
		});

		expect(plan).toEqual({ title: null, studentName: null, studentId: null, applied: [] });
	});
});

/**
 * Which deliveries the bulk pass is worth running on. A gap only counts when the
 * header pass can actually close it: an unlinked delivery with an empty roster
 * has nothing to link to, so counting it forever made the button process the
 * same rows on every click and never shrink its own number.
 */
describe('needsMetadataCompletion', () => {
	it('counts a delivery with no title', () => {
		expect(
			needsMetadataCompletion({ title: null, studentName: 'Ana Gómez', studentId: null, rosterSize: 0 })
		).toBe(true);
		expect(
			needsMetadataCompletion({ title: '   ', studentName: 'Ana Gómez', studentId: 's1', rosterSize: 2 })
		).toBe(true);
	});

	it('counts a delivery with no printed name', () => {
		expect(
			needsMetadataCompletion({ title: 'TP 2', studentName: null, studentId: 's1', rosterSize: 2 })
		).toBe(true);
	});

	it('counts an unlinked delivery only when there is a roster to link against', () => {
		expect(
			needsMetadataCompletion({ title: 'TP 2', studentName: 'Ana Gómez', studentId: null, rosterSize: 2 })
		).toBe(true);
		expect(
			needsMetadataCompletion({ title: 'TP 2', studentName: 'Ana Gómez', studentId: null, rosterSize: 0 })
		).toBe(false);
	});

	it('skips a delivery that has everything the pass can write', () => {
		expect(
			needsMetadataCompletion({ title: 'TP 2', studentName: 'Ana Gómez', studentId: 's1', rosterSize: 0 })
		).toBe(false);
	});
});
