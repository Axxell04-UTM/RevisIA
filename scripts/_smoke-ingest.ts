import { readFileSync } from 'node:fs';
import { extractSubmissionZip } from '../src/lib/server/zip-ingest.js';
import { detectMimeType } from '../src/lib/server/file-signature.js';

const zip = readFileSync('entregas-prueba/entregas-moodle.zip');
const result = await extractSubmissionZip(zip);
console.log('accepted:', result.accepted.length, 'rejected:', result.rejected.length, 'totalUncompressed:', result.totalUncompressed);
for (const entry of result.accepted) {
	const detected = detectMimeType(entry.data, entry.fileName);
	console.log(`${entry.fileName} -> ${detected} (${entry.data.length} bytes)`);
}
if (result.rejected.length) console.log('REJECTED', result.rejected);
