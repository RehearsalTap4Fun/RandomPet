import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { extractChromaAlpha, type ChromaExtractionResult } from './extract-chroma-alpha.js'

export interface CandidateSheetInput {
  sourcePath: string
  outputDirectory: string
  sourceId: string
  safeBorderPixels?: number
}

export interface CandidateSheetVariant {
  index: 1 | 2 | 3 | 4
  sourcePath: string
  rgbaPath: string
  extraction: ChromaExtractionResult
}

export interface NormalizedMasterResult {
  masterPath: string
  sha256: string
  width: number
  height: number
  hasAlpha: boolean
  boundaryAlphaPixels: number
}

const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function processCandidateSheet(
  input: CandidateSheetInput,
): Promise<CandidateSheetVariant[]> {
  const metadata = await sharp(input.sourcePath).metadata()
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error(`Cannot read candidate sheet dimensions: ${input.sourcePath}`)
  }
  const halfWidth = Math.floor(metadata.width / 2)
  const halfHeight = Math.floor(metadata.height / 2)
  const crops = [
    { left: 0, top: 0, width: halfWidth, height: halfHeight },
    { left: metadata.width - halfWidth, top: 0, width: halfWidth, height: halfHeight },
    { left: 0, top: metadata.height - halfHeight, width: halfWidth, height: halfHeight },
    { left: metadata.width - halfWidth, top: metadata.height - halfHeight, width: halfWidth, height: halfHeight },
  ] as const
  await mkdir(input.outputDirectory, { recursive: true })
  const variants: CandidateSheetVariant[] = []
  for (const [offset, crop] of crops.entries()) {
    const index = (offset + 1) as 1 | 2 | 3 | 4
    const sourcePath = join(input.outputDirectory, `${input.sourceId}-candidate-${index}-source.png`)
    const rgbaPath = join(input.outputDirectory, `${input.sourceId}-candidate-${index}-rgba.png`)
    await sharp(input.sourcePath).extract(crop).png(PNG_OPTIONS).toFile(sourcePath)
    const extraction = await extractChromaAlpha({
      sourcePath,
      outputPath: rgbaPath,
      safeBorderPixels: input.safeBorderPixels ?? 16,
    })
    variants.push({ index, sourcePath, rgbaPath, extraction })
  }
  return variants
}

export async function normalizeApprovedMaster(input: {
  rgbaPath: string
  masterPath: string
  maximumSubjectSize?: number
}): Promise<NormalizedMasterResult> {
  const maximumSubjectSize = input.maximumSubjectSize ?? 1792
  if (maximumSubjectSize <= 0 || maximumSubjectSize > 1856) {
    throw new Error('maximumSubjectSize must leave at least a 96px safe border on a 2048 master.')
  }
  const trimmed = await sharp(input.rgbaPath).trim({ background: '#00000000' }).png().toBuffer()
  const resized = await sharp(trimmed)
    .resize(maximumSubjectSize, maximumSubjectSize, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png(PNG_OPTIONS)
    .toBuffer({ resolveWithObject: true })
  await mkdir(dirname(input.masterPath), { recursive: true })
  await sharp({
    create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
  }).composite([{
    input: resized.data,
    left: Math.floor((2048 - resized.info.width) / 2),
    top: Math.floor((2048 - resized.info.height) / 2),
  }]).png(PNG_OPTIONS).toFile(input.masterPath)
  const metadata = await sharp(input.masterPath).metadata()
  const alpha = await sharp(input.masterPath).ensureAlpha().extractChannel('alpha').raw().toBuffer()
  let boundaryAlphaPixels = 0
  const width = metadata.width!
  const height = metadata.height!
  for (let x = 0; x < width; x += 1) {
    if (alpha[x] !== 0) boundaryAlphaPixels += 1
    if (alpha[(height - 1) * width + x] !== 0) boundaryAlphaPixels += 1
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (alpha[y * width] !== 0) boundaryAlphaPixels += 1
    if (alpha[y * width + width - 1] !== 0) boundaryAlphaPixels += 1
  }
  return {
    masterPath: input.masterPath,
    sha256: await sha256File(input.masterPath),
    width,
    height,
    hasAlpha: metadata.hasAlpha ?? false,
    boundaryAlphaPixels,
  }
}

/**
 * Preserves the candidate quadrant as a coordinate-bearing canvas. Slot edits
 * are generated against full-canvas rig guides, so trimming/recentering them
 * would destroy their socket-relative position even when the pixels remain
 * individually valid. The 96px inset scales that full canvas uniformly and
 * guarantees the immutable master safe border.
 */
export async function normalizeAlignedMaster(input: {
  rgbaPath: string
  masterPath: string
  contentScale?: number
}): Promise<NormalizedMasterResult> {
  const contentScale = input.contentScale ?? 1
  if (contentScale < 1 || contentScale > 1.6) throw new Error('contentScale must be between 1 and 1.6.')
  let aligned = await sharp(input.rgbaPath)
    .ensureAlpha()
    .resize(1856, 1856, { fit: 'fill' })
    .png(PNG_OPTIONS)
    .toBuffer()
  if (contentScale !== 1) {
    const scaledSize = Math.round(1856 * contentScale)
    const scaled = await sharp(aligned).resize(scaledSize, scaledSize, { fit: 'fill' }).png(PNG_OPTIONS).toBuffer()
    const inset = Math.floor((scaledSize - 1856) / 2)
    aligned = await sharp(scaled).extract({ left: inset, top: inset, width: 1856, height: 1856 }).png(PNG_OPTIONS).toBuffer()
  }
  await mkdir(dirname(input.masterPath), { recursive: true })
  await sharp({
    create: { width: 2048, height: 2048, channels: 4, background: '#00000000' },
  }).composite([{ input: aligned, left: 96, top: 96 }]).png(PNG_OPTIONS).toFile(input.masterPath)

  const metadata = await sharp(input.masterPath).metadata()
  const alpha = await sharp(input.masterPath).ensureAlpha().extractChannel('alpha').raw().toBuffer()
  let boundaryAlphaPixels = 0
  const width = metadata.width!
  const height = metadata.height!
  for (let x = 0; x < width; x += 1) {
    if (alpha[x] !== 0) boundaryAlphaPixels += 1
    if (alpha[(height - 1) * width + x] !== 0) boundaryAlphaPixels += 1
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (alpha[y * width] !== 0) boundaryAlphaPixels += 1
    if (alpha[y * width + width - 1] !== 0) boundaryAlphaPixels += 1
  }
  return {
    masterPath: input.masterPath,
    sha256: await sha256File(input.masterPath),
    width,
    height,
    hasAlpha: metadata.hasAlpha ?? false,
    boundaryAlphaPixels,
  }
}

/** Builds a real bilateral layer from one approved generated side design. */
export async function normalizeBilateralMaster(input: {
  rgbaPath: string
  masterPath: string
}): Promise<NormalizedMasterResult> {
  const trimmed = await sharp(input.rgbaPath).trim({ background: '#00000000' }).png().toBuffer()
  const oneSide = await sharp(trimmed)
    .resize(640, 900, { fit: 'inside', withoutEnlargement: false })
    .png(PNG_OPTIONS)
    .toBuffer({ resolveWithObject: true })
  const mirrored = await sharp(oneSide.data).flop().png(PNG_OPTIONS).toBuffer()
  const top = Math.floor((2048 - oneSide.info.height) / 2)
  await mkdir(dirname(input.masterPath), { recursive: true })
  await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([
      { input: oneSide.data, left: 96, top },
      { input: mirrored, left: 2048 - 96 - oneSide.info.width, top },
    ])
    .png(PNG_OPTIONS)
    .toFile(input.masterPath)
  const metadata = await sharp(input.masterPath).metadata()
  const alpha = await sharp(input.masterPath).ensureAlpha().extractChannel('alpha').raw().toBuffer()
  let boundaryAlphaPixels = 0
  const width = metadata.width!
  const height = metadata.height!
  for (let x = 0; x < width; x += 1) {
    if (alpha[x] !== 0) boundaryAlphaPixels += 1
    if (alpha[(height - 1) * width + x] !== 0) boundaryAlphaPixels += 1
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (alpha[y * width] !== 0) boundaryAlphaPixels += 1
    if (alpha[y * width + width - 1] !== 0) boundaryAlphaPixels += 1
  }
  return {
    masterPath: input.masterPath,
    sha256: await sha256File(input.masterPath),
    width,
    height,
    hasAlpha: metadata.hasAlpha ?? false,
    boundaryAlphaPixels,
  }
}
