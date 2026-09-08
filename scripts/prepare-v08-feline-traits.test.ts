import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { validateV08RasterContract } from '../packages/asset-catalog/src/v08-raster-contract.js'
import { buildCompleteV08Inventory } from './assemble-v08-catalog.js'
import { renderV08TraitSource } from './prepare-v08-feline-traits.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('prepare v0.8 feline trait sources', () => {
  it('writes a full-canvas trait inside its exact owner mask and permits only explicit none to be empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-v08-trait-'))
    temporaryRoots.push(root)
    const maskPath = join(root, 'mask.png')
    const pixels = Buffer.alloc(2048 * 2048 * 4)
    for (let y = 500; y < 700; y += 1) for (let x = 500; x < 700; x += 1) {
      const offset = (y * 2048 + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = 255
    }
    await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toFile(maskPath)
    const inventory = buildCompleteV08Inventory('a'.repeat(64))
    const eyes = inventory.traits.find(trait => trait.id === 'eyes_n_amber')!
    const effectNone = inventory.traits.find(trait => trait.id === 'effect_n_none')!
    const eyesPath = join(root, 'eyes.png')
    const nonePath = join(root, 'none.png')

    await renderV08TraitSource(eyes, maskPath, eyesPath)
    await renderV08TraitSource(effectNone, maskPath, nonePath)

    expect(await validateV08RasterContract({
      sourcePath: eyesPath, role: 'trait', ownerMaskPath: maskPath,
    })).toEqual([])
    expect(await validateV08RasterContract({
      sourcePath: nonePath, role: 'trait', ownerMaskPath: maskPath, allowEmpty: true,
    })).toEqual([])
  }, 30_000)
})
