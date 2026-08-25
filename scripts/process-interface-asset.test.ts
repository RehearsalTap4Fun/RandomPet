import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { processInterfaceAsset } from './process-interface-asset.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture(coverage: number) {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-asset-'))
  roots.push(root)
  const width = 32
  const height = 32
  const source = Buffer.alloc(width * height * 4)
  const mask = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const masked = pixel < 100
    mask[pixel * 4 + 3] = masked ? 255 : 0
    source[pixel * 4] = 120
    source[pixel * 4 + 1] = 90
    source[pixel * 4 + 2] = 70
    source[pixel * 4 + 3] = masked && pixel < Math.floor(100 * coverage) ? 255 : 0
  }
  const sourcePath = join(root, 'source.png')
  const contourMaskPath = join(root, 'contour.png')
  const foregroundMaskPath = join(root, 'foreground.png')
  const backgroundMaskPath = join(root, 'background.png')
  await sharp(source, { raw: { width, height, channels: 4 } }).png().toFile(sourcePath)
  for (const path of [contourMaskPath, foregroundMaskPath, backgroundMaskPath]) {
    await sharp(mask, { raw: { width, height, channels: 4 } }).png().toFile(path)
  }
  return {
    sourcePath,
    outputPngPath: join(root, 'runtime', 'asset.png'),
    outputWebpPath: join(root, 'runtime', 'asset.webp'),
    connectors: [{ id: 'neck', contourMaskPath, foregroundMaskPath, backgroundMaskPath }],
    materialSampleRegion: { x: 0, y: 0, width: 8, height: 8 },
  }
}

describe('processInterfaceAsset', () => {
  it('rejects a plug whose opaque connector coverage is below ninety percent', async () => {
    await expect(processInterfaceAsset(await fixture(0.89))).rejects.toThrow('CONNECTOR_PROFILE_INVALID')
  })

  it('writes deterministic PNG/WebP bytes and hashes every real connector resource', async () => {
    const result = await processInterfaceAsset(await fixture(0.95))
    expect(result.connectorCoverage.neck).toBe(0.95)
    expect(result.pngSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.webpSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.connectorHashes.neck).toEqual({
      contourMaskSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      foregroundMaskSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      backgroundMaskSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('rejects non-binary foreground and background masks', async () => {
    const input = await fixture(0.95)
    const antialias = Buffer.from([255, 255, 255, 128])
    await sharp(antialias, { raw: { width: 1, height: 1, channels: 4 } })
      .resize(32, 32, { kernel: 'nearest' }).png().toFile(input.connectors[0]!.foregroundMaskPath)
    await expect(processInterfaceAsset(input)).rejects.toThrow('CONNECTOR_PROFILE_INVALID')
  })

  it('rejects a material sample region without opaque source pixels', async () => {
    const input = await fixture(0.95)
    input.materialSampleRegion = { x: 24, y: 24, width: 8, height: 8 }
    await expect(processInterfaceAsset(input)).rejects.toThrow('CONNECTOR_PROFILE_INVALID')
  })
})
