import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
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
  }, 90_000)

  it('keeps every normal feline body/head pairing in canvas and uses a tapered bridge silhouette', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-interface-contract-'))
    temporaryRoots.push(stagedRoot)
    const catalog = await assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot })
    const structuralVariant = (partId: string) => catalog.parts.find((part: { id: string }) => part.id === partId)
      .composition.variantsByRig['feline-sit']
    const neck = (variant: { connectors: Array<{ id: string }> }) => variant.connectors.find(connector => connector.id === 'neck')
    const alphaAt = (image: { data: Buffer, info: { width: number } }, x: number, y: number) => (
      image.data[(y * image.info.width + x) * 4 + 3]
    )
    const alphaPixels = (image: { data: Buffer, info: { width: number, height: number } }) => {
      let pixels = 0
      for (let pixel = 0; pixel < image.info.width * image.info.height; pixel += 1) {
        if (image.data[pixel * 4 + 3]! > 0) pixels += 1
      }
      return pixels
    }
    const visibleBounds = (image: { data: Buffer, info: { width: number, height: number } }) => {
      let minX = image.info.width; let minY = image.info.height; let maxX = -1; let maxY = -1
      for (let y = 0; y < image.info.height; y += 1) for (let x = 0; x < image.info.width; x += 1) {
        if (alphaAt(image, x, y) === 0) continue
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      return { minX, minY, maxX, maxY }
    }

    for (const bodyId of ['body_feline_sit_round', 'body_feline_sit_plush']) for (const headId of ['head_feline_round', 'head_feline_tufted']) {
      const bodyNeck = neck(structuralVariant(bodyId))
      const headPart = catalog.parts.find((part: { id: string }) => part.id === headId)
      const head = structuralVariant(headId)
      const headPlacementY = bodyNeck.origin.y - neck(head).origin.y
      const bounds = visibleBounds(await sharp(await readFile(join(stagedRoot, 'packages', 'asset-catalog', headPart.pngPath)))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
      const faceZone = head.faceSafeZones[0]
      expect(headPlacementY + bounds.minY).toBeGreaterThanOrEqual(0)
      expect(headPlacementY + bounds.maxY).toBeLessThan(2048)
      expect(headPlacementY + faceZone.y).toBeGreaterThanOrEqual(0)
      expect(headPlacementY + faceZone.y + faceZone.height).toBeLessThanOrEqual(2048)
    }

    for (const bridge of catalog.transitionBridges) {
      const bridgePath = join(stagedRoot, 'packages', 'asset-catalog', bridge.neutralPngPath)
      const decoded = await sharp(await readFile(bridgePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const front = await sharp(await readFile(join(stagedRoot, 'packages', 'asset-catalog', bridge.frontMaskPath)))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const back = await sharp(await readFile(join(stagedRoot, 'packages', 'asset-catalog', bridge.backMaskPath)))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalPixels = decoded.info.width * decoded.info.height
      expect(alphaPixels(decoded)).toBeGreaterThan(totalPixels * 0.7)
      expect(alphaPixels(decoded)).toBeLessThan(totalPixels * 0.9)
      expect(alphaAt(decoded, 0, Math.floor(decoded.info.height / 2))).toBe(0)
      expect(alphaAt(decoded, decoded.info.width - 1, Math.floor(decoded.info.height / 2))).toBe(0)
      for (const x of [0, Math.floor(decoded.info.width / 2), decoded.info.width - 1]) {
        expect(alphaAt(decoded, x, 0)).toBe(255)
        expect(alphaAt(decoded, x, decoded.info.height - 1)).toBe(255)
      }
      for (const mask of [front, back]) {
        expect(alphaPixels(mask)).toBeGreaterThan(totalPixels * 0.25)
        expect(alphaPixels(mask)).toBeLessThan(totalPixels * 0.46)
      }
      expect(alphaAt(front, 0, Math.floor(front.info.height / 2) - 1)).toBe(0)
      expect(alphaAt(back, 0, Math.floor(back.info.height / 2))).toBe(0)
      expect(await sharp(await readFile(join(stagedRoot, 'packages', 'asset-catalog', bridge.neutralAssetPath))).metadata())
        .toMatchObject({ hasAlpha: true })
    }
  }, 90_000)

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
  }, 90_000)

  it('refuses an existing release target before writing any sibling target', async () => {
    const stagedRoot = await mkdtemp(join(tmpdir(), 'qmonster-v06-immutable-'))
    temporaryRoots.push(stagedRoot)
    await mkdir(join(stagedRoot, 'packages/asset-catalog/catalog/v0.6.0'), { recursive: true })
    await expect(assembleV06Catalog({ repositoryRoot: process.cwd(), stagedRoot }))
      .rejects.toThrow(/V06_RELEASE_TARGET_EXISTS_NO_OVERWRITE/u)
    await expect(access(join(stagedRoot, 'packages/asset-catalog/assets/v0.6.0'))).rejects.toThrow()
  })
})
