import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCatalog } from '@qmonster/generator-core'
import {
  buildProductionEvidenceManifest,
  type ProductionEvidenceManifest,
  type Task9EvidenceDependency,
} from '../packages/asset-catalog/src/evidence-root.js'
import { measureCompositionDistribution } from './composition-statistics.js'

interface DependencySeed { path: string; group: string }

function portable(path: string): string {
  return path.replaceAll('\\', '/')
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
  const root = resolve(repositoryRoot, directory)
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
    const document = JSON.parse(await readFile(resolve(repositoryRoot, documentPath), 'utf8')) as unknown
    const inheritedGroups = [...groups.get(documentPath)!]
    for (const reference of referencedPaths(document)) {
      for (const group of inheritedGroups) add(reference, group)
    }
  }
  const dependencies: Task9EvidenceDependency[] = []
  for (const [path, pathGroups] of [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const lexical = resolve(repositoryRoot, path)
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

export function task9StructuralMatrixEvidence(review: any): {
  entryCount: number
  failureCount: number
  entryCountByRig: { blob: number; biped: number; floating: number }
  observedExtrema: Record<string, number>
} {
  const structural = review.structuralMatrixReview
  if (structural === undefined) throw new Error('Task 9 review lacks structuralMatrixReview evidence.')
  return {
    entryCount: structural.entryCount,
    failureCount: structural.machineGates.failureCount,
    entryCountByRig: structural.entryCountByRig,
    observedExtrema: structural.observedExtrema,
  }
}

export async function buildTask9EvidenceManifest(repositoryRoot = process.cwd()): Promise<{
  manifest: ProductionEvidenceManifest
  dependencies: Task9EvidenceDependency[]
}> {
  const [sourceIndex, catalog, statistics, pipeline, structuralReview, dependencies] = await Promise.all([
    readFile(resolve(repositoryRoot, 'packages/asset-catalog/source-index-v0.3.0.json'), 'utf8').then(JSON.parse),
    readFile(resolve(repositoryRoot, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8').then(JSON.parse),
    readFile(resolve(repositoryRoot, 'packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json'), 'utf8').then(JSON.parse),
    readFile(resolve(repositoryRoot, 'packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json'), 'utf8').then(JSON.parse),
    readFile(resolve(repositoryRoot, 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'), 'utf8').then(JSON.parse),
    collectEvidenceDependencyClosure({ repositoryRoot, seedFiles: SEED_FILES, recursiveDirectories: RECURSIVE_DIRECTORIES }),
  ])
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main()
