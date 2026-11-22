/**
 * Roster matching, as pure functions.
 *
 * Three names for the same student arrive in three shapes: the roster says
 * "Pérez, Juan", Moodle's ZIP says "Perez_Juan_12345.pdf", and the document
 * header says "Juan Pérez". All of them must resolve to one row, and a failed
 * match must be fixable by hand — so nothing here touches the database or
 * guesses across students.
 */

/**
 * Canonical key for a person's name: lowercase, no accents, no punctuation,
 * tokens sorted alphabetically.
 *
 * Sorting is what makes "Pérez, Juan" and "Juan Pérez" identical. It also means
 * a name made of the same tokens always resolves, whatever order the source
 * used; a genuinely different name produces a different key and simply does not
 * match, which is the safe failure.
 */
export function normalizeMatchKey(name: string): string {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.sort()
		.join(' ');
}

export type ParsedFileName = {
	/** Name as written in the file name, tokens in their original order. */
	name: string;
	/** Numeric student id or assignment id, when the name carries one. */
	externalId: string | null;
};

/**
 * Words a LMS export puts in front of the name: the activity, never a student.
 *
 * Without this list, "TP2_Gomez_Ana_12345.pdf" is read as the student
 * "TP2 Gomez Ana", which displays as garbage and can never match the roster.
 * The comparison ignores a trailing number and accents, so "TP2", "tp-2" and
 * "Trabajo Práctico 2" all count as the activity.
 */
const ACTIVITY_TOKENS = new Set([
	'tp',
	'trabajo',
	'practico',
	'practica',
	'tarea',
	'entrega',
	'actividad',
	'consigna',
	'ejercicio',
	'parcial',
	'recuperatorio',
	'proyecto',
	'unidad',
	'final'
]);

function isActivityToken(token: string): boolean {
	const key = token
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\d+$/, '');
	return ACTIVITY_TOKENS.has(key);
}

/**
 * Reads the Moodle convention `Nombre_Apellido_12345.pdf`.
 *
 * Only two things are certain in a Moodle export: the name is separated by
 * `_`, `-` or spaces, and the trailing number is an id. Anything before the
 * name (an activity prefix, a commission) is not a name, so it is dropped
 * instead of glued to the student; guessing wrongly produces a confident wrong
 * match, and the review table exists precisely so a human can fix the ones the
 * parser could not read.
 */
export function parseMoodleFileName(fileName: string): ParsedFileName | null {
	const withoutExtension = fileName.replace(/\.[a-z0-9]{1,8}$/i, '');
	// "Trabajo (1).pdf" and "Trabajo copia.pdf" are the OS duplicating a file,
	// not part of anybody's name.
	const cleaned = withoutExtension
		.replace(/\(\s*\d+\s*\)/g, ' ')
		.replace(/\bcopia\b/gi, ' ');

	const tokens = cleaned
		.split(/[_\-.,\s]+/)
		.map((token) => token.trim())
		.filter(Boolean);

	let externalId: string | null = null;
	const last = tokens[tokens.length - 1];
	if (last && /^\d{3,}$/.test(last)) {
		externalId = last;
		tokens.pop();
	}

	// Drop pure numbers left in the middle ("2024") instead of treating them
	// as a surname, and drop the activity prefix ("TP2", "Trabajo", "Práctico")
	// so what remains is only the person.
	const nameTokens = tokens.filter(
		(token) => /[a-z]/i.test(token) && !isActivityToken(token)
	);
	if (nameTokens.length === 0) return null;

	return { name: nameTokens.join(' '), externalId };
}

export type RosterCsvRow = {
	/** 1-based line in the original file, header and blank lines included. */
	line: number;
	name: string;
	externalId: string | null;
	email: string | null;
};

export type CsvParseError = {
	/** 1-based line number in the original file, header included. */
	line: number;
	message: string;
};

export type CsvParseResult = {
	rows: RosterCsvRow[];
	errors: CsvParseError[];
};

const NAME_HEADERS = ['nombre completo', 'nombre y apellido', 'nombrecompleto', 'full name', 'fullname'];
const FIRST_NAME_HEADERS = ['nombre', 'nombres', 'name', 'first name', 'firstname', 'estudiante', 'alumno'];
const LAST_NAME_HEADERS = ['apellido', 'apellidos', 'last name', 'lastname', 'surname'];
const ID_HEADERS = [
	'legajo',
	'padron',
	'external_id',
	'externalid',
	'id',
	'codigo',
	'code',
	'matricula',
	'student id',
	'studentid'
];
const EMAIL_HEADERS = ['email', 'correo', 'mail', 'e-mail', 'correo electronico'];

/** Accent- and case-insensitive header comparison. */
function headerKey(value: string): string {
	return normalizeMatchKey(value);
}

function findColumn(headers: string[], aliases: string[]): number {
	const normalizedAliases = aliases.map(headerKey);
	return headers.findIndex((header) => normalizedAliases.includes(headerKey(header)));
}

/**
 * CSV from Excel arrives with `;` in Spanish locales, a UTF-8 BOM, quoted
 * fields containing the delimiter, and CRLF. All four are handled here so the
 * repository layer only sees clean rows.
 */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
	const firstLine =
		text
			.replace(/^\uFEFF/, '')
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0) ?? '';
	const counts = {
		',': (firstLine.match(/,/g) ?? []).length,
		';': (firstLine.match(/;/g) ?? []).length,
		'\t': (firstLine.match(/\t/g) ?? []).length
	};
	if (counts[';'] >= counts[','] && counts[';'] >= counts['\t'] && counts[';'] > 0) return ';';
	if (counts['\t'] > counts[',']) return '\t';
	return ',';
}

/** Splits one CSV line, honouring `"quoted, values"` and `""` escapes. */
function splitCsvLine(line: string, delimiter: string): string[] {
	const cells: string[] = [];
	let current = '';
	let quoted = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (quoted) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					quoted = false;
				}
			} else {
				current += char;
			}
			continue;
		}

		if (char === '"') {
			quoted = true;
			continue;
		}
		if (char === delimiter) {
			cells.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}

	cells.push(current.trim());
	return cells;
}

/**
 * Parses a roster CSV. Requires a recognizable name column: a file without one
 * cannot be imported, and silently taking column 0 would import grades or ids
 * as names.
 */
export function parseRosterCsv(text: string): CsvParseResult {
	const clean = text.replace(/^\uFEFF/, '');
	const lines = clean.split(/\r?\n/);
	const delimiter = detectDelimiter(clean);

	const headerIndex = lines.findIndex((line) => line.trim().length > 0);
	if (headerIndex === -1) {
		return { rows: [], errors: [{ line: 1, message: 'El archivo está vacío' }] };
	}

	const headers = splitCsvLine(lines[headerIndex], delimiter);
	const fullNameColumn = findColumn(headers, NAME_HEADERS);
	const firstNameColumn = findColumn(headers, FIRST_NAME_HEADERS);
	const lastNameColumn = findColumn(headers, LAST_NAME_HEADERS);
	const idColumn = findColumn(headers, ID_HEADERS);
	const emailColumn = findColumn(headers, EMAIL_HEADERS);

	const hasName = fullNameColumn !== -1 || firstNameColumn !== -1;
	if (!hasName) {
		return {
			rows: [],
			errors: [
				{
					line: headerIndex + 1,
					message: 'No se encontró una columna de nombre (nombre, apellido, nombre completo)'
				}
			]
		};
	}

	const rows: RosterCsvRow[] = [];
	const errors: CsvParseError[] = [];
	const seen = new Set<string>();

	for (let i = headerIndex + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (!line.trim()) continue;

		const cells = splitCsvLine(line, delimiter);
		const fullName = fullNameColumn !== -1 ? (cells[fullNameColumn] ?? '') : '';
		const firstName = firstNameColumn !== -1 ? (cells[firstNameColumn] ?? '') : '';
		const lastName = lastNameColumn !== -1 ? (cells[lastNameColumn] ?? '') : '';

		const name = fullName.trim() || `${firstName} ${lastName}`.trim();
		if (!name) {
			errors.push({ line: i + 1, message: 'Fila sin nombre' });
			continue;
		}

		const key = normalizeMatchKey(name);
		if (!key) {
			errors.push({ line: i + 1, message: `Nombre sin letras: "${name}"` });
			continue;
		}
		if (seen.has(key)) {
			errors.push({ line: i + 1, message: `Nombre repetido en el archivo: "${name}"` });
			continue;
		}
		seen.add(key);

		rows.push({
			line: i + 1,
			name: name.replace(/\s+/g, ' ').trim(),
			externalId: idColumn !== -1 ? (cells[idColumn] ?? '').trim() || null : null,
			email: emailColumn !== -1 ? (cells[emailColumn] ?? '').trim() || null : null
		});
	}

	return { rows, errors };
}

export type RosterEntry = { id: string; matchKey: string };

export type RosterMatch = {
	studentId: string;
	/** The canonical key that matched, so the UI can show what it compared. */
	matchKey: string;
};

/**
 * Resolves a detected name against the roster by canonical key.
 *
 * Returns `null` instead of a best guess: an unmatched delivery keeps its raw
 * name and waits for a human, which is reversible (F2.9). Fuzzy matching here
 * would attach "Juan Perez" to "Juan Peres" and grade the wrong person.
 */
export function resolveRosterMatch(name: string, roster: RosterEntry[]): RosterMatch | null {
	const matchKey = normalizeMatchKey(name);
	if (!matchKey) return null;

	const found = roster.find((entry) => entry.matchKey === matchKey);
	return found ? { studentId: found.id, matchKey } : null;
}

/**
 * The name a delivery is shown with.
 *
 * Evidence order: the roster link first (it is the only verified identity),
 * then a name the header printed, then the name stored on the delivery. A
 * stored name that is exactly what the file name yields is not identity by
 * itself: earlier versions stored the file-name guess in that column, and
 * "Documento-RevisIA" is a file name, not a person. The header suggestion stored
 * next to the file is what separates that old guess from a name the model read
 * off the document, which the teacher sees even when the file name says the same.
 */
export function submissionStudentName(submission: {
	studentRosterName?: string | null;
	studentName: string | null;
	files?: { fileName: string; metadataName?: string | null }[];
}): string | null {
	if (submission.studentRosterName) return submission.studentRosterName;

	const stored = submission.studentName?.trim();
	if (!stored) return null;

	const files = submission.files ?? [];
	const storedKey = normalizeMatchKey(stored);

	// The header is evidence, not a guess: a name the document printed is shown
	// even when it coincides with the file name. Without this check the guard
	// below hid every Moodle delivery, where the file name is the student's name.
	const printedInHeader = files.some(
		(file) => file.metadataName && normalizeMatchKey(file.metadataName) === storedKey
	);
	if (printedInHeader) return stored;

	const fileName = files[0]?.fileName;
	const fromFile = fileName ? (parseMoodleFileName(fileName)?.name ?? null) : null;
	if (fromFile && normalizeMatchKey(fromFile) === storedKey) return null;

	return stored;
}
