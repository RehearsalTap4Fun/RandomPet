import { validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateCatalogFiles } from './file-validation.js'
import { loadCatalog } from './load-catalog.js'
import {
  validateNoStaleRuntimeAssets,
  validateProductionMetadata,
  validateProductionSourceIndex,
  validateProductionSplitFiles,
  type ProductionSourceIndex,
} from './production-validation.js'

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path.length === 0 ? '<catalog>' : diagnostic.path.join('.')
    console.error(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}: ${diagnostic.message}`)
  }
}

async function main(): Promise<void> {
  const [catalogFile, assetRoot, mode] = process.argv.slice(2)
  if (catalogFile === undefined || assetRoot === undefined) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: 'Usage: tsx src/cli.ts <catalog-file> <asset-root> [--production]' }])
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
  if (mode === '--production') {
    const catalogDirectory = dirname(resolve(catalogFile))
    const sourceIndexPath = resolve(catalogDirectory, '..', '..', 'source-index.json')
    let sourceIndex: ProductionSourceIndex = {}
    try {
      sourceIndex = JSON.parse(await readFile(sourceIndexPath, 'utf8')) as ProductionSourceIndex
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_SOURCE_INDEX_MISSING', path: [sourceIndexPath], message: 'Cannot read production source-index.json.' })
    }
    diagnostics.push(
      ...validateProductionMetadata(parsed.value),
      ...(await validateProductionSplitFiles(parsed.value, catalogDirectory)),
      ...(await validateProductionSourceIndex(parsed.value, assetRoot, sourceIndex)),
      ...(await validateNoStaleRuntimeAssets(parsed.value, assetRoot)),
    )
  }
  printDiagnostics(diagnostics)
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) process.exitCode = 1
}

void main()
