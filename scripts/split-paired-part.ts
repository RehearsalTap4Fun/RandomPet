import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  alphaMaskFromRgba,
  assertNearOpaqueProximalContour,
} from './alpha-junction-calibration.js'
import { resolveOutputPath } from './safe-output.js'

export interface PairCrop {
  id: 'left' | 'right'
  rect: { left: number; top: number; width: number; height: number }
  anchor: { x: number; y: number }
  mirrorX: boolean
}

export interface SplitNodeResult {
  id: 'left' | 'right'
  pngPath: string
  webpPath: string
  pngSha256: string
  webpSha256: string
  width: number
  height: number
  origin: { x: number; y: number }
  mirrorX: boolean
}

const ALPHA_FOREGROUND_THRESHOLD = 8
const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED_OUTPUT_ROOTS = [
  join(REPOSITORY_ROOT, 'asset-source', 'v0.2.0'),
  join(REPOSITORY_ROOT, 'packages', 'asset-catalog', 'assets', 'v0.2.0'),
] as const

function contained(root: string, target: string): boolean {
  const remainder = relative(root, target)
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
}

async function existingAncestor(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      await lstat(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

async function canonicalOutputDirectory(outputDirectory: string): Promise<{
  directory: string
  allowedRoot: string
}> {
  const requested = resolve(outputDirectory)
  const lexicalAllowedRoot = ALLOWED_OUTPUT_ROOTS.find(root => contained(root, requested))
  if (lexicalAllowedRoot === undefined) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${outputDirectory}`)
  }
  const [allowedRoot, ancestor] = await Promise.all([
    realpath(lexicalAllowedRoot),
    existingAncestor(requested),
  ])
  const canonicalAncestor = await realpath(ancestor)
  if (!contained(allowedRoot, canonicalAncestor)) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${outputDirectory}`)
  }
  const canonicalRequested = resolve(canonicalAncestor, relative(ancestor, requested))
  if (!contained(allowedRoot, canonicalRequested)) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${outputDirectory}`)
  }
  await mkdir(canonicalRequested, { recursive: true })
  const verifiedDirectory = await realpath(canonicalRequested)
  if (!contained(allowedRoot, verifiedDirectory)) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${outputDirectory}`)
  }
  return { directory: verifiedDirectory, allowedRoot }
}

function assertCrop(crop: PairCrop, width: number, height: number): void {
  const values = [crop.rect.left, crop.rect.top, crop.rect.width, crop.rect.height]
  if (!values.every(Number.isInteger) || crop.rect.width <= 0 || crop.rect.height <= 0) {
    throw new Error(`${crop.id} crop must use positive integer dimensions`)
  }
  if (
    crop.rect.left < 0
    || crop.rect.top < 0
    || crop.rect.left + crop.rect.width > width
    || crop.rect.top + crop.rect.height > height
  ) {
    throw new Error(`${crop.id} crop is outside input bounds`)
  }
  if (
    crop.anchor.x < crop.rect.left
    || crop.anchor.y < crop.rect.top
    || crop.anchor.x >= crop.rect.left + crop.rect.width
    || crop.anchor.y >= crop.rect.top + crop.rect.height
  ) {
    throw new Error(`${crop.id} anchor is outside its crop`)
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function missingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function samePath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === ''
}

async function assertSafeOutputLeaf(path: string): Promise<void> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if (missingPath(error)) return
    throw error
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`Paired-part output leaf must be an ordinary unlinked file: ${path}`)
  }
  const canonicalPath = await realpath(path)
  if (!samePath(path, canonicalPath)) {
    throw new Error(`Paired-part output leaf must be an ordinary unlinked file: ${path}`)
  }
}

async function assertSafeOutputLeaves(paths: readonly string[]): Promise<void> {
  for (const path of paths) await assertSafeOutputLeaf(path)
}

async function assertOutputDirectoryStable(directory: string, allowedRoot: string): Promise<void> {
  const verifiedDirectory = await realpath(directory)
  if (!contained(allowedRoot, verifiedDirectory) || !samePath(directory, verifiedDirectory)) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${directory}`)
  }
}

interface PreparedSplitNode {
  result: SplitNodeResult
  outputs: readonly [
    { path: string; bytes: Buffer },
    { path: string; bytes: Buffer },
  ]
}

async function prepareSplitNode(
  inputPath: string,
  outputDirectory: string,
  crop: PairCrop,
): Promise<PreparedSplitNode> {
  const cropped = await sharp(inputPath)
    .extract(crop.rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minX = cropped.info.width
  let minY = cropped.info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < cropped.info.height; y += 1) {
    for (let x = 0; x < cropped.info.width; x += 1) {
      if (cropped.data[(y * cropped.info.width + x) * 4 + 3]! <= ALPHA_FOREGROUND_THRESHOLD) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error(`${crop.id} crop has no foreground pixels`)

  const cropMask = alphaMaskFromRgba(
    cropped.data,
    cropped.info.width,
    cropped.info.height,
    cropped.info.channels,
  )
  try {
    assertNearOpaqueProximalContour(cropMask, {
      x: crop.anchor.x - crop.rect.left,
      y: crop.anchor.y - crop.rect.top,
    })
  } catch (error) {
    throw new Error(`${crop.id} ${(error as Error).message}`)
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const input = await sharp(cropped.data, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 4,
    },
  }).extract({ left: minX, top: minY, width, height }).png(PNG_OPTIONS).toBuffer()
  const pngPath = resolveOutputPath(outputDirectory, `${crop.id}.png`)
  const webpPath = resolveOutputPath(outputDirectory, `${crop.id}.webp`)
  const png = await sharp(input).png(PNG_OPTIONS).toBuffer()
  const webp = await sharp(input).webp({ lossless: true }).toBuffer()
  return {
    result: {
      id: crop.id,
      pngPath,
      webpPath,
      pngSha256: sha256(png),
      webpSha256: sha256(webp),
      width,
      height,
      origin: {
        x: crop.anchor.x - crop.rect.left - minX,
        y: crop.anchor.y - crop.rect.top - minY,
      },
      mirrorX: crop.mirrorX,
    },
    outputs: [{ path: pngPath, bytes: png }, { path: webpPath, bytes: webp }],
  }
}

async function commitPreparedOutputs(
  outputDirectory: string,
  allowedRoot: string,
  outputs: readonly { path: string; bytes: Buffer }[],
): Promise<void> {
  const temporaryPaths = new Set<string>()
  const staged: { temporaryPath: string; finalPath: string }[] = []
  try {
    for (const output of outputs) {
      const temporaryPath = resolveOutputPath(
        outputDirectory,
        `.split-${basename(output.path)}-${randomUUID()}.tmp`,
      )
      await writeFile(temporaryPath, output.bytes, { flag: 'wx', mode: 0o600 })
      temporaryPaths.add(temporaryPath)
      staged.push({ temporaryPath, finalPath: output.path })
    }
    await assertOutputDirectoryStable(outputDirectory, allowedRoot)
    await assertSafeOutputLeaves(staged.map(output => output.finalPath))
    for (const output of staged) {
      await assertOutputDirectoryStable(outputDirectory, allowedRoot)
      await assertSafeOutputLeaf(output.finalPath)
      await rename(output.temporaryPath, output.finalPath)
      temporaryPaths.delete(output.temporaryPath)
    }
  } finally {
    await Promise.all([...temporaryPaths].map(path => unlink(path).catch(() => undefined)))
  }
}

export async function splitPairedPart(
  inputPath: string,
  outputDirectory: string,
  crops: readonly [PairCrop, PairCrop],
): Promise<readonly [SplitNodeResult, SplitNodeResult]> {
  const metadata = await sharp(inputPath).metadata()
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error(`Cannot read paired-part dimensions: ${inputPath}`)
  }
  if (crops[0].id !== 'left' || crops[1].id !== 'right') {
    throw new Error('Paired-part crops must be ordered left, right')
  }
  for (const crop of crops) assertCrop(crop, metadata.width, metadata.height)

  const root = await canonicalOutputDirectory(outputDirectory)
  const finalPaths = crops.flatMap(crop => [
    resolveOutputPath(root.directory, `${crop.id}.png`),
    resolveOutputPath(root.directory, `${crop.id}.webp`),
  ])
  await assertSafeOutputLeaves(finalPaths)
  const left = await prepareSplitNode(inputPath, root.directory, crops[0])
  const right = await prepareSplitNode(inputPath, root.directory, crops[1])
  await commitPreparedOutputs(root.directory, root.allowedRoot, [...left.outputs, ...right.outputs])
  return [left.result, right.result]
}
