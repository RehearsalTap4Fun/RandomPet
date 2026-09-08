import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  V08_REGION_IDS,
  VISUAL_SLOT_IDS,
  parseCatalog,
  validateCatalogStructure,
  type Catalog,
  type Diagnostic,
  type V08RegionId,
  type V08SpeciesRigCatalog,
} from '@qmonster/generator-core'
import { assetPathBelowVersionRoot, validateAssetFile, validateCatalogFiles } from './file-validation.js'
import { validateV08RasterContract } from './v08-raster-contract.js'

export interface V08SourceIndexTrait {
  id: string
  sourcePath: string
  sourceSha256: string
  runtimePngPath: string
  runtimePngSha256: string
  runtimeAssetPath: string
  runtimeAssetSha256: string
}

export interface V08SourceIndex {
  schemaVersion: 'qmonster-v08-source-index-v1'
  catalogVersion: '0.8.0'
  speciesRigId: 'feline-sit-v1'
  sourceMaster: { path: string; sha256: string }
  regionGuide: { path: string; sha256: string }
  traits: V08SourceIndexTrait[]
  runtimeResources: Array<{ path: string; sha256: string }>
}

export interface V08EvidenceManifest {
  schemaVersion: 'qmonster-v08-production-evidence-v1'
  catalogVersion: '0.8.0'
  sourceIndexPath: 'packages/asset-catalog/source-index-v0.8.0.json'
  sourceIndexSha256: string
  catalogPath: 'packages/asset-catalog/catalog/v0.8.0/catalog.json'
  catalogSha256: string
  sourceMasterSha256: string
  traitCount: 182
  runtimeResourceCount: number
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fileHash(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path))
  } catch {
    return null
  }
}

function pathBelow(root: string, target: string): boolean {
  const remainder = relative(resolve(root), resolve(target))
  return remainder !== '' && !remainder.startsWith('..') && !isAbsolute(remainder)
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function mapBatches<T>(
  values: readonly T[],
  operation: (value: T, index: number) => Promise<Diagnostic[]>,
  concurrency = 4,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (let start = 0; start < values.length; start += concurrency) {
    const batch = values.slice(start, start + concurrency)
    const results = await Promise.all(batch.map((value, offset) => operation(value, start + offset)))
    diagnostics.push(...results.flat())
  }
  return diagnostics
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(directory, { withFileTypes: true }) as never
    } catch {
      return
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  await visit(root)
  return files.sort()
}

function resourcePaths(catalog: V08SpeciesRigCatalog): Array<{ path: string; sha256: string }> {
  const rig = catalog.speciesRigs[0]!
  const bundle = catalog.anatomyBundles[0]!
  const resources = [
    bundle.structural,
    ...V08_REGION_IDS.map(regionId => rig.regions[regionId]),
    ...catalog.parts.flatMap(part => [{
      assetPath: part.assetPath,
      assetSha256: part.assetSha256!,
      pngPath: part.pngPath!,
      pngSha256: part.pngSha256!,
    }]),
  ]
  const byPath = new Map<string, string>()
  for (const resource of resources) {
    byPath.set(resource.assetPath, resource.assetSha256)
    byPath.set(resource.pngPath, resource.pngSha256)
  }
  return [...byPath].map(([path, hash]) => ({ path, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path))
}

export async function validateV08ProductionTrait(
  traitPngPath: string,
  ownerMaskPngPath: string,
  allowEmpty: boolean,
): Promise<Diagnostic[]> {
  return validateV08RasterContract({
    sourcePath: traitPngPath,
    role: 'trait',
    ownerMaskPath: ownerMaskPngPath,
    allowEmpty,
  })
}

function splitDocuments(catalog: Catalog | Record<string, unknown>): Record<string, unknown> {
  return {
    'parts.json': catalog.parts,
    'rigs.json': catalog.rigs,
    'themes.json': catalog.themes,
    'semantic-traits.json': catalog.semanticTraits,
    'modifiers.json': catalog.modifiers,
    'species-rigs.json': catalog.speciesRigs,
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function validateV08ProductionRelease(
  repositoryRoot: string,
  sourceRoot?: string,
): Promise<Diagnostic[]> {
  const root = resolve(repositoryRoot)
  const catalogDirectory = join(root, 'packages', 'asset-catalog', 'catalog', 'v0.8.0')
  const catalogPath = join(catalogDirectory, 'catalog.json')
  const assetRoot = join(root, 'packages', 'asset-catalog', 'assets', 'v0.8.0')
  const sourceIndexPath = join(root, 'packages', 'asset-catalog', 'source-index-v0.8.0.json')
  const evidencePath = join(root, 'packages', 'asset-catalog', 'audit', 'v0.8.0', 'evidence-manifest.json')
  const diagnostics: Diagnostic[] = []

  let catalog: V08SpeciesRigCatalog
  let catalogBytes: Buffer
  let rawCatalog: Record<string, unknown>
  try {
    catalogBytes = await readFile(catalogPath)
    rawCatalog = JSON.parse(catalogBytes.toString('utf8')) as Record<string, unknown>
    const parsed = parseCatalog(rawCatalog)
    if (!parsed.ok || parsed.value.version !== '0.8.0') {
      diagnostics.push(...(!parsed.ok ? parsed.diagnostics : [error('V08_CATALOG_VERSION_INVALID', ['version'], 'Expected catalog 0.8.0.')]))
      return diagnostics
    }
    catalog = parsed.value as V08SpeciesRigCatalog
  } catch {
    return [error('V08_CATALOG_MISSING', [catalogPath], 'Cannot read the canonical v0.8 catalog.')]
  }

  diagnostics.push(...validateCatalogStructure(catalog))
  diagnostics.push(...await validateCatalogFiles(catalog, assetRoot))
  const rig = catalog.speciesRigs[0]
  const bundle = catalog.anatomyBundles[0]
  if (rig === undefined || bundle === undefined) return diagnostics

  const structuralResourceChecks = [bundle.structural, ...V08_REGION_IDS.map(regionId => rig.regions[regionId])]
  diagnostics.push(...await mapBatches(structuralResourceChecks, async (resource, index) => [
    ...await validateAssetFile(assetRoot, assetPathBelowVersionRoot(resource.assetPath, '0.8.0'), resource.assetSha256, ['resources', String(index), 'assetPath']),
    ...await validateAssetFile(assetRoot, assetPathBelowVersionRoot(resource.pngPath, '0.8.0'), resource.pngSha256, ['resources', String(index), 'pngPath']),
  ]))

  diagnostics.push(...await validateV08RasterContract({
    sourcePath: join(assetRoot, assetPathBelowVersionRoot(bundle.structural.pngPath, '0.8.0')),
    role: 'structure',
  }))
  diagnostics.push(...await mapBatches(V08_REGION_IDS, async regionId => validateV08RasterContract({
    sourcePath: join(assetRoot, assetPathBelowVersionRoot(rig.regions[regionId].pngPath, '0.8.0')),
    role: 'mask',
  })))
  diagnostics.push(...await mapBatches(catalog.parts, async part => {
    if (part.composition?.mode !== 'species-rig') return []
    return validateV08ProductionTrait(
      join(assetRoot, assetPathBelowVersionRoot(part.pngPath!, '0.8.0')),
      join(assetRoot, assetPathBelowVersionRoot(rig.regions[part.composition.ownerRegionId].pngPath, '0.8.0')),
      part.composition.isNone === true,
    )
  }))

  const expectedResources = resourcePaths(catalog)
  const actualFiles = await listFiles(assetRoot)
  const expectedFiles = expectedResources.map(item => assetPathBelowVersionRoot(item.path, '0.8.0')).sort()
  for (const stale of actualFiles.filter(path => !expectedFiles.includes(path))) {
    diagnostics.push(error('V08_STALE_RUNTIME_ASSET', ['assets', stale], `Unexpected v0.8 runtime asset: ${stale}.`))
  }
  for (const missing of expectedFiles.filter(path => !actualFiles.includes(path))) {
    diagnostics.push(error('V08_RUNTIME_ASSET_MISSING', ['assets', missing], `Missing v0.8 runtime asset: ${missing}.`))
  }

  for (const [name, expected] of Object.entries(splitDocuments(rawCatalog))) {
    try {
      if (!jsonEqual(await readJson(join(catalogDirectory, name)), expected)) {
        diagnostics.push(error('V08_SPLIT_CATALOG_MISMATCH', ['catalog', name], `${name} differs from catalog.json.`))
      }
    } catch {
      diagnostics.push(error('V08_SPLIT_CATALOG_MISSING', ['catalog', name], `Cannot read ${name}.`))
    }
  }

  let sourceIndex: V08SourceIndex | null = null
  let sourceIndexBytes: Buffer | null = null
  try {
    sourceIndexBytes = await readFile(sourceIndexPath)
    sourceIndex = JSON.parse(sourceIndexBytes.toString('utf8')) as V08SourceIndex
  } catch {
    diagnostics.push(error('V08_SOURCE_INDEX_MISSING', [sourceIndexPath], 'Cannot read source-index-v0.8.0.json.'))
  }
  if (
    sourceIndex !== null
    && (
      sourceIndex.schemaVersion !== 'qmonster-v08-source-index-v1'
      || sourceIndex.catalogVersion !== '0.8.0'
      || sourceIndex.speciesRigId !== 'feline-sit-v1'
      || sourceIndex.traits.length !== 182
      || !jsonEqual(sourceIndex.runtimeResources, expectedResources)
    )
  ) diagnostics.push(error('V08_SOURCE_INDEX_INVALID', ['sourceIndex'], 'The v0.8 source index does not match the catalog resources.'))

  try {
    const evidence = await readJson(evidencePath) as V08EvidenceManifest
    if (
      evidence.schemaVersion !== 'qmonster-v08-production-evidence-v1'
      || evidence.catalogVersion !== '0.8.0'
      || evidence.sourceIndexPath !== 'packages/asset-catalog/source-index-v0.8.0.json'
      || evidence.catalogPath !== 'packages/asset-catalog/catalog/v0.8.0/catalog.json'
      || evidence.sourceIndexSha256 !== (sourceIndexBytes === null ? '' : sha256(sourceIndexBytes))
      || evidence.catalogSha256 !== sha256(catalogBytes)
      || evidence.sourceMasterSha256 !== rig.sourceMasterSha256
      || evidence.traitCount !== 182
      || evidence.runtimeResourceCount !== expectedResources.length
    ) diagnostics.push(error('V08_EVIDENCE_MANIFEST_INVALID', ['evidence'], 'The v0.8 evidence manifest does not bind the exact catalog, source index, master, and runtime inventory.'))
  } catch {
    diagnostics.push(error('V08_EVIDENCE_MANIFEST_MISSING', [evidencePath], 'Cannot read the v0.8 evidence manifest.'))
  }

  if (sourceIndex !== null && sourceRoot !== undefined) {
    const suppliedRoot = resolve(sourceRoot)
    const canonicalSourceRoot = basename(suppliedRoot).toLowerCase() === 'feline' ? suppliedRoot : join(suppliedRoot, 'feline')
    for (const record of [sourceIndex.sourceMaster, sourceIndex.regionGuide, ...sourceIndex.traits.map(item => ({ path: item.sourcePath, sha256: item.sourceSha256 }))]) {
      const target = resolve(suppliedRoot, record.path)
      if (!pathBelow(suppliedRoot, target) || await fileHash(target) !== record.sha256) {
        diagnostics.push(error('V08_SOURCE_FILE_INVALID', ['source', record.path], `Missing or changed v0.8 source: ${record.path}.`))
      }
    }
    try {
      const inventory = await readJson(join(canonicalSourceRoot, 'trait-inventory.json')) as { sourceMasterSha256?: unknown; traits?: unknown[] }
      if (inventory.sourceMasterSha256 !== rig.sourceMasterSha256 || inventory.traits?.length !== 182) {
        diagnostics.push(error('V08_SOURCE_INVENTORY_INVALID', ['source', 'trait-inventory.json'], 'Source inventory is not bound to the production master and 182 traits.'))
      }
    } catch {
      diagnostics.push(error('V08_SOURCE_INVENTORY_MISSING', ['source', 'trait-inventory.json'], 'Cannot read the v0.8 trait inventory.'))
    }
  }

  try {
    const evidence = await readJson(evidencePath) as V08EvidenceManifest
    if (
      evidence.schemaVersion !== 'qmonster-v08-production-evidence-v1'
      || evidence.catalogVersion !== '0.8.0'
      || evidence.sourceIndexPath !== 'packages/asset-catalog/source-index-v0.8.0.json'
      || evidence.catalogPath !== 'packages/asset-catalog/catalog/v0.8.0/catalog.json'
      || evidence.sourceIndexSha256 !== (sourceIndexBytes === null ? '' : sha256(sourceIndexBytes))
      || evidence.catalogSha256 !== sha256(catalogBytes)
      || evidence.sourceMasterSha256 !== rig.sourceMasterSha256
      || evidence.traitCount !== 182
      || evidence.runtimeResourceCount !== expectedResources.length
    ) diagnostics.push(error('V08_EVIDENCE_MANIFEST_INVALID', ['evidence'], 'The v0.8 evidence manifest does not bind the complete release.'))
  } catch {
    diagnostics.push(error('V08_EVIDENCE_MANIFEST_MISSING', [evidencePath], 'Cannot read the v0.8 evidence manifest.'))
  }

  return diagnostics
}
