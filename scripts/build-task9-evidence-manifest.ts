import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { parseCatalog } from '@qmonster/generator-core'
import {
  buildProductionEvidenceManifest,
  type ProductionEvidenceManifest,
  type Task9EvidenceDependency,
} from '../packages/asset-catalog/src/evidence-root.js'
import { measureCompositionDistribution } from './composition-statistics.js'
import { canonicalBipedGuideFiles, type InterfaceSourceManifest } from './interface-source-schema.js'
import { resolveExistingContainedPath } from './safe-output.js'

interface DependencySeed { path: string; group: string }
const execFile = promisify(execFileCallback)
const TASK9_ASSET_ROOT = 'packages/asset-catalog/assets/v0.3.0'
export const TASK9_STALE_BASELINE_COMMIT = '31a3f1d903412f9ad6dbf84982075aac54bc6297'
const fullCommitOid = /^[a-f0-9]{40}$/u

interface Task9StaleRemovalAudit {
  schemaVersion: 'task9-stale-runtime-removal-v2'
  catalogVersion: '0.3.0'
  baselineCommit: string
  sourcePathRemovalCount: number
  baselineDeletions: { count: number, recovery: string, files: string[] }
  similarityRenames: {
    count: number
    classification: 'git-similarity-rename'
    recovery: { command: string, sourcePaths: string[] }
    entries: Array<{ status: string, source: string, destination: string }>
  }
}

async function task9GitRemovalSets(repositoryRoot: string, baselineCommit: string): Promise<{
  deletions: string[]
  renames: Array<{ status: string, source: string, destination: string }>
}> {
  if (!fullCommitOid.test(baselineCommit) || baselineCommit !== TASK9_STALE_BASELINE_COMMIT) {
    throw new Error('TASK9_STALE_REMOVAL_BASELINE_INVALID')
  }
  const common = ['-C', repositoryRoot, '-c', 'diff.renames=true', 'diff', '--find-renames=50%', '--end-of-options', baselineCommit, 'HEAD', '--', TASK9_ASSET_ROOT]
  const [{ stdout: deletedOutput }, { stdout: renamedOutput }] = await Promise.all([
    execFile('git', [...common.slice(0, 6), '--name-only', '--diff-filter=D', ...common.slice(6)], { maxBuffer: 4 * 1024 * 1024 }),
    execFile('git', [...common.slice(0, 6), '--name-status', '--diff-filter=R', ...common.slice(6)], { maxBuffer: 4 * 1024 * 1024 }),
  ])
  const deletions = deletedOutput.split(/\r?\n/u).filter(Boolean).map(portable).sort()
  const renames = renamedOutput.split(/\r?\n/u).filter(Boolean).map(line => {
    const [status, source, destination] = line.split('\t')
    if (!/^R\d{3}$/u.test(status ?? '') || source === undefined || destination === undefined) throw new Error(`Invalid Git rename record: ${line}`)
    return { status: status!, source: portable(source), destination: portable(destination) }
  }).sort((left, right) => left.source.localeCompare(right.source, 'en'))
  return { deletions, renames }
}

export async function buildTask9StaleRemovalAudit(repositoryRoot: string, baselineCommit = TASK9_STALE_BASELINE_COMMIT): Promise<Task9StaleRemovalAudit> {
  const { deletions, renames } = await task9GitRemovalSets(resolve(repositoryRoot), baselineCommit)
  return {
    schemaVersion: 'task9-stale-runtime-removal-v2',
    catalogVersion: '0.3.0',
    baselineCommit,
    sourcePathRemovalCount: deletions.length + renames.length,
    baselineDeletions: {
      count: deletions.length,
      recovery: `git restore --source=${baselineCommit} -- <path>`,
      files: deletions,
    },
    similarityRenames: {
      count: renames.length,
      classification: 'git-similarity-rename',
      recovery: {
        command: `git restore --source=${baselineCommit} -- <source-path>`,
        sourcePaths: renames.map(entry => entry.source),
      },
      entries: renames,
    },
  }
}

export async function validateTask9StaleRemovalAudit(repositoryRoot: string, audit: unknown): Promise<string[]> {
  if (audit === null || typeof audit !== 'object') return ['TASK9_STALE_REMOVAL_AUDIT_INVALID']
  const candidate = audit as Partial<Task9StaleRemovalAudit>
  if (candidate.schemaVersion !== 'task9-stale-runtime-removal-v2' || typeof candidate.baselineCommit !== 'string') {
    return ['TASK9_STALE_REMOVAL_AUDIT_INVALID']
  }
  if (!fullCommitOid.test(candidate.baselineCommit) || candidate.baselineCommit !== TASK9_STALE_BASELINE_COMMIT) {
    return ['TASK9_STALE_REMOVAL_BASELINE_INVALID']
  }
  const expected = await buildTask9StaleRemovalAudit(repositoryRoot)
  return JSON.stringify(candidate) === JSON.stringify(expected) ? [] : ['TASK9_STALE_REMOVAL_GIT_SET_MISMATCH']
}

export async function writeTask9StaleRemovalAudit(repositoryRoot: string, baselineCommit = TASK9_STALE_BASELINE_COMMIT): Promise<Task9StaleRemovalAudit> {
  const audit = await buildTask9StaleRemovalAudit(repositoryRoot, baselineCommit)
  const path = resolve(repositoryRoot, 'packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json')
  await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`)
  return audit
}

export async function collectCanonicalInterfaceGuideSeeds(
  repositoryRoot: string,
  manifest: InterfaceSourceManifest,
): Promise<DependencySeed[]> {
  const seeds = canonicalBipedGuideFiles(manifest).map(name => ({
    path: `asset-source/v0.3.0/guides/${name}`,
    group: 'interface-guides',
  }))
  for (const seed of seeds) {
    try {
      await resolveExistingContainedPath(repositoryRoot, seed.path)
    } catch {
      throw new Error(`Missing canonical interface guide dependency: ${seed.path}`)
    }
  }
  return seeds
}

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

function containedRepositoryPath(repositoryRoot: string, path: string): string {
  const target = resolve(repositoryRoot, path)
  const remainder = relative(repositoryRoot, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Task 9 dependency escapes repository root: ${path}`)
  return target
}

function normalizeReference(path: string): string | undefined {
  const normalized = portable(path)
  if (normalized.startsWith('assets/v0.3.0/')) return `packages/asset-catalog/${normalized}`
  if (/^(?:asset-source|packages|scripts|apps|tests|docs)\//u.test(normalized)) return normalized
  return undefined
}

function referencedPaths(value: unknown, key = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(item => referencedPaths(item, key))
  if (value === null || typeof value !== 'object') {
    if (typeof value !== 'string' || !(key === 'path' || key.toLowerCase().endsWith('path'))) return []
    const normalized = normalizeReference(value)
    return normalized === undefined ? [] : [normalized]
  }
  return Object.entries(value).flatMap(([childKey, child]) => referencedPaths(child, childKey))
}

async function recursiveFiles(repositoryRoot: string, directory: string): Promise<string[]> {
  const root = containedRepositoryPath(repositoryRoot, directory)
  const files: string[] = []
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = resolve(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push(portable(relative(repositoryRoot, target)))
    }
  }
  await visit(root)
  return files
}

export async function collectEvidenceDependencyClosure(input: {
  repositoryRoot: string
  seedFiles: DependencySeed[]
  recursiveDirectories: DependencySeed[]
}): Promise<Task9EvidenceDependency[]> {
  const repositoryRoot = await realpath(resolve(input.repositoryRoot))
  const groups = new Map<string, Set<string>>()
  const documentQueue: string[] = []
  const parsedDocuments = new Set<string>()
  const add = (path: string, group: string): void => {
    const normalized = portable(path)
    if (normalized === 'packages/asset-catalog/audit/v0.3.0/evidence-manifest.json') {
      throw new Error('Task 9 evidence dependency graph must not contain its own manifest.')
    }
    const existing = groups.get(normalized) ?? new Set<string>()
    existing.add(group)
    groups.set(normalized, existing)
    if (normalized.endsWith('.json')) documentQueue.push(normalized)
  }
  for (const seed of input.seedFiles) add(seed.path, seed.group)
  for (const directory of input.recursiveDirectories) {
    for (const path of await recursiveFiles(repositoryRoot, directory.path)) add(path, directory.group)
  }
  while (documentQueue.length > 0) {
    const documentPath = documentQueue.shift()!
    if (parsedDocuments.has(documentPath)) continue
    parsedDocuments.add(documentPath)
    const canonicalDocument = await resolveExistingContainedPath(repositoryRoot, documentPath)
      .catch(error => {
        if (error instanceof Error && error.message.includes('escapes output root')) {
          throw new Error(`Task 9 dependency escapes repository root: ${documentPath}`)
        }
        throw error
      })
    const document = JSON.parse(await readFile(canonicalDocument, 'utf8')) as unknown
    const inheritedGroups = [...groups.get(documentPath)!]
    for (const reference of referencedPaths(document)) {
      for (const group of inheritedGroups) add(reference, group)
    }
  }
  const dependencies: Task9EvidenceDependency[] = []
  for (const [path, pathGroups] of [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const lexical = containedRepositoryPath(repositoryRoot, path)
    const canonical = await realpath(lexical)
    const remainder = relative(repositoryRoot, canonical)
    if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Task 9 dependency escaped repository root: ${path}`)
    const [link, metadata] = await Promise.all([lstat(lexical), stat(canonical)])
    if (link.isSymbolicLink() || !metadata.isFile() || metadata.nlink < 1) throw new Error(`Task 9 dependency is not a direct linked regular file: ${path}`)
    dependencies.push({
      path,
      sha256: createHash('sha256').update(await readFile(canonical)).digest('hex'),
      groups: [...pathGroups].sort(),
    })
  }
  return dependencies
}

const SEED_FILES: DependencySeed[] = [
  ...['catalog.json', 'parts.json', 'semantic-traits.json', 'themes.json', 'rigs.json', 'modifiers.json']
    .map(name => ({ path: `packages/asset-catalog/catalog/v0.3.0/${name}`, group: 'catalog' })),
  { path: 'packages/asset-catalog/source-index-v0.3.0.json', group: 'source-index' },
  { path: 'asset-source/v0.3.0/interface-manifest.json', group: 'interface-manifest' },
  { path: 'asset-source/v0.3.0/production/processed-index.json', group: 'processed-index' },
  { path: 'asset-source/v0.3.0/provenance/retained-v0.2-nonstructural.json', group: 'retained-provenance' },
  { path: 'asset-source/v0.3.0/provenance/v0.3-structural-union-color-masks.json', group: 'color-provenance' },
  { path: 'asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json', group: 'retained-coordinate-metadata' },
  { path: 'asset-source/v0.3.0/retained-v0.2/structural-union-alpha-index.json', group: 'color-structural-union' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json', group: 'composition-statistics' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json', group: 'pipeline-fixed-point' },
  { path: 'packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json', group: 'stale-removal' },
  { path: 'scripts/render-tail-extra-structural-matrices.ts', group: 'task9-live-renderer' },
  { path: 'scripts/task9-structural-identities.ts', group: 'task9-live-renderer' },
  { path: 'scripts/render-limb-contact-sheets.ts', group: 'task9-live-renderer' },
  { path: 'apps/creator-web/src/render-test.ts', group: 'task9-live-renderer' },
  { path: 'packages/renderer-canvas/src/render.ts', group: 'task9-live-renderer' },
  { path: 'packages/renderer-canvas/src/types.ts', group: 'task9-live-renderer' },
  ...[
    'review-record.json', 'biped-vertical-slice-acceptance.json', 'task6-approved-input-integrity.json',
    'body-head-contact-sheets-acceptance.json', 'body-head-review-record.json', 'body-head-connector-amendment.json',
    'limb-contact-sheets-acceptance.json', 'limb-review-record.json', 'visible-limb-threshold-amendment.json',
    'tail-extra-review-record.json', 'rework-record.json', 'structural-matrix-index.json',
  ].map(name => ({ path: `packages/asset-catalog/review/v0.3.0/${name}`, group: 'task6-9-review' })),
]

const RECURSIVE_DIRECTORIES: DependencySeed[] = [
  { path: 'asset-source/v0.3.0/generation/task9-candidates', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-extracted', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-normalized', group: 'task9-generation' },
  { path: 'asset-source/v0.3.0/generation/task9-review', group: 'task9-generation-review' },
  { path: 'asset-source/v0.3.0/production', group: 'production-provenance' },
  { path: 'asset-source/v0.3.0/provenance', group: 'production-provenance' },
]

const TASK9_PIPELINE_FIXED_FILES = [
  'asset-source/v0.3.0/interface-manifest.json',
  'asset-source/v0.3.0/production/processed-index.json',
  'asset-source/v0.3.0/provenance/v0.3-structural-union-color-masks.json',
  'asset-source/v0.3.0/retained-v0.2/structural-union-alpha-index.json',
  'packages/asset-catalog/source-index-v0.3.0.json',
] as const
const TASK9_PIPELINE_FIXED_DIRECTORIES = [
  'asset-source/v0.3.0/retained-v0.2/structural-union-alpha',
  'packages/asset-catalog/assets/v0.3.0',
  'packages/asset-catalog/catalog/v0.3.0',
] as const

export async function task9PipelineScopeSnapshot(repositoryRoot: string): Promise<{ fileCount: number; sha256: string }> {
  const paths: string[] = [...TASK9_PIPELINE_FIXED_FILES]
  const canonicalRoot = await realpath(resolve(repositoryRoot))
  const collect = async (directory: string): Promise<void> => {
    const canonicalDirectory = await realpath(resolve(canonicalRoot, directory))
    const remainder = relative(canonicalRoot, canonicalDirectory)
    if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Task 9 pipeline directory escapes repository: ${directory}`)
    for (const entry of await readdir(canonicalDirectory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`.replaceAll('\\', '/')
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile()) paths.push(path)
      else throw new Error(`Task 9 pipeline scope contains a non-regular entry: ${path}`)
    }
  }
  for (const directory of TASK9_PIPELINE_FIXED_DIRECTORIES) await collect(directory)
  const records = await Promise.all([...new Set(paths)].sort().map(async path => ({
    path,
    sha256: createHash('sha256').update(await readFile(await resolveExistingContainedPath(canonicalRoot, path))).digest('hex'),
  })))
  return {
    fileCount: records.length,
    sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
  }
}

export function task9StructuralMatrixEvidence(review: any): {
  entryCount: number
  failureCount: number
  entryCountByRig: { blob: number; biped: number; floating: number }
  observedExtrema: Record<string, number>
  diagnosticScope: {
    id: 'task9-tail-extra'
    activeVisualSlots: ['tail', 'extraAppendage']
    activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight']
    defaultRendererErrorCount: 188
    activeErrorCount: 0
    suppressedInactiveErrorCount: 188
    suppressedInactiveErrorCountByRig: { blob: 75; biped: 68; floating: 45 }
  }
} {
  const structural = review.structuralMatrixReview
  if (structural === undefined) throw new Error('Task 9 review lacks structuralMatrixReview evidence.')
  return {
    entryCount: structural.entryCount,
    failureCount: structural.machineGates.failureCount,
    entryCountByRig: structural.entryCountByRig,
    observedExtrema: structural.observedExtrema,
    diagnosticScope: structural.diagnosticScope,
  }
}

export async function buildTask9EvidenceManifest(repositoryRoot = process.cwd()): Promise<{
  manifest: ProductionEvidenceManifest
  dependencies: Task9EvidenceDependency[]
}> {
  const readJson = async (path: string) => JSON.parse(await readFile(
    await resolveExistingContainedPath(repositoryRoot, path), 'utf8',
  ))
  const interfaceManifest = await readJson('asset-source/v0.3.0/interface-manifest.json') as InterfaceSourceManifest
  const guideSeeds = await collectCanonicalInterfaceGuideSeeds(repositoryRoot, interfaceManifest)
  const [sourceIndex, catalog, statistics, pipeline, structuralReview, staleAudit, dependencies] = await Promise.all([
    readJson('packages/asset-catalog/source-index-v0.3.0.json'),
    readJson('packages/asset-catalog/catalog/v0.3.0/catalog.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json'),
    readJson('packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json'),
    collectEvidenceDependencyClosure({ repositoryRoot, seedFiles: [...SEED_FILES, ...guideSeeds], recursiveDirectories: RECURSIVE_DIRECTORIES }),
  ])
  const staleDiagnostics = await validateTask9StaleRemovalAudit(repositoryRoot, staleAudit)
  if (staleDiagnostics.length > 0) throw new Error(staleDiagnostics.join(','))
  const pipelineSnapshot = await task9PipelineScopeSnapshot(repositoryRoot)
  if (
    pipeline.stable !== true
    || pipeline.fileCount !== pipelineSnapshot.fileCount
    || pipeline.round1Sha256 !== pipelineSnapshot.sha256
    || pipeline.round2Sha256 !== pipelineSnapshot.sha256
  ) throw new Error(`Task 9 pipeline fixed-point evidence is stale: ${JSON.stringify(pipelineSnapshot)}`)
  const parsed = parseCatalog(catalog)
  if (!parsed.ok) throw new Error(`Cannot measure Task 9 final catalog: ${JSON.stringify(parsed.diagnostics)}`)
  const measured = measureCompositionDistribution(
    parsed.value,
    Array.from({ length: 10_000 }, (_, index) => `v03-composition-${String(index).padStart(5, '0')}`),
  )
  if (JSON.stringify(measured) !== JSON.stringify({
    optionalNoneRates: statistics.optionalNoneRates,
    maximumStrongFeatures: statistics.maximumStrongFeatures,
    maximumSurpriseSlots: statistics.maximumSurpriseSlots,
  })) throw new Error('Task 9 committed 10,000-seed statistics differ from live deterministic recomputation.')
  const manifest: ProductionEvidenceManifest = {
    ...buildProductionEvidenceManifest(sourceIndex),
    task9Evidence: {
      schemaVersion: 'task9-production-evidence-v1',
      sourceEntryCount: sourceIndex.sources.length,
      dependencyCount: dependencies.length,
      dependencies,
      compositionStatistics: {
        seedCount: statistics.seedCount,
        optionalNoneRates: statistics.optionalNoneRates,
        maximumStrongFeatures: statistics.maximumStrongFeatures,
        maximumSurpriseSlots: statistics.maximumSurpriseSlots,
        surpriseLimit: statistics.maximumSurpriseSlotsLimit,
      },
      structuralMatrix: task9StructuralMatrixEvidence(structuralReview),
      pipelineFixedPoint: {
        sequence: pipeline.sequence,
        round1Sha256: pipeline.round1Sha256,
        round2Sha256: pipeline.round2Sha256,
      },
    },
  }
  return { manifest, dependencies }
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd()
  const { manifest, dependencies } = await buildTask9EvidenceManifest(repositoryRoot)
  const auditRoot = resolve(repositoryRoot, 'packages/asset-catalog/audit/v0.3.0')
  await mkdir(auditRoot, { recursive: true })
  await writeFile(resolve(auditRoot, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(resolve(auditRoot, 'task9-tracked-dependencies.json'), `${JSON.stringify({
    schemaVersion: 'task9-tracked-dependencies-v1',
    dependencyCount: dependencies.length + 1,
    dependencies: [...dependencies.map(item => item.path), 'packages/asset-catalog/audit/v0.3.0/evidence-manifest.json'].sort(),
  }, null, 2)}\n`)
  console.log(JSON.stringify({ dependencies: dependencies.length }))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--write-stale-audit')) {
    const baselineIndex = process.argv.indexOf('--baseline')
    const baseline = baselineIndex === -1 ? TASK9_STALE_BASELINE_COMMIT : process.argv[baselineIndex + 1]
    if (baseline === undefined) throw new Error('Missing --baseline value.')
    console.log(JSON.stringify(await writeTask9StaleRemovalAudit(process.cwd(), baseline)))
  } else await main()
}
