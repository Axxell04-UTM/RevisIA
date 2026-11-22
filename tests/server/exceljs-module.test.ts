import { describe, expect, it } from 'vitest';
import { resolveExcelJs } from '../../src/lib/server/exceljs-module.js';

/**
 * exceljs ships as CommonJS only. Under native Node ESM — what the built server
 * uses — the module namespace exposes the library exclusively as `default`, so
 * reading `.Workbook` straight off the namespace throws
 * "ExcelJS.Workbook is not a constructor". Vite's interop also spreads the
 * exports as names, which is why the unit test never caught it.
 *
 * Both shapes are pinned here so the resolver cannot regress into reading the
 * namespace blindly again.
 */

class FakeWorkbook {
	readonly kind = 'fake-workbook';
}

type ExcelJsLibrary = typeof import('exceljs');

const asLibrary = (workbook: unknown) => ({ Workbook: workbook }) as unknown as ExcelJsLibrary;

describe('resolveExcelJs', () => {
	it('unwraps a CommonJS namespace that only exposes default', () => {
		const resolved = resolveExcelJs({ default: asLibrary(FakeWorkbook) });

		expect(new resolved.Workbook()).toBeInstanceOf(FakeWorkbook);
	});

	it('keeps a namespace that already carries the named exports', () => {
		const resolved = resolveExcelJs(asLibrary(FakeWorkbook));

		expect(new resolved.Workbook()).toBeInstanceOf(FakeWorkbook);
	});
});
