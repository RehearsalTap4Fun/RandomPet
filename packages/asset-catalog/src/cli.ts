import { validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { validateCatalogFiles } from './file-validation.js'
import { loadCatalog } from './load-catalog.js'
import { productionEvidenceSourceIndexPath, validateProductionEvidenceDependencies, validateProductionEvidenceManifest } from './evidence-root.js'
import { validateProductionSourceFiles, type SourceRichValidationResult } from './source-rich-validation.js'
import {
  validateNoStaleRuntimeAssets,
  validateProductionInterfaceResources,
  validateProductionMetadata,
  validateProductionSourceIndex,
  validateProductionSplitFiles,
  type ProductionSourceIndex,
  type RuntimeIntegrityReview,
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
  const sourceIndexOption = options.indexOf('--source-index')
  const sourceIndexInput = sourceIndexOption === -1 ? undefined : options[sourceIndexOption + 1]
  const evidenceManifestOption = options.indexOf('--evidence-manifest')
  const evidenceManifestInput = evidenceManifestOption === -1 ? undefined : options[evidenceManifestOption + 1]
  const recognized = new Set<number>()
  if (production) recognized.add(options.indexOf('--production'))
  if (sourceRootOption !== -1) {
    recognized.add(sourceRootOption)
    recognized.add(sourceRootOption + 1)
  }
  if (sourceIndexOption !== -1) {
    recognized.add(sourceIndexOption)
    recognized.add(sourceIndexOption + 1)
  }
  if (evidenceManifestOption !== -1) {
    recognized.add(evidenceManifestOption)
    recognized.add(evidenceManifestOption + 1)
  }
  const invalidOptions = options.filter((_option, index) => !recognized.has(index))
  if (catalogFile === undefined || assetRoot === undefined) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: 'Usage: tsx src/cli.ts <catalog-file> <asset-root> [--production --source-index <source-index.json> --evidence-manifest <evidence-manifest.json>] [--source-root <asset-source/vX.Y.Z>]' }])
    process.exitCode = 1
    return
  }
  const missingProductionEvidence = production && (sourceIndexInput === undefined || evidenceManifestInput === undefined)
  const malformedProductionPath = [sourceRoot, sourceIndexInput, evidenceManifestInput]
    .some(value => value !== undefined && value.startsWith('--'))
  const evidenceWithoutProduction = !production && (sourceIndexInput !== undefined || evidenceManifestInput !== undefined)
  if (invalidOptions.length > 0 || malformedProductionPath || (sourceRoot !== undefined && !production) || evidenceWithoutProduction || missingProductionEvidence) {
    printDiagnostics([{ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [], message: '--source-index and --evidence-manifest require paths and must be supplied together with --production; --source-root also requires --production.' }])
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
    let catalogDirectory = dirname(resolve(catalogFile))
    try {
      catalogDirectory = dirname(await realpath(catalogFile))
    } catch {
      diagnostics.push({ severity: 'error', code: 'CATALOG_CLI_ARGUMENTS_INVALID', path: [catalogFile], message: 'Production catalog file cannot be canonicalized.' })
    }
    let sourceIndexPath = resolve(sourceIndexInput!)
    let evidenceManifestPath = resolve(evidenceManifestInput!)
    let sourceIndex: ProductionSourceIndex = {}
    let evidenceManifest: unknown = null
    try {
      sourceIndexPath = await realpath(sourceIndexPath)
      sourceIndex = JSON.parse(await readFile(sourceIndexPath, 'utf8')) as ProductionSourceIndex
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_SOURCE_INDEX_MISSING', path: [sourceIndexPath], message: 'Cannot resolve/read the explicit production source-index.' })
    }
    try {
      evidenceManifestPath = await realpath(evidenceManifestPath)
      evidenceManifest = JSON.parse(await readFile(evidenceManifestPath, 'utf8')) as unknown
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_MANIFEST_MISSING', path: [evidenceManifestPath], message: 'Cannot resolve/read the explicit independent production evidence manifest.' })
    }
    const version = parsed.value.version
    const packageRoot = resolve(catalogDirectory, '..', '..')
    let task6Integrity: RuntimeIntegrityReview | undefined
    if (version === '0.3.0') {
      const task6IntegrityPath = resolve(packageRoot, 'review', `v${version}`, 'task6-approved-input-integrity.json')
      try {
        task6Integrity = JSON.parse(await readFile(task6IntegrityPath, 'utf8')) as RuntimeIntegrityReview
      } catch {
        diagnostics.push({ severity: 'error', code: 'PRODUCTION_RUNTIME_REVIEW_MISSING', path: [task6IntegrityPath], message: 'Cannot read the canonical Task 6 approved-input integrity review.' })
      }
    }
    const expectedSourceIndex = resolve(packageRoot, basename(productionEvidenceSourceIndexPath(version)))
    const expectedEvidenceManifest = resolve(packageRoot, 'audit', `v${version}`, 'evidence-manifest.json')
    try {
      if (sourceIndexPath !== await realpath(expectedSourceIndex)) {
        diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_PATH_INVALID', path: [sourceIndexPath], message: `Source-index must be the canonical ${expectedSourceIndex} for catalog version ${version}.` })
      }
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_PATH_INVALID', path: [expectedSourceIndex], message: `Expected source-index cannot be resolved for catalog version ${version}.` })
    }
    try {
      if (evidenceManifestPath !== await realpath(expectedEvidenceManifest)) {
        diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_PATH_INVALID', path: [evidenceManifestPath], message: `Evidence manifest must be the canonical ${expectedEvidenceManifest} for catalog version ${version}.` })
      }
    } catch {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_PATH_INVALID', path: [expectedEvidenceManifest], message: `Expected evidence manifest cannot be resolved for catalog version ${version}.` })
    }
    if (sourceIndex.catalogVersion !== version) {
      diagnostics.push({ severity: 'error', code: 'PRODUCTION_EVIDENCE_VERSION_MISMATCH', path: ['catalogVersion'], message: `Source-index version must equal catalog version ${version}.` })
    }
    diagnostics.push(
      ...validateProductionMetadata(parsed.value),
      ...(await validateProductionSplitFiles(parsed.value, catalogDirectory)),
      ...(await validateProductionSourceIndex(parsed.value, assetRoot, sourceIndex)),
      ...(await validateProductionInterfaceResources(parsed.value, assetRoot, sourceIndex, {
        manifestPath: resolve(packageRoot, '..', '..', 'asset-source', `v${version}`, 'interface-manifest.json'),
      })),
      ...validateProductionEvidenceManifest(sourceIndex, evidenceManifest),
      ...(await validateProductionEvidenceDependencies(evidenceManifest, resolve(packageRoot, '..', '..'))),
      ...(await validateNoStaleRuntimeAssets(parsed.value, assetRoot, sourceIndex, task6Integrity)),
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
