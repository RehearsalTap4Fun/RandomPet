import { validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateCatalogFiles } from './file-validation.js'
import { loadCatalog } from './load-catalog.js'
import { validateProductionEvidenceManifest } from './evidence-root.js'
import { validateProductionSourceFiles, type SourceRichValidationResult } from './source-rich-validation.js'
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
  const [catalogFile, assetRoot, ...options] = process.argv.slice(2)
  const production = options.includes('--production')
  const sourceRootOption = options.indexOf('--source-root')
  const sourceRoot = sourceRootOption === -1 ? undefined : options[sourceRootOption + 1]
  const recognized = new Set<number>()
  if (production) recognized.add(options.indexOf('--production'))
  if (sourceRootOption !== -1) {
    recognized.add(sourceRootOption)
    recognized.add(sourceRootOption + 1)
  }
  const invalidOptions = options.filter((_option, index) => !recognized.has(index))
  if (catalogFile === undefined || assetRoot === undefined) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: 'Usage: tsx src/cli.ts <catalog-file> <asset-root> [--production] [--source-root <asset-source/v0.1.0>]' }])
    process.exitCode = 1
    return
  }
  if (invalidOptions.length > 0 || (sourceRootOption !== -1 && (sourceRoot === undefined || sourceRoot.startsWith('--'))) || (sourceRoot !== undefined && !production)) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: '--source-root requires a path and may only be used together with --production.' }])
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
  let sourceRichResult: SourceRichValidationResult | undefined
  if (production) {
    const catalogDirectory = dirname(resolve(catalogFile))
    const sourceIndexPath = resolve(catalogDirectory, '..', '..', 'source-index.json')
    const evidenceManifestPath = resolve(catalogDirectory, '..', '..', 'audit', 'v0.1.0', 'evidence-manifest.json')
    let sourceIndex: ProductionSourceIndex = {}
    let evidenceManifest: unknown = null
    try {
      sourceIndex = JSON.parse(await readFile(sourceIndexPath, 'utf8')) as ProductionSourceIndex
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_SOURCE_INDEX_MISSING', path: [sourceIndexPath], message: 'Cannot read production source-index.json.' })
    }
    try {
      evidenceManifest = JSON.parse(await readFile(evidenceManifestPath, 'utf8')) as unknown
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_MANIFEST_MISSING', path: [evidenceManifestPath], message: 'Cannot read independent production evidence manifest.' })
    }
    diagnostics.push(
      ...validateProductionMetadata(parsed.value),
      ...(await validateProductionSplitFiles(parsed.value, catalogDirectory)),
      ...(await validateProductionSourceIndex(parsed.value, assetRoot, sourceIndex)),
      ...validateProductionEvidenceManifest(sourceIndex, evidenceManifest),
      ...(await validateNoStaleRuntimeAssets(parsed.value, assetRoot)),
    )
    if (sourceRoot !== undefined) {
      sourceRichResult = await validateProductionSourceFiles(sourceIndex, sourceRoot)
      diagnostics.push(...sourceRichResult.diagnostics)
    }
  }
  printDiagnostics(diagnostics)
  if (sourceRichResult !== undefined) {
    console.log(JSON.stringify({
      sourceRich: {
        referencesChecked: sourceRichResult.referencesChecked,
        uniqueFilesChecked: sourceRichResult.uniqueFilesChecked,
      },
    }))
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) process.exitCode = 1
}

void main()
