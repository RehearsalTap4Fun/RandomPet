import { describe, expect, it } from 'vitest'
import { migratePixelSceneStateV1, pixelSceneStateKey, requirePixelSceneStateV1 } from './pixel-scene-state.js'

describe('pixel-scene-state-v1', () => {
  it.each(['none', 'doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'] as const)('accepts %s', backdrop => {
    const state = { schemaVersion: 'pixel-scene-state-v1' as const, backdrop }
    expect(requirePixelSceneStateV1(state)).toEqual(state)
    expect(pixelSceneStateKey(state)).toBe(JSON.stringify(['pixel-scene-state-v1', backdrop]))
  })

  it('migrates only a missing backdrop to none', () => {
    expect(migratePixelSceneStateV1({})).toEqual({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' })
    expect(() => migratePixelSceneStateV1({ backdrop: 'unknown' })).toThrow(/backdrop/i)
    expect(() => migratePixelSceneStateV1({ backdrop: null })).toThrow(/backdrop/i)
  })

  it('rejects unknown fields and schema versions', () => {
    expect(() => requirePixelSceneStateV1({ schemaVersion: 'pixel-scene-state-v1', backdrop: 'none', path: 'x.png' })).toThrow()
    expect(() => requirePixelSceneStateV1({ schemaVersion: 'pixel-scene-state-v2', backdrop: 'none' })).toThrow()
  })
})
