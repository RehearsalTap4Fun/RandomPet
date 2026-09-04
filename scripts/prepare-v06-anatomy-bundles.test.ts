import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareAnatomyBundle, type AnatomyBundleSource } from './prepare-v06-anatomy-bundles.js'

const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function entry(sourcePath: string): AnatomyBundleSource {
  return {
    id: 'feline-sit-test', sourcePath,
    prompt: 'test prompt',
    faceSafeZone: { x: 680, y: 360, width: 680, height: 500 },
    featureSockets: { eyes: { x: 860, y: 590 }, mouth: { x: 1024, y: 750 } },
    mutationAnchors: { ear: { x: 600, y: 180, width: 260, height: 260 } },
    allowedTraitPools: { eyes: ['eyes_feline_round'] },
  }
}

async function connectedCat(path: string): Promise<void> {
  const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([
      { input: { create: { width: 860, height: 860, channels: 4, background: '#b58969ff' } }, left: 594, top: 260 },
      { input: { create: { width: 1040, height: 930, channels: 4, background: '#b58969ff' } }, left: 504, top: 900 },
      { input: { create: { width: 360, height: 180, channels: 4, background: '#b58969ff' } }, left: 1450, top: 1330 },
    ]).png().toBuffer()
  await writeFile(path, image)
}

describe('prepare v0.6 anatomy bundles', () => {
  it('rejects a broken two-island structure alpha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-anatomy-two-island-'))
    roots.push(root)
    const sourcePath = join(root, 'two-island.png')
    const source = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
      .composite([
        { input: { create: { width: 400, height: 400, channels: 4, background: '#ffffffff' } }, left: 300, top: 300 },
        { input: { create: { width: 400, height: 400, channels: 4, background: '#ffffffff' } }, left: 1300, top: 1300 },
      ]).png().toBuffer()
    await writeFile(sourcePath, source)
    await expect(prepareAnatomyBundle(entry(sourcePath), join(root, 'output')))
      .rejects.toThrow('ANATOMY_BUNDLE_STRUCTURE_NOT_CONNECTED')
  })

  it('derives alpha and clip resources from one full source alpha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-anatomy-derived-'))
    roots.push(root)
    const sourcePath = join(root, 'connected-cat.png')
    await connectedCat(sourcePath)
    const prepared = await prepareAnatomyBundle(entry(sourcePath), join(root, 'output'))
    expect(prepared.structural.pngSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(prepared.alpha.pngSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(prepared.clip.pngSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(prepared.alpha.pngSha256).not.toBe(prepared.clip.pngSha256)
    const [source, alpha, clip] = await Promise.all([
      sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(prepared.alpha.absolutePngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(prepared.clip.absolutePngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])
    const sourceAlpha = Buffer.alloc(source.info.width * source.info.height)
    const alphaAlpha = Buffer.alloc(sourceAlpha.length)
    let clipOutsideSource = 0
    for (let pixel = 0; pixel < sourceAlpha.length; pixel += 1) {
      sourceAlpha[pixel] = source.data[pixel * 4 + 3]!
      alphaAlpha[pixel] = alpha.data[pixel * 4 + 3]!
      if (clip.data[pixel * 4 + 3]! > 0 && sourceAlpha[pixel] === 0) clipOutsideSource += 1
    }
    expect(alphaAlpha.equals(sourceAlpha)).toBe(true)
    expect(clipOutsideSource).toBe(0)
  })
})
