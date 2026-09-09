import { describe, expect, it } from 'vitest'
import { V09_TRAIT_SLOT_IDS, generateMonsterV09, rerollV09Skeleton, rerollV09Slot } from './index.js'
import { fixtureCatalog } from './v09-generation.test.js'

describe('v0.9 rerolls', () => {
  it('uses independent skeleton and slot domains', () => {
    const first = generateMonsterV09({ seed: 'same', slotRolls: {} }, fixtureCatalog())
    const rerolled = rerollV09Slot({ spec: first.spec, slotId: 'eyes' }, fixtureCatalog())

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.skeletonFamilyId).toBe(first.spec.skeletonFamilyId)
    expect(rerolled.spec.visualSlots.bodyColor).toEqual(first.spec.visualSlots.bodyColor)
    expect(rerolled.spec.visualSlots.eyes).not.toEqual(first.spec.visualSlots.eyes)
    expect(rerolled.affectedSlots).toEqual(['eyes'])
  })

  it('rebuilds all skeleton projections from the next whole-skeleton roll', () => {
    const first = generateMonsterV09({ seed: 'reroll-71', slotRolls: {} }, fixtureCatalog())
    const rerolled = rerollV09Skeleton({ spec: first.spec }, fixtureCatalog())

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.skeletonSelection.roll).toBe(first.spec.skeletonSelection.roll + 1)
    expect(rerolled.affectedSlots).toEqual(V09_TRAIT_SLOT_IDS)
    expect(Object.values(rerolled.spec.visualSlots).every(selection => selection.roll === 0)).toBe(true)
  })

  it('fails closed instead of retrying an incompatible skeleton projection during reroll', () => {
    const first = generateMonsterV09({ seed: 'reroll-71', slotRolls: {} }, fixtureCatalog())
    const rerolled = rerollV09Skeleton({ spec: first.spec }, fixtureCatalog('eyes_l_legendary-cat_0'))

    expect(rerolled).toMatchObject({
      blocked: true,
      diagnostics: [expect.objectContaining({ code: 'SKELETON_PROJECTION_MISSING' })],
    })
  })
})
