import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  prepareV05LongTailAssets,
  V05_LONG_TAIL_IDS,
  V05_LONG_TAIL_RIG_IDS,
} from './prepare-v05-long-tail-assets.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function alphaPixels(path: string): Promise<number> {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { data, info } = decoded
  let count = 0
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * info.channels + 3]! > 0) count += 1
  }
  return count
}

describe('prepare v0.5 long-tail assets', () => {
  it('recovers six opaque checkerboard sources into transparent, single-component rig nodes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v05-long-tail-'))
    temporaryRoots.push(root)
    const sourceDirectory = join(root, 'source')
    await cp('asset-source/v0.5.0/generation/long-tail', sourceDirectory, { recursive: true })

    const assets = await prepareV05LongTailAssets({
      sourceDirectory,
      outputDirectory: join(root, 'output'),
    })

    expect(assets).toHaveLength(6)
    expect(assets.map(asset => `${asset.tailId}:${asset.rigId}`).sort()).toEqual(
      V05_LONG_TAIL_IDS.flatMap(tailId => V05_LONG_TAIL_RIG_IDS.map(rigId => `${tailId}:${rigId}`)).sort(),
    )

    for (const asset of assets) {
      expect(asset.connectedComponents).toBe(1)
      expect(await sharp(asset.previewPngPath).metadata()).toMatchObject({
        width: 1024,
        height: 1024,
        hasAlpha: true,
      })
      expect(await sharp(asset.nodePngPath).metadata()).toMatchObject({
        width: 2048,
        height: 2048,
        hasAlpha: true,
      })
      expect(await alphaPixels(asset.nodePngPath)).toBeGreaterThan(0)

      const [contour, foreground, background] = await Promise.all([
        alphaPixels(asset.connectorMaskPaths.contour),
        alphaPixels(asset.connectorMaskPaths.foreground),
        alphaPixels(asset.connectorMaskPaths.background),
      ])
      expect(contour).toBeGreaterThan(0)
      expect(foreground).toBeGreaterThan(0)
      expect(background).toBeGreaterThan(0)
      expect(foreground + background).toBe(contour)
    }
  }, 30_000)

  it('requires exactly the six named sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v05-long-tail-missing-'))
    temporaryRoots.push(root)
    await expect(prepareV05LongTailAssets({
      sourceDirectory: join(root, 'missing-source'),
      outputDirectory: join(root, 'output'),
    })).rejects.toThrow(/V05_LONG_TAIL_SOURCE_MISSING/u)
  })
})
