/**
 * Genera un paquete de entregas de prueba para F2 (ingesta → revisión → metadatos).
 *
 * El objetivo es probar el sistema de punta a punta sin depender de archivos
 * externos: 10 documentos con nombres tipo Moodle, encabezados distintos (con
 * nombre, sin nombre, grupal, con coma, en mayúsculas) y un DOCX para cubrir el
 * segundo formato soportado.
 *
 * Los PDFs se construyen a mano (sin librería) para que el resultado sea
 * determinístico y para que el texto tenga capa real: el generador después los
 * vuelve a leer con `unpdf` y `mammoth`, las mismas librerías que usa la app, y
 * falla si alguno no extrae su marcador. Un fixture que la app no puede leer no
 * sirve como fixture.
 *
 * Uso: pnpm fixtures:f2
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { getDocumentProxy, extractText } from 'unpdf';
import { extractRawText } from 'mammoth';
import yauzl from 'yauzl';

const OUT_DIR = join(process.cwd(), 'entregas-prueba');
const ZIP_PATH = join(OUT_DIR, 'entregas-moodle.zip');

type Fixture = {
	fileName: string;
	kind: 'pdf' | 'docx';
	/** Líneas del encabezado: lo único que debe mirar la extracción de metadatos. */
	header: string[];
	/** Cuerpo del trabajo, para superar el umbral de capa de texto. */
	body: string[];
	/** Token único que la verificación busca en el texto extraído. */
	marker: string;
	scenario: string;
};

const FIXTURES: Fixture[] = [
	{
		fileName: 'Gomez_Ana_12345.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Ana Gómez',
			'Legajo: 12345'
		],
		body: [
			'Consigna 1: resolver la ecuación cuadrática planteada y justificar cada paso.',
			'Aplico la fórmula resolvente, calculo el discriminante y verifico ambas raíces por sustitución.',
			'Consigna 2: explicar cuándo el sistema no tiene solución real y dar un ejemplo.',
			'El discriminante negativo implica raíces complejas conjugadas; lo muestro con un caso numérico.'
		],
		marker: 'Ana Gómez',
		scenario: 'Individual con nombre en el encabezado y coincidencia exacta con el padrón.'
	},
	{
		fileName: 'Perez_Juan_12346.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'JUAN PÉREZ',
			'Legajo: 12346'
		],
		body: [
			'Consigna 1: desarrollar el procedimiento completo con unidades y redondeo indicado.',
			'Resuelvo primero el caso base y luego generalizo; dejo el desarrollo intermedio visible.',
			'Consigna 2: comparar el resultado con la estimación previa del enunciado.',
			'La diferencia es menor al dos por ciento, consistente con el error de redondeo esperado.'
		],
		marker: 'JUAN PÉREZ',
		scenario: 'Nombre en mayúsculas: el matching debe ignorar mayúsculas y acentos.'
	},
	{
		fileName: 'Diaz_Luis_12347.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Díaz, Luis',
			'Legajo: 12347'
		],
		body: [
			'Consigna 1: resolver el sistema de dos ecuaciones con dos incógnitas.',
			'Uso sustitución porque una incógnita ya está despejada; luego valido con el método gráfico.',
			'Consigna 2: indicar si el sistema es compatible determinado, indeterminado o incompatible.',
			'Es compatible determinado: las rectas se cortan en un único punto del primer cuadrante.'
		],
		marker: 'Díaz, Luis',
		scenario: 'Nombre invertido con coma ("Apellido, Nombre"), como suele venir del padrón.'
	},
	{
		fileName: 'Rodriguez_Maria_12348.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones'
		],
		body: [
			'Consigna 1: resolver la ecuación de segundo grado y graficar la parábola.',
			'Identifico vértice, raíces y ordenada al origen; el gráfico acompaña el desarrollo algebraico.',
			'Consigna 2: justificar la elección del método de resolución.',
			'Elegí factorización porque el término independiente permite agrupar de forma directa.'
		],
		marker: 'graficar la parábola',
		scenario: 'Encabezado SIN nombre: la extracción debe devolver nombre vacío y el sistema cae al nombre del archivo.'
	},
	{
		fileName: 'Fernandez_Sofia_12349.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Integrantes: Sofía Fernández, Mateo Silva, Valentina Rossi',
			'Comisión 3 — Grupo 7'
		],
		body: [
			'Consigna 1: resolver el problema de optimización con restricciones lineales.',
			'Planteo la función objetivo, dibujo la región factible y evalúo los vértices.',
			'Consigna 2: explicar por qué el óptimo se alcanza en un vértice.',
			'Porque la función objetivo es lineal y la región factible es un politopo convexo y acotado.'
		],
		marker: 'Integrantes',
		scenario: 'Trabajo grupal: tres integrantes en una sola entrega (uno de ellos fuera del padrón).'
	},
	{
		fileName: 'Silva_Mateo_12350.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Mateo Silva',
			'Legajo: 12350'
		],
		body: [
			'Consigna 1: implementar el algoritmo de búsqueda binaria sobre un arreglo ordenado.',
			'Describo el invariante del ciclo y muestro la traza para un arreglo de diez elementos.',
			'Consigna 2: indicar la complejidad temporal y justificarla.',
			'Cada iteración descarta la mitad del espacio de búsqueda, por lo que es O(log n).'
		],
		marker: 'Mateo Silva',
		scenario: 'Individual normal; también figura como integrante del trabajo grupal anterior.'
	},
	{
		fileName: 'Rossi_Valentina_12351.docx',
		kind: 'docx',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Valentina Rossi',
			'Legajo: 12351'
		],
		body: [
			'Consigna 1: documentar el diseño de la solución con un diagrama de flujo.',
			'Presento el diagrama, explico cada decisión y enumero los casos borde considerados.',
			'Consigna 2: describir las pruebas realizadas.',
			'Incluyo pruebas de camino feliz, entradas vacías y valores límite del rango permitido.'
		],
		marker: 'Valentina Rossi',
		scenario: 'DOCX: cubre el segundo formato soportado y la extracción con mammoth.'
	},
	{
		fileName: 'Lopez_Pedro_12352.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Pedro López',
			'Legajo: 12352'
		],
		body: [
			'Consigna 1: resolver la ecuación exponencial aplicando logaritmos.',
			'Aplico logaritmo en ambos miembros, despejo la incógnita y verifico con calculadora.',
			'Consigna 2: discutir la validez del resultado en el contexto del problema.',
			'La solución es válida porque el dominio exige valores positivos y el resultado lo es.'
		],
		marker: 'Pedro López',
		scenario: 'Nombre válido pero AUSENTE del padrón: debe quedar "sin match" y poder vincularse a mano.'
	},
	{
		fileName: 'Martinez_Carla.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Trabajo Práctico 2: Ecuaciones',
			'Carla Martínez'
		],
		body: [
			'Consigna 1: analizar la convergencia de la sucesión definida por recurrencia.',
			'Demuestro que es monótona y acotada, por lo tanto convergente, y calculo el límite.',
			'Consigna 2: graficar los primeros términos para ilustrar el comportamiento.',
			'La gráfica muestra aproximación progresiva al límite desde abajo, sin oscilaciones.'
		],
		marker: 'Carla Martínez',
		scenario: 'Nombre de archivo SIN id numérico: el parser debe devolver nombre y externalId nulo.'
	},
	{
		fileName: 'Sosa_Diego_12354.pdf',
		kind: 'pdf',
		header: [
			'Universidad Nacional de Ejemplo',
			'Programación I — Comisión 3',
			'Materia: Programación I',
			'Informe de laboratorio sobre estructuras de datos y algoritmos de ordenamiento',
			'Diego Sosa',
			'Legajo: 12354'
		],
		body: [
			'Consigna 1: comparar ordenamiento por inserción y por mezcla en distintos tamaños.',
			'Presento una tabla con tiempos medidos y explico la diferencia teórica entre ambos.',
			'Consigna 2: concluir cuál conviene para arreglos casi ordenados.',
			'Inserción rinde mejor en ese caso porque aprovecha el orden previo y hace pocos movimientos.'
		],
		marker: 'Diego Sosa',
		scenario: 'Encabezado con ruido (materia repetida + título largo): ni la materia ni la comisión deben tomarse como título.'
	}
];

/** Padrón que acompaña al ZIP. Pedro López queda afuera a propósito. */
const ROSTER_CSV = `nombre,legajo,email
"Gómez, Ana",12345,ana.gomez@example.edu
"Pérez, Juan",12346,juan.perez@example.edu
"Luis Díaz",12347,luis.diaz@example.edu
"Rodríguez, María",12348,maria.rodriguez@example.edu
"Sofía Fernández",12349,sofia.fernandez@example.edu
"Silva, Mateo",12350,mateo.silva@example.edu
"Valentina Rossi",12351,valentina.rossi@example.edu
"Carla Martínez",12352,carla.martinez@example.edu
"Lucía Benítez",12399,lucia.benitez@example.edu
`;

// ---------------------------------------------------------------------------
// PDF mínimo, una página, Helvetica con WinAnsi (los acentos sobreviven).
// ---------------------------------------------------------------------------

function escapePdfText(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(lines: string[]): Buffer {
	const content = [
		'BT',
		'/F1 12 Tf',
		'16 TL',
		'50 792 Td',
		...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
		'ET'
	].join('\n');
	const contentBytes = Buffer.from(content, 'latin1');

	const objects: Buffer[] = [
		Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
		Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
		Buffer.from(
			'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
			'latin1'
		),
		Buffer.concat([
			Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`, 'latin1'),
			contentBytes,
			Buffer.from('\nendstream', 'latin1')
		]),
		Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1')
	];

	const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
	const offsets: number[] = [];
	let offset = chunks[0].length;

	objects.forEach((object, index) => {
		offsets.push(offset);
		const chunk = Buffer.concat([
			Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
			object,
			Buffer.from('\nendobj\n', 'latin1')
		]);
		chunks.push(chunk);
		offset += chunk.length;
	});

	const xref = [
		'xref',
		`0 ${objects.length + 1}`,
		'0000000000 65535 f ',
		...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n `),
		'',
		'trailer',
		`<< /Size ${objects.length + 1} /Root 1 0 R >>`,
		'startxref',
		String(offset),
		'%%EOF',
		''
	].join('\n');

	chunks.push(Buffer.from(xref, 'latin1'));
	return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// DOCX mínimo (OOXML) con ZIP propio, stored sin compresión.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let value = i;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[i] = value;
	}
	return table;
})();

function crc32(buffer: Buffer): number {
	let value = 0xffffffff;
	for (let i = 0; i < buffer.length; i += 1) {
		value = CRC_TABLE[(value ^ buffer[i]) & 0xff] ^ (value >>> 8);
	}
	return (value ^ 0xffffffff) >>> 0;
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const compressed = deflateRawSync(entry.data);
		const nameBytes = Buffer.from(entry.name, 'utf8');
		const crc = crc32(entry.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);

		localParts.push(local, nameBytes, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);

		centralParts.push(central, nameBytes);
		offset += local.length + nameBytes.length + compressed.length;
	}

	const localSection = Buffer.concat(localParts);
	const centralDirectory = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(localSection.length, 16);

	return Buffer.concat([localSection, centralDirectory, end]);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildDocx(lines: string[]): Buffer {
	const paragraph = (line: string) =>
		`<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
	const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines
		.map(paragraph)
		.join('')}<w:sectPr/></w:body></w:document>`;

	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

	const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

	return buildZip([
		{ name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
		{ name: '_rels/.rels', data: Buffer.from(relationships, 'utf8') },
		{ name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') }
	]);
}

// ---------------------------------------------------------------------------
// Verificación: se relee con las mismas librerías que usa la app.
// ---------------------------------------------------------------------------

async function readPdfText(buffer: Buffer): Promise<string> {
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const result = await extractText(pdf, { mergePages: true });
	return String(result.text ?? result);
}

async function verify(): Promise<void> {
	let failures = 0;

	for (const fixture of FIXTURES) {
		const bytes = readFileSync(join(OUT_DIR, fixture.fileName));
		const text =
			fixture.kind === 'pdf'
				? await readPdfText(bytes)
				: (await extractRawText({ buffer: bytes })).value;

		const ok = text.includes(fixture.marker);
		if (!ok) failures += 1;
		console.log(`${ok ? 'OK  ' : 'FAIL'} ${fixture.fileName} — ${text.length} chars extraídos`);
	}

	const names = await new Promise<string[]>((resolve, reject) => {
		yauzl.fromBuffer(readFileSync(ZIP_PATH), { lazyEntries: true }, (error, zip) => {
			if (error || !zip) return reject(error ?? new Error('ZIP inválido'));
			const collected: string[] = [];
			zip.on('entry', (entry: yauzl.Entry) => {
				if (!entry.fileName.endsWith('/')) collected.push(entry.fileName);
				zip.readEntry();
			});
			zip.on('end', () => resolve(collected));
			zip.on('error', reject);
			zip.readEntry();
		});
	});

	const expected = FIXTURES.map((fixture) => fixture.fileName).sort();
	if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) {
		failures += 1;
		console.error('FAIL el ZIP no contiene exactamente los 10 archivos');
	} else {
		console.log(`OK   ${ZIP_PATH} — ${names.length} entradas`);
	}

	if (failures > 0) {
		throw new Error(`${failures} verificación(es) fallaron`);
	}
}

const README = `# Entregas de prueba — F2

Generado por \`pnpm fixtures:f2\` (script: \`scripts/generar-entregas-prueba.ts\`).
No editar a mano: se regenera y se sobrescribe.

## Cómo usarlo

1. Importá \`padron.csv\` en la materia (Roster → Importar CSV).
2. Entrá a una actividad abierta y subí \`entregas-moodle.zip\` (contexto ZIP de entregas).
3. En la tabla de revisión verificá el matching y probá el botón **Metadatos**.

## Escenarios incluidos

${FIXTURES.map((fixture) => `- \`${fixture.fileName}\` — ${fixture.scenario}`).join('\n')}

## Qué mirar

- **Matching**: 8 de las 10 deberían vincularse solas con el padrón; Pedro López debe
  quedar "sin match" y poder vincularse/desvincularse a mano.
- **Grupo**: el PDF de Sofía Fernández debe quedar como entrega grupal con 3 integrantes;
  Valentina Rossi figura como integrante sin estar vinculada al padrón.
- **Metadatos**: en el archivo sin nombre (\`Rodriguez_Maria_12348.pdf\`) la sugerencia no
  debe inventar un nombre; en el caso con ruido (\`Sosa_Diego_12354.pdf\`) el título no
  debe ser la materia ni la comisión.
- **DOCX**: \`Rossi_Valentina_12351.docx\` prueba el camino de mammoth.

\`padron.csv\` incluye a Lucía Benítez, que no entrega nada, y omite a Pedro López.
`;

function main(): void {
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });

	const zipped: { name: string; data: Buffer }[] = [];

	for (const fixture of FIXTURES) {
		const lines = [...fixture.header, '', ...fixture.body];
		const data = fixture.kind === 'pdf' ? buildPdf(lines) : buildDocx(lines);
		writeFileSync(join(OUT_DIR, fixture.fileName), data);
		zipped.push({ name: fixture.fileName, data });
	}

	writeFileSync(ZIP_PATH, buildZip(zipped));
	writeFileSync(join(OUT_DIR, 'padron.csv'), ROSTER_CSV, 'utf8');
	writeFileSync(join(OUT_DIR, 'README.md'), README, 'utf8');

	console.log(`Generados ${FIXTURES.length} archivos en ${OUT_DIR}`);
}

main();
await verify();
