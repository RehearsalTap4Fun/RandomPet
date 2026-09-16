import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { requirePixelArtCatalog, resolvePixelArt } from '../../asset-catalog/src/pixel-art-catalog.js'
import * as api from './pixel-art-render.js'

const root = new URL('../../asset-catalog/pixel/v1/', import.meta.url)
const sha = (bytes: Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex')

describe('portable pixel renderer', () => {
  it('replays all fourteen independently recorded review RGBA hashes without mutating layers', async () => {
    const catalog = requirePixelArtCatalog(JSON.parse(await readFile(new URL('catalog.candidate.json', root), 'utf8')))
    const layers: Record<string, Uint8ClampedArray> = {}
    for (const [id, resource] of Object.entries(catalog.resources)) {
      layers[id] = new Uint8ClampedArray(await sharp(await readFile(new URL(resource.path, root))).ensureAlpha().raw().toBuffer())
    }
    const before = Object.fromEntries(Object.entries(layers).map(([id, bytes]) => [id, sha(bytes)]))
    expect(catalog.coverage).toHaveLength(14)
    for (const sample of catalog.coverage) {
      const pixels = api.composePixelArt(resolvePixelArt(sample.phenotype, catalog), layers)
      expect(sha(pixels), sample.id).toBe(sample.rgbaSha256)
      for (let i = 3; i < pixels.length; i += 4) expect([0, 255]).toContain(pixels[i])
    }
    expect(Object.fromEntries(Object.entries(layers).map(([id, bytes]) => [id, sha(bytes)]))).toEqual(before)
  })
  it('fails closed on missing pixels, wrong dimensions and nonbinary alpha', async () => {
    const catalog = requirePixelArtCatalog(JSON.parse(await readFile(new URL('catalog.approved.json', root), 'utf8')))
    const plan = resolvePixelArt(catalog.coverage[0]!.phenotype, catalog)
    expect(() => api.composePixelArt(plan, {})).toThrow(/missing/i)
    const id = Object.keys(plan.resources)[0]!
    expect(() => api.composePixelArt(plan, { [id]: new Uint8ClampedArray(4) })).toThrow(/dimensions/i)
    const invalid = new Uint8ClampedArray(64 * 64 * 4); invalid[3] = 1
    expect(() => api.composePixelArt(plan, { [id]: invalid })).toThrow(/alpha/i)
  })
  it('verifies catalog revisions and PNG digest before decoding', async () => {
    const text = await readFile(new URL('catalog.approved.json', root), 'utf8')
    await expect(api.verifyPixelCatalog(JSON.parse(text))).resolves.toBeDefined()
    const changed = JSON.parse(text); changed.profiles[0].steps.reverse()
    await expect(api.verifyPixelCatalog(changed)).rejects.toThrow()
    const catalog = requirePixelArtCatalog(JSON.parse(text)), resource = Object.values(catalog.resources)[0]!
    const bytes = await readFile(new URL(resource.path, root))
    await expect(api.verifyPixelPng(bytes, resource)).resolves.toBeUndefined()
    const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1]! ^= 1
    await expect(api.verifyPixelPng(corrupt, resource)).rejects.toThrow(/SHA-256/)
  })
})
