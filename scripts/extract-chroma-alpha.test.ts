import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { extractChromaAlpha } from './extract-chroma-alpha.js'

const temporaryDirectories: string[] = []

interface FixtureOptions {
  backgroundBase?: [number, number, number]
  backgroundNoise?: number
  clipped?: boolean
  crisp?: boolean
  contaminatedBorder?: boolean
  subject?: [number, number, number]
  edgeTint?: [number, number, number]
  maximumAlpha?: number
}

async function makeFixture(path: string, options: FixtureOptions = {}): Promise<void> {
  const width = 96
  const height = 96
  const channels = 3
  const pixels = Buffer.alloc(width * height * channels)
  const centerX = options.clipped ? 12 : 48
  const centerY = 48
  const radius = 24
  const feather = options.crisp ? 0 : 3.5
  const foreground = options.subject ?? [188, 137, 212]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY)
      const rawAlpha = feather === 0
        ? (distance <= radius ? 1 : 0)
        : Math.max(0, Math.min(1, (radius + feather - distance) / (feather * 2)))
      const alpha = rawAlpha * (options.maximumAlpha ?? 1)
      const noise = ((x * 17 + y * 29) % 5) - 2
      const backgroundNoise = options.backgroundNoise ?? 0
      let key: [number, number, number] = options.backgroundBase ?? [0, 255, 0]
      if (backgroundNoise > 0) {
        const delta = ((x * 13 + y * 7) % (backgroundNoise * 2 + 1)) - backgroundNoise
        key = [
          Math.max(0, Math.min(255, key[0] + delta)),
          Math.max(0, Math.min(255, key[1] + delta)),
          Math.max(0, Math.min(255, key[2] - delta)),
        ]
      }
      if (options.contaminatedBorder && y < 8 && x > 24 && x < 72) key = [35, 205, 80]
      const offset = (y * width + x) * channels
      for (let channel = 0; channel < channels; channel += 1) {
        const edgeForeground = rawAlpha > 0 && rawAlpha < 0.65 && options.edgeTint !== undefined
          ? options.edgeTint
          : foreground
        const texturedForeground = Math.max(0, Math.min(255, edgeForeground[channel]! + noise))
        pixels[offset + channel] = Math.round(
          texturedForeground * alpha + key[channel]! * (1 - alpha),
        )
      }
    }
  }
  await sharp(pixels, { raw: { width, height, channels } }).png().toFile(path)
}

async function paths(): Promise<{ directory: string; sourcePath: string; outputPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'qmonster-chroma-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    sourcePath: join(directory, 'source.png'),
    outputPath: join(directory, 'output.png'),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('extractChromaAlpha', () => {
  it('deterministically preserves tactile soft alpha and decontaminates green edge color', async () => {
    const first = await paths()
    await makeFixture(first.sourcePath)

    const result = await extractChromaAlpha({
      sourcePath: first.sourcePath,
      outputPath: first.outputPath,
      safeBorderPixels: 8,
    })
    const secondOutput = join(first.directory, 'second.png')
    const repeated = await extractChromaAlpha({
      sourcePath: first.sourcePath,
      outputPath: secondOutput,
      safeBorderPixels: 8,
    })
    const { data, info } = await sharp(first.outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number): [number, number, number, number] => {
      const offset = (y * info.width + x) * 4
      return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!]
    }
    const softEdge = pixel(23, 48)

    expect(result.approved, JSON.stringify(result.metrics)).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.metrics.detectedKeyHex).toBe('#00ff00')
    expect(result.metrics.partialAlphaPixels).toBeGreaterThan(0)
    expect(result.metrics.safeBorderAlphaMax).toBe(0)
    expect(softEdge[3]).toBeGreaterThan(0)
    expect(softEdge[3]).toBeLessThan(255)
    expect(softEdge[1]).toBeLessThanOrEqual(Math.max(softEdge[0], softEdge[2]) + 2)
    expect(Math.hypot(softEdge[0] - 188, softEdge[1] - 137, softEdge[2] - 212)).toBeLessThan(30)
    expect(result.metrics.edgeFringeP95).toBeLessThanOrEqual(2)
    expect(result.metrics.edgeColorDeltaP95).toBeLessThanOrEqual(12)
    expect(result.metrics.edgeNearestDistanceP95).toBeLessThanOrEqual(16)
    expect(result.thresholds).toEqual({
      safeBorderPixels: 8,
      maxBackgroundP95Delta: 12,
      maxBorderContaminationRatio: 0.01,
      borderContaminationDelta: 24,
      minOpaquePixels: 46,
      minSubjectBackgroundDistanceP05: 80,
      maxSafeBorderForegroundPixels: 16,
      maxPartialAlphaRatio: 0.45,
      minPartialAlphaPixels: 16,
      maxEdgeFringeP95: 4,
      maxEdgeColorDeltaP95: 12,
      maxEdgeNearestDistanceP95: 32,
      maxEdgePixelsWithoutOpaqueCore: 0,
    })
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.processedSha256).toBe(repeated.processedSha256)
    expect(await readFile(first.outputPath)).toEqual(await readFile(secondOutput))
  })

  it('calibrates alpha to a near-key generated background without turning encoder variation translucent', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { backgroundBase: [6, 250, 5], backgroundNoise: 2 })

    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved, JSON.stringify(result.metrics)).toBe(true)
    expect(result.metrics.detectedKeyHex).toBe('#00ff00')
    expect(result.metrics.safeBorderAlphaMax).toBe(0)
    expect(result.metrics.partialAlphaRatio).toBeLessThan(0.45)
  })

  it('rejects a nonuniform chroma background', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { backgroundNoise: 24 })
    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_BACKGROUND_NONUNIFORM' }))
  })

  it('rejects a contaminated safe-border background', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { contaminatedBorder: true })
    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_BACKGROUND_CONTAMINATED' }))
  })

  it('rejects excessive subject-background chroma similarity', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { subject: [24, 214, 28] })
    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_SUBJECT_SIMILARITY' }))
  })

  it('rejects foreground alpha clipped into the safe border', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { clipped: true })
    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_SAFE_BORDER_CLIPPED' }))
  })

  it('rejects degraded hard edges without preserved partial alpha', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { crisp: true })
    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_EDGE_DEGRADED' }))
  })

  it('rejects a real colored fringe measured before edge-color propagation', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { edgeTint: [255, 220, 40] })

    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.metrics.edgeColorDeltaP95).toBeGreaterThan(12)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_EDGE_DEGRADED' }))
  })

  it('rejects partial-alpha subject pixels that have no inward opaque core', async () => {
    const fixture = await paths()
    await makeFixture(fixture.sourcePath, { maximumAlpha: 0.55 })

    const result = await extractChromaAlpha({ ...fixture, safeBorderPixels: 8 })

    expect(result.approved).toBe(false)
    expect(result.metrics.edgePixelsWithoutOpaqueCore).toBeGreaterThan(0)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHROMA_EDGE_NO_CORE' }))
  })
})
