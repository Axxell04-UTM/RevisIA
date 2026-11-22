import type * as ExcelJsImport from 'exceljs';

type ExcelJsLibrary = typeof ExcelJsImport;

/**
 * Returns the usable exceljs library from its module namespace.
 *
 * exceljs is CommonJS only (`module.exports = ExcelJS` built from a variable, so
 * Node's static lexer cannot see named exports). Under native ESM the namespace
 * therefore exposes the library only as `default`, and `ExcelJS.Workbook` is
 * `undefined`. Vite's interop spreads the names instead, so a unit test that
 * imports exceljs directly sees a different shape than the running server.
 *
 * Always resolve the library through this function, never off the raw namespace.
 */
export function resolveExcelJs(moduleNamespace: unknown): ExcelJsLibrary {
	const namespace = moduleNamespace as ExcelJsLibrary & { default?: ExcelJsLibrary };
	return namespace.default ?? namespace;
}
