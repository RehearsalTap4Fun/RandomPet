import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'

export interface ChromaExtractionInput {
  sourcePath: string
  outputPath: string
  safeBorderPixels: number
}

export interface ChromaDiagnostic {
  severity: 'error'
  code:
    | 'CHROMA_KEY_INVALID'
    | 'CHROMA_BACKGROUND_NONUNIFORM'
    | 'CHROMA_BACKGROUND_CONTAMINATED'
    | 'CHROMA_SUBJECT_SIMILARITY'
    | 'CHROMA_SAFE_BORDER_CLIPPED'
    | 'CHROMA_EDGE_NO_CORE'
    | 'CHROMA_EDGE_DEGRADED'
  message: string
}

export interface ChromaQualityMetrics {
  detectedKeyHex: string
  sampledKeyHex: string
  backgroundP95Delta: number
  borderContaminationRatio: number
  subjectCoverage: number
  subjectBackgroundDistanceP05: number
  partialAlphaPixels: number
  partialAlphaRatio: number
  edgeFringeP95: number
  edgeColorDeltaP95: number
  edgeNearestDistanceP95: number
  edgePixelsWithoutOpaqueCore: number
  safeBorderAlphaMax: number
  safeBorderForegroundPixels: number
}

export interface ChromaExtractionResult {
  approved: boolean
  diagnostics: ChromaDiagnostic[]
  metrics: ChromaQualityMetrics
  thresholds: ChromaQualityThresholds
  sourceSha256: string
  processedSha256: string
}

export interface ChromaQualityThresholds {
  safeBorderPixels: number
  maxBackgroundP95Delta: number
  maxBorderContaminationRatio: number
  borderContaminationDelta: number
  minOpaquePixels: number
  minSubjectBackgroundDistanceP05: number
  maxSafeBorderForegroundPixels: number
  maxPartialAlphaRatio: number
  minPartialAlphaPixels: number
  maxEdgeFringeP95: number
  maxEdgeColorDeltaP95: number
  maxEdgeNearestDistanceP95: number
  maxEdgePixelsWithoutOpaqueCore: number
}

type Rgb = readonly [number, number, number]

const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
} as const

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5)
}

function delta(left: Rgb, right: Rgb): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function hex(rgb: Rgb): string {
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function error(code: ChromaDiagnostic['code'], message: string): ChromaDiagnostic {
  return { severity: 'error', code, message }
}

function borderIndices(width: number, height: number, border: number): number[] {
  const indices: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        indices.push(y * width + x)
      }
    }
  }
  return indices
}

function readRgb(data: Uint8Array, pixelIndex: number): Rgb {
  const offset = pixelIndex * 3
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!]
}

function detectKey(data: Uint8Array, indices: readonly number[]): { key: Rgb; sampled: Rgb; valid: boolean } {
  const channels = [0, 1, 2].map(channel => median(indices.map(index => data[index * 3 + channel]!)))
  const sampled = channels as [number, number, number]
  const snapped = channels.map(value => value <= 31 ? 0 : value >= 224 ? 255 : value) as [number, number, number]
  const binary = snapped.every(value => value === 0 || value === 255)
  const hasHigh = snapped.some(value => value === 255)
  const hasLow = snapped.some(value => value === 0)
  return { key: snapped, sampled, valid: binary && hasHigh && hasLow }
}

function chromaAlpha(rgb: Rgb, nominalKey: Rgb, sampledKey: Rgb): number {
  const high = nominalKey.flatMap((value, index) => value === 255 ? [rgb[index]!] : [])
  const low = nominalKey.flatMap((value, index) => value === 0 ? [rgb[index]!] : [])
  if (high.length === 0 || low.length === 0) return 1
  const keyDominance = Math.min(...high) - Math.max(...low)
  const sampledHigh = nominalKey.flatMap((value, index) => value === 255 ? [sampledKey[index]!] : [])
  const sampledLow = nominalKey.flatMap((value, index) => value === 0 ? [sampledKey[index]!] : [])
  const sampledDominance = Math.max(1, Math.min(...sampledHigh) - Math.max(...sampledLow))
  return Math.max(0, Math.min(1, 1 - keyDominance / sampledDominance))
}

function decontaminate(rgb: Rgb, key: Rgb, alpha: number): Rgb {
  if (alpha <= 0) return [0, 0, 0]
  return rgb.map((value, channel) => Math.round(Math.max(
    0,
    Math.min(255, (value - (1 - alpha) * key[channel]!) / alpha),
  ))) as [number, number, number]
}

function keyFringe(rgb: Rgb, key: Rgb): number {
  const high = key.flatMap((value, index) => value === 255 ? [rgb[index]!] : [])
  const low = key.flatMap((value, index) => value === 0 ? [rgb[index]!] : [])
  return Math.max(0, Math.min(...high) - Math.max(...low))
}

function blendLineResidual(observed: Rgb, key: Rgb, intendedForeground: Rgb): number {
  const vector = intendedForeground.map((value, channel) => value - key[channel]!)
  const denominator = vector.reduce((sum, value) => sum + value ** 2, 0)
  if (denominator === 0) return delta(observed, intendedForeground)
  const alpha = Math.max(0, Math.min(1, vector.reduce(
    (sum, value, channel) => sum + (observed[channel]! - key[channel]!) * value,
    0,
  ) / denominator))
  const predicted = key.map((value, channel) => Math.round(
    value + alpha * vector[channel]!,
  )) as [number, number, number]
  return delta(observed, predicted)
}

function bestLocalBlendResidual(input: {
  observed: Rgb
  key: Rgb
  rgba: Uint8Array
  alpha: Uint8Array
  width: number
  height: number
  nearestCoreIndex: number
}): number {
  const centerX = input.nearestCoreIndex % input.width
  const centerY = Math.floor(input.nearestCoreIndex / input.width)
  const nearestOffset = input.nearestCoreIndex * 4
  const nearestColor: Rgb = [input.rgba[nearestOffset]!, input.rgba[nearestOffset + 1]!, input.rgba[nearestOffset + 2]!]
  let best = blendLineResidual(input.observed, input.key, nearestColor)
  for (let y = Math.max(0, centerY - 32); y <= Math.min(input.height - 1, centerY + 32); y += 1) {
    for (let x = Math.max(0, centerX - 32); x <= Math.min(input.width - 1, centerX + 32); x += 1) {
      const index = y * input.width + x
      // A high-confidence, independently observed foreground sample. Requiring
      // substantial opacity avoids learning the colour from the very fringe we
      // are auditing, while 192 still captures the lighter tips of soft fur
      // that legitimately disappear before an entirely opaque core exists.
      if (input.alpha[index]! < 192) continue
      const offset = index * 4
      const candidate: Rgb = [input.rgba[offset]!, input.rgba[offset + 1]!, input.rgba[offset + 2]!]
      best = Math.min(best, blendLineResidual(input.observed, input.key, candidate))
    }
  }
  return best
}

function nearestOpaquePixels(
  alpha: Uint8Array,
  width: number,
  height: number,
): { nearest: Int32Array; distanceSquared: Float64Array } {
  const pixelCount = width * height
  const nearest = new Int32Array(pixelCount)
  nearest.fill(-1)
  const distanceSquared = new Float64Array(pixelCount)
  distanceSquared.fill(Number.POSITIVE_INFINITY)
  for (let index = 0; index < pixelCount; index += 1) {
    if (alpha[index] !== 255) continue
    const x = index % width
    const y = Math.floor(index / width)
    let isCore = x >= 2 && y >= 2 && x + 2 < width && y + 2 < height
    for (let offsetY = -2; isCore && offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        if (alpha[(y + offsetY) * width + x + offsetX] !== 255) {
          isCore = false
          break
        }
      }
    }
    if (isCore) {
      nearest[index] = index
      distanceSquared[index] = 0
    }
  }

  const consider = (index: number, neighbour: number, x: number, y: number): void => {
    const source = nearest[neighbour]!
    if (source < 0) return
    const sourceX = source % width
    const sourceY = Math.floor(source / width)
    const candidateDistance = (x - sourceX) ** 2 + (y - sourceY) ** 2
    if (candidateDistance < distanceSquared[index]!) {
      nearest[index] = source
      distanceSquared[index] = candidateDistance
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (x > 0) consider(index, index - 1, x, y)
      if (y > 0) consider(index, index - width, x, y)
      if (x > 0 && y > 0) consider(index, index - width - 1, x, y)
      if (x + 1 < width && y > 0) consider(index, index - width + 1, x, y)
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x
      if (x + 1 < width) consider(index, index + 1, x, y)
      if (y + 1 < height) consider(index, index + width, x, y)
      if (x + 1 < width && y + 1 < height) consider(index, index + width + 1, x, y)
      if (x > 0 && y + 1 < height) consider(index, index + width - 1, x, y)
    }
  }
  return { nearest, distanceSquared }
}

export async function extractChromaAlpha(
  input: ChromaExtractionInput,
): Promise<ChromaExtractionResult> {
  const source = await readFile(input.sourcePath)
  const decoded = await sharp(source)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const border = Math.max(1, Math.min(
    Math.floor(Math.min(width, height) / 4),
    Math.floor(input.safeBorderPixels),
  ))
  const indices = borderIndices(width, height, border)
  const detection = detectKey(decoded.data, indices)
  const key = detection.key
  const sampledKey = detection.sampled
  const diagnostics: ChromaDiagnostic[] = []
  if (!detection.valid) {
    diagnostics.push(error(
      'CHROMA_KEY_INVALID',
      `Detected border color ${hex(key)} is not a saturated binary chroma key.`,
    ))
  }

  const borderDeltas = indices.map(index => delta(readRgb(decoded.data, index), sampledKey))
  const backgroundP95Delta = percentile(borderDeltas, 0.95)
  const borderContaminationRatio = borderDeltas.filter(value => value > 24).length / indices.length
  if (backgroundP95Delta > 12) {
    diagnostics.push(error(
      'CHROMA_BACKGROUND_NONUNIFORM',
      `Safe-border chroma p95 delta ${backgroundP95Delta.toFixed(2)} exceeds 12.`,
    ))
  }
  if (borderContaminationRatio > 0.01) {
    diagnostics.push(error(
      'CHROMA_BACKGROUND_CONTAMINATED',
      `Safe-border contamination ${(borderContaminationRatio * 100).toFixed(2)}% exceeds 1%.`,
    ))
  }

  const pixelCount = width * height
  const backgroundTolerance = Math.max(2, Math.min(12, backgroundP95Delta + 2))
  const safeBorderMask = new Uint8Array(pixelCount)
  for (const index of indices) safeBorderMask[index] = 1
  const rgba = Buffer.alloc(pixelCount * 4)
  const alphaBytes = new Uint8Array(pixelCount)
  const foregroundDistances: number[] = []
  let opaquePixels = 0
  let partialAlphaPixels = 0
  let nonzeroAlphaPixels = 0

  for (let index = 0; index < pixelCount; index += 1) {
    const rgb = readRgb(decoded.data, index)
    const keyDelta = delta(rgb, sampledKey)
    const alpha = keyDelta <= backgroundTolerance || (safeBorderMask[index] === 1 && keyDelta <= 32)
      ? 0
      : chromaAlpha(rgb, key, sampledKey)
    const alphaByte = alpha <= 8 / 255 ? 0 : alpha >= 0.996 ? 255 : Math.round(alpha * 255)
    alphaBytes[index] = alphaByte
    if (alphaByte > 0) nonzeroAlphaPixels += 1
    if (alphaByte === 255) {
      opaquePixels += 1
      foregroundDistances.push(delta(rgb, key))
    } else if (alphaByte > 0) {
      partialAlphaPixels += 1
    }
    const cleaned = decontaminate(rgb, sampledKey, alphaByte / 255)
    const offset = index * 4
    rgba[offset] = cleaned[0]
    rgba[offset + 1] = cleaned[1]
    rgba[offset + 2] = cleaned[2]
    rgba[offset + 3] = alphaByte
  }

  const propagated = nearestOpaquePixels(alphaBytes, width, height)
  const edgeFringes: number[] = []
  const edgeColorDeltas: number[] = []
  const edgeNearestDistances: number[] = []
  let edgePixelsWithoutOpaqueCore = 0
  for (let index = 0; index < pixelCount; index += 1) {
    const alphaByte = alphaBytes[index]!
    if (alphaByte === 0 || alphaByte === 255) continue
    const source = propagated.nearest[index]!
    if (source < 0) {
      edgePixelsWithoutOpaqueCore += 1
      continue
    }
    const offset = index * 4
    const sourceOffset = source * 4
    const nearestColor: Rgb = [rgba[sourceOffset]!, rgba[sourceOffset + 1]!, rgba[sourceOffset + 2]!]
    // Fringe is an output-quality metric: this is the independently sampled
    // inward colour that will be propagated into transparent RGB. The separate
    // blend residual below deliberately uses the untouched source observation,
    // so propagation cannot hide a genuinely coloured input fringe.
    edgeFringes.push(keyFringe(nearestColor, key))
    edgeColorDeltas.push(bestLocalBlendResidual({
      observed: readRgb(decoded.data, index),
      key: sampledKey,
      rgba,
      alpha: alphaBytes,
      width,
      height,
      nearestCoreIndex: source,
    }))
    edgeNearestDistances.push(Math.sqrt(propagated.distanceSquared[index]!))
    rgba[offset] = nearestColor[0]
    rgba[offset + 1] = nearestColor[1]
    rgba[offset + 2] = nearestColor[2]
  }

  const subjectCoverage = opaquePixels / pixelCount
  const subjectBackgroundDistanceP05 = percentile(foregroundDistances, 0.05)
  const minOpaquePixels = Math.max(32, Math.floor(pixelCount * 0.005))
  if (opaquePixels < minOpaquePixels || subjectBackgroundDistanceP05 < 80) {
    diagnostics.push(error(
      'CHROMA_SUBJECT_SIMILARITY',
      `Opaque subject coverage ${(subjectCoverage * 100).toFixed(2)}% and key-distance p05 ${subjectBackgroundDistanceP05.toFixed(2)} do not safely separate foreground from chroma.`,
    ))
  }

  let safeBorderAlphaMax = 0
  let safeBorderForegroundPixels = 0
  for (const index of indices) {
    safeBorderAlphaMax = Math.max(safeBorderAlphaMax, alphaBytes[index]!)
    if (alphaBytes[index]! > 8) safeBorderForegroundPixels += 1
  }
  const maxSafeBorderForegroundPixels = Math.max(16, Math.floor(indices.length * 0.0001))
  if (safeBorderForegroundPixels > maxSafeBorderForegroundPixels) {
    diagnostics.push(error(
      'CHROMA_SAFE_BORDER_CLIPPED',
      `${safeBorderForegroundPixels} foreground pixels (max alpha ${safeBorderAlphaMax}/255) enter the required ${border}px safe border.`,
    ))
  }

  const partialAlphaRatio = partialAlphaPixels / Math.max(1, nonzeroAlphaPixels)
  const edgeFringeP95 = percentile(edgeFringes, 0.95)
  const edgeColorDeltaP95 = percentile(edgeColorDeltas, 0.95)
  const edgeNearestDistanceP95 = percentile(edgeNearestDistances, 0.95)
  const minPartialAlphaPixels = Math.max(16, Math.floor(opaquePixels * 0.001))
  if (edgePixelsWithoutOpaqueCore > 0) {
    diagnostics.push(error(
      'CHROMA_EDGE_NO_CORE',
      `${edgePixelsWithoutOpaqueCore} partial-alpha edge pixels have no opaque inward color core.`,
    ))
  }
  if (
    partialAlphaPixels < minPartialAlphaPixels
    || partialAlphaRatio > 0.45
    || edgeFringeP95 > 4
    || edgeColorDeltaP95 > 12
    || edgeNearestDistanceP95 > 32
  ) {
    diagnostics.push(error(
      'CHROMA_EDGE_DEGRADED',
      `Partial-alpha pixels ${partialAlphaPixels}, ratio ${(partialAlphaRatio * 100).toFixed(2)}%, fringe p95 ${edgeFringeP95.toFixed(2)}, color delta p95 ${edgeColorDeltaP95.toFixed(2)}, nearest distance p95 ${edgeNearestDistanceP95.toFixed(2)} failed edge limits.`,
    ))
  }

  await mkdir(dirname(input.outputPath), { recursive: true })
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png(PNG_OPTIONS)
    .toFile(input.outputPath)
  const processed = await readFile(input.outputPath)

  return {
    approved: diagnostics.length === 0,
    diagnostics,
    metrics: {
      detectedKeyHex: hex(key),
      sampledKeyHex: hex(sampledKey),
      backgroundP95Delta,
      borderContaminationRatio,
      subjectCoverage,
      subjectBackgroundDistanceP05,
      partialAlphaPixels,
      partialAlphaRatio,
      edgeFringeP95,
      edgeColorDeltaP95,
      edgeNearestDistanceP95,
      edgePixelsWithoutOpaqueCore,
      safeBorderAlphaMax,
      safeBorderForegroundPixels,
    },
    thresholds: {
      safeBorderPixels: border,
      maxBackgroundP95Delta: 12,
      maxBorderContaminationRatio: 0.01,
      borderContaminationDelta: 24,
      minOpaquePixels,
      minSubjectBackgroundDistanceP05: 80,
      maxSafeBorderForegroundPixels,
      maxPartialAlphaRatio: 0.45,
      minPartialAlphaPixels,
      maxEdgeFringeP95: 4,
      maxEdgeColorDeltaP95: 12,
      maxEdgeNearestDistanceP95: 32,
      maxEdgePixelsWithoutOpaqueCore: 0,
    },
    sourceSha256: sha256(source),
    processedSha256: sha256(processed),
  }
}
