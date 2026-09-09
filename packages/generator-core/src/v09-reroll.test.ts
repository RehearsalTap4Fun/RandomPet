import { describe, expect, it } from 'vitest'
import { V09_TRAIT_SLOT_IDS, generateMonsterV09, rerollV09Skeleton, rerollV09Slot } from './index.js'
import { fixtureCatalog, socketFixtureCatalog } from './v09-generation.test.js'

describe('v0.9 rerolls', () => {
  it('re-resolves oralDetail at the same roll when an open mouth changes narrow to wide', () => {
    const catalog = socketFixtureCatalog(); const first = generateMonsterV09({ seed: 'closed-4' }, catalog)
    expect(first.spec.visualSlots.mouthShape.traitId).toBe('mouthShape_c_base-cat_0')
    expect(first.spec.visualSlots.oralDetail).toEqual({ traitId: 'oralDetail_c_base-cat_6', rarity: 'common', roll: 0 })
    const rerolled = rerollV09Slot({ spec: first.spec, slotId: 'mouthShape' }, catalog)
    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.visualSlots.mouthShape.traitId).toBe('mouthShape_c_base-cat_7')
    expect(rerolled.spec.visualSlots.oralDetail).toEqual({ traitId: 'oralDetail_c_base-cat_7', rarity: 'common', roll: 0 })
    expect(rerolled.affectedSlots).toEqual(['mouthShape', 'oralDetail'])
    for (const slotId of V09_TRAIT_SLOT_IDS.filter(slot => slot !== 'mouthShape' && slot !== 'oralDetail')) expect(rerolled.spec.visualSlots[slotId]).toEqual(first.spec.visualSlots[slotId])
  })
  it('limits oral-only rerolls to the current open socket with the original RNG domain', () => {
    const catalog = socketFixtureCatalog(); const first = generateMonsterV09({ seed: 'closed-4' }, catalog)
    for (let roll = 1; roll <= 12; roll += 1) {
      const rerolled = rerollV09Slot({ spec: { ...first.spec, visualSlots: { ...first.spec.visualSlots, oralDetail: { ...first.spec.visualSlots.oralDetail, roll: roll - 1 } } }, slotId: 'oralDetail' }, catalog)
      expect(rerolled.blocked).toBe(false)
      const selected = catalog.sealedTraits.find(trait => trait.traitId === rerolled.spec.visualSlots.oralDetail.traitId)!
      expect(selected.kind === 'oralDetail' && Object.hasOwn(selected.runtimeResources.oralProjections, 'narrow')).toBe(true)
      expect(rerolled.spec.visualSlots.oralDetail.roll).toBe(roll)
      expect(rerolled.spec.visualSlots.mouthShape).toEqual(first.spec.visualSlots.mouthShape)
      expect(rerolled.affectedSlots).toEqual(['oralDetail'])
      const direct = generateMonsterV09({ seed: first.spec.seed, slotRolls: { oralDetail: roll } }, catalog)
      expect(rerolled.spec.visualSlots.oralDetail).toEqual(direct.spec.visualSlots.oralDetail)
    }
  })
  it('keeps the previous spec when a mouth reroll has no wide-compatible oral projection', () => {
    const catalog = socketFixtureCatalog(); const first = generateMonsterV09({ seed: 'closed-4' }, catalog)
    catalog.sealedTraits = catalog.sealedTraits.filter(trait => !(trait.kind === 'oralDetail' && Object.hasOwn(trait.runtimeResources.oralProjections, 'wide')))
    const result = rerollV09Slot({ spec: first.spec, slotId: 'mouthShape' }, catalog)
    expect(result.blocked).toBe(true); expect(result.spec).toEqual(first.spec)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SKELETON_PROJECTION_MISSING', path: ['visualSlots', 'oralDetail'] })])
  })
  it('fails closed without changing the spec when an oral-only reroll has no narrow pool', () => {
    const catalog = socketFixtureCatalog(); const first = generateMonsterV09({ seed: 'closed-4' }, catalog)
    catalog.sealedTraits = catalog.sealedTraits.filter(trait => !(trait.kind === 'oralDetail' && Object.hasOwn(trait.runtimeResources.oralProjections, 'narrow')))
    const result = rerollV09Slot({ spec: first.spec, slotId: 'oralDetail' }, catalog)
    expect(result.blocked).toBe(true); expect(result.spec).toEqual(first.spec)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SKELETON_PROJECTION_MISSING', path: ['visualSlots', 'oralDetail'] })])
  })
  it('uses independent skeleton and slot domains', () => {
    const first = generateMonsterV09({ seed: 'same', slotRolls: {} }, fixtureCatalog())
    const rerolled = rerollV09Slot({ spec: first.spec, slotId: 'eyes' }, fixtureCatalog())

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.skeletonFamilyId).toBe(first.spec.skeletonFamilyId)
    expect(rerolled.spec.visualSlots.bodyColor).toEqual(first.spec.visualSlots.bodyColor)
    expect(rerolled.spec.visualSlots.eyes).not.toEqual(first.spec.visualSlots.eyes)
    expect(rerolled.affectedSlots).toEqual(['eyes'])
  })

  it('restores an oral projection when a mouth reroll opens a previously closed socket', () => {
    const first = generateMonsterV09({ seed: 'closed-4', slotRolls: {} }, fixtureCatalog())
    const rerolled = rerollV09Slot({ spec: first.spec, slotId: 'mouthShape' }, fixtureCatalog())

    expect(first.spec.visualSlots.oralDetail).toEqual({ traitId: 'oral-none', rarity: 'common', roll: 0 })
    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.visualSlots.mouthShape).toEqual({ traitId: 'mouthShape_c_base-cat_7', rarity: 'common', roll: 1 })
    expect(rerolled.spec.visualSlots.oralDetail).toEqual({ traitId: 'oralDetail_c_base-cat_6', rarity: 'common', roll: 0 })
    expect(rerolled.affectedSlots).toEqual(['mouthShape', 'oralDetail'])
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
    expect(rerolled.spec.skeletonSelection.roll).toBe(first.spec.skeletonSelection.roll + 1)
    expect(rerolled.spec.visualSlots.eyes).toEqual({ traitId: 'missing_eyes', rarity: 'common', roll: 0 })
    expect(rerolled.affectedSlots).toEqual(V09_TRAIT_SLOT_IDS)
  })
})
