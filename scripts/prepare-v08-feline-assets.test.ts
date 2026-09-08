import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  V08_REGION_GUIDE_FILENAMES,
  establishV08CanonicalMaster,
  prepareV08FelineMaster,
} from './prepare-v08-feline-assets.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function writeMask(
  path: string,
  points: readonly (readonly [number, number])[],
): Promise<void> {
  const pixels = Buffer.alloc(2048 * 2048 * 4)
  for (const [x, y] of points) {
    const offset = (y * 2048 + x) * 4
    pixels[offset] = 255
    pixels[offset + 1] = 255
    pixels[offset + 2] = 255
    pixels[offset + 3] = 255
  }
  await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toFile(path)
}

async function fixture(): Promise<{ root: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-v08-master-'))
  temporaryRoots.push(root)
  const masterDirectory = join(root, 'master')
  const maskDirectory = join(masterDirectory, 'masks')
  const output = join(root, 'prepared')
  await mkdir(maskDirectory, { recursive: true })
  const bodyPoints = Array.from({ length: 80 }, (_, y) => (
    Array.from({ length: 80 }, (_unused, x) => [100 + x, 100 + y] as const)
  )).flat()
  await writeMask(join(masterDirectory, 'feline-sit-v1.png'), bodyPoints)
  await writeMask(join(masterDirectory, 'feline-sit-v1-raw.png'), bodyPoints)

  const pointsByRegion: Record<keyof typeof V08_REGION_GUIDE_FILENAMES, readonly (readonly [number, number])[]> = {
    bodySurface: bodyPoints,
    headSurface: [[120, 120], [121, 120], [120, 121], [121, 121]],
    faceSafeZone: [[120, 120], [121, 120], [120, 121], [121, 121]],
    eyesRegion: [[120, 120]],
    mouthRegion: [[121, 121]],
    oralRegion: [[121, 121]],
    tailSurface: [[178, 150]],
    frontPawDetail: [[110, 170], [130, 170]],
    hindPawDetail: [[150, 170], [170, 170]],
    headAccessory: [[125, 110]],
    mutationEar: [[135, 110]],
    mutationBack: [[175, 140]],
    mutationTailTip: [[178, 150]],
    effectField: [[1900, 1900]],
    faceProtection: [[120, 120], [121, 120], [120, 121], [121, 121]],
  }
  for (const [regionId, filename] of Object.entries(V08_REGION_GUIDE_FILENAMES) as Array<[
    keyof typeof V08_REGION_GUIDE_FILENAMES, string,
  ]>) await writeMask(join(maskDirectory, filename), pointsByRegion[regionId])

  await writeFile(join(root, 'region-guides.json'), JSON.stringify({
    schemaVersion: 'qmonster-region-guide-v1',
    canvas: { width: 2048, height: 2048 },
    regions: {
      bodySurface: { sourcePath: 'master/masks/body-surface.png', equals: 'structureAlpha' },
      headSurface: { sourcePath: 'master/masks/head-surface.png', within: 'bodySurface' },
      faceSafeZone: { sourcePath: 'master/masks/face-safe-zone.png', within: 'headSurface' },
      eyesRegion: { sourcePath: 'master/masks/eyes-region.png', within: 'faceSafeZone' },
      mouthRegion: { sourcePath: 'master/masks/mouth-region.png', within: 'faceSafeZone' },
      oralRegion: { sourcePath: 'master/masks/oral-region.png', within: 'mouthRegion' },
      tailSurface: { sourcePath: 'master/masks/tail-surface.png', within: 'bodySurface' },
      frontPawDetail: { sourcePath: 'master/masks/front-paw-detail.png', within: 'bodySurface' },
      hindPawDetail: { sourcePath: 'master/masks/hind-paw-detail.png', within: 'bodySurface' },
      headAccessory: { sourcePath: 'master/masks/head-accessory.png', subtract: ['faceProtection'] },
      mutationEar: { sourcePath: 'master/masks/mutation-ear.png', subtract: ['faceProtection'] },
      mutationBack: { sourcePath: 'master/masks/mutation-back.png', subtract: ['faceProtection'] },
      mutationTailTip: { sourcePath: 'master/masks/mutation-tail-tip.png', subtract: ['faceProtection'] },
      effectField: { sourcePath: 'master/masks/effect-field.png' },
      faceProtection: { sourcePath: 'master/masks/face-protection.png', within: 'headSurface' },
    },
  }, null, 2))
  return { root, output }
}

describe('prepare v0.8 feline master', () => {
  it('normalizes the square raw master once without trimming and extracts green to alpha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v08-establish-'))
    temporaryRoots.push(root)
    const rawPath = join(root, 'raw.png')
    const outputPath = join(root, 'master.png')
    await sharp({ create: {
      width: 1024, height: 1024, channels: 4, background: '#00ff00ff',
    } }).composite([{
      input: { create: { width: 300, height: 500, channels: 4, background: '#aaaaaaff' } },
      left: 362, top: 262,
    }]).png().toFile(rawPath)

    await establishV08CanonicalMaster(rawPath, outputPath)
    const image = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(image.info).toMatchObject({ width: 2048, height: 2048, channels: 4 })
    expect(image.data[3]).toBe(0)
    expect(image.data[((1024 * 2048 + 1024) * 4) + 3]).toBeGreaterThan(0)
  })

  it('validates and packages the master plus exactly fifteen full-canvas masks', async () => {
    const { root, output } = await fixture()
    const prepared = await prepareV08FelineMaster({ sourceRoot: root, outputDirectory: output })

    expect(Object.keys(prepared.regions)).toHaveLength(15)
    expect(prepared.sourceMasterSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(prepared.structure.pngSha256).toMatch(/^[a-f0-9]{64}$/u)
    for (const resource of Object.values(prepared.regions)) {
      expect(await sharp(resource.pngPath).metadata()).toMatchObject({
        width: 2048, height: 2048, hasAlpha: true,
      })
      expect(resource.assetSha256).toMatch(/^[a-f0-9]{64}$/u)
    }
  }, 30_000)

  it('rejects a declared subset that leaks outside its parent region', async () => {
    const { root, output } = await fixture()
    await writeMask(join(root, 'master', 'masks', 'oral-region.png'), [[900, 900]])

    await expect(prepareV08FelineMaster({ sourceRoot: root, outputDirectory: output }))
      .rejects.toThrow(/V08_REGION_RELATION_INVALID:oralRegion:within:mouthRegion:1/u)
  }, 30_000)

  it('rejects intersecting front and hind paw masks', async () => {
    const { root, output } = await fixture()
    await writeMask(join(root, 'master', 'masks', 'hind-paw-detail.png'), [[110, 170], [170, 170]])

    await expect(prepareV08FelineMaster({ sourceRoot: root, outputDirectory: output }))
      .rejects.toThrow(/V08_REGION_DISJOINT_INVALID:frontPawDetail:hindPawDetail:1/u)
  }, 30_000)
})
