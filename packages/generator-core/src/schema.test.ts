import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { parseMonsterSpec } from './schema.js'
import { makeValidCatalogFixture, makeValidMonsterSpecFixture } from './test-fixtures.js'

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

  it('returns a clone isolated from successful parse input', () => {
    const input = makeValidMonsterSpecFixture()
    const result = parseMonsterSpec(input)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected the valid fixture to parse')
    }

    expect(result.value).not.toBe(input)
    expect(result.value.visualSlots).not.toBe(input.visualSlots)
    result.value.visualSlots.eyes.partId = 'eyes_round'
    expect(input.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  })

  it('builds a catalog fixture with unique part IDs', () => {
    const partIds = makeValidCatalogFixture().parts.map(part => part.id)
    expect(new Set(partIds).size).toBe(partIds.length)
  })
})
