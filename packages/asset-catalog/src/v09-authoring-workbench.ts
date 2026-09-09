import sharp from 'sharp'
import { decodedPngSha256, V09CatalogError } from './v09-content-identity.js'

export type PngBytes = Buffer | Uint8Array
export type AuthoringZoneInput = {
  mode: 'full-context'
  candidate: PngBytes
  authoringZone: PngBytes
  neutralMaster: PngBytes
} | {
  mode: 'exported-layer'
  candidate: PngBytes
  authoringZone: PngBytes
}

export type DecodedMasterRgba = { pixels: Buffer; width: 2048; height: 2048 }

const SIZE = 2048
const PIXELS = SIZE * SIZE

function fail(code: string, message: string, cause?: unknown): never {
  throw new V09CatalogError(code, message, cause === undefined ? undefined : { cause })
}

async function decodeMaster(bytes: PngBytes, code: string): Promise<DecodedMasterRgba> {
  try {
    await decodedPngSha256(bytes)
    const decoded = await sharp(Buffer.from(bytes), { animated: false, failOn: 'error' })
      .toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== SIZE || decoded.info.height !== SIZE || decoded.info.channels !== 4) {
      fail(code, 'PNG must decode as a 2048x2048 RGBA8 full master.')
    }
    return { pixels: decoded.data, width: SIZE, height: SIZE }
  } catch (error) {
    if (error instanceof V09CatalogError && error.code === code) throw error
    fail(code, 'PNG must be a one-page, profile-free 2048x2048 sRGB RGBA8 full master.', error)
  }
}

async function decodeBinaryMask(bytes: PngBytes, code: string): Promise<DecodedMasterRgba> {
  const mask = await decodeMaster(bytes, code)
  let included = 0
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    const alpha = mask.pixels[pixel * 4 + 3]!
    if (alpha !== 0 && alpha !== 255) fail(code, 'Authoring masks and root stencils must have binary alpha.')
    if (alpha === 255) included += 1
  }
  if (included === 0) fail(code, 'Authoring masks and root stencils must contain at least one included pixel.')
  return mask
}

/** Enforce an immutable full-master authoring zone without crop, repair, or transform. */
export async function enforceAuthoringZone(input: AuthoringZoneInput): Promise<void> {
  const zone = await decodeBinaryMask(input.authoringZone, 'AUTHORING_ZONE_VIOLATION')
  const candidate = await decodeMaster(input.candidate, 'AUTHORING_ZONE_VIOLATION')
  const neutral = input.mode === 'full-context'
    ? await decodeMaster(input.neutralMaster, 'AUTHORING_ZONE_VIOLATION')
    : undefined

  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    if (zone.pixels[pixel * 4 + 3] === 255) continue
    const offset = pixel * 4
    if (input.mode === 'exported-layer') {
      if (candidate.pixels[offset] !== 0 || candidate.pixels[offset + 1] !== 0
        || candidate.pixels[offset + 2] !== 0 || candidate.pixels[offset + 3] !== 0) {
        fail('AUTHORING_ZONE_VIOLATION', 'Exported layer contains non-transparent pixels outside its full-master authoring zone.')
      }
    } else if (candidate.pixels[offset] !== neutral!.pixels[offset]
      || candidate.pixels[offset + 1] !== neutral!.pixels[offset + 1]
      || candidate.pixels[offset + 2] !== neutral!.pixels[offset + 2]
      || candidate.pixels[offset + 3] !== neutral!.pixels[offset + 3]) {
      fail('AUTHORING_ZONE_VIOLATION', 'Full-context composite differs from the neutral master outside its authoring zone.')
    }
  }
}

/** Copy immutable stencil pixels into a full-master layer using no placement or transform controls. */
export async function injectFixedRootStencil(layer: PngBytes, rootStencil: PngBytes): Promise<Buffer> {
  const decodedLayer = await decodeMaster(layer, 'ROOT_STENCIL_INVALID')
  const stencil = await decodeBinaryMask(rootStencil, 'ROOT_STENCIL_INVALID')
  const output = Buffer.from(decodedLayer.pixels)
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    if (stencil.pixels[pixel * 4 + 3] !== 255) continue
    const offset = pixel * 4
    stencil.pixels.copy(output, offset, offset, offset + 4)
  }
  return sharp(output, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer()
}

export async function decodeFullMasterPng(bytes: PngBytes, code = 'AUTHORING_ZONE_VIOLATION'): Promise<DecodedMasterRgba> {
  return decodeMaster(bytes, code)
}

export async function decodeBinaryFullMasterMask(bytes: PngBytes, code = 'AUTHORING_ZONE_VIOLATION'): Promise<DecodedMasterRgba> {
  return decodeBinaryMask(bytes, code)
}
