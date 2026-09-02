import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareV04SingleFaceAssets, type V04ReplacementInput } from './prepare-v04-single-face-assets.js'

const REQUIRED_IDS = [
  'surface_soft_scales',
  'pattern_gentle_stripes',
  'effect_bioluminescent_orbs',
] as const

const roots: string[] = []
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

type FixtureKind = 'valid' | 'opaque' | 'empty' | 'checkerboard'

async function rgbaFixture(path: string, kind: FixtureKind = 'valid'): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (kind === 'checkerboard') {
    const width = 48
    const height = 32
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const matte = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) ? 240 : 252
      const foreground = x >= 14 && x < 34 && y >= 10 && y < 22
      pixels[offset] = foreground ? 120 : matte
      pixels[offset + 1] = foreground ? 60 : matte
      pixels[offset + 2] = foreground ? 180 : matte
      pixels[offset + 3] = 255
    }
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(path)
    return
  }
  if (kind === 'opaque') {
    await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 90, g: 140, b: 190, alpha: 1 } } })
      .png().toFile(path)
    return
  }
  const alpha = kind === 'empty' ? 0 : 1
  const subject = await sharp({ create: { width: 20, height: 12, channels: 4, background: { r: 90, g: 140, b: 190, alpha } } })
    .png().toBuffer()
  await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: subject, left: 14, top: 10 }]).png().toFile(path)
}

async function fixtureSet(overrides: Partial<Record<typeof REQUIRED_IDS[number], FixtureKind>> = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-v04-assets-'))
  roots.push(repositoryRoot)
  const inputs: V04ReplacementInput[] = []
  for (const partId of REQUIRED_IDS) {
    const generatedPath = join(repositoryRoot, 'asset-source', 'v0.4.0', 'generation', 'single-face', `${partId}-generated.png`)
    const referencedV03Path = join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.3.0', 'parts', `${partId}.png`)
    await rgbaFixture(generatedPath, overrides[partId])
    await rgbaFixture(referencedV03Path)
    inputs.push({ partId, generatedPath, prompt: `prompt:${partId}`, referencedV03Path })
  }
  return { repositoryRoot, inputs }
}

function runtimePath(root: string, partId: string, extension: 'png' | 'webp'): string {
  return join(root, 'asset-source', 'v0.4.0', 'runtime-staging', 'parts', `${partId}.${extension}`)
}

async function expectNoOutputs(root: string): Promise<void> {
  await expect(readFile(join(root, 'asset-source', 'v0.4.0', 'runtime-staging', 'parts', 'provenance.json')))
    .rejects.toMatchObject({ code: 'ENOENT' })
  for (const partId of REQUIRED_IDS) {
    await expect(readFile(join(root, 'asset-source', 'v0.4.0', 'recovered', 'single-face', `${partId}-recovered.png`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'asset-source', 'v0.4.0', 'parts', `${partId}.png`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(runtimePath(root, partId, 'png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(runtimePath(root, partId, 'webp'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

describe('prepareV04SingleFaceAssets', () => {
  it('normalizes the exact three inputs into deterministic transparent masters and runtimes', async () => {
    const { repositoryRoot, inputs } = await fixtureSet()

    const result = await prepareV04SingleFaceAssets(inputs, { repositoryRoot })

    expect(result.assets.map(item => item.partId)).toEqual([
      'surface_soft_scales',
      'pattern_gentle_stripes',
      'effect_bioluminescent_orbs',
    ])
    for (const asset of result.assets) {
      const masterPng = join(repositoryRoot, 'asset-source', 'v0.4.0', 'parts', `${asset.partId}.png`)
      const runtimePng = runtimePath(repositoryRoot, asset.partId, 'png')
      const runtimeWebp = runtimePath(repositoryRoot, asset.partId, 'webp')
      expect(await sharp(await readFile(masterPng)).metadata()).toMatchObject({ width: 2048, height: 2048, hasAlpha: true })
      expect(await sharp(await readFile(runtimePng)).metadata()).toMatchObject({ width: 1024, height: 1024, hasAlpha: true })
      expect(await sharp(await readFile(runtimeWebp)).metadata()).toMatchObject({ width: 1024, height: 1024, hasAlpha: true })
      expect(asset.pngSha256).toBe(hash(await readFile(runtimePng)))
      expect(asset.webpSha256).toBe(hash(await readFile(runtimeWebp)))
    }
    const provenance = JSON.parse(await readFile(join(repositoryRoot, 'asset-source', 'v0.4.0', 'runtime-staging', 'parts', 'provenance.json'), 'utf8'))
    expect(provenance.assets.map((item: { partId: string }) => item.partId)).toEqual([...REQUIRED_IDS])
    expect(provenance.assets.map((item: { prompt: string }) => item.prompt)).toEqual(inputs.map(item => item.prompt))
  })

  it.each([
    ['duplicate', (inputs: V04ReplacementInput[]) => [inputs[0]!, inputs[0]!, inputs[2]!]],
    ['missing', (inputs: V04ReplacementInput[]) => inputs.slice(0, 2)],
  ])('rejects %s IDs before committing any output', async (_name, change) => {
    const { repositoryRoot, inputs } = await fixtureSet()
    await expect(prepareV04SingleFaceAssets(change(inputs), { repositoryRoot })).rejects.toThrow(/exact|duplicate|missing/iu)
    await expectNoOutputs(repositoryRoot)
  })

  it.each([
    ['opaque background', 'opaque'],
    ['empty alpha', 'empty'],
  ] as const)('rejects %s before committing any output', async (_name, kind) => {
    const { repositoryRoot, inputs } = await fixtureSet({ pattern_gentle_stripes: kind })
    await expect(prepareV04SingleFaceAssets(inputs, { repositoryRoot })).rejects.toThrow(/alpha|transparent border/iu)
    await expectNoOutputs(repositoryRoot)
  })

  it('rejects unsafe input paths before committing any output', async () => {
    const { repositoryRoot, inputs } = await fixtureSet()
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-v04-outside-'))
    roots.push(outside)
    const outsidePath = join(outside, 'surface_soft_scales-generated.png')
    await rgbaFixture(outsidePath)
    inputs[0] = { ...inputs[0]!, generatedPath: outsidePath }

    await expect(prepareV04SingleFaceAssets(inputs, { repositoryRoot })).rejects.toThrow(/escape|path|expected/iu)
    await expectNoOutputs(repositoryRoot)
  })

  it('never writes to or creates the final assets/v0.3.0 tree', async () => {
    const { repositoryRoot, inputs } = await fixtureSet()
    const protectedPath = join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.3.0', 'parts', 'surface_soft_scales.png')
    const before = hash(await readFile(protectedPath))

    await prepareV04SingleFaceAssets(inputs, { repositoryRoot })

    expect(hash(await readFile(protectedPath))).toBe(before)
    await expect(readFile(join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.4.0', 'parts', 'surface_soft_scales.png')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers only an explicitly authorized border-connected near-neutral checkerboard without mutating raw bytes', async () => {
    const { repositoryRoot, inputs } = await fixtureSet({ pattern_gentle_stripes: 'checkerboard' })
    const rawPath = inputs[1]!.generatedPath
    const rawBefore = await readFile(rawPath)

    const result = await prepareV04SingleFaceAssets(inputs, {
      repositoryRoot,
      recoverBorderConnectedNearNeutralCheckerboard: true,
    })

    expect(await readFile(rawPath)).toEqual(rawBefore)
    expect(result.assets).toHaveLength(3)
    const recoveredPath = join(repositoryRoot, 'asset-source', 'v0.4.0', 'recovered', 'single-face', 'pattern_gentle_stripes-recovered.png')
    const recovered = await sharp(await readFile(recoveredPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let foregroundPixels = 0
    let borderAlphaPixels = 0
    for (let y = 0; y < recovered.info.height; y += 1) for (let x = 0; x < recovered.info.width; x += 1) {
      const alpha = recovered.data[(y * recovered.info.width + x) * 4 + 3]!
      if (alpha > 0) foregroundPixels += 1
      if (alpha > 0 && (x === 0 || y === 0 || x === recovered.info.width - 1 || y === recovered.info.height - 1)) borderAlphaPixels += 1
    }
    expect(foregroundPixels).toBe(240)
    expect(borderAlphaPixels).toBe(0)
  })

  it('produces a deterministic recovered hash and complete recovery provenance on repeat', async () => {
    const { repositoryRoot, inputs } = await fixtureSet({ surface_soft_scales: 'checkerboard' })
    const options = { repositoryRoot, recoverBorderConnectedNearNeutralCheckerboard: true as const }

    await prepareV04SingleFaceAssets(inputs, options)
    const provenancePath = join(repositoryRoot, 'asset-source', 'v0.4.0', 'runtime-staging', 'parts', 'provenance.json')
    const first = JSON.parse(await readFile(provenancePath, 'utf8'))
    await prepareV04SingleFaceAssets(inputs, options)
    const second = JSON.parse(await readFile(provenancePath, 'utf8'))
    const firstRecovery = first.assets[0].recovery
    const secondRecovery = second.assets[0].recovery

    expect(secondRecovery.recoveredPngSha256).toBe(firstRecovery.recoveredPngSha256)
    expect(firstRecovery).toMatchObject({
      method: 'border-connected-near-neutral-checkerboard-v1',
      sourceSha256: hash(await readFile(inputs[0]!.generatedPath)),
      parameters: {
        minimumChannel: 225,
        maximumChannelSpread: 12,
        connectivity: 4,
        minimumBorderLuminanceRange: 6,
      },
      evidence: { borderAlphaPixels: 0, retainedForegroundPixels: 240 },
    })
  })

  it('rejects opaque inputs whose border is not the authorized connected near-neutral matte', async () => {
    const { repositoryRoot, inputs } = await fixtureSet({ effect_bioluminescent_orbs: 'opaque' })

    await expect(prepareV04SingleFaceAssets(inputs, {
      repositoryRoot,
      recoverBorderConnectedNearNeutralCheckerboard: true,
    })).rejects.toThrow(/near-neutral|checkerboard|matte/iu)
    await expectNoOutputs(repositoryRoot)
  })

  it('objectively recovers all three preserved real one-shot files', async () => {
    const liveRoot = process.cwd()
    const { repositoryRoot, inputs } = await fixtureSet()
    const rawHashes = new Map<string, string>()
    for (const input of inputs) {
      const raw = await readFile(join(liveRoot, 'asset-source', 'v0.4.0', 'generation', 'single-face', `${input.partId}-generated.png`))
      await writeFile(input.generatedPath, raw)
      rawHashes.set(input.partId, hash(raw))
    }

    await prepareV04SingleFaceAssets(inputs, {
      repositoryRoot,
      recoverBorderConnectedNearNeutralCheckerboard: true,
    })

    const provenance = JSON.parse(await readFile(join(repositoryRoot, 'asset-source', 'v0.4.0', 'runtime-staging', 'parts', 'provenance.json'), 'utf8'))
    expect(provenance.assets.map((item: { recovery: { method: string } }) => item.recovery.method)).toEqual([
      'border-connected-near-neutral-checkerboard-v1',
      'border-connected-near-neutral-checkerboard-v1',
      'border-connected-near-neutral-checkerboard-v1',
    ])
    for (const [index, input] of inputs.entries()) {
      expect(hash(await readFile(input.generatedPath))).toBe(rawHashes.get(input.partId))
      expect(provenance.assets[index].recovery).toMatchObject({
        sourceSha256: rawHashes.get(input.partId),
        evidence: { borderAlphaPixels: 0 },
      })
      expect(provenance.assets[index].recovery.evidence.retainedForegroundPixels).toBeGreaterThan(0)
    }
  }, 20_000)
})
