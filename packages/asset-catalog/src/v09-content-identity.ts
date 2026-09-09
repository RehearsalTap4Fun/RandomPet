import { createHash } from 'node:crypto'
import sharp from 'sharp'

/** Stable, public failures used by the isolated v0.9 catalog path. */
export class V09CatalogError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'V09CatalogError'
    this.code = code
  }
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON does not allow non-finite numbers.')
      return JSON.stringify(value)
    case 'bigint':
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new V09CatalogError('CANONICAL_JSON_INVALID', `Canonical JSON does not allow ${typeof value} values.`)
    case 'object':
      break
    default:
      throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON value is unsupported.')
  }

  if (ancestors.has(value)) throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON does not allow cycles.')
  ancestors.add(value)
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON does not allow symbol keys.')
    }
    if (Array.isArray(value)) {
      const members: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON does not allow sparse arrays.')
        members.push(canonicalize(value[index], ancestors))
      }
      return `[${members.join(',')}]`
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new V09CatalogError('CANONICAL_JSON_INVALID', 'Canonical JSON only allows ordinary objects without symbol keys.')
    }
    const keys = Object.keys(value).sort()
    const members = keys.map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], ancestors)}`)
    return `{${members.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/** RFC 8785-compatible canonical UTF-8 bytes for the supported JSON data model. */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value, new WeakSet()), 'utf8')
}

export function canonicalJsonSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJsonBytes(value)).digest('hex')
}

/** Hash the normalized, straight RGBA8 decoded representation mandated by v0.9. */
export async function decodedPngSha256(bytes: Buffer | Uint8Array): Promise<string> {
  try {
    const input = Buffer.from(bytes)
    const image = sharp(input, { animated: false, failOn: 'error' })
    const metadata = await image.metadata()
    if (metadata.format !== 'png'
      || metadata.width !== 2048
      || metadata.height !== 2048
      || metadata.channels !== 4
      || metadata.depth !== 'uchar'
      || (metadata.pages !== undefined && metadata.pages !== 1)
      || metadata.hasProfile === true
      || metadata.icc !== undefined) {
      throw new V09CatalogError('PNG_DECODE_INVALID', 'PNG must be a one-page, profile-free 2048x2048 straight RGBA8 image.')
    }
    const decoded = await image.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== 2048 || decoded.info.height !== 2048 || decoded.info.channels !== 4) {
      throw new V09CatalogError('PNG_DECODE_INVALID', 'Decoded PNG is not 2048x2048 RGBA8.')
    }
    return createHash('sha256').update('2048x2048:rgba8:', 'ascii').update(decoded.data).digest('hex')
  } catch (error) {
    if (error instanceof V09CatalogError) throw error
    throw new V09CatalogError('PNG_DECODE_INVALID', 'PNG cannot be decoded as a v0.9 resource.', { cause: error })
  }
}
