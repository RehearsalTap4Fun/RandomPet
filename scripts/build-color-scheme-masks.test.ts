import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { afterEach } from 'vitest'
import { buildColorSchemeRuntime, buildProductionColorSchemeMasks, deriveRigColorMasks } from './build-color-scheme-masks.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const value = pixel(x, y)
      data.set(value, offset)
    }
  }
  return data
}

async function png(width: number, height: number, data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

describe('rig-aware color-scheme mask derivation', () => {
  it('partitions the approved three-zone layout inside only the opaque rig body core', async () => {
    const width = 12
    const height = 12
    const source = await png(width, height, rgba(width, height, (x, y) => {
      if (x < 1 || x > 10 || y < 1 || y > 10) return [0, 0, 0, 0]
      if (x < 5) return [30, 80, 170, 255]
      if (y < 6) return [230, 220, 180, 255]
      return [235, 100, 70, 255]
    }))
    const rig = await png(width, height, rgba(width, height, (x, y) => {
      const inside = x >= 2 && x <= 9 && y >= 2 && y <= 9
      const edge = inside && (x === 2 || x === 9 || y === 2 || y === 9)
      return inside ? [90, 110, 130, edge ? 128 : 255] : [0, 0, 0, 0]
    }))

    const first = await deriveRigColorMasks(source, rig)
    const second = await deriveRigColorMasks(source, rig)
    const decoded = await Promise.all(
      [first.primary, first.secondary, first.accent].map(mask => sharp(mask).ensureAlpha().raw().toBuffer()),
    )

    expect(first.metrics).toMatchObject({
      width,
      height,
      rigOpaqueCorePixels: 36,
      maskUnionPixels: 36,
      outsideRigCorePixels: 0,
      overlappingMaskPixels: 0,
    })
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const alphas = decoded.map(mask => mask[pixel * 4 + 3] ?? 0)
      expect(alphas.filter(alpha => alpha > 0)).toHaveLength(
        pixel % width >= 3 && pixel % width <= 8 && Math.floor(pixel / width) >= 3 && Math.floor(pixel / width) <= 8 ? 1 : 0,
      )
    }
    expect(createHash('sha256').update(first.primary).digest('hex')).toBe(
      createHash('sha256').update(second.primary).digest('hex'),
    )
  })

  it('writes a transparent lighting layer plus hashed per-rig masks deterministically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-color-masks-'))
    temporaryDirectories.push(root)
    const sourcePath = join(root, 'source.png')
    const rigPath = join(root, 'rig.png')
    const runtimePngPath = join(root, 'parts', 'color_test.png')
    const runtimeWebpPath = join(root, 'parts', 'color_test.webp')
    const maskRoot = join(root, 'masks')
    await writeFile(sourcePath, await png(12, 12, rgba(12, 12, (x, y) => (
      x < 4 ? [40, 60, 160, 255] : y < 6 ? [220, 210, 170, 255] : [230, 90, 60, 255]
    ))))
    await writeFile(rigPath, await png(12, 12, rgba(12, 12, (x, y) => (
      x >= 1 && x <= 10 && y >= 1 && y <= 10 ? [80, 100, 120, 255] : [0, 0, 0, 0]
    ))))

    const first = await buildColorSchemeRuntime({
      sourceId: 'color_test', sourcePath, runtimePngPath, runtimeWebpPath, maskRoot,
      rigs: [{ rigId: 'blob', assetPath: rigPath }],
    })
    const second = await buildColorSchemeRuntime({
      sourceId: 'color_test', sourcePath, runtimePngPath, runtimeWebpPath, maskRoot,
      rigs: [{ rigId: 'blob', assetPath: rigPath }],
    })
    const runtime = await sharp(await readFile(runtimePngPath)).ensureAlpha().raw().toBuffer()

    expect(runtime.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true)
    expect(first.runtimePngSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.rigMasks.blob).toMatchObject({
      metrics: { outsideRigCorePixels: 0, overlappingMaskPixels: 0 },
      paths: {
        primary: expect.stringContaining('color_test/blob-primary.png'),
        secondary: expect.stringContaining('color_test/blob-secondary.png'),
        accent: expect.stringContaining('color_test/blob-accent.png'),
      },
    })
    expect(second).toEqual(first)
  })

  it('updates only declared color entries in the production index with replayable mask audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-production-color-masks-'))
    temporaryDirectories.push(root)
    const sourceRoot = join(root, 'source')
    const runtimeRoot = join(root, 'runtime')
    const indexPath = join(sourceRoot, 'generation', 'production-index.json')
    const source = await png(12, 12, rgba(12, 12, (x, y) => (
      x < 4 ? [40, 60, 160, 255] : y < 6 ? [220, 210, 170, 255] : [230, 90, 60, 255]
    )))
    const rig = await png(12, 12, rgba(12, 12, (x, y) => (
      x >= 1 && x <= 10 && y >= 1 && y <= 10 ? [80, 100, 120, 255] : [0, 0, 0, 0]
    )))
    await mkdir(join(sourceRoot, 'parts'), { recursive: true })
    await mkdir(join(sourceRoot, 'generation'), { recursive: true })
    await mkdir(join(runtimeRoot, 'rigs'), { recursive: true })
    await writeFile(join(sourceRoot, 'parts', 'color_test.png'), source)
    await writeFile(join(runtimeRoot, 'rigs', 'base_blob_v1.png'), rig)
    await writeFile(indexPath, `${JSON.stringify([
      { id: 'ordinary_part', pngSha256: 'unchanged' },
      { id: 'color_test', pngPath: 'old.png', pngSha256: 'old', webpPath: 'old.webp', webpSha256: 'old' },
    ])}\n`)

    await buildProductionColorSchemeMasks({
      sourceRoot,
      runtimeAssetRoot: runtimeRoot,
      productionIndexPath: indexPath,
      schemes: [{ sourceId: 'color_test', compatibleRigs: ['blob'] }],
    })
    const entries = JSON.parse(await readFile(indexPath, 'utf8')) as Array<Record<string, unknown>>

    expect(entries[0]).toEqual({ id: 'ordinary_part', pngSha256: 'unchanged' })
    expect(entries[1]).toMatchObject({
      postProcess: 'rig-aware-palette-masks-v1',
      paletteMaskAudit: {
        version: 'rig-aware-palette-masks-v1',
        rigMasks: { blob: { metrics: { outsideRigCorePixels: 0 } } },
      },
      pngSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      webpSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
  })
})
