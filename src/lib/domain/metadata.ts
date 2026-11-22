import { parseJsonLoose } from './normalize.js';
import {
	parseMoodleFileName,
	resolveRosterMatch,
	type RosterEntry
} from './roster.js';

/**
 * Metadata read from the header of a submission.
 *
 * The teacher reviews everything in the pre-review table before grading, so
 * these values are suggestions: nothing here is trusted enough to skip the
 * confirmation step (F2.9/S7). The model only sees the first lines of the
 * document, and the parsing rules below punish anything that looks invented.
 */

export type DocumentMetadata = {
	/** Author name exactly as printed in the header, or null when absent. */
	name: string | null;
	/** Every member listed in the header, in printed order, deduplicated. */
	members: string[];
	/** Delivery title, or null when the header does not print one. */
	title: string | null;
};

/**
 * What the activity already knows about the delivery.
 *
 * It is reference material for the model ("this delivery belongs to TP 2 of
 * Análisis Matemático"), never a source of values: a title or a name that is
 * not printed in the header must stay empty. The guards below also use the
 * subject name to drop a header line that is just the subject repeated.
 */
export type MetadataContext = {
	activityTitle?: string | null;
	subjectName?: string | null;
};

export const EMPTY_METADATA: DocumentMetadata = { name: null, members: [], title: null };

/** How much of the extracted text the model reads. Headers are short. */
export const HEADER_CHAR_LIMIT = 2000;

const NAME_MAX = 200;
const TITLE_MAX = 300;
const MAX_MEMBERS = 30;

/**
 * Placeholders the model may emit instead of an empty value. They mean "not
 * found", and storing them would prefill the review table with noise.
 */
const PLACEHOLDERS = new Set([
	'',
	'-',
	'--',
	'—',
	'n/a',
	'na',
	'null',
	'none',
	'undefined',
	'sin datos',
	'sin dato',
	'no disponible',
	'no especificado',
	'no especificada',
	'no informado',
	'no informada',
	'desconocido',
	'desconocida'
]);

/** Schema handed to every provider so the answer is JSON, not prose. */
export const METADATA_JSON_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['nombre', 'integrantes', 'titulo'],
	properties: {
		nombre: { type: 'string' },
		integrantes: { type: 'array', items: { type: 'string' } },
		titulo: { type: 'string' }
	}
} as const;

/**
 * First lines of the extracted text, cleaned for the model.
 *
 * Two things matter here: the header must be inside the window (a PDF's first
 * 2000 chars are the header, not page 4), and repeated blank lines must not eat
 * the budget. The slice happens after normalising newlines so the length is
 * comparable across PDF/DOCX/TXT sources.
 */
export function headerSlice(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, HEADER_CHAR_LIMIT)
		.trim();
}

/**
 * Prompt for the metadata pass.
 *
 * It is deliberately strict: the model reads a cover page that usually mixes
 * the university, the career, the subject, the commission, the teacher, the
 * date and the actual work title in the same block. Left unsaid, models happily
 * return the subject as the title and the teacher as the author, so the prompt
 * names every one of those traps explicitly and keeps "when in doubt, leave it
 * empty" as the rule that protects the review table.
 */
export function buildMetadataPrompt(header: string, context: MetadataContext = {}): string {
	const reference = referenceBlock(context);

	return `Leé el encabezado de esta entrega y extraé solo los datos que estén impresos en el texto.

Devolvé un JSON con esta forma exacta:
{"nombre": "string", "integrantes": ["string"], "titulo": "string"}

Definiciones:
- "nombre": nombre y apellido del autor principal, tal como está impreso (si figura como "Apellido, Nombre", copiá ese orden).
- "integrantes": los demás integrantes listados en el encabezado, en el orden en que aparecen.
- "titulo": título del trabajo entregado, tal como está impreso, con su subtítulo y su número si forman parte del título.

Qué NO es el título: la asignatura o materia, la comisión o cátedra, la carrera, la facultad o universidad, el nombre del docente, la fecha, el año o cuatrimestre, y el número de hoja.

Qué NO es un nombre de alumno: el docente, el JTP o el ayudante; la institución; una dirección de correo; un legajo o padrón; y una etiqueta suelta como "Alumno:" o "Integrantes:" sin un nombre al lado.

Reglas:
1. No inventes ni completes datos: si un dato no aparece, devolvé "" o [].
2. No repitas el nombre del autor dentro de "integrantes".
3. Copiá los nombres tal como están escritos, sin corregir ortografía.
4. Si una línea mezcla varios datos ("Materia: X - Alumno: Y"), extraé solo el valor del campo que corresponde.
5. El título tiene que estar impreso en el encabezado: no devuelvas la actividad como título salvo que aparezca escrita ahí.
6. Si el encabezado no imprime un título propio del trabajo, devolvé "" en "titulo".
7. Si el encabezado es ilegible, devolvé {"nombre": "", "integrantes": [], "titulo": ""}.
8. Respondé únicamente con el JSON, sin explicaciones ni markdown.
${reference}
Encabezado:
"""
${header}
"""`;
}

/** Reference lines for the model; empty when the activity knows nothing yet. */
function referenceBlock(context: MetadataContext): string {
	const activity = context.activityTitle?.trim();
	const subject = context.subjectName?.trim();
	if (!activity && !subject) return '';

	const lines = ['', 'Datos de referencia de la actividad (no están impresos necesariamente y no son el autor):'];
	if (activity) lines.push(`- Actividad: ${activity}`);
	if (subject) lines.push(`- Asignatura: ${subject}`);
	lines.push(
		'Usalos solo para reconocer el título impreso (por ejemplo, aceptar "TP 2" cuando la actividad es "TP 2: Límites"), nunca para completar un dato que el encabezado no tiene.',
		''
	);
	return lines.join('\n');
}

function normalizeKey(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Labels a header prints next to a value: "Título:", "Alumno:", "Legajo:".
 *
 * They are matched only at the start of the line and only when a separator
 * follows, so a real title that happens to start with a label word ("Curso de
 * análisis") is not mangled, while "Título: Curso de análisis" loses only the
 * label. Alternatives carry their own accents because the text is not
 * normalised before matching.
 */
const FIELD_LABELS = [
	't[ií]tulo',
	'tema',
	'nombre',
	'alumn[oa]s?',
	'estudiantes?',
	'autor(?:a|es)?',
	'integrantes?',
	'entrega',
	'actividad',
	'materia',
	'asignatura',
	'comisi[oó]n',
	'c[áa]tedra',
	'curso',
	'carrera',
	'facultad',
	'universidad',
	'docentes?',
	'profesor(?:a|es)?',
	'jtp',
	'ayudantes?',
	'tutor(?:a|es)?',
	'fecha',
	'a[ñn]o',
	'cuatrimestre',
	'legajo',
	'padr[óo]n',
	'dni',
	'e-?mail',
	'correo'
];

/** Label + optional number ("N° 2") + separator, anchored at the start. */
const SEPARATOR = '\\s*(?:n[°º]?\\s*\\d+)?\\s*[:\\-–—]';

/** Lines that announce a field other than the work's title. */
const NON_TITLE_LABELS =
	'materia|asignatura|comisi[oó]n|c[áa]tedra|curso|carrera|facultad|universidad|docentes?|profesor(?:a|es)?|jtp|ayudantes?|tutor(?:a|es)?|fecha|a[ñn]o|cuatrimestre|legajo|padr[óo]n|dni|e-?mail|correo|nota|calificaci[oó]n';

/** Lines that announce a role, an institution or an id instead of a student. */
const NON_NAME_LABELS =
	'materia|asignatura|comisi[oó]n|c[áa]tedra|curso|carrera|facultad|universidad|docentes?|profesor(?:a|es)?|jtp|ayudantes?|tutor(?:a|es)?|fecha|legajo|padr[óo]n|dni|e-?mail|correo';

const STRIP_FIELD_LABEL_RE = new RegExp(`^(?:${FIELD_LABELS.join('|')})${SEPARATOR}\\s*`, 'iu');

const NON_TITLE_LINE_RE = new RegExp(`^(?:${NON_TITLE_LABELS})${SEPARATOR}`, 'iu');
const NON_NAME_LINE_RE = new RegExp(`^(?:${NON_NAME_LABELS})${SEPARATOR}`, 'iu');

/** "Comisión 3", "Legajo 12345", "Comisión": a label carrying only an id. */
function labelOnlyRegExp(labels: string): RegExp {
	return new RegExp(`^(?:${labels})\\s*(?:n[°º]?\\s*)?\\d*\\s*$`, 'iu');
}

const NON_TITLE_LABEL_ONLY_RE = labelOnlyRegExp(NON_TITLE_LABELS);
const NON_NAME_LABEL_ONLY_RE = labelOnlyRegExp(NON_NAME_LABELS);

/**
 * "Universidad Nacional de La Plata" is an institution, never a title or an
 * author. The capitalised word after the keyword is what separates it from a
 * title that merely starts with the same word ("Universidad y sociedad").
 */
function startsWithInstitution(value: string): boolean {
	const match = /^(?:universidad|facultad|colegio|instituto|escuela)\b/i.exec(value.trim());
	if (!match) return false;
	const rest = value
		.trim()
		.slice(match[0].length)
		.trim()
		.replace(/^(?:de|del|de la|de las|de los)\s+/i, '');
	return /^\p{Lu}/u.test(rest);
}

const MONTHS = [
	'enero',
	'febrero',
	'marzo',
	'abril',
	'mayo',
	'junio',
	'julio',
	'agosto',
	'septiembre',
	'setiembre',
	'octubre',
	'noviembre',
	'diciembre'
];

/** "12/05/2025", "2025", "Mayo de 2025": a date is never a title. */
function looksLikeDate(value: string): boolean {
	const text = normalizeKey(value);
	if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(text)) return true;
	if (/^\d{4}$/.test(text)) return true;
	const withoutYear = text.replace(/\b\d{2,4}\b/g, '').replace(/\bde\b/g, '').replace(/\s+/g, ' ').trim();
	return MONTHS.includes(withoutYear);
}

function stripFieldLabels(value: string): string {
	let current = value.trim();
	// Two passes so "Título: Tema: X" loses both labels.
	for (let pass = 0; pass < 2; pass += 1) {
		const next = current.replace(STRIP_FIELD_LABEL_RE, '').trim();
		if (next === current) break;
		current = next;
	}
	return current;
}

function cleanText(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const cleaned = value
		// Markdown markers and printed separators become spaces: "Ana_Gómez"
		// is two words, not one.
		.replace(/[*_`#]+/g, ' ')
		.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (PLACEHOLDERS.has(normalizeKey(cleaned))) return null;
	return cleaned.slice(0, maxLength).trim() || null;
}

/**
 * A student name, after removing what a header prints around it.
 *
 * Covers the two ways a header poisons the name: the label glued to the value
 * ("Alumno: Ana Gómez") and the id glued to the surname ("Ana Gómez 12345").
 * A line that announces a role or an institution is dropped entirely instead of
 * being "cleaned", because "Docente: Pedro Ruiz" is not a student called
 * "Pedro Ruiz".
 */
function cleanName(value: unknown): string | null {
	const text = cleanText(value, NAME_MAX);
	if (!text) return null;
	if (NON_NAME_LINE_RE.test(text) || NON_NAME_LABEL_ONLY_RE.test(text)) return null;
	if (startsWithInstitution(text)) return null;
	if (text.includes('@') || /https?:\/\/|www\./i.test(text)) return null;

	const withoutId = text.replace(/\s*[-–—,;]?\s*\b\d{3,}\b\s*$/u, '').trim();
	const cleaned = stripFieldLabels(withoutId).replace(/^[-–—,;.\s]+|[-–—,;.\s]+$/g, '').trim();
	if (!cleaned || !/\p{L}/u.test(cleaned)) return null;
	return cleaned.slice(0, NAME_MAX).trim() || null;
}

/**
 * The delivery title, after removing labels and refusing metadata lines.
 *
 * A model that returns "Materia: Análisis Matemático" as the title is wrong in
 * a way the teacher has to undo by hand, so that line returns null instead. The
 * subject name is refused too, which is the most common confusion on a cover
 * page.
 */
function cleanTitle(value: unknown, context: MetadataContext): string | null {
	const text = cleanText(value, TITLE_MAX);
	if (!text) return null;
	if (NON_TITLE_LINE_RE.test(text) || NON_TITLE_LABEL_ONLY_RE.test(text)) return null;
	if (startsWithInstitution(text)) return null;

	const stripped = stripFieldLabels(text).replace(/\s+/g, ' ').trim();
	if (!stripped || NON_TITLE_LINE_RE.test(stripped) || NON_TITLE_LABEL_ONLY_RE.test(stripped)) return null;
	if (looksLikeDate(stripped)) return null;
	if (!/[\p{L}\d]/u.test(stripped)) return null;

	const subject = context.subjectName?.trim();
	if (subject && normalizeKey(stripped) === normalizeKey(subject)) return null;

	// The activity name is the other line a cover page repeats and a model
	// happily returns as the work's title ("Ensayo fenómeno del niño" printed as
	// the header of an essay about it). It is not the title, so it never fills it.
	const activity = context.activityTitle?.trim();
	if (activity && normalizeKey(stripped) === normalizeKey(activity)) return null;

	return stripped.slice(0, TITLE_MAX).trim() || null;
}

function cleanMembers(value: unknown, author: string | null): string[] {
	let raw: unknown[] = [];
	if (Array.isArray(value)) raw = value;
	else if (typeof value === 'string') raw = value.split(/\n|;/);
	else return [];

	const seen = new Set<string>();
	const authorKey = author ? normalizeKey(author) : null;
	const members: string[] = [];

	for (const entry of raw) {
		const name = cleanName(entry);
		if (!name) continue;
		const key = normalizeKey(name);
		if (key === authorKey || seen.has(key)) continue;
		seen.add(key);
		members.push(name);
		if (members.length >= MAX_MEMBERS) break;
	}

	return members;
}

/**
 * Turns whatever the provider returned into a usable suggestion.
 *
 * Accepts the prompt's Spanish keys, the English ones some models prefer, a
 * loose JSON string with markdown fences, and anything else by returning empty
 * fields instead of throwing. A model failure must never break the review
 * table; the teacher can always type the data.
 */
export function normalizeMetadata(raw: unknown, context: MetadataContext = {}): DocumentMetadata {
	let data: unknown = raw;
	if (typeof data === 'string') {
		try {
			data = parseJsonLoose(data);
		} catch {
			return { ...EMPTY_METADATA };
		}
	}
	if (!data || typeof data !== 'object') return { ...EMPTY_METADATA };

	const record = data as Record<string, unknown>;
	const name = cleanName(record.nombre ?? record.name);
	const members = cleanMembers(record.integrantes ?? record.members, name);

	// A header that repeats one line for both fields must not fill both: the
	// author is the better claim, so the duplicate title is dropped.
	let title = cleanTitle(record.titulo ?? record.title, context);
	if (title && name && normalizeKey(title) === normalizeKey(name)) title = null;

	return { name, members, title };
}

/**
 * Re-applies the current rules to a suggestion stored earlier.
 *
 * Prompts and guards improve over time, and a cached suggestion does not. The
 * extraction pass compares this result with what is stored and pays for a new
 * model call when the old answer no longer survives the rules, so a title that
 * used to be the subject name stops being shown without a migration.
 */
export function sanitizeMetadata(
	metadata: DocumentMetadata,
	context: MetadataContext = {}
): DocumentMetadata {
	return normalizeMetadata(
		{ nombre: metadata.name, integrantes: metadata.members, titulo: metadata.title },
		context
	);
}

/** Field-by-field comparison; members are compared in order. */
export function metadataEquals(a: DocumentMetadata, b: DocumentMetadata): boolean {
	return (
		a.name === b.name &&
		a.title === b.title &&
		a.members.length === b.members.length &&
		a.members.every((member, index) => member === b.members[index])
	);
}

/** True when the suggestion carries at least one usable field. */
export function hasMetadata(metadata: DocumentMetadata): boolean {
	return Boolean(metadata.name || metadata.title || metadata.members.length > 0);
}

/** Round-trip for the `file.metadata_integrantes` text column. */
export function serializeMembers(members: string[]): string | null {
	return members.length > 0 ? JSON.stringify(members) : null;
}

/** Tolerant read of `file.metadata_integrantes`; bad data means "no members". */
export function deserializeMembers(stored: string | null): string[] {
	if (!stored) return [];
	try {
		const parsed = JSON.parse(stored);
		if (!Array.isArray(parsed)) return [];
		return cleanMembers(parsed, null);
	} catch {
		return [];
	}
}

/**
 * What the metadata pass would write on a delivery, decided without touching
 * the database so the rule is testable and the same in every caller.
 *
 * It only fills gaps: a title, a printed name or a roster link the teacher
 * already has is never overwritten. `null` in a field means "leave it alone".
 */
export type MetadataApplicationPlan = {
	title: string | null;
	studentName: string | null;
	studentId: string | null;
	/** Short labels of what the plan writes, for the review-table notice. */
	applied: string[];
};

export type MetadataApplicationInput = {
	/** Current values stored on the delivery. */
	current: { title: string | null; studentName: string | null; studentId: string | null };
	metadata: DocumentMetadata;
	/** File name of the main document: a hint, never an identity. */
	fileName?: string | null;
	/** Roster of the activity's subject; empty when there is no subject. */
	roster?: RosterEntry[];
};

export function planMetadataApplication(input: MetadataApplicationInput): MetadataApplicationPlan {
	const { current, metadata, fileName, roster = [] } = input;

	// The header is the printed evidence. The roster is still the only verified
	// identity, so a name becomes a link only when it resolves by canonical key.
	const author = metadata.name ?? metadata.members[0] ?? null;

	const title = !current.title?.trim() && metadata.title ? metadata.title : null;
	const studentName = !current.studentName?.trim() && author ? author : null;

	let studentId: string | null = null;
	let matchedFromFile = false;
	if (!current.studentId) {
		const candidates: { name: string; fromFile: boolean }[] = [];
		if (author) candidates.push({ name: author, fromFile: false });
		if (current.studentName?.trim()) candidates.push({ name: current.studentName, fromFile: false });
		const fromFile = fileName ? (parseMoodleFileName(fileName)?.name ?? null) : null;
		if (fromFile) candidates.push({ name: fromFile, fromFile: true });

		for (const candidate of candidates) {
			const match = resolveRosterMatch(candidate.name, roster);
			if (!match) continue;
			studentId = match.studentId;
			matchedFromFile = candidate.fromFile;
			break;
		}
	}

	const applied: string[] = [];
	if (title) applied.push('título');
	if (studentName) applied.push('nombre impreso');
	if (studentId) {
		applied.push(
			matchedFromFile ? 'estudiante del padrón (por el nombre del archivo)' : 'estudiante del padrón'
		);
	}

	return { title, studentName, studentId, applied };
}

export type MetadataCompletionInput = {
	title: string | null | undefined;
	studentName: string | null | undefined;
	studentId: string | null | undefined;
	/** Size of the activity's roster: without one, nothing can be linked. */
	rosterSize: number;
};

/**
 * Whether the header pass still has something it can write on this delivery.
 *
 * The rule matters for the bulk button, not for the extraction itself: a
 * delivery with a title and a printed name but no roster link is only a gap
 * when a roster exists. Counting it anyway kept the same rows in the queue
 * forever, so every click paid one model call per delivery and the number in
 * the button never went down.
 */
export function needsMetadataCompletion(input: MetadataCompletionInput): boolean {
	if (!input.title?.trim()) return true;
	if (!input.studentName?.trim()) return true;
	if (!input.studentId && input.rosterSize > 0) return true;
	return false;
}
