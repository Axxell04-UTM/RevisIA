import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { extractPdfText } from '../../src/lib/server/file-extraction.js';

/**
 * unpdf 2.x rejects a Node Buffer and returns `{ totalPages, text }` instead of
 * a bare string/array. Both broke every source-document extraction with a 500,
 * so this pins the contract against a real PDF.
 */
describe('extractPdfText', () => {
	it('extracts text from a real PDF passed as a Node Buffer', async () => {
		const buffer = await readFile(
			new URL('../../entregas-prueba/Gomez_Ana_12345.pdf', import.meta.url)
		);

		const result = await extractPdfText(buffer);

		expect(result.success).toBe(true);
		expect(result.pages).toBeGreaterThan(0);
		expect(result.text.length).toBeGreaterThan(0);
		expect(result.text).not.toContain('[object Object]');
	});
});
