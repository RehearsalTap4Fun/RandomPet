import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  decodedPngSha256,
} from './v09-content-identity.js'

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

function withTextMetadata(png: Buffer): Buffer {
  const data = Buffer.from('Comment\0same decoded pixels', 'latin1')
  const type = Buffer.from('tEXt', 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)])
}

describe('v0.9 content identity', () => {
  it('canonicalizes recursively sorted JSON keys into the same bytes and hash', () => {
    const left = { z: 1, nested: { b: true, a: 'x' }, a: null }
    const right = { a: null, nested: { a: 'x', b: true }, z: 1 }

    expect(canonicalJsonBytes(left).toString('utf8')).toBe('{"a":null,"nested":{"a":"x","b":true},"z":1}')
    expect(canonicalJsonBytes(right)).toEqual(canonicalJsonBytes(left))
    expect(canonicalJsonSha256(right)).toBe(canonicalJsonSha256(left))
  })

  it('preserves array order in canonical JSON', () => {
    expect(canonicalJsonSha256({ values: [1, 2] })).not.toBe(canonicalJsonSha256({ values: [2, 1] }))
  })

  it('fails closed for values which JSON.stringify would silently coerce or omit', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    for (const value of [NaN, Infinity, 1n, undefined, () => undefined, Symbol('x'), { omitted: undefined }, [1, undefined], [, 1], new Date(), circular]) {
      expect(() => canonicalJsonBytes(value)).toThrow()
    }
  })

  it('hashes equal decoded RGBA pixels equally despite PNG compression and metadata', async () => {
    const raw = Buffer.alloc(2048 * 2048 * 4, 0)
    raw[0] = 0x11
    raw[1] = 0x22
    raw[2] = 0x33
    raw[3] = 0xff
    const compressed = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer()
    const annotated = withTextMetadata(await sharp(raw, { raw: { width: 2048, height: 2048, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer())

    expect(await decodedPngSha256(compressed)).toBe(await decodedPngSha256(annotated))
  })

  it('changes the PNG hash when one decoded pixel changes', async () => {
    const first = Buffer.alloc(2048 * 2048 * 4, 0)
    const second = Buffer.from(first)
    second[0] = 1
    const firstPng = await sharp(first, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toBuffer()
    const secondPng = await sharp(second, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toBuffer()

    expect(await decodedPngSha256(firstPng)).not.toBe(await decodedPngSha256(secondPng))
  })

  it('rejects invalid PNG dimensions and embedded-profile ambiguity', async () => {
    const wrongSize = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'black' } }).png().toBuffer()
    const profiled = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: 'black' } }).withMetadata().png().toBuffer()

    await expect(decodedPngSha256(wrongSize)).rejects.toThrow()
    await expect(decodedPngSha256(profiled)).rejects.toThrow()
    await expect(decodedPngSha256(Buffer.from('not a png'))).rejects.toThrow()
  })

  it('rejects animated or multi-page PNG input when sharp can encode APNG', async ({ skip }) => {
    const frame = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: 'black' } }).png().toBuffer()
    let animated: Buffer
    try {
      animated = await sharp([frame, frame], { join: { animated: true } }).png().toBuffer()
    } catch {
      skip('installed sharp cannot encode APNG fixtures')
      return
    }

    await expect(decodedPngSha256(animated)).rejects.toThrow()
  })

  it('uses lowercase SHA-256 of canonical UTF-8 bytes', () => {
    const bytes = canonicalJsonBytes({ a: 'b' })
    expect(canonicalJsonSha256({ a: 'b' })).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})
