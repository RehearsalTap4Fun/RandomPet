import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { collectEvidenceDependencyClosure, task9StructuralMatrixEvidence } from './build-task9-evidence-manifest.js'

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

it('reads structural metrics from the approved structuralMatrixReview field', () => {
  expect(task9StructuralMatrixEvidence({ structuralMatrixReview: {
    entryCount: 39,
    entryCountByRig: { blob: 15, biped: 15, floating: 9 },
    machineGates: { failureCount: 0 },
    observedExtrema: { receiverCoverageMin: 0.92 },
  } })).toEqual({
    entryCount: 39,
    failureCount: 0,
    entryCountByRig: { blob: 15, biped: 15, floating: 9 },
    observedExtrema: { receiverCoverageMin: 0.92 },
  })
})
