import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { parseMonsterSpec } from './schema.js'
import { makeValidMonsterSpecFixture } from './test-fixtures.js'

describe('MonsterSpecSchema', () => {
  it('accepts exactly fourteen visual slots and eight semantic slots', () => {
    const input = makeValidMonsterSpecFixture()
    expect(Object.keys(input.visualSlots)).toHaveLength(14)
    expect(VISUAL_SLOT_IDS).toHaveLength(14)
    expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
  })

  it('rejects a missing mandatory slot without mutating input', () => {
    const input = makeValidMonsterSpecFixture()
    const snapshot = structuredClone(input)
    delete input.visualSlots.eyes
    const result = parseMonsterSpec(input)
    expect(result.ok).toBe(false)
    expect(snapshot.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  })
})
