import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { requirePixelSceneCatalogV1 } from '../../asset-catalog/src/pixel-scene-catalog.js'
import {
  composePixelScene,
  loadPixelScene,
  outlineSceneBackdrop,
  verifyScenePng,
} from './pixel-scene-render.js'

const put = (pixels: Uint8ClampedArray, width: number, x: number, y: number, rgba: number[]) =>
  pixels.set(rgba, (y * width + x) * 4)
const get = (pixels: Uint8ClampedArray, x: number, y: number) =>
  [...pixels.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)]
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

function catalogFixture() {
  const content = {
    schemaVersion: 'pixel-scene-catalog-v1',
    sceneVersion: '1.0.0-candidate.1',
    rendererVersion: 'pixel-scene-rgba-v1',
    canvas: { width: 96, height: 64 },
    subject: {
      schemaVersion: 'feline-phenotype-v2', catalogSchemaVersion: 'pixel-art-catalog-v3',
      rendererVersion: 'pixel-rgba-v1', width: 64, height: 64, anchor: { x: 16, y: 0 },
    },
    outline: { owner: 'scene-renderer', neighborhood: 'four', width: 1, color: 'adjacent-mean-darken', factor: 0.36 },
    resources: {
      'scene-a': { path: 'assets/a.png', sha256: 'a'.repeat(64), width: 96, height: 64 },
      'scene-b': { path: 'assets/b.png', sha256: 'b'.repeat(64), width: 96, height: 64 },
      'scene-c': { path: 'assets/c.png', sha256: 'c'.repeat(64), width: 96, height: 64 },
    },
    backdrops: {
      'doodle-horizon': { resourceId: 'scene-a', rarity: 'N', growthRank: 1, review: 'pending' },
      'doodle-leaf-shadow': { resourceId: 'scene-b', rarity: 'R', growthRank: 2, review: 'pending' },
      'doodle-rainbow-trail': { resourceId: 'scene-c', rarity: 'L', growthRank: 3, review: 'pending' },
    },
    growth: { slot: 'backdrop', order: ['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'] },
    validatedSubject: { artVersion: '1.6.1', revision: 'd'.repeat(64) },
    generatable: [],
    evidence: { 'docs/qa/approval.json': 'e'.repeat(64) },
  }
  return requirePixelSceneCatalogV1({ ...content, revision: sha(canonicalJson(content)) })
}

const subject = {
  schemaVersion: 'pixel-art-catalog-v3', rendererVersion: 'pixel-rgba-v1', size: 64,
  artVersion: '1.6.1', revision: 'd'.repeat(64),
}
const horizonState = { schemaVersion: 'pixel-scene-state-v1' as const, backdrop: 'doodle-horizon' as const }

describe('pixel-scene-rgba-v1', () => {
  it('draws one four-neighbor outline ring with adjacent-mean darkening', () => {
    const source = new Uint8ClampedArray(96 * 64 * 4)
    put(source, 96, 10, 10, [100, 50, 25, 255])
    put(source, 96, 11, 10, [200, 100, 50, 255])
    const before = new Uint8ClampedArray(source)
    const output = outlineSceneBackdrop(source)
    expect(get(output, 10, 9)).toEqual([36, 18, 9, 255])
    expect(get(output, 10, 11)).toEqual([36, 18, 9, 255])
    expect(get(output, 9, 9)).toEqual([0, 0, 0, 0])
    expect(get(output, 10, 8)).toEqual([0, 0, 0, 0])
    expect(get(output, 10, 10)).toEqual([100, 50, 25, 255])
    expect(source).toEqual(before)
  })

  it('centers a none scene at x=16 without mutating the cat', () => {
    const cat = new Uint8ClampedArray(64 * 64 * 4)
    put(cat, 64, 0, 0, [9, 8, 7, 255])
    put(cat, 64, 63, 63, [6, 5, 4, 255])
    const before = new Uint8ClampedArray(cat)
    const scene = composePixelScene(
      { schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, catalogFixture(), subject, cat, {},
    )
    expect(scene).toHaveLength(96 * 64 * 4)
    expect(get(scene, 16, 0)).toEqual([9, 8, 7, 255])
    expect(get(scene, 79, 63)).toEqual([6, 5, 4, 255])
    expect(get(scene, 15, 0)).toEqual([0, 0, 0, 0])
    expect(cat).toEqual(before)
  })

  it('draws the cat over both backdrop and outline', () => {
    const backdrop = new Uint8ClampedArray(96 * 64 * 4)
    put(backdrop, 96, 15, 0, [100, 100, 100, 255])
    put(backdrop, 96, 16, 1, [120, 120, 120, 255])
    const cat = new Uint8ClampedArray(64 * 64 * 4)
    put(cat, 64, 0, 0, [9, 8, 7, 255])
    put(cat, 64, 0, 1, [6, 5, 4, 255])
    const scene = composePixelScene(horizonState, catalogFixture(), subject, cat, { 'scene-a': backdrop })
    expect(get(scene, 16, 0)).toEqual([9, 8, 7, 255])
    expect(get(scene, 16, 1)).toEqual([6, 5, 4, 255])
  })

  it('fails closed on wrong dimensions, missing layers and nonbinary alpha', () => {
    const catalog = catalogFixture()
    const validCat = new Uint8ClampedArray(64 * 64 * 4)
    const validBackdrop = new Uint8ClampedArray(96 * 64 * 4)
    put(validBackdrop, 96, 10, 10, [1, 2, 3, 255])
    expect(() => composePixelScene(horizonState, catalog, subject, new Uint8ClampedArray(4), { 'scene-a': validBackdrop })).toThrow(/dimensions/i)
    expect(() => composePixelScene(horizonState, catalog, subject, validCat, {})).toThrow(/missing/i)
    expect(() => composePixelScene(horizonState, catalog, subject, validCat, { 'scene-a': new Uint8ClampedArray(4) })).toThrow(/dimensions/i)
    const badBackdrop = new Uint8ClampedArray(validBackdrop); badBackdrop[3] = 1
    expect(() => composePixelScene(horizonState, catalog, subject, validCat, { 'scene-a': badBackdrop })).toThrow(/alpha/i)
    const badCat = new Uint8ClampedArray(validCat); badCat[3] = 1
    expect(() => composePixelScene(horizonState, catalog, subject, badCat, { 'scene-a': validBackdrop })).toThrow(/alpha/i)
  })

  it('rejects incompatible subjects and unknown scene states', () => {
    const catalog = catalogFixture()
    const cat = new Uint8ClampedArray(64 * 64 * 4)
    expect(() => composePixelScene(horizonState, catalog, { ...subject, size: 96 }, cat, {})).toThrow(/subject/i)
    expect(() => composePixelScene(
      { schemaVersion: 'pixel-scene-state-v1', backdrop: 'unknown' } as any, catalog, subject, cat, {},
    )).toThrow(/backdrop/i)
  })

  it('verifies rectangular PNG identity and dimensions before decode', async () => {
    const file = new URL('../../../docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png', import.meta.url)
    const bytes = await readFile(file)
    const resource = { path: 'assets/horizon.png', sha256: sha(bytes), width: 96 as const, height: 64 as const }
    await expect(verifyScenePng(bytes, resource)).resolves.toBeUndefined()
    const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1]! ^= 1
    await expect(verifyScenePng(corrupt, resource)).rejects.toThrow(/SHA-256/i)
    await expect(verifyScenePng(bytes, { ...resource, width: 64 as any })).rejects.toThrow(/dimensions/i)
  })

  it('loader rejects corrupt bytes before browser decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
    try {
      await expect(loadPixelScene(catalogFixture(), subject, resource => resource.path)).rejects.toThrow(/SHA-256/i)
      expect(decode).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
