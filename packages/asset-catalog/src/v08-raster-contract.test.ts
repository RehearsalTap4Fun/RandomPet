import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { validateV08RasterContract } from './v08-raster-contract.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'qmonster-v08-raster-'))
  temporaryRoots.push(path)
  return path
}

async function writeSparseAlpha(
  path: string,
  points: readonly (readonly [number, number])[],
  size = 2048,
): Promise<void> {
  await sharp({ create: {
    width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
  } }).composite(points.map(([x, y]) => ({
    input: { create: { width: 1, height: 1, channels: 4, background: '#ffffffff' } },
    left: x,
    top: y,
  }))).png().toFile(path)
}

describe('v0.8 raster contract', () => {
  it('rejects a source whose dimensions changed through trimming', async () => {
    const directory = await root()
    const sourcePath = join(directory, 'trait.png')
    const ownerMaskPath = join(directory, 'mask.png')
    await sharp({ create: {
      width: 1200, height: 1500, channels: 4, background: '#ffffffff',
    } }).png().toFile(sourcePath)
    await writeSparseAlpha(ownerMaskPath, [[100, 100]])

    expect(await validateV08RasterContract({ sourcePath, role: 'trait', ownerMaskPath }))
      .toContainEqual(expect.objectContaining({ code: 'V08_CANVAS_SIZE_INVALID' }))
  })

  it('rejects visible trait alpha outside its owner mask', async () => {
    const directory = await root()
    const sourcePath = join(directory, 'trait.png')
    const ownerMaskPath = join(directory, 'mask.png')
    await writeSparseAlpha(sourcePath, [[100, 100], [1800, 1800]])
    await writeSparseAlpha(ownerMaskPath, [[100, 100]])

    expect(await validateV08RasterContract({ sourcePath, role: 'trait', ownerMaskPath }))
      .toContainEqual(expect.objectContaining({
        code: 'V08_OWNER_MASK_LEAK', message: expect.stringContaining('1 pixel'),
      }))
  })

  it('requires one dominant eight-neighbour structural alpha component', async () => {
    const directory = await root()
    const sourcePath = join(directory, 'structure.png')
    await sharp({ create: {
      width: 2048, height: 2048, channels: 4, background: '#00000000',
    } }).composite([
      { input: { create: { width: 64, height: 64, channels: 4, background: '#ffffffff' } }, left: 100, top: 100 },
      { input: { create: { width: 64, height: 64, channels: 4, background: '#ffffffff' } }, left: 1800, top: 1800 },
    ]).png().toFile(sourcePath)

    expect(await validateV08RasterContract({ sourcePath, role: 'structure' }))
      .toContainEqual(expect.objectContaining({ code: 'V08_STRUCTURE_DISCONNECTED' }))
  })

  it('rejects opaque RGB input instead of manufacturing alpha', async () => {
    const directory = await root()
    const sourcePath = join(directory, 'opaque.png')
    await sharp({ create: {
      width: 2048, height: 2048, channels: 3, background: '#ffffffff',
    } }).png().toFile(sourcePath)

    expect(await validateV08RasterContract({ sourcePath, role: 'structure' }))
      .toContainEqual(expect.objectContaining({ code: 'V08_ALPHA_CHANNEL_MISSING' }))
  })

  it('accepts one connected structure and a fully contained trait', async () => {
    const directory = await root()
    const structurePath = join(directory, 'structure.png')
    const traitPath = join(directory, 'trait.png')
    const ownerMaskPath = join(directory, 'mask.png')
    await writeSparseAlpha(structurePath, [[100, 100], [101, 101]])
    await writeSparseAlpha(traitPath, [[100, 100]])
    await writeSparseAlpha(ownerMaskPath, [[100, 100], [101, 101]])

    expect(await validateV08RasterContract({ sourcePath: structurePath, role: 'structure' })).toEqual([])
    expect(await validateV08RasterContract({ sourcePath: traitPath, role: 'trait', ownerMaskPath })).toEqual([])
  })
})
