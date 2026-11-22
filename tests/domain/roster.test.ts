import { describe, expect, it } from 'vitest';
import {
	detectDelimiter,
	normalizeMatchKey,
	parseMoodleFileName,
	parseRosterCsv,
	resolveRosterMatch,
	submissionStudentName
} from '../../src/lib/domain/roster.js';

/**
 * These functions are the whole contract between a name written by a human and
 * a row in the database: get one wrong and a delivery is graded against the
 * wrong student. That is why `normalizeMatchKey` sorts tokens, `parseMoodleFileName`
 * refuses to guess, and `resolveRosterMatch` returns `null` instead of the
 * closest match.
 */

describe('normalizeMatchKey', () => {
	it('treats "Pérez, Juan" and "Juan Perez" as the same person', () => {
		expect(normalizeMatchKey('Pérez, Juan')).toBe(normalizeMatchKey('Juan Perez'));
		expect(normalizeMatchKey('Pérez, Juan')).toBe('juan perez');
	});

	it('ignores accents, case, punctuation and repeated spaces', () => {
		expect(normalizeMatchKey('  JUAN   PÉREZ  ')).toBe('juan perez');
		expect(normalizeMatchKey('Perez.Juan')).toBe('juan perez');
	});

	it('sorts tokens, so reversed names still match', () => {
		expect(normalizeMatchKey('Pérez Juan')).toBe(normalizeMatchKey('Juan Pérez'));
	});

	it('keeps a different name different', () => {
		expect(normalizeMatchKey('Juan Peres')).not.toBe(normalizeMatchKey('Juan Perez'));
		expect(normalizeMatchKey('Juan Perez').length).not.toBe(
			normalizeMatchKey('Juan Perez Gomez').length
		);
	});

	it('returns an empty key for a name with no letters or digits', () => {
		expect(normalizeMatchKey('  ...  ')).toBe('');
	});
});

describe('parseMoodleFileName', () => {
	it('reads the Moodle convention name_id.extension', () => {
		expect(parseMoodleFileName('Perez_Juan_12345.pdf')).toEqual({
			name: 'Perez Juan',
			externalId: '12345'
		});
	});

	it('accepts DOCX, hyphens and spaces as separators', () => {
		expect(parseMoodleFileName('Gomez-Ana-6789.docx')).toEqual({
			name: 'Gomez Ana',
			externalId: '6789'
		});
		expect(parseMoodleFileName('Perez Juan 12345.PDF')).toEqual({
			name: 'Perez Juan',
			externalId: '12345'
		});
	});

	it('keeps a delivery without an id', () => {
		expect(parseMoodleFileName('Perez_Juan.pdf')).toEqual({
			name: 'Perez Juan',
			externalId: null
		});
	});

	it('drops the OS duplicate suffix instead of reading it as a name', () => {
		expect(parseMoodleFileName('Perez_Juan_123 (1).pdf')).toEqual({
			name: 'Perez Juan',
			externalId: '123'
		});
		expect(parseMoodleFileName('Perez_Juan copia.pdf')).toEqual({
			name: 'Perez Juan',
			externalId: null
		});
	});

	it('drops a bare year in the middle instead of treating it as a surname', () => {
		expect(parseMoodleFileName('2024_Perez_Juan_123.pdf')).toEqual({
			name: 'Perez Juan',
			externalId: '123'
		});
	});

	it('drops the activity prefix, which is not part of the student name', () => {
		expect(parseMoodleFileName('TP2_Gomez_Ana_12345.pdf')).toEqual({
			name: 'Gomez Ana',
			externalId: '12345'
		});
		expect(parseMoodleFileName('Trabajo_Practico_2_Gomez_Ana.pdf')).toEqual({
			name: 'Gomez Ana',
			externalId: null
		});
		expect(parseMoodleFileName('TP-2-Gomez-Ana.docx')).toEqual({
			name: 'Gomez Ana',
			externalId: null
		});
	});

	it('returns null when the file name carries only the activity', () => {
		expect(parseMoodleFileName('Trabajo_Practico_12345.pdf')).toBeNull();
		expect(parseMoodleFileName('TP2.pdf')).toBeNull();
	});

	it('returns null when there is no name at all', () => {
		expect(parseMoodleFileName('12345.pdf')).toBeNull();
		expect(parseMoodleFileName('.pdf')).toBeNull();
	});
});

describe('submissionStudentName', () => {
	const file = (fileName: string) => [{ fileName }];

	it('prefers the roster link over anything stored', () => {
		expect(
			submissionStudentName({
				studentRosterName: 'Ana Gómez',
				studentName: 'Gomez Ana',
				files: file('Gomez_Ana_12345.pdf')
			})
		).toBe('Ana Gómez');
	});

	it('keeps a name that cannot come from the file name', () => {
		expect(
			submissionStudentName({ studentName: 'Ana Gómez', files: file('Documento-RevisIA.pdf') })
		).toBe('Ana Gómez');
	});

	it('does not present the file name as the student of an older row', () => {
		// Older versions stored the file-name guess in `student_name`: it is the
		// file talking, not a person, so the delivery stays unidentified.
		expect(
			submissionStudentName({
				studentName: 'Documento RevisIA',
				files: file('Documento-RevisIA.pdf')
			})
		).toBeNull();
		expect(
			submissionStudentName({ studentName: 'Perez Juan', files: file('Perez_Juan_12345.pdf') })
		).toBeNull();
	});

	it('keeps a name the header printed even when the file name coincides', () => {
		// The header pass stored this name as evidence: it is a person, not the
		// file-name echo the guard above rejects.
		expect(
			submissionStudentName({
				studentName: 'Gabriela Loor',
				files: [{ fileName: '05_Gabriela_Loor.pdf', metadataName: 'Gabriela Loor' }]
			})
		).toBe('Gabriela Loor');
		expect(
			submissionStudentName({
				studentName: 'Perez Juan',
				files: [{ fileName: 'Perez_Juan_12345.pdf', metadataName: 'Juan Pérez' }]
			})
		).toBe('Perez Juan');
	});

	it('keeps a stored name when there is no file to compare it with', () => {
		expect(submissionStudentName({ studentName: 'Ana Gómez', files: [] })).toBe('Ana Gómez');
		expect(submissionStudentName({ studentName: '  ', files: [] })).toBeNull();
	});
});

describe('resolveRosterMatch', () => {
	const roster = [
		{ id: 'student-1', matchKey: normalizeMatchKey('Juan Pérez') },
		{ id: 'student-2', matchKey: normalizeMatchKey('Ana Gomez') }
	];

	it('resolves the detected name to the roster row', () => {
		expect(resolveRosterMatch('Perez, Juan', roster)).toEqual({
			studentId: 'student-1',
			matchKey: 'juan perez'
		});
	});

	it('returns null instead of a near match', () => {
		expect(resolveRosterMatch('Juan Peres', roster)).toBeNull();
		expect(resolveRosterMatch('', roster)).toBeNull();
	});

	it('returns null when the roster is empty', () => {
		expect(resolveRosterMatch('Juan Perez', [])).toBeNull();
	});
});

describe('detectDelimiter', () => {
	it('detects the Excel-Spanish semicolon and the tab export', () => {
		expect(detectDelimiter('nombre;legajo\nJuan;1')).toBe(';');
		expect(detectDelimiter('nombre\tlegajo\nJuan\t1')).toBe('\t');
		expect(detectDelimiter('nombre,legajo\nJuan,1')).toBe(',');
	});

	it('ignores a UTF-8 BOM and blank leading lines', () => {
		expect(detectDelimiter('\uFEFF\n\nnombre;legajo')).toBe(';');
	});
});

describe('parseRosterCsv', () => {
	it('reads a standard Spanish roster with a single name column', () => {
		const csv = 'Nombre completo,Legajo,Email\n"Pérez, Juan",12345,juan@uni.edu\nGómez Ana,67890,';

		const result = parseRosterCsv(csv);

		expect(result.errors).toEqual([]);
		expect(result.rows).toEqual([
			{ line: 2, name: 'Pérez, Juan', externalId: '12345', email: 'juan@uni.edu' },
			{ line: 3, name: 'Gómez Ana', externalId: '67890', email: null }
		]);
	});

	it('splits an unquoted comma in a name column, which is why Excel must quote it', () => {
		// Pinned on purpose: a comma-delimited file cannot carry `Pérez, Juan`
		// unquoted, and silently joining the pieces would corrupt the legajo.
		const csv = 'Nombre completo,Legajo\nPérez, Juan,12345';

		const result = parseRosterCsv(csv);

		expect(result.rows[0]).toMatchObject({ name: 'Pérez', externalId: 'Juan' });
	});

	it('joins separate first and last name columns', () => {
		const csv = 'Nombre,Apellido,Padrón\nJuan,Pérez,12345';

		const result = parseRosterCsv(csv);

		expect(result.rows[0]).toMatchObject({ name: 'Juan Pérez', externalId: '12345' });
	});

	it('handles BOM, CRLF, semicolons and quoted values', () => {
		const csv = '\uFEFFnombre;legajo\r\n"Pérez; Juan";12345\r\n';

		const result = parseRosterCsv(csv);

		expect(result.errors).toEqual([]);
		expect(result.rows[0]).toMatchObject({ name: 'Pérez; Juan', externalId: '12345' });
	});

	it('rejects a file without a recognizable name column', () => {
		const result = parseRosterCsv('legajo,email\n12345,a@b.c');

		expect(result.rows).toEqual([]);
		expect(result.errors[0].message).toContain('No se encontró una columna de nombre');
	});

	it('reports a repeated name instead of importing it twice', () => {
		const csv = 'Nombre\nJuan Pérez\nJuan Perez';

		const result = parseRosterCsv(csv);

		expect(result.rows).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({ line: 3 });
		expect(result.errors[0].message).toContain('repetido');
	});

	it('skips blank lines without erroring', () => {
		const result = parseRosterCsv('Nombre\n\nJuan Pérez\n\n');

		expect(result.rows).toHaveLength(1);
		expect(result.errors).toEqual([]);
	});

	it('reports a row with no name', () => {
		const result = parseRosterCsv('Nombre,Legajo\nJuan,1\n,2');

		expect(result.rows).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({ line: 3, message: 'Fila sin nombre' });
	});

	it('reports an empty file', () => {
		expect(parseRosterCsv('   ').errors[0].message).toBe('El archivo está vacío');
	});
});
