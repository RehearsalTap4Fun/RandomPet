import { mkdir, mkdtemp, readdir, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { splitPairedPart, type PairCrop } from './split-paired-part.js'

const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

const temporaryDirectories: string[] = []
const junctions: string[] = []

afterEach(async () => {
  await Promise.all(junctions.splice(0).map(path => unlink(path).catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function allowedOutputRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), 'packages', 'asset-catalog', 'assets', 'v0.2.0', prefix))
  temporaryDirectories.push(root)
  return root
}

async function makeFixture(root: string): Promise<string> {
  const path = join(root, 'paired.png')
  const left = await sharp({
    create: { width: 2, height: 3, channels: 4, background: '#ff8844ff' },
  }).png(PNG_OPTIONS).toBuffer()
  const right = await sharp({
    create: { width: 2, height: 3, channels: 4, background: '#6688ffff' },
  }).png(PNG_OPTIONS).toBuffer()
  await sharp({
    create: { width: 8, height: 6, channels: 4, background: '#00000000' },
  }).composite([
    { input: left, left: 1, top: 1 },
    { input: right, left: 5, top: 2 },
  ]).png(PNG_OPTIONS).toFile(path)
  return path
}

const CROPS: readonly [PairCrop, PairCrop] = [
  {
    id: 'left',
    rect: { left: 0, top: 0, width: 4, height: 6 },
    anchor: { x: 2, y: 3 },
    mirrorX: false,
  },
  {
    id: 'right',
    rect: { left: 4, top: 0, width: 4, height: 6 },
    anchor: { x: 5, y: 3 },
    mirrorX: true,
  },
]

describe('splitPairedPart', () => {
  it('rejects an out-of-bounds crop before creating output files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-pair-'))
    temporaryDirectories.push(root)
    const inputPath = await makeFixture(root)
    const outputParent = await allowedOutputRoot('split-out-of-bounds-')
    const outputDirectory = join(outputParent, 'split-output')
    const invalid = [
      CROPS[0],
      { ...CROPS[1], rect: { left: 7, top: 0, width: 2, height: 6 } },
    ] as const

    await expect(splitPairedPart(inputPath, outputDirectory, invalid))
      .rejects.toThrow('outside input bounds')
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('trims transparent margins while preserving source-canvas anchor coordinates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-pair-'))
    temporaryDirectories.push(root)
    const inputPath = await makeFixture(root)
    const outputDirectory = await allowedOutputRoot('split-trim-')

    const [left, right] = await splitPairedPart(inputPath, outputDirectory, CROPS)

    expect(left).toMatchObject({
      id: 'left', width: 2, height: 3, origin: { x: 1, y: 2 }, mirrorX: false,
    })
    expect(right).toMatchObject({
      id: 'right', width: 2, height: 3, origin: { x: 0, y: 1 }, mirrorX: true,
    })
    await expect(sharp(left.pngPath).metadata()).resolves.toMatchObject({ width: 2, height: 3, hasAlpha: true })
    await expect(sharp(right.pngPath).metadata()).resolves.toMatchObject({ width: 2, height: 3, hasAlpha: true })
  })

  it('reruns deterministically for decoded RGBA and node metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-pair-'))
    temporaryDirectories.push(root)
    const inputPath = await makeFixture(root)
    const outputDirectory = await allowedOutputRoot('split-deterministic-')

    const first = await splitPairedPart(inputPath, outputDirectory, CROPS)
    const firstPixels = await Promise.all(first.map(node => sharp(node.pngPath).ensureAlpha().raw().toBuffer()))
    const second = await splitPairedPart(inputPath, outputDirectory, CROPS)
    const secondPixels = await Promise.all(second.map(node => sharp(node.pngPath).ensureAlpha().raw().toBuffer()))

    expect(second).toEqual(first)
    expect(secondPixels).toEqual(firstPixels)
  })

  it('rejects an absolute lookalike path containing the allowed directory names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-pair-lookalike-'))
    temporaryDirectories.push(root)
    const inputPath = await makeFixture(root)
    const outputDirectory = join(root, 'asset-source', 'v0.2.0', 'split-output')

    await expect(splitPairedPart(inputPath, outputDirectory, CROPS))
      .rejects.toThrow(/canonical v0\.2\.0 output root/u)
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a junction that escapes a canonical repository output root', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'qmonster-pair-junction-fixture-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'qmonster-pair-junction-outside-'))
    temporaryDirectories.push(fixtureRoot, outsideRoot)
    const inputPath = await makeFixture(fixtureRoot)
    const allowedParent = await allowedOutputRoot('split-junction-')
    const junction = join(allowedParent, 'escape')
    await symlink(outsideRoot, junction, 'junction')
    junctions.push(junction)
    const outputDirectory = join(junction, 'nodes')

    await expect(splitPairedPart(inputPath, outputDirectory, CROPS))
      .rejects.toThrow(/canonical v0\.2\.0 output root/u)
    expect(await readdir(outsideRoot)).toEqual([])
  })
})
