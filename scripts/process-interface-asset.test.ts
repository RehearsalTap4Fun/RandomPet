import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  const width = 2048
  const height = 2048
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

  it('routes encoded outputs through the supplied writer without touching formal paths', async () => {
    const input = await fixture(0.95)
    const captured = new Map<string, Buffer>()
    Object.assign(input, {
      writeOutput: async (path: string, bytes: Uint8Array) => { captured.set(path, Buffer.from(bytes)) },
    })

    const result = await processInterfaceAsset(input)

    expect(captured.get(input.outputPngPath)?.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(captured.get(input.outputWebpPath)?.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(result.pngSha256).toBe(createHash('sha256').update(captured.get(input.outputPngPath)!).digest('hex'))
    await expect(readFile(input.outputPngPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(input.outputWebpPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects non-binary foreground and background masks', async () => {
    const input = await fixture(0.95)
    const antialias = Buffer.from([255, 255, 255, 128])
    await sharp(antialias, { raw: { width: 1, height: 1, channels: 4 } })
      .resize(2048, 2048, { kernel: 'nearest' }).png().toFile(input.connectors[0]!.foregroundMaskPath)
    await expect(processInterfaceAsset(input)).rejects.toThrow('CONNECTOR_PROFILE_INVALID')
  })

  it('rejects identical incomplete foreground and background masks for a head plug', async () => {
    const input = await fixture(0.95)
    Object.assign(input.connectors[0]!, {
      role: 'plug',
      nodeLayer: 'head',
      origin: { x: 16, y: 16 },
      outwardNormal: { x: 0, y: 1 },
      depth: 8,
      faceSafeZones: [{ x: 0, y: 0, width: 8, height: 8 }],
    })

    await expect(processInterfaceAsset(input)).rejects.toThrow(
      'CONNECTOR_PROFILE_INVALID: neck foreground/background masks overlap',
    )
  })

  it('rejects a material sample region without opaque source pixels', async () => {
    const input = await fixture(0.95)
    input.materialSampleRegion = { x: 24, y: 24, width: 8, height: 8 }
    await expect(processInterfaceAsset(input)).rejects.toThrow('CONNECTOR_PROFILE_INVALID')
  })

  it('rejects compressed interface inputs above the explicit byte cap before decoding', async () => {
    const input = await fixture(0.95)
    await writeFile(input.sourcePath, Buffer.alloc(8 * 1024 * 1024 + 1))

    await expect(processInterfaceAsset(input)).rejects.toThrow(
      'CONNECTOR_PROFILE_INVALID: compressed image exceeds 8388608 bytes',
    )
  })

  it('rejects source and connector images that are not exactly 2048 by 2048', async () => {
    const input = await fixture(0.95)
    await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 120, g: 90, b: 70, alpha: 1 } },
    }).png().toFile(input.sourcePath)

    await expect(processInterfaceAsset(input)).rejects.toThrow(
      'CONNECTOR_PROFILE_INVALID: interface images must be exactly 2048 by 2048',
    )
  })
})
