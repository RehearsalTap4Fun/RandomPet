import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical-json.js'
import { canonicalJson as catalogCanonicalJson, pixelArtPointSchema, pixelArtPolygonSchema, pixelArtResourceSchema, pixelArtStepSchema } from '../../asset-catalog/src/pixel-art-catalog.js'

describe('shared canonical JSON and pixel validators', () => {
  it('keeps the catalog canonical JSON export backed by the core serializer', () => {
    const value = { z: [true, { b: 2, a: 1 }], a: 'cat' }
    expect(canonicalJson(value)).toBe('{"a":"cat","z":[true,{"a":1,"b":2}]}')
    expect(catalogCanonicalJson).toBe(canonicalJson)
  })

  it('exports the v1 resource and geometry schemas used by parallel catalogs', () => {
    expect(pixelArtPointSchema.safeParse([64, 0]).success).toBe(true)
    expect(pixelArtPointSchema.safeParse([64.1, 0]).success).toBe(false)
    expect(pixelArtPolygonSchema.safeParse([[0, 0], [1, 0], [0, 1]]).success).toBe(true)
    expect(pixelArtResourceSchema.safeParse({ path: 'assets/body.png', sha256: 'a'.repeat(64), width: 64, height: 64 }).success).toBe(true)
    expect(pixelArtStepSchema.safeParse({ slot: 'body', target: 'subject', resources: {}, clear: [], occlusion: [] }).success).toBe(true)
  })
})
