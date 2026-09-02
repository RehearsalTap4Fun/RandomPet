import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import {
  buildTask9EvidenceManifest,
  collectCanonicalInterfaceGuideSeeds,
  collectEvidenceDependencyClosure,
  task9PipelineScopeSnapshot,
  task9StructuralMatrixEvidence,
  validateTask9StaleRemovalAudit,
  TASK9_STALE_BASELINE_COMMIT,
} from './build-task9-evidence-manifest.js'
import { collectExpectedTask9EvidenceDependencies } from '../packages/asset-catalog/src/task9-evidence-dependencies.js'

it('rebuilds legacy v0.3 evidence through the two-argument composition statistics contract', async () => {
  const statisticsPath = 'packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json'
  const before = await readFile(statisticsPath)

  const { manifest } = await buildTask9EvidenceManifest(process.cwd())

  expect(manifest.catalogVersion).toBe('0.3.0')
  expect(await readFile(statisticsPath)).toEqual(before)
}, 60_000)

it('matches the audited baseline deletion and similarity-rename sets to Git exactly', async () => {
  const audit = JSON.parse(await readFile('packages/asset-catalog/audit/v0.3.0/task9-stale-runtime-removal.json', 'utf8'))
  expect(audit.baselineCommit).toBe(TASK9_STALE_BASELINE_COMMIT)
  expect(audit.similarityRenames.recovery.sourcePaths).toEqual(
    audit.similarityRenames.entries.map((entry: { source: string }) => entry.source),
  )
  await expect(validateTask9StaleRemovalAudit(process.cwd(), audit)).resolves.toEqual([])
})

it('rejects a HEAD-derived empty stale audit and malformed or untrusted revision input', async () => {
  const forged = {
    schemaVersion: 'task9-stale-runtime-removal-v2',
    catalogVersion: '0.3.0',
    baselineCommit: 'HEAD',
    sourcePathRemovalCount: 0,
    baselineDeletions: { count: 0, recovery: 'none', files: [] },
    similarityRenames: {
      count: 0, classification: 'git-similarity-rename', entries: [],
      recovery: { command: 'none', sourcePaths: [] },
    },
  }
  await expect(validateTask9StaleRemovalAudit(process.cwd(), forged)).resolves.toEqual([
    'TASK9_STALE_REMOVAL_BASELINE_INVALID',
  ])
  forged.baselineCommit = '0'.repeat(40)
  await expect(validateTask9StaleRemovalAudit(process.cwd(), forged)).resolves.toEqual([
    'TASK9_STALE_REMOVAL_BASELINE_INVALID',
  ])
})

it('derives every canonical biped guide from the interface manifest and fails if one is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-guides-'))
  const guideRoot = join(root, 'asset-source', 'v0.3.0', 'guides')
  await mkdir(guideRoot, { recursive: true })
  const manifest = {
    assets: [{
      id: 'body_biped_peanut',
      slotId: 'bodyFrame',
      variants: [{
        rigId: 'biped',
        connectors: [{ id: 'tailRoot', role: 'receiver' }, { id: 'extraLeft', role: 'receiver' }],
      }],
    }],
  }
  const expected = [
    'body_biped_peanut-extraLeft-receiver-guide.png',
    'body_biped_peanut-extraLeft-receiver-mask.png',
    'body_biped_peanut-tailRoot-receiver-guide.png',
    'body_biped_peanut-tailRoot-receiver-mask.png',
  ]
  for (const name of expected) await writeFile(join(guideRoot, name), name)

  await expect(collectCanonicalInterfaceGuideSeeds(root, manifest as any)).resolves.toEqual(
    expected.map(name => ({ path: `asset-source/v0.3.0/guides/${name}`, group: 'interface-guides' })),
  )
  await import('node:fs/promises').then(({ rm }) => rm(join(guideRoot, expected[0]!)))
  await expect(collectCanonicalInterfaceGuideSeeds(root, manifest as any)).rejects.toThrow(expected[0])
})

it('recursively collects sorted hash-bound paths from documents and directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-collector-'))
  await mkdir(join(root, 'asset-source', 'v0.3.0', 'generation', 'task9-candidates'), { recursive: true })
  await mkdir(join(root, 'packages', 'asset-catalog', 'assets', 'v0.3.0'), { recursive: true })
  const candidate = Buffer.from('candidate')
  const runtime = Buffer.from('runtime')
  await writeFile(join(root, 'asset-source', 'v0.3.0', 'generation', 'task9-candidates', 'candidate.png'), candidate)
  await writeFile(join(root, 'packages', 'asset-catalog', 'assets', 'v0.3.0', 'part.png'), runtime)
  await writeFile(join(root, 'source-index.json'), JSON.stringify({
    sources: [{
      sourceResources: [{ path: 'asset-source/v0.3.0/generation/task9-candidates/candidate.png' }],
      runtimeResources: [{ path: 'assets/v0.3.0/part.png' }],
    }],
  }))

  const dependencies = await collectEvidenceDependencyClosure({
    repositoryRoot: root,
    seedFiles: [{ path: 'source-index.json', group: 'source-index' }],
    recursiveDirectories: [{ path: 'asset-source/v0.3.0/generation/task9-candidates', group: 'task9-generation' }],
  })

  expect(dependencies.map(item => item.path)).toEqual([
    'asset-source/v0.3.0/generation/task9-candidates/candidate.png',
    'packages/asset-catalog/assets/v0.3.0/part.png',
    'source-index.json',
  ])
  expect(dependencies.find(item => item.path.endsWith('candidate.png'))).toEqual({
    path: 'asset-source/v0.3.0/generation/task9-candidates/candidate.png',
    sha256: createHash('sha256').update(candidate).digest('hex'),
    groups: ['source-index', 'task9-generation'],
  })
})

it('rejects an escaping document seed before attempting to parse outside bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-boundary-'))
  const outside = join(dirname(root), `${basename(root)}-outside.json`)
  await writeFile(outside, 'this is intentionally not JSON')
  await expect(collectEvidenceDependencyClosure({
    repositoryRoot: root,
    seedFiles: [{ path: `../${basename(outside)}`, group: 'malicious' }],
    recursiveDirectories: [],
  })).rejects.toThrow(/portable lexical leaf|escapes repository root/iu)
})

it('rejects an evidence JSON document reached through an escaping junction before parsing', async ({ skip }) => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-json-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'qmonster-task9-json-outside-'))
  await writeFile(join(outside, 'input.json'), 'this is intentionally not JSON')
  try {
    try {
      await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('directory links unavailable')
      throw error
    }
    await expect(collectEvidenceDependencyClosure({
      repositoryRoot: root,
      seedFiles: [{ path: 'linked/input.json', group: 'malicious' }],
      recursiveDirectories: [],
    })).rejects.toThrow(/escapes?.*(?:canonical )?repository root/i)
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
  }
})

it('reads structural metrics from the approved structuralMatrixReview field', () => {
  expect(task9StructuralMatrixEvidence({ structuralMatrixReview: {
    entryCount: 39,
    entryCountByRig: { blob: 15, biped: 15, floating: 9 },
    machineGates: { failureCount: 0 },
    observedExtrema: { receiverCoverageMin: 0.92 },
    diagnosticScope: {
      id: 'task9-tail-extra',
      activeVisualSlots: ['tail', 'extraAppendage'],
      activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight'],
      defaultRendererErrorCount: 188,
      activeErrorCount: 0,
      suppressedInactiveErrorCount: 188,
      suppressedInactiveErrorCountByRig: { blob: 75, biped: 68, floating: 45 },
    },
  } })).toEqual({
    entryCount: 39,
    failureCount: 0,
    entryCountByRig: { blob: 15, biped: 15, floating: 9 },
    observedExtrema: { receiverCoverageMin: 0.92 },
    diagnosticScope: {
      id: 'task9-tail-extra',
      activeVisualSlots: ['tail', 'extraAppendage'],
      activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight'],
      defaultRendererErrorCount: 188,
      activeErrorCount: 0,
      suppressedInactiveErrorCount: 188,
      suppressedInactiveErrorCountByRig: { blob: 75, biped: 68, floating: 45 },
    },
  })
})

it('binds pipeline fixed-point evidence to the current exact production scope bytes', async () => {
  const audit = JSON.parse(await readFile('packages/asset-catalog/audit/v0.3.0/task9-pipeline-fixed-point.json', 'utf8'))
  const snapshot = await task9PipelineScopeSnapshot(process.cwd())
  expect(snapshot.fileCount).toBe(audit.fileCount)
  expect(snapshot.sha256).toBe(audit.round1Sha256)
  expect(snapshot.sha256).toBe(audit.round2Sha256)
})

it('includes the independent bridge-review provenance validator in the formal evidence closure', async () => {
  const dependencies = await collectExpectedTask9EvidenceDependencies(process.cwd())
  expect(dependencies).toContainEqual(expect.objectContaining({
    path: 'packages/asset-catalog/src/bridge-render-review-provenance.ts',
    groups: ['task9-validation'],
  }))
})

it('binds the Task 10 face-socket amendment and role-specific connector threshold into Task 9 evidence', async () => {
  const dependencies = await collectExpectedTask9EvidenceDependencies(process.cwd())
  for (const [path, group] of [
    ['packages/asset-catalog/review/v0.3.0/head-face-socket-amendment.json', 'task6-9-review'],
    ['scripts/amend-head-face-sockets.ts', 'task9-validation'],
    ['packages/renderer-canvas/src/connector-metrics.ts', 'task9-live-renderer'],
  ] as const) {
    expect(dependencies).toContainEqual(expect.objectContaining({ path, groups: expect.arrayContaining([group]) }))
  }
})
