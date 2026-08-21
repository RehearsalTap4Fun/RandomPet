import { describe, expect, it } from 'vitest'
import { makeValidMonsterSpecFixture } from '../../generator-core/src/test-fixtures.js'
import { toGenerationRequest, toIncubatorRecord } from './index.js'

describe('incubator adapter', () => {
  it('exports exactly eight legacy traits and preserves the complete visual extension', () => {
    const spec = makeValidMonsterSpecFixture()
    const record = toIncubatorRecord(spec)

    expect(record.traits).toHaveLength(8)
    expect(record.traits).toEqual([
      'frame_blob',
      'appendage_anchor_tail',
      'head_round',
      'mouth_wide',
      'surface_gel',
      'pattern_spots',
      'personality_curious',
      'quirk_bioluminescent',
    ])
    expect(record.visualExtension.visualSlots).toEqual(spec.visualSlots)
    expect(Object.keys(record.visualExtension.visualSlots)).toHaveLength(14)
  })

  it('maps deep_sea to the generator spelling', () => {
    const input = {
      id: 'egg-1', theme: 'deep_sea', seed: 42, risk: 0, mutationBonus: 0,
    } as const
    const request = toGenerationRequest(input)

    expect(request).toMatchObject({ seed: '42', themeId: 'deep-sea' })
    expect(toGenerationRequest(input)).toEqual(request)
  })

  it('rolls an aberration before mutation when both chances apply', () => {
    const request = toGenerationRequest({
      id: 'egg-2', theme: 'fungal', seed: '0', risk: 1, mutationBonus: 1,
    })

    expect(request.mode).toBe('aberration')
  })

  it('caps risk and mutation chance while normalizing invalid numeric values', () => {
    const cappedRisk = toGenerationRequest({
      id: 'egg-3', theme: 'fungal', seed: 'fungal-egg', risk: 999, mutationBonus: 0,
    })
    const cappedMutation = toGenerationRequest({
      id: 'egg-3', theme: 'fungal', seed: 'fungal-egg', risk: 0, mutationBonus: 999,
    })
    const invalid = toGenerationRequest({
      id: 'egg-3', theme: 'fungal', seed: 'fungal-egg', risk: Number.NaN, mutationBonus: Number.NaN,
    })

    expect(cappedRisk.mode).toBe('normal')
    expect(cappedMutation.mode).toBe('mutation')
    expect(invalid.mode).toBe('normal')
  })
})
