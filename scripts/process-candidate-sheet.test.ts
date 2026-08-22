import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeAlignedMaster, normalizeBilateralMaster } from './process-candidate-sheet.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('aligned master normalization', () => {
  it('preserves full-canvas socket-relative position while enforcing a 96px safe border', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qmonster-aligned-master-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'source.png')
    const masterPath = join(directory, 'master.png')
    await sharp({ create: { width: 200, height: 200, channels: 4, background: '#00000000' } })
      .composite([{ input: Buffer.from('<svg width="20" height="20"><rect width="20" height="20" fill="#ff3366"/></svg>'), left: 20, top: 50 }])
      .png()
      .toFile(sourcePath)

    const result = await normalizeAlignedMaster({ rgbaPath: sourcePath, masterPath })
    const { data, info } = await sharp(masterPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let xTotal = 0
    let yTotal = 0
    let count = 0
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] === 0) continue
        xTotal += x
        yTotal += y
        count += 1
      }
    }

    expect(result).toMatchObject({ width: 2048, height: 2048, hasAlpha: true, boundaryAlphaPixels: 0 })
    const expectedX = 96 + (29.5 + 0.5) / 200 * 1856 - 0.5
    const expectedY = 96 + (59.5 + 0.5) / 200 * 1856 - 0.5
    expect(Math.abs(xTotal / count - expectedX)).toBeLessThan(2)
    expect(Math.abs(yTotal / count - expectedY)).toBeLessThan(2)
  })

  it('assembles a generated single-side design into a symmetric bilateral master with a clear center gap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qmonster-bilateral-master-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'single-fin.png')
    const masterPath = join(directory, 'paired-fin.png')
    await sharp({ create: { width: 200, height: 200, channels: 4, background: '#00000000' } })
      .composite([{ input: Buffer.from('<svg width="45" height="100"><path d="M45 0H20Q0 50 20 100H45Z" fill="#aa77dd"/></svg>'), left: 15, top: 50 }])
      .png()
      .toFile(sourcePath)

    const result = await normalizeBilateralMaster({ rgbaPath: sourcePath, masterPath })
    const alpha = await sharp(masterPath).extractChannel('alpha').raw().toBuffer()
    const count = (from: number, to: number) => {
      let total = 0
      for (let y = 0; y < 2048; y += 1) for (let x = from; x < to; x += 1) if (alpha[y * 2048 + x] !== 0) total += 1
      return total
    }
    const left = count(0, 900)
    const middle = count(900, 1148)
    const right = count(1148, 2048)

    expect(result).toMatchObject({ width: 2048, height: 2048, hasAlpha: true, boundaryAlphaPixels: 0 })
    expect(left).toBeGreaterThan(10_000)
    expect(right).toBe(left)
    expect(middle).toBe(0)
  })
})
