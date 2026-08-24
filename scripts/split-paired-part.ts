import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
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

async function splitOne(
  inputPath: string,
  outputDirectory: string,
  allowedRoot: string,
  crop: PairCrop,
): Promise<SplitNodeResult> {
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

  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const input = await sharp(cropped.data, {
    raw: {
      width: cropped.info.width,
      height: cropped.info.height,
      channels: 4,
    },
  }).extract({ left: minX, top: minY, width, height }).png(PNG_OPTIONS).toBuffer()
  const verifiedDirectory = await realpath(outputDirectory)
  if (!contained(allowedRoot, verifiedDirectory)) {
    throw new Error(`Paired-part output must stay inside a canonical v0.2.0 output root: ${outputDirectory}`)
  }
  const pngPath = resolveOutputPath(verifiedDirectory, `${crop.id}.png`)
  const webpPath = resolveOutputPath(verifiedDirectory, `${crop.id}.webp`)
  const png = await sharp(input).png(PNG_OPTIONS).toBuffer()
  const webp = await sharp(input).webp({ lossless: true }).toBuffer()
  await Promise.all([writeFile(pngPath, png), writeFile(webpPath, webp)])
  return {
    id: crop.id,
    pngPath,
    webpPath,
    pngSha256: sha256(await readFile(pngPath)),
    webpSha256: sha256(await readFile(webpPath)),
    width,
    height,
    origin: {
      x: crop.anchor.x - crop.rect.left - minX,
      y: crop.anchor.y - crop.rect.top - minY,
    },
    mirrorX: crop.mirrorX,
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
  const left = await splitOne(inputPath, root.directory, root.allowedRoot, crops[0])
  const right = await splitOne(inputPath, root.directory, root.allowedRoot, crops[1])
  return [left, right]
}
