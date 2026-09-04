import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareV06FelineAssets, V06_SOURCE_FILENAMES } from './prepare-v06-feline-assets.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function alphaPixels(path: string): Promise<number> {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel += 1) {
    if (decoded.data[pixel * decoded.info.channels + 3]! > 0) count += 1
  }
  return count
}

async function copyApprovedSources(root: string): Promise<string> {
  const sourceDirectory = join(root, 'source')
  await cp('asset-source/v0.6.0/generation/feline', sourceDirectory, { recursive: true })
  return sourceDirectory
}

describe('prepare v0.6 feline assets', () => {
  it('stages the exact transparent source inventory with structural connector masks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-feline-'))
    temporaryRoots.push(root)
    const assets = await prepareV06FelineAssets({
      sourceDirectory: 'asset-source/v0.6.0/generation/feline',
      outputDirectory: join(root, 'assets'),
    })

    expect(assets.map(asset => asset.sourceFilename).sort()).toEqual([...V06_SOURCE_FILENAMES].sort())
    expect(assets).toHaveLength(22)
    for (const asset of assets) {
      expect(await sharp(asset.runtimePngPath).metadata()).toMatchObject({ width: 2048, height: 2048, hasAlpha: true })
      const isIntentionalEmptyLayer = ['oral_feline_none', 'effect_feline_none'].includes(asset.partId)
      if (isIntentionalEmptyLayer) expect(await alphaPixels(asset.runtimePngPath)).toBe(0)
      else expect(await alphaPixels(asset.runtimePngPath)).toBeGreaterThan(0)
      expect(asset.sourceSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(asset.runtimePngSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(asset.runtimeWebpSha256).toMatch(/^[a-f0-9]{64}$/u)
    }
    for (const asset of assets.filter(candidate => candidate.connectorMasks.length > 0)) {
      expect(asset.connectedComponents).toBe(1)
      for (const connector of asset.connectorMasks) {
        expect(await alphaPixels(connector.contourPath)).toBeGreaterThan(0)
        expect(await alphaPixels(connector.foregroundPath)).toBeGreaterThan(0)
        expect(await alphaPixels(connector.backgroundPath)).toBeGreaterThan(0)
      }
    }
    expect(assets.filter(asset => ['surface', 'pattern', 'palette'].includes(asset.category))
      .every(asset => asset.outsideFelineMaskPixels === 0)).toBe(true)
  }, 60_000)

  it('rejects a missing or additional source before writing output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-inventory-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    await rm(join(sourceDirectory, V06_SOURCE_FILENAMES[0]))
    await writeFile(join(sourceDirectory, 'unexpected.png'), Buffer.from('unexpected'))

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_SOURCE_INVENTORY_INVALID/u)
  }, 30_000)

  it('rejects a disconnected structural source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-components-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const disconnected = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
      .composite([
        { input: { create: { width: 400, height: 400, channels: 4, background: '#ffffffff' } }, left: 300, top: 700 },
        { input: { create: { width: 400, height: 400, channels: 4, background: '#ffffffff' } }, left: 1300, top: 700 },
      ])
      .png()
      .toBuffer()
    await writeFile(join(sourceDirectory, 'tail_feline_long-source.png'), disconnected)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_COMPONENT_COUNT_INVALID/u)
  }, 30_000)

  it('rejects an opaque RGB source instead of manufacturing alpha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-opaque-rgb-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const opaque = await sharp({
      create: { width: 2048, height: 2048, channels: 3, background: { r: 80, g: 120, b: 160 } },
    }).png().toBuffer()
    await writeFile(join(sourceDirectory, 'eyes_feline_round-source.png'), opaque)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_SOURCE_ALPHA_INVALID:eyes_feline_round-source\.png/u)
  }, 30_000)

  it('rejects a fully empty visible source layer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-empty-visible-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const empty = await sharp({
      create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
    }).png().toBuffer()
    await writeFile(join(sourceDirectory, 'eyes_feline_round-source.png'), empty)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_VISIBLE_LAYER_ALPHA_EMPTY:eyes_feline_round-source\.png/u)
  }, 30_000)

  it('rejects a detached faint structural fragment with meaningful coverage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-faint-fragment-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const fragment = await sharp(join(sourceDirectory, 'tail_feline_long-source.png'))
      .ensureAlpha()
      .composite([{
        input: { create: { width: 12, height: 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.3 } } },
        left: 8,
        top: 8,
      }])
      .png()
      .toBuffer()
    await writeFile(join(sourceDirectory, 'tail_feline_long-source.png'), fragment)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_COMPONENT_COUNT_INVALID:tail_feline_long-source\.png/u)
  }, 30_000)

  it('rejects a structural source without its required tailRoot guide region', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-guide-region-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const noTailRootGuide = await sharp({
      create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
    })
      .composite([{
        input: { create: { width: 420, height: 420, channels: 4, background: '#ffffffff' } },
        left: 800,
        top: 700,
      }])
      .png()
      .toBuffer()
    await writeFile(join(sourceDirectory, 'tail_feline_long-source.png'), noTailRootGuide)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_CONNECTOR_GUIDE_EMPTY:tail_feline_long:tailRoot/u)
  }, 30_000)

  it('rejects a surface resource with visible pixels outside the feline structural mask', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-mask-overflow-'))
    temporaryRoots.push(root)
    const sourceDirectory = await copyApprovedSources(root)
    const overflow = await sharp(join(sourceDirectory, 'pattern_feline_tabby-source.png'))
      .ensureAlpha()
      .composite([{
        input: { create: { width: 8, height: 8, channels: 4, background: '#ff0000ff' } },
        left: 2040,
        top: 2040,
      }])
      .png()
      .toBuffer()
    await writeFile(join(sourceDirectory, 'pattern_feline_tabby-source.png'), overflow)

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_MASK_CONTAINMENT_INVALID:pattern_feline_tabby-source\.png/u)
  }, 30_000)
})
