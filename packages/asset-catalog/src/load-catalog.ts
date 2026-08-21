import { readFile } from 'node:fs/promises'
import { parseCatalog, type Catalog, type Diagnostic, type ParseResult } from '@qmonster/generator-core'

function error(code: string, message: string): Diagnostic {
  return { severity: 'error', code, path: [], message }
}

export async function loadCatalog(catalogFile: string): Promise<ParseResult<Catalog>> {
  let content: string
  try {
    content = await readFile(catalogFile, 'utf8')
  } catch {
    return { ok: false, diagnostics: [error('CATALOG_FILE_MISSING', `Cannot read catalog file: ${catalogFile}`)] }
  }
  try {
    return parseCatalog(JSON.parse(content) as unknown)
  } catch {
    return { ok: false, diagnostics: [error('CATALOG_JSON_INVALID', `Catalog is not valid JSON: ${catalogFile}`)] }
  }
}
