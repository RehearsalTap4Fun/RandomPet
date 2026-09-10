import { describe, expect, it } from 'vitest'
import { V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS } from '@qmonster/generator-core'
import { assembleV09Release } from '../packages/asset-catalog/src/v09-production-validation.js'
import { buildV09ReleaseCandidate, parseV09AssemblyArgs } from './assemble-v09-release.js'

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
})
