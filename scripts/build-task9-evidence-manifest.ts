import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
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
import {
  collectCanonicalInterfaceGuideSeeds,
  collectEvidenceDependencyClosure,
  collectExpectedTask9EvidenceDependencies,
} from '../packages/asset-catalog/src/task9-evidence-dependencies.js'
import { readTrustedRepositoryFile } from '../packages/asset-catalog/src/trusted-repository-file.js'
import { measureCompositionDistribution } from './composition-statistics.js'

export { collectCanonicalInterfaceGuideSeeds, collectEvidenceDependencyClosure }
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

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

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
    sha256: (await readTrustedRepositoryFile(canonicalRoot, path)).sha256,
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
  const readJson = async (path: string) => JSON.parse(
    (await readTrustedRepositoryFile(repositoryRoot, path)).bytes.toString('utf8'),
  )
  const [sourceIndex, catalog, statistics, pipeline, structuralReview, staleAudit, dependencies] = await Promise.all([
    readJson('packages/asset-catalog/source-index-v0.3.0.json'),
    readJson('packages/asset-catalog/catalog/v0.3.0/catalog.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json'),
    readJson('packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'),
    readJson('packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json'),
    collectExpectedTask9EvidenceDependencies(repositoryRoot),
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
