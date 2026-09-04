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
      expect(await alphaPixels(asset.runtimePngPath)).toBeGreaterThanOrEqual(0)
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
    const sourceDirectory = join(root, 'source')
    await cp('asset-source/v0.6.0/generation/feline', sourceDirectory, { recursive: true })
    await rm(join(sourceDirectory, V06_SOURCE_FILENAMES[0]))
    await writeFile(join(sourceDirectory, 'unexpected.png'), Buffer.from('unexpected'))

    await expect(prepareV06FelineAssets({ sourceDirectory, outputDirectory: join(root, 'output') }))
      .rejects.toThrow(/V06_FELINE_SOURCE_INVENTORY_INVALID/u)
  })

  it('rejects a disconnected structural source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v06-components-'))
    temporaryRoots.push(root)
    const sourceDirectory = join(root, 'source')
    await cp('asset-source/v0.6.0/generation/feline', sourceDirectory, { recursive: true })
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
  })
})
