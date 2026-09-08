import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import catalogDocument from '../catalog/v0.8.0/catalog.json'

const ROOT = process.cwd()
const ASSET_ROOT = resolve(ROOT, 'packages', 'asset-catalog')
const catalog = catalogDocument

interface AlphaImage {
  alpha: Uint8Array
  width: number
  height: number
}

async function readAlpha(assetPath: string): Promise<AlphaImage> {
  const decoded = await sharp(resolve(ASSET_ROOT, assetPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alpha = new Uint8Array(decoded.info.width * decoded.info.height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    alpha[pixel] = decoded.data[pixel * decoded.info.channels + 3]!
  }
  return { alpha, width: decoded.info.width, height: decoded.info.height }
}

function componentCentroids(image: AlphaImage): Array<{ x: number, y: number, pixels: number }> {
  const visited = new Uint8Array(image.alpha.length)
  const queue = new Int32Array(image.alpha.length)
  const components: Array<{ x: number, y: number, pixels: number }> = []
  for (let start = 0; start < image.alpha.length; start += 1) {
    if (visited[start] !== 0 || image.alpha[start]! < 128) continue
    let read = 0
    let written = 1
    let sumX = 0
    let sumY = 0
    visited[start] = 1
    queue[0] = start
    while (read < written) {
      const pixel = queue[read++]!
      const x = pixel % image.width
      const y = Math.floor(pixel / image.width)
      sumX += x
      sumY += y
      for (const candidate of [pixel - 1, pixel + 1, pixel - image.width, pixel + image.width]) {
        if (candidate < 0 || candidate >= image.alpha.length || visited[candidate] !== 0) continue
        const candidateX = candidate % image.width
        if (Math.abs(candidateX - x) > 1 || image.alpha[candidate]! < 128) continue
        visited[candidate] = 1
        queue[written++] = candidate
      }
    }
    if (written > 1_000) components.push({ x: sumX / written, y: sumY / written, pixels: written })
  }
  return components.sort((left, right) => left.x - right.x)
}

function overlapPixels(left: AlphaImage, right: AlphaImage): number {
  let overlap = 0
  for (let pixel = 0; pixel < left.alpha.length; pixel += 1) {
    if (left.alpha[pixel]! > 0 && right.alpha[pixel]! > 0) overlap += 1
  }
  return overlap
}

function partAsset(partId: string): string {
  const part = catalog.parts.find(candidate => candidate.id === partId)
  if (part === undefined) throw new Error(`Missing v0.8 part ${partId}`)
  return part.assetPath
}

describe('v0.8 feline visual coherence', () => {
  it('centers the fixed eye regions on the canonical master eye sockets', async () => {
    const eyeMask = await readAlpha(catalog.speciesRigs[0]!.regions.eyesRegion.assetPath)
    const centers = componentCentroids(eyeMask)

    expect(centers).toHaveLength(2)
    expect(centers[0]!.x).toBeGreaterThanOrEqual(790)
    expect(centers[0]!.x).toBeLessThanOrEqual(820)
    expect(centers[1]!.x).toBeGreaterThanOrEqual(1228)
    expect(centers[1]!.x).toBeLessThanOrEqual(1258)
    expect(centers.every(center => center.y >= 610 && center.y <= 650)).toBe(true)
  })

  it('keeps every wearable appendage physically attached to the cat silhouette', async () => {
    const structure = await readAlpha(catalog.anatomyBundles[0]!.structural.assetPath)
    const extras = catalog.parts.filter(part => (
      part.slotId === 'headAppendage' || part.slotId === 'extraAppendage'
    ))

    for (const part of extras) {
      const trait = await readAlpha(part.assetPath)
      expect(overlapPixels(trait, structure), part.id).toBeGreaterThan(500)
    }
  })

  it.each([
    ['effect_n_paw-glow', 'frontPawDetail'],
    ['effect_n_tail-spark', 'tailSurface'],
    ['effect_n_ear-glint', 'mutationEar'],
  ] as const)('anchors %s to its named body region', async (partId, regionId) => {
    const effect = await readAlpha(partAsset(partId))
    const region = await readAlpha(catalog.speciesRigs[0]!.regions[regionId].assetPath)

    expect(overlapPixels(effect, region)).toBeGreaterThan(20_000)
  })

  it('places floor sparks at the paw baseline instead of arbitrary floating positions', async () => {
    const effect = await readAlpha(partAsset('effect_n_floor-spark'))
    let baselinePixels = 0
    for (let pixel = 0; pixel < effect.alpha.length; pixel += 1) {
      if (effect.alpha[pixel]! > 0 && Math.floor(pixel / effect.width) >= 1850) baselinePixels += 1
    }

    expect(baselinePixels).toBeGreaterThan(10_000)
  })
})
