import { validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import { validateCatalogFiles } from './file-validation.js'
import { loadCatalog } from './load-catalog.js'

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path.length === 0 ? '<catalog>' : diagnostic.path.join('.')
    console.error(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}: ${diagnostic.message}`)
  }
}

async function main(): Promise<void> {
  const [catalogFile, assetRoot] = process.argv.slice(2)
  if (catalogFile === undefined || assetRoot === undefined) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: 'Usage: tsx src/cli.ts <catalog-file> <asset-root>' }])
    process.exitCode = 1
    return
  }
  const parsed = await loadCatalog(catalogFile)
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics)
    process.exitCode = 1
    return
  }
  const diagnostics = [
    ...validateCatalogStructure(parsed.value),
    ...(await validateCatalogFiles(parsed.value, assetRoot)),
  ]
  printDiagnostics(diagnostics)
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) process.exitCode = 1
}

void main()
