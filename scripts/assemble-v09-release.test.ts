import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS } from '@qmonster/generator-core'
import { assembleV09Release, canonicalJsonSha256, type V09ReleaseCandidate } from '@qmonster/asset-catalog'
import { assembleBuiltV09Candidate, buildV09ReleaseCandidate, parseV09AssemblyArgs } from './assemble-v09-release.js'

async function tree(root: string, prefix = ''): Promise<Record<string, string>> {
  const output: Record<string, string> = {}
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) {
      output[`${path.replaceAll('\\', '/')}/`] = '<directory>'
      Object.assign(output, await tree(root, path))
    }
    else output[path.replaceAll('\\', '/')] = (await readFile(join(root, path))).toString('base64')
  }
  return output
}

function transactionCandidate(): V09ReleaseCandidate {
  const traitInventory = { schemaVersion: 'qmonster-trait-inventory-v1', traits: [] }
  const skeletonPool = { schemaVersion: 'qmonster-skeleton-pool-v1', skeletonPoolId: 'test', candidates: [] }
  return {
    releaseManifest: { schemaVersion: 'qmonster-release-v1' },
    speciesRig: {}, skeletonPool, skeletonFamilies: [], assemblyTemplates: [], assemblyApprovals: [],
    traitApprovals: [], attachmentAllowlist: {}, traitInventory, sealedTraits: [], compositionGraph: {}, resources: [],
  } as unknown as V09ReleaseCandidate
}

describe('v0.9 release assembly', () => {
  it('does not write when validation fails', async () => {
    await expect(assembleV09Release({ root: '', candidate: undefined })).rejects.toMatchObject({ code: 'V09_RELEASE_INVALID' })
  })

  it('builds the exact approved 8:1 production candidate without an active pointer', async () => {
    const candidate = await buildV09ReleaseCandidate({ repositoryRoot: process.cwd(), catalogVersion: '0.9.0' })

    expect(candidate.releaseManifest).toMatchObject({
      schemaVersion: 'qmonster-release-v1',
      versionTuple: { schemaVersion: '0.4.0', catalogVersion: '0.9.0', generatorVersion: '0.9.0' },
    })
    expect(candidate.skeletonPool).toEqual({
      schemaVersion: 'qmonster-skeleton-pool-v1',
      skeletonPoolId: 'feline-sit-v2-pool',
      candidates: [
        { skeletonFamilyId: 'feline-sit-v2-core', skeletonClass: 'base', weight: 8 },
        { skeletonFamilyId: 'feline-sit-v2-legendary-01', skeletonClass: 'legendary', weight: 1 },
      ],
    })
    expect(candidate.traitInventory.traits).toHaveLength(156)
    expect(candidate.sealedTraits).toHaveLength(312)
    expect(candidate.traitApprovals).toHaveLength(312)
    expect(candidate.attachmentAllowlist.entries).toHaveLength(52)
    expect(candidate.assemblyApprovals).toHaveLength(2)
    expect(candidate.compositionGraph).toEqual({
      schemaVersion: 'qmonster-composition-graph-v1',
      orderedNodes: V09_COMPOSITION_NODE_IDS,
      blendMode: 'source-over-premultiplied-srgb',
      transformPolicy: 'identity-only',
    })
    for (const slotId of V09_TRAIT_SLOT_IDS) {
      const entries = candidate.traitInventory.traits.filter(entry => entry.slotId === slotId)
      expect(entries.filter(entry => entry.rarity === 'common')).toHaveLength(8)
      expect(entries.filter(entry => entry.rarity === 'rare')).toHaveLength(4)
      expect(entries.filter(entry => entry.rarity === 'legendary')).toHaveLength(1)
    }
  }, 120_000)

  it('accepts only the frozen catalog version and non-active candidate pointer', () => {
    expect(parseV09AssemblyArgs([
      '--catalog-version', '0.9.0',
      '--output-pointer', 'packages/asset-catalog/releases/candidate-v0.9.0.json',
    ], process.cwd())).toEqual({
      repositoryRoot: process.cwd(),
      catalogVersion: '0.9.0',
      outputPointer: expect.stringMatching(/[\\/]packages[\\/]asset-catalog[\\/]releases[\\/]candidate-v0\.9\.0\.json$/u),
    })

    for (const args of [
      ['--catalog-version', '0.8.0', '--output-pointer', 'packages/asset-catalog/releases/candidate-v0.9.0.json'],
      ['--catalog-version', '0.9.0', '--output-pointer', 'packages/asset-catalog/releases/active-release.json'],
      ['--catalog-version', '0.9.0'],
    ]) expect(() => parseV09AssemblyArgs(args, process.cwd())).toThrow()
  })

  it.each(['trait-inventory.json', 'skeleton-pool.json'])('preflights conflicting %s before any candidate output', async conflictName => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-wrapper-conflict-'))
    const catalogDirectory = join(root, 'catalog', 'v0.9.0')
    const conflictPath = join(catalogDirectory, conflictName)
    await mkdir(catalogDirectory, { recursive: true })
    await writeFile(conflictPath, 'foreign-bytes')
    await writeFile(join(root, 'foreign-marker'), 'preserve-me')
    const before = await tree(root)
    let assemblerCalls = 0
    try {
      await expect(assembleBuiltV09Candidate({
        catalogRoot: root,
        outputPointer: join(root, 'releases', 'candidate-v0.9.0.json'),
        candidate: transactionCandidate(),
        assembler: async () => {
          assemblerCalls += 1
          throw new Error('assembler must not run')
        },
      })).rejects.toThrow(/immutable catalog document/i)
      expect(assemblerCalls).toBe(0)
      expect(await tree(root)).toEqual(before)
      expect(await readFile(conflictPath, 'utf8')).toBe('foreign-bytes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes both catalog documents with the candidate and leaves active bytes untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-wrapper-success-'))
    const active = join(root, 'releases', 'active-release.json')
    const candidate = transactionCandidate()
    const manifestSha256 = canonicalJsonSha256(candidate.releaseManifest)
    await mkdir(join(root, 'releases'), { recursive: true })
    await writeFile(active, 'foreign-active-bytes')
    try {
      const result = await assembleBuiltV09Candidate({
        catalogRoot: root,
        outputPointer: join(root, 'releases', 'candidate-v0.9.0.json'),
        candidate,
        assembler: async ({ root: target }) => {
          await mkdir(join(target, 'resources', 'by-sha256'), { recursive: true })
          await mkdir(join(target, 'releases', 'by-sha256'), { recursive: true })
          await mkdir(join(target, 'audit', 'v0.9.0'), { recursive: true })
          await writeFile(join(target, 'resources', 'by-sha256', 'fixture'), 'resource')
          await writeFile(join(target, 'releases', 'by-sha256', `${manifestSha256}.json`), 'manifest')
          await writeFile(join(target, 'audit', 'v0.9.0', `release-${manifestSha256}.json`), 'audit')
          await writeFile(join(target, 'releases', 'candidate-v0.9.0.json'), 'pointer')
          return {
            releaseManifestSha256: manifestSha256,
            candidatePointerPath: join(target, 'releases', 'candidate-v0.9.0.json'),
            auditPath: join(target, 'audit', 'v0.9.0', `release-${manifestSha256}.json`),
          }
        },
      })
      expect(result.releaseManifestSha256).toBe(manifestSha256)
      expect(JSON.parse(await readFile(join(root, 'catalog', 'v0.9.0', 'trait-inventory.json'), 'utf8'))).toEqual(candidate.traitInventory)
      expect(JSON.parse(await readFile(join(root, 'catalog', 'v0.9.0', 'skeleton-pool.json'), 'utf8'))).toEqual(candidate.skeletonPool)
      expect(await readFile(active, 'utf8')).toBe('foreign-active-bytes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rolls back both wrapper-owned catalog documents when release assembly fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v09-wrapper-rollback-'))
    await writeFile(join(root, 'foreign-marker'), 'preserve-me')
    const before = await tree(root)
    try {
      await expect(assembleBuiltV09Candidate({
        catalogRoot: root,
        outputPointer: join(root, 'releases', 'candidate-v0.9.0.json'),
        candidate: transactionCandidate(),
        assembler: async () => { throw new Error('injected assembly failure') },
      })).rejects.toThrow('injected assembly failure')
      expect(await tree(root)).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
