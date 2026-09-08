import sharp from 'sharp'
import type { Diagnostic } from '@qmonster/generator-core'

const CANVAS_SIZE = 2048
const STRUCTURE_DOMINANT_COMPONENT_RATIO = 0.999

export interface V08RasterContractInput {
  sourcePath: string
  role: 'structure' | 'trait' | 'mask'
  ownerMaskPath?: string
  allowEmpty?: boolean
}

interface DecodedRgba {
  pixels: Buffer
  width: number
  height: number
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

async function decodeExactRgba(
  path: string,
  diagnosticPath: string[],
): Promise<{ decoded: DecodedRgba | null; diagnostics: Diagnostic[] }> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    metadata = await sharp(path).metadata()
  } catch {
    return {
      decoded: null,
      diagnostics: [error('V08_RASTER_DECODE_FAILED', diagnosticPath, `Unable to decode ${path}.`)],
    }
  }
  const diagnostics: Diagnostic[] = []
  if (metadata.width !== CANVAS_SIZE || metadata.height !== CANVAS_SIZE) diagnostics.push(error(
    'V08_CANVAS_SIZE_INVALID', diagnosticPath,
    `${path} is ${metadata.width ?? 0}×${metadata.height ?? 0}; expected 2048×2048 with no trimming.`,
  ))
  if (metadata.hasAlpha !== true) diagnostics.push(error(
    'V08_ALPHA_CHANNEL_MISSING', diagnosticPath,
    `${path} must contain a real alpha channel.`,
  ))
  if (diagnostics.length > 0) return { decoded: null, diagnostics }
  try {
    const image = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return {
      decoded: { pixels: image.data, width: image.info.width, height: image.info.height },
      diagnostics,
    }
  } catch {
    return {
      decoded: null,
      diagnostics: [error('V08_RASTER_DECODE_FAILED', diagnosticPath, `Unable to read RGBA pixels from ${path}.`)],
    }
  }
}

function visiblePixelCount(pixels: Uint8Array): number {
  let count = 0
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if ((pixels[offset] ?? 0) > 0) count += 1
  }
  return count
}

function componentSizes8(pixels: Uint8Array, width: number, height: number): number[] {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  const sizes: number[] = []
  for (let start = 0; start < total; start += 1) {
    if (visited[start] !== 0 || (pixels[start * 4 + 3] ?? 0) === 0) continue
    visited[start] = 1
    let read = 0
    let written = 1
    queue[0] = start
    while (read < written) {
      const pixel = queue[read++]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue
          const nextX = x + deltaX
          const nextY = y + deltaY
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
          const candidate = nextY * width + nextX
          if (visited[candidate] !== 0 || (pixels[candidate * 4 + 3] ?? 0) === 0) continue
          visited[candidate] = 1
          queue[written++] = candidate
        }
      }
    }
    sizes.push(written)
  }
  return sizes
}

function ownerMaskLeakPixels(source: Uint8Array, ownerMask: Uint8Array): number {
  let leaks = 0
  for (let pixel = 0; pixel < source.length / 4; pixel += 1) {
    if ((source[pixel * 4 + 3] ?? 0) > 0 && (ownerMask[pixel * 4 + 3] ?? 0) === 0) leaks += 1
  }
  return leaks
}

export async function validateV08RasterContract(
  input: V08RasterContractInput,
): Promise<Diagnostic[]> {
  const path = ['sourcePath']
  const source = await decodeExactRgba(input.sourcePath, path)
  const diagnostics = [...source.diagnostics]
  if (source.decoded === null) return diagnostics

  const visiblePixels = visiblePixelCount(source.decoded.pixels)
  if (visiblePixels === 0 && input.allowEmpty !== true) diagnostics.push(error(
    'V08_VISIBLE_ALPHA_EMPTY', path,
    `${input.sourcePath} has no visible alpha pixels.`,
  ))

  if (input.role === 'structure' && visiblePixels > 0) {
    const sizes = componentSizes8(source.decoded.pixels, source.decoded.width, source.decoded.height)
    const largest = Math.max(0, ...sizes)
    const ratio = largest / visiblePixels
    if (ratio < STRUCTURE_DOMINANT_COMPONENT_RATIO) diagnostics.push(error(
      'V08_STRUCTURE_DISCONNECTED', path,
      `${input.sourcePath} largest connected component contains ${largest}/${visiblePixels} visible pixels (${ratio.toFixed(6)}); expected at least 0.999000.`,
    ))
  }

  if (input.role === 'trait') {
    if (input.ownerMaskPath === undefined) {
      diagnostics.push(error(
        'V08_OWNER_MASK_REQUIRED', ['ownerMaskPath'],
        `Trait ${input.sourcePath} requires an owner mask.`,
      ))
    } else {
      const owner = await decodeExactRgba(input.ownerMaskPath, ['ownerMaskPath'])
      diagnostics.push(...owner.diagnostics)
      if (owner.decoded !== null) {
        const leaks = ownerMaskLeakPixels(source.decoded.pixels, owner.decoded.pixels)
        if (leaks > 0) diagnostics.push(error(
          'V08_OWNER_MASK_LEAK', path,
          `${input.sourcePath} has ${leaks} pixel${leaks === 1 ? '' : 's'} outside ${input.ownerMaskPath}.`,
        ))
      }
    }
  }
  return diagnostics
}
