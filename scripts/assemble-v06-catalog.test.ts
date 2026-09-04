import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleV06Catalog, V06_INTEGRATED_PART_IDS } from './assemble-v06-catalog.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('assemble v0.6 feline catalog', () => {
  it('builds only the feline-sit catalog with integrated limbs and bounded special features', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-catalog-'))
    temporaryRoots.push(stagedRoot)
    const catalog = await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })

    expect(catalog.version).toBe('0.6.0')
    expect(catalog.rigs.map((rig: { id: string }) => rig.id)).toEqual(['feline-sit'])
    expect(catalog.archetypes).toEqual([expect.objectContaining({
      id: 'feline', defaultRigId: 'feline-sit', integratedSlots: ['arms', 'legs', 'extraAppendage'],
    })])
    expect(Object.keys(catalog.rigs[0].sockets).sort()).toEqual([
      'effect', 'eyes', 'head', 'headAppendage', 'mouth', 'oralDetail', 'overlay', 'tail',
    ])
    expect(catalog.parts.filter((part: { slotId: string }) => part.slotId === 'tail').map((part: { id: string }) => part.id).sort()).toEqual([
      'tail_feline_curl', 'tail_feline_long', 'tail_feline_star_tip',
    ])
    expect(catalog.parts.filter((part: { featureTier?: string }) => part.featureTier === 'special')).toEqual(expect.arrayContaining([
      expect.objectContaining({ specialFeatureAnchor: 'ear' }),
      expect.objectContaining({ specialFeatureAnchor: 'back' }),
      expect.objectContaining({ specialFeatureAnchor: 'tailTip' }),
    ]))
    for (const [slotId, id] of Object.entries(V06_INTEGRATED_PART_IDS)) {
      expect(catalog.parts.find((part: { id: string }) => part.id === id)).toMatchObject({
        slotId, assetPath: '', composition: { isNone: true, renderNodes: [] },
      })
    }
    for (const part of catalog.parts.filter((item: { slotId: string }) => ['surfaceMaterial', 'pattern', 'colorScheme'].includes(item.slotId))) {
      expect(part.composition.renderNodes.every((node: { clipPolicy: string }) => node.clipPolicy === 'body')).toBe(true)
    }
    expect(catalog.parts.find((part: { id: string }) => part.id === 'ear_crystal_rim').composition.renderNodes[0].clipPolicy).toBe('protect-face')
    expect(JSON.stringify(catalog)).not.toMatch(/\b(?:blob|biped|floating)\b/u)
  }, 60_000)

  it('adds a source-free normal head appendage candidate', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-head-appendage-none-'))
    temporaryRoots.push(stagedRoot)
    const catalog = await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })

    const part = catalog.parts.find((candidate: { id: string }) => candidate.id === 'headAppendage_feline_none')
    expect(part).toMatchObject({
      id: 'headAppendage_feline_none',
      slotId: 'headAppendage',
      archetypeIds: ['feline'],
      featureTier: 'base',
      assetPath: '',
      composition: { isNone: true, renderNodes: [] },
    })
    expect(part).not.toHaveProperty('assetSha256')
    expect(part).not.toHaveProperty('pngPath')
    expect(part).not.toHaveProperty('pngSha256')
    expect(catalog.parts.filter((candidate: { featureTier?: string }) => candidate.featureTier === 'special'))
      .not.toContainEqual(expect.objectContaining({ id: 'headAppendage_feline_none' }))
  }, 60_000)

  it('writes aggregate, splits, provenance, manifest, evidence, review and assets together', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-release-'))
    temporaryRoots.push(stagedRoot)
    await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })
    for (const path of [
      'packages/asset-catalog/catalog/v0.6.0/catalog.json',
      'packages/asset-catalog/catalog/v0.6.0/parts.json',
      'packages/asset-catalog/source-index-v0.6.0.json',
      'packages/asset-catalog/audit/v0.6.0/evidence-manifest.json',
      'packages/asset-catalog/review/v0.6.0/review-record.json',
      'asset-source/v0.6.0/interface-manifest.json',
    ]) await expect(access(join(stagedRoot, path))).resolves.toBeUndefined()
  }, 60_000)

  it('refuses an existing release target before writing any sibling target', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-immutable-'))
    temporaryRoots.push(stagedRoot)
    await mkdir(join(stagedRoot, 'packages/asset-catalog/catalog/v0.6.0'), { recursive: true })
    await expect(assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot }))
      .rejects.toThrow(/V06_RELEASE_TARGET_EXISTS_NO_OVERWRITE/u)
    await expect(access(join(stagedRoot, 'packages/asset-catalog/assets/v0.6.0'))).rejects.toThrow()
  })
})
