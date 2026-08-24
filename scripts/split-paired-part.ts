import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
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

function assertSafeVersionedOutput(outputDirectory: string): void {
  const normalized = resolve(outputDirectory).toLowerCase()
  const allowedMarkers = [
    `${sep}asset-source${sep}v0.2.0${sep}`,
    `${sep}packages${sep}asset-catalog${sep}assets${sep}v0.2.0${sep}`,
  ]
  if (!allowedMarkers.some(marker => `${normalized}${sep}`.includes(marker))) {
    throw new Error(`Paired-part output must stay inside a v0.2.0 safe root: ${outputDirectory}`)
  }
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
  const pngPath = resolveOutputPath(outputDirectory, `${crop.id}.png`)
  const webpPath = resolveOutputPath(outputDirectory, `${crop.id}.webp`)
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
  assertSafeVersionedOutput(outputDirectory)
  const metadata = await sharp(inputPath).metadata()
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error(`Cannot read paired-part dimensions: ${inputPath}`)
  }
  if (crops[0].id !== 'left' || crops[1].id !== 'right') {
    throw new Error('Paired-part crops must be ordered left, right')
  }
  for (const crop of crops) assertCrop(crop, metadata.width, metadata.height)

  const root = resolve(outputDirectory)
  await mkdir(root, { recursive: true })
  const left = await splitOne(inputPath, root, crops[0])
  const right = await splitOne(inputPath, root, crops[1])
  return [left, right]
}
