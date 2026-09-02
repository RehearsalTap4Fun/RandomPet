import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAttachmentPartComposition, parseCatalog, type Catalog } from '@qmonster/generator-core'
import { buildProductionEvidenceManifest } from '../packages/asset-catalog/src/evidence-root.js'
import { resolveExistingContainedPath } from './safe-output.js'

const REQUIRED_IDS = [
  'surface_soft_scales',
  'pattern_gentle_stripes',
  'effect_bioluminescent_orbs',
] as const

const INTENSITY_BY_PART_ID = {
  surface_gel_bubbles: 'strong',
  effect_bioluminescent_orbs: 'strong',
  effect_spore_glow: 'strong',
  surface_soft_scales: 'quiet',
  pattern_gentle_stripes: 'quiet',
} as const

const PACKAGE_ROOT = 'packages/asset-catalog'
const V03_CATALOG_ROOT = `${PACKAGE_ROOT}/catalog/v0.3.0`
const V03_ASSET_ROOT = `${PACKAGE_ROOT}/assets/v0.3.0`
const V03_SOURCE_INDEX = `${PACKAGE_ROOT}/source-index-v0.3.0.json`
const V04_CATALOG_ROOT = `${PACKAGE_ROOT}/catalog/v0.4.0`
const V04_ASSET_ROOT = `${PACKAGE_ROOT}/assets/v0.4.0`
const V04_SOURCE_INDEX = `${PACKAGE_ROOT}/source-index-v0.4.0.json`
const V04_AUDIT_ROOT = `${PACKAGE_ROOT}/audit/v0.4.0`
const V04_REVIEW_ROOT = `${PACKAGE_ROOT}/review/v0.4.0`
const TASK4_PROVENANCE = 'asset-source/v0.4.0/runtime-staging/parts/provenance.json'

type ReplacementId = typeof REQUIRED_IDS[number]

interface Task4ReplacementAsset {
  partId: string
  prompt?: unknown
  generatedPath?: unknown
  generatedSha256?: unknown
  recovery?: unknown
  referencedV03Path?: unknown
  referencedV03Sha256?: unknown
  masterPngPath?: unknown
  masterPngSha256?: unknown
  runtimePngPath?: unknown
  runtimePngSha256?: unknown
  runtimeWebpPath?: unknown
  runtimeWebpSha256?: unknown
}

interface Task4Provenance {
  schemaVersion?: unknown
  assets?: unknown
}

interface ValidatedReplacement extends Task4ReplacementAsset {
  partId: ReplacementId
  prompt: string
  generatedPath: string
  generatedSha256: string
  recovery: unknown
  referencedV03Path: string
  referencedV03Sha256: string
  masterPngPath: string
  masterPngSha256: string
  runtimePngPath: string
  runtimePngSha256: string
  runtimeWebpPath: string
  runtimeWebpSha256: string
}

interface ReleaseIdentity {
  dev: number
  ino: number
  kind: 'file' | 'directory'
}

export interface V04CatalogPublishOperations {
  publish(stagedPath: string, targetPath: string): Promise<void>
}

export interface AssembleV04CatalogOptions {
  repositoryRoot?: string
  verifyOnly?: boolean
  publishOperations?: V04CatalogPublishOperations
}

const DEFAULT_PUBLISH_OPERATIONS: V04CatalogPublishOperations = {
  async publish(stagedPath, targetPath) {
    await rename(stagedPath, targetPath)
  },
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function portable(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

function assertContained(root: string, target: string, label: string): void {
  const remainder = relative(root, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) {
    throw new Error(`${label}_ESCAPES_REPOSITORY:${target}`)
  }
}

function directoryChain(root: string, target: string): string[] {
  assertContained(root, target, 'V04_RELEASE_DIRECTORY')
  const chain: string[] = []
  let cursor = target
  while (cursor !== root) {
    chain.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`V04_RELEASE_DIRECTORY_ESCAPE:${target}`)
    cursor = parent
  }
  return chain.reverse()
}

async function ensureSafeDirectory(root: string, target: string, create: boolean): Promise<boolean> {
  for (const directory of directoryChain(root, target)) {
    let metadata
    try {
      metadata = await lstat(directory)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (!create) return false
      try {
        await mkdir(directory)
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      metadata = await lstat(directory)
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`V04_RELEASE_DIRECTORY_LINK_OR_REPARSE_INVALID:${directory}`)
    }
    const canonical = await realpath(directory)
    assertContained(root, canonical, 'V04_RELEASE_DIRECTORY')
    if (canonical !== directory) throw new Error(`V04_RELEASE_DIRECTORY_REPARSE_INVALID:${directory}`)
  }
  return true
}

async function assertAbsent(root: string, target: string, code = 'V04_RELEASE_TARGET_EXISTS_NO_OVERWRITE'): Promise<void> {
  assertContained(root, target, 'V04_RELEASE_TARGET')
  if (!await ensureSafeDirectory(root, dirname(target), false)) return
  try {
    await lstat(target)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  throw new Error(`${code}:${target}`)
}

async function exists(root: string, target: string): Promise<boolean> {
  assertContained(root, target, 'V04_RELEASE_TARGET')
  if (!await ensureSafeDirectory(root, dirname(target), false)) return false
  try {
    await lstat(target)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function identity(metadata: Awaited<ReturnType<typeof lstat>>): ReleaseIdentity {
  const kind = metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : null
  if (metadata.isSymbolicLink() || kind === null) throw new Error('V04_RELEASE_PATH_IDENTITY_INVALID')
  return { dev: metadata.dev, ino: metadata.ino, kind }
}

function sameIdentity(left: ReleaseIdentity, right: ReleaseIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.kind === right.kind
}

async function readRepositoryFile(root: string, path: string): Promise<Buffer> {
  const canonical = await resolveExistingContainedPath(root, path)
  return readFile(canonical)
}

async function readRepositoryJson<T>(root: string, path: string): Promise<T> {
  return JSON.parse((await readRepositoryFile(root, path)).toString('utf8')) as T
}

async function collectTreeFiles(root: string, directoryPath: string): Promise<string[]> {
  const lexicalRoot = resolve(root, directoryPath)
  assertContained(root, lexicalRoot, 'V04_RELEASE_INPUT_TREE')
  const rootMetadata = await lstat(lexicalRoot)
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`V04_RELEASE_INPUT_TREE_INVALID:${directoryPath}`)
  }
  if (await realpath(lexicalRoot) !== lexicalRoot) throw new Error(`V04_RELEASE_INPUT_TREE_REPARSE_INVALID:${directoryPath}`)
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = join(directory, entry.name)
      assertContained(root, target, 'V04_RELEASE_INPUT_TREE')
      const metadata = await lstat(target)
      if (metadata.isSymbolicLink()) throw new Error(`V04_RELEASE_INPUT_TREE_LINK_INVALID:${portable(root, target)}`)
      if (metadata.isDirectory()) {
        if (await realpath(target) !== target) throw new Error(`V04_RELEASE_INPUT_TREE_REPARSE_INVALID:${portable(root, target)}`)
        await visit(target)
      } else if (metadata.isFile() && metadata.nlink === 1) {
        files.push(portable(root, target))
      } else {
        throw new Error(`V04_RELEASE_INPUT_FILE_INVALID:${portable(root, target)}`)
      }
    }
  }
  await visit(lexicalRoot)
  if (files.length === 0) throw new Error(`V04_RELEASE_INPUT_TREE_EMPTY:${directoryPath}`)
  return files
}

async function copyTreeToStage(root: string, sourceDirectory: string, targetDirectory: string): Promise<string[]> {
  const files = await collectTreeFiles(root, sourceDirectory)
  for (const sourcePath of files) {
    const remainder = relative(sourceDirectory, sourcePath).replaceAll('\\', '/')
    if (!remainder || remainder.startsWith('..') || isAbsolute(remainder)) {
      throw new Error(`V04_RELEASE_COPY_PATH_INVALID:${sourcePath}`)
    }
    const source = await resolveExistingContainedPath(root, sourcePath)
    const target = resolve(root, targetDirectory, remainder)
    assertContained(root, target, 'V04_RELEASE_STAGE')
    await ensureSafeDirectory(root, dirname(target), true)
    await copyFile(source, target)
  }
  return files.map(path => relative(sourceDirectory, path).replaceAll('\\', '/'))
}

function rewriteAssetPrefixes<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('assets/v0.3.0/', 'assets/v0.4.0/') as T
  if (Array.isArray(value)) return value.map(rewriteAssetPrefixes) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteAssetPrefixes(item)])) as T
  }
  return value
}

function replacementRecordById(provenance: Task4Provenance): Map<ReplacementId, Task4ReplacementAsset> {
  if (provenance.schemaVersion !== 'v0.4-single-face-replacement-provenance-v1' || !Array.isArray(provenance.assets)) {
    throw new Error('V04_REPLACEMENT_PROVENANCE_INVALID')
  }
  const records = new Map<ReplacementId, Task4ReplacementAsset>()
  for (const item of provenance.assets) {
    if (item === null || typeof item !== 'object') throw new Error('V04_REPLACEMENT_PROVENANCE_INVALID')
    const record = item as Task4ReplacementAsset
    if (!REQUIRED_IDS.includes(record.partId as ReplacementId) || records.has(record.partId as ReplacementId)) {
      throw new Error(`V04_REPLACEMENT_PROVENANCE_PART_INVALID:${String(record.partId)}`)
    }
    records.set(record.partId as ReplacementId, record)
  }
  if (records.size !== REQUIRED_IDS.length || REQUIRED_IDS.some(partId => !records.has(partId))) {
    throw new Error('V04_REPLACEMENT_PROVENANCE_SET_INVALID')
  }
  return records
}

async function validateTask4Replacements(root: string): Promise<{
  provenance: Task4Provenance
  provenanceSha256: string
  replacements: Map<ReplacementId, ValidatedReplacement>
}> {
  const provenanceBytes = await readRepositoryFile(root, TASK4_PROVENANCE)
  const provenance = JSON.parse(provenanceBytes.toString('utf8')) as Task4Provenance
  const records = replacementRecordById(provenance)
  const replacements = new Map<ReplacementId, ValidatedReplacement>()
  for (const partId of REQUIRED_IDS) {
    const record = records.get(partId)!
    const expectedPngPath = `asset-source/v0.4.0/runtime-staging/parts/${partId}.png`
    const expectedWebpPath = `asset-source/v0.4.0/runtime-staging/parts/${partId}.webp`
    const expectedV03Path = `${V03_ASSET_ROOT}/parts/${partId}.png`
    if (
      typeof record.prompt !== 'string' || record.prompt === ''
      || typeof record.generatedPath !== 'string' || !isSha256(record.generatedSha256)
      || typeof record.masterPngPath !== 'string' || !isSha256(record.masterPngSha256)
      || record.runtimePngPath !== expectedPngPath || !isSha256(record.runtimePngSha256)
      || record.runtimeWebpPath !== expectedWebpPath || !isSha256(record.runtimeWebpSha256)
      || record.referencedV03Path !== expectedV03Path || !isSha256(record.referencedV03Sha256)
    ) throw new Error(`V04_REPLACEMENT_PROVENANCE_FIELDS_INVALID:${partId}`)
    const [pngBytes, webpBytes, v03Bytes] = await Promise.all([
      readRepositoryFile(root, expectedPngPath),
      readRepositoryFile(root, expectedWebpPath),
      readRepositoryFile(root, expectedV03Path),
    ])
    if (sha256(pngBytes) !== record.runtimePngSha256 || sha256(webpBytes) !== record.runtimeWebpSha256) {
      throw new Error(`V04_REPLACEMENT_RUNTIME_HASH_MISMATCH:${partId}`)
    }
    if (sha256(v03Bytes) !== record.referencedV03Sha256) {
      throw new Error(`V04_REPLACEMENT_REFERENCE_HASH_MISMATCH:${partId}`)
    }
    replacements.set(partId, record as ValidatedReplacement)
  }
  return { provenance, provenanceSha256: sha256(provenanceBytes), replacements }
}

function makeV04Catalog(v03: Catalog, replacements: Map<ReplacementId, ValidatedReplacement>): Catalog {
  const catalog = rewriteAssetPrefixes(structuredClone(v03))
  catalog.version = '0.4.0'
  if (catalog.compositionPolicy === undefined) throw new Error('V04_CATALOG_COMPOSITION_POLICY_MISSING')
  catalog.compositionPolicy.maxStrongNonFacialFeatures = 1

  for (const [partId, intensity] of Object.entries(INTENSITY_BY_PART_ID)) {
    const part = catalog.parts.find(candidate => candidate.id === partId)
    if (part?.composition === undefined) throw new Error(`V04_CATALOG_INTENSITY_PART_MISSING:${partId}`)
    part.composition.visualIntensity = intensity
  }

  const matchingNodeCount = new Map<ReplacementId, number>(REQUIRED_IDS.map(partId => [partId, 0]))
  for (const part of catalog.parts) {
    const replacement = replacements.get(part.id as ReplacementId)
    if (replacement !== undefined) {
      part.assetSha256 = replacement.runtimeWebpSha256
      part.pngSha256 = replacement.runtimePngSha256
    }
    if (!isAttachmentPartComposition(part.composition)) continue
    for (const node of part.composition.renderNodes) {
      for (const [partId, candidate] of replacements) {
        if (node.assetPath !== `parts/${partId}.webp` && node.pngPath !== `parts/${partId}.png`) continue
        node.assetSha256 = candidate.runtimeWebpSha256
        node.pngSha256 = candidate.runtimePngSha256
        matchingNodeCount.set(partId, matchingNodeCount.get(partId)! + 1)
      }
    }
  }
  for (const partId of REQUIRED_IDS) {
    if (matchingNodeCount.get(partId) === 0) throw new Error(`V04_CATALOG_REPLACEMENT_RENDER_NODE_MISSING:${partId}`)
  }
  if (JSON.stringify(catalog).includes('assets/v0.3.0/')) throw new Error('V04_CATALOG_V03_ASSET_PREFIX_REMAINS')
  const parsed = parseCatalog(catalog)
  if (!parsed.ok) throw new Error(`V04_CATALOG_SCHEMA_INVALID:${JSON.stringify(parsed.diagnostics)}`)
  return parsed.value
}

function makeV04SourceIndex(
  v03SourceIndex: Record<string, unknown>,
  replacements: Map<ReplacementId, ValidatedReplacement>,
  provenanceSha256: string,
): Record<string, unknown> {
  const sourceIndex = rewriteAssetPrefixes(structuredClone(v03SourceIndex))
  sourceIndex.catalogVersion = '0.4.0'
  if (!Array.isArray(sourceIndex.sources)) throw new Error('V04_SOURCE_INDEX_SOURCES_INVALID')
  for (const [partId, replacement] of replacements) {
    const source = sourceIndex.sources.find(candidate => (
      candidate !== null && typeof candidate === 'object' && (candidate as Record<string, unknown>).sourceId === partId
    )) as Record<string, unknown> | undefined
    if (source === undefined) throw new Error(`V04_SOURCE_INDEX_REPLACEMENT_MISSING:${partId}`)
    source.runtimePngPath = `${V04_ASSET_ROOT}/parts/${partId}.png`
    source.runtimePngSha256 = replacement.runtimePngSha256
    source.runtimeWebpPath = `${V04_ASSET_ROOT}/parts/${partId}.webp`
    source.runtimeWebpSha256 = replacement.runtimeWebpSha256
    source.replacementProvenance = {
      schemaVersion: 'v0.4-single-face-release-overlay-v1',
      sourcePath: TASK4_PROVENANCE,
      sourceSha256: provenanceSha256,
      prompt: replacement.prompt,
      generatedPath: replacement.generatedPath,
      generatedSha256: replacement.generatedSha256,
      recovery: replacement.recovery,
      referencedV03Path: replacement.referencedV03Path,
      referencedV03Sha256: replacement.referencedV03Sha256,
      masterPngPath: replacement.masterPngPath,
      masterPngSha256: replacement.masterPngSha256,
      runtimeStagingPngPath: replacement.runtimePngPath,
      runtimeStagingPngSha256: replacement.runtimePngSha256,
      runtimeStagingWebpPath: replacement.runtimeWebpPath,
      runtimeStagingWebpSha256: replacement.runtimeWebpSha256,
      releasePngPath: `${V04_ASSET_ROOT}/parts/${partId}.png`,
      releasePngSha256: replacement.runtimePngSha256,
      releaseWebpPath: `${V04_ASSET_ROOT}/parts/${partId}.webp`,
      releaseWebpSha256: replacement.runtimeWebpSha256,
    }
  }
  return sourceIndex
}

function makeReviewRecord(replacements: Map<ReplacementId, ValidatedReplacement>): Record<string, unknown> {
  return {
    schemaVersion: 'qmonster-catalog-release-review-v1',
    catalogVersion: '0.4.0',
    basedOnCatalogVersion: '0.3.0',
    decision: 'pending_user_review',
    userApproved: false,
    replacementPartIds: REQUIRED_IDS,
    replacementHashes: Object.fromEntries([...replacements].map(([partId, replacement]) => [partId, {
      pngSha256: replacement.runtimePngSha256,
      webpSha256: replacement.runtimeWebpSha256,
    }])),
    evidenceManifestPath: `${V04_AUDIT_ROOT}/evidence-manifest.json`,
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

async function validateV04Model(catalog: Catalog, replacements: Map<ReplacementId, ValidatedReplacement>): Promise<void> {
  if (catalog.version !== '0.4.0' || catalog.compositionPolicy?.maxStrongNonFacialFeatures !== 1) {
    throw new Error('V04_RELEASE_CATALOG_POLICY_INVALID')
  }
  if (JSON.stringify(catalog).includes('assets/v0.3.0/')) throw new Error('V04_RELEASE_CATALOG_V03_PATH_REMAINS')
  for (const [partId, expected] of replacements) {
    const part = catalog.parts.find(candidate => candidate.id === partId)
    if (part?.assetSha256 !== expected.runtimeWebpSha256 || part.pngSha256 !== expected.runtimePngSha256) {
      throw new Error(`V04_RELEASE_CATALOG_HASH_INVALID:${partId}`)
    }
    if (!isAttachmentPartComposition(part.composition)) throw new Error(`V04_RELEASE_CATALOG_ATTACHMENT_INVALID:${partId}`)
    const nodes = part.composition.renderNodes.filter(node => (
      node.assetPath === `parts/${partId}.webp` || node.pngPath === `parts/${partId}.png`
    ))
    if (nodes.length === 0 || nodes.some(node => (
      node.assetSha256 !== expected.runtimeWebpSha256 || node.pngSha256 !== expected.runtimePngSha256
    ))) throw new Error(`V04_RELEASE_RENDER_NODE_HASH_INVALID:${partId}`)
  }
  for (const [partId, expected] of Object.entries(INTENSITY_BY_PART_ID)) {
    const actual = catalog.parts.find(part => part.id === partId)?.composition?.visualIntensity
    if (actual !== expected) throw new Error(`V04_RELEASE_INTENSITY_INVALID:${partId}`)
  }
  const parsed = parseCatalog(catalog)
  if (!parsed.ok) throw new Error(`V04_RELEASE_CATALOG_SCHEMA_INVALID:${JSON.stringify(parsed.diagnostics)}`)
}

async function verifyAssetTree(root: string, replacements: Map<ReplacementId, ValidatedReplacement>): Promise<void> {
  const [v03Files, v04Files] = await Promise.all([
    collectTreeFiles(root, V03_ASSET_ROOT),
    collectTreeFiles(root, V04_ASSET_ROOT),
  ])
  const v03Relative = v03Files.map(path => relative(V03_ASSET_ROOT, path).replaceAll('\\', '/')).sort()
  const v04Relative = v04Files.map(path => relative(V04_ASSET_ROOT, path).replaceAll('\\', '/')).sort()
  if (!isDeepStrictEqual(v03Relative, v04Relative)) throw new Error('V04_RELEASE_ASSET_INVENTORY_MISMATCH')
  for (const path of v04Relative) {
    const replacementId = REQUIRED_IDS.find(partId => path === `parts/${partId}.png` || path === `parts/${partId}.webp`)
    const v04Bytes = await readRepositoryFile(root, `${V04_ASSET_ROOT}/${path}`)
    if (replacementId !== undefined) {
      const replacement = replacements.get(replacementId)!
      const expected = path.endsWith('.png') ? replacement.runtimePngSha256 : replacement.runtimeWebpSha256
      if (sha256(v04Bytes) !== expected) throw new Error(`V04_RELEASE_REPLACEMENT_HASH_MISMATCH:${path}`)
    } else {
      const v03Bytes = await readRepositoryFile(root, `${V03_ASSET_ROOT}/${path}`)
      if (sha256(v04Bytes) !== sha256(v03Bytes)) throw new Error(`V04_RELEASE_RETAINED_ASSET_MISMATCH:${path}`)
    }
  }
}

async function verifyV04Release(root: string): Promise<Catalog> {
  const completedCatalogPath = `${V04_CATALOG_ROOT}/catalog.json`
  if (!await exists(root, resolve(root, completedCatalogPath))) throw new Error('V04_RELEASE_NOT_COMPLETE')
  const { replacements, provenanceSha256 } = await validateTask4Replacements(root)
  const [catalog, themes, rigs, parts, semanticTraits, modifiers, sourceIndex, evidence, review] = await Promise.all([
    readRepositoryJson<Catalog>(root, completedCatalogPath),
    readRepositoryJson<unknown>(root, `${V04_CATALOG_ROOT}/themes.json`),
    readRepositoryJson<unknown>(root, `${V04_CATALOG_ROOT}/rigs.json`),
    readRepositoryJson<unknown>(root, `${V04_CATALOG_ROOT}/parts.json`),
    readRepositoryJson<unknown>(root, `${V04_CATALOG_ROOT}/semantic-traits.json`),
    readRepositoryJson<unknown>(root, `${V04_CATALOG_ROOT}/modifiers.json`),
    readRepositoryJson<Record<string, unknown>>(root, V04_SOURCE_INDEX),
    readRepositoryJson<Record<string, unknown>>(root, `${V04_AUDIT_ROOT}/evidence-manifest.json`),
    readRepositoryJson<Record<string, unknown>>(root, `${V04_REVIEW_ROOT}/review-record.json`),
  ])
  await validateV04Model(catalog, replacements)
  if (!isDeepStrictEqual([themes, rigs, parts, semanticTraits, modifiers], [
    catalog.themes, catalog.rigs, catalog.parts, catalog.semanticTraits, catalog.modifiers,
  ])) throw new Error('V04_RELEASE_CATALOG_SHARD_MISMATCH')
  if (sourceIndex.catalogVersion !== '0.4.0') {
    throw new Error('V04_RELEASE_SOURCE_INDEX_INVALID')
  }
  for (const [partId, replacement] of replacements) {
    const source = (sourceIndex.sources as Array<Record<string, unknown>> | undefined)?.find(item => item.sourceId === partId)
    if (
      source?.runtimePngPath !== `${V04_ASSET_ROOT}/parts/${partId}.png`
      || source.runtimePngSha256 !== replacement.runtimePngSha256
      || source.runtimeWebpPath !== `${V04_ASSET_ROOT}/parts/${partId}.webp`
      || source.runtimeWebpSha256 !== replacement.runtimeWebpSha256
      || (source.replacementProvenance as Record<string, unknown> | undefined)?.sourceSha256 !== provenanceSha256
    ) throw new Error(`V04_RELEASE_SOURCE_INDEX_REPLACEMENT_INVALID:${partId}`)
  }
  if (!isDeepStrictEqual(evidence, buildProductionEvidenceManifest(sourceIndex))) {
    throw new Error('V04_RELEASE_EVIDENCE_MANIFEST_INVALID')
  }
  if (review.catalogVersion !== '0.4.0' || review.decision !== 'pending_user_review' || review.userApproved !== false) {
    throw new Error('V04_RELEASE_REVIEW_RECORD_INVALID')
  }
  await verifyAssetTree(root, replacements)
  return catalog
}

async function publishTransaction(input: {
  root: string
  stageRoot: string
  publications: Array<{ stagedPath: string; targetPath: string }>
  operations: V04CatalogPublishOperations
  verifyPublished: () => Promise<void>
}): Promise<void> {
  const committed: Array<{ targetPath: string; identity: ReleaseIdentity }> = []
  let caught: unknown
  try {
    for (const publication of input.publications) {
      await ensureSafeDirectory(input.root, dirname(publication.targetPath), false)
      await assertAbsent(input.root, publication.targetPath)
      const stagedIdentity = identity(await lstat(publication.stagedPath))
      try {
        await input.operations.publish(publication.stagedPath, publication.targetPath)
      } catch (error) {
        try {
          const publishedIdentity = identity(await lstat(publication.targetPath))
          if (sameIdentity(stagedIdentity, publishedIdentity)) committed.push({ targetPath: publication.targetPath, identity: publishedIdentity })
        } catch (inspectionError) {
          if (!isMissing(inspectionError)) throw inspectionError
        }
        throw error
      }
      const publishedIdentity = identity(await lstat(publication.targetPath))
      if (!sameIdentity(stagedIdentity, publishedIdentity)) {
        throw new Error(`V04_RELEASE_PUBLISHED_IDENTITY_INVALID:${publication.targetPath}`)
      }
      committed.push({ targetPath: publication.targetPath, identity: publishedIdentity })
    }
    await input.verifyPublished()
  } catch (error) {
    caught = error
    for (const item of [...committed].reverse()) {
      if (!await ensureSafeDirectory(input.root, dirname(item.targetPath), false)) {
        throw new Error(`V04_RELEASE_ROLLBACK_PARENT_MISSING:${item.targetPath}`)
      }
      const current = identity(await lstat(item.targetPath))
      if (!sameIdentity(item.identity, current)) throw new Error(`V04_RELEASE_ROLLBACK_IDENTITY_CHANGED:${item.targetPath}`)
      await rm(item.targetPath, { recursive: current.kind === 'directory' })
    }
  } finally {
    await rm(input.stageRoot, { recursive: true, force: true })
  }
  if (caught !== undefined) throw caught
}

export async function assembleV04Catalog(options: AssembleV04CatalogOptions = {}): Promise<Catalog> {
  const lexicalRoot = resolve(options.repositoryRoot ?? process.cwd())
  const root = await realpath(lexicalRoot)
  await ensureSafeDirectory(root, resolve(root, PACKAGE_ROOT), false)
  const completedCatalogPath = resolve(root, V04_CATALOG_ROOT, 'catalog.json')
  if (options.verifyOnly === true) return verifyV04Release(root)
  if (await exists(root, completedCatalogPath)) throw new Error(`V04_RELEASE_ALREADY_COMPLETE:${completedCatalogPath}`)

  const targets = [V04_ASSET_ROOT, V04_SOURCE_INDEX, V04_AUDIT_ROOT, V04_REVIEW_ROOT, V04_CATALOG_ROOT]
    .map(path => resolve(root, path))
  for (const target of targets) await assertAbsent(root, target)

  const [v03Catalog, v03SourceIndex, replacementInput] = await Promise.all([
    readRepositoryJson<Catalog>(root, `${V03_CATALOG_ROOT}/catalog.json`),
    readRepositoryJson<Record<string, unknown>>(root, V03_SOURCE_INDEX),
    validateTask4Replacements(root),
  ])
  if (parseCatalog(v03Catalog).ok === false || v03Catalog.version !== '0.3.0') throw new Error('V04_RELEASE_V03_CATALOG_INVALID')
  if (v03SourceIndex.catalogVersion !== '0.3.0') throw new Error('V04_RELEASE_V03_SOURCE_INDEX_INVALID')
  const catalog = makeV04Catalog(v03Catalog, replacementInput.replacements)
  const sourceIndex = makeV04SourceIndex(v03SourceIndex, replacementInput.replacements, replacementInput.provenanceSha256)
  const evidence = buildProductionEvidenceManifest(sourceIndex)
  const review = makeReviewRecord(replacementInput.replacements)

  const packageRoot = resolve(root, PACKAGE_ROOT)
  const stageRoot = join(packageRoot, `.qmonster-v04-catalog-transaction-${randomUUID()}`)
  await assertAbsent(root, stageRoot)
  await mkdir(stageRoot)
  if (await realpath(stageRoot) !== stageRoot) throw new Error(`V04_RELEASE_STAGE_ROOT_REPARSE_INVALID:${stageRoot}`)
  let caught: unknown
  let verifiedCatalog: Catalog | undefined
  try {
    const stageAssetRoot = portable(root, join(stageRoot, 'assets/v0.4.0'))
    await copyTreeToStage(root, V03_ASSET_ROOT, stageAssetRoot)
    for (const [partId, replacement] of replacementInput.replacements) {
      for (const [sourcePath, extension] of [[replacement.runtimePngPath, 'png'], [replacement.runtimeWebpPath, 'webp']] as const) {
        const target = join(stageRoot, `assets/v0.4.0/parts/${partId}.${extension}`)
        await copyFile(await resolveExistingContainedPath(root, sourcePath), target)
      }
    }

    const stageCatalogRoot = join(stageRoot, 'catalog/v0.4.0')
    await writeJson(join(stageCatalogRoot, 'themes.json'), catalog.themes)
    await writeJson(join(stageCatalogRoot, 'rigs.json'), catalog.rigs)
    await writeJson(join(stageCatalogRoot, 'parts.json'), catalog.parts)
    await writeJson(join(stageCatalogRoot, 'semantic-traits.json'), catalog.semanticTraits)
    await writeJson(join(stageCatalogRoot, 'modifiers.json'), catalog.modifiers)
    await writeJson(join(stageCatalogRoot, 'catalog.json'), catalog)
    await writeJson(join(stageRoot, 'source-index-v0.4.0.json'), sourceIndex)
    await writeJson(join(stageRoot, 'audit/v0.4.0/evidence-manifest.json'), evidence)
    await writeJson(join(stageRoot, 'review/v0.4.0/review-record.json'), review)

    const publications = [
      ['assets/v0.4.0', V04_ASSET_ROOT],
      ['source-index-v0.4.0.json', V04_SOURCE_INDEX],
      ['audit/v0.4.0', V04_AUDIT_ROOT],
      ['review/v0.4.0', V04_REVIEW_ROOT],
      ['catalog/v0.4.0', V04_CATALOG_ROOT],
    ].map(([staged, target]) => ({ stagedPath: join(stageRoot, staged), targetPath: resolve(root, target) }))
    await publishTransaction({
      root,
      stageRoot,
      publications,
      operations: options.publishOperations ?? DEFAULT_PUBLISH_OPERATIONS,
      verifyPublished: async () => {
        verifiedCatalog = await verifyV04Release(root)
      },
    })
  } catch (error) {
    caught = error
  } finally {
    await rm(stageRoot, { recursive: true, force: true })
  }
  if (caught !== undefined) throw caught
  if (verifiedCatalog === undefined) throw new Error('V04_RELEASE_POST_PUBLISH_VERIFICATION_MISSING')
  return verifiedCatalog
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const verifyOnly = args.includes('--verify-only')
  if (args.some(argument => argument !== '--verify-only')) {
    throw new Error('Usage: tsx scripts/assemble-v04-catalog.ts [--verify-only]')
  }
  const catalog = await assembleV04Catalog({ verifyOnly })
  process.stdout.write(`${JSON.stringify({ catalogVersion: catalog.version, verifyOnly })}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
