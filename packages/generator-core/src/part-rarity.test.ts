import { describe, expect, it } from 'vitest'
import {
  createRng,
  generateMonster,
  pickIndependentPartTier,
  rerollSlot,
  validateAnatomyBundleSpec,
  VISUAL_SLOT_IDS,
} from './index.js'
import { slotSeedParts } from './prng.js'
import { makeV07FelinePartLibraryFixture } from './test-fixtures.js'

describe('independent part rarity', () => {
  it('keeps every v0.8 slot close to the 8:4:1 tier weights across 13,000 deterministic seeds', () => {
    for (const slotId of VISUAL_SLOT_IDS) {
      const counts = { N: 0, R: 0, L: 0 }
      for (let index = 0; index < 13_000; index += 1) {
        const rng = createRng([
          ...slotSeedParts(`v08-frequency-${index}`, 'fungal', slotId, 0),
          'part-rarity',
        ])
        counts[pickIndependentPartTier(rng)] += 1
      }
      expect(counts.N / 13_000, `${slotId}:N`).toBeCloseTo(8 / 13, 1)
      expect(counts.R / 13_000, `${slotId}:R`).toBeCloseTo(4 / 13, 1)
      expect(counts.L / 13_000, `${slotId}:L`).toBeCloseTo(1 / 13, 1)
    }
  })

  it('uses exact 8:4:1 tier boundaries', () => {
    const rng = (value: number) => ({ nextFloat: () => value })

    expect(pickIndependentPartTier(rng(0))).toBe('N')
    expect(pickIndependentPartTier(rng((8 / 13) - Number.EPSILON))).toBe('N')
    expect(pickIndependentPartTier(rng(8 / 13))).toBe('R')
    expect(pickIndependentPartTier(rng((12 / 13) - Number.EPSILON))).toBe('R')
    expect(pickIndependentPartTier(rng(12 / 13))).toBe('L')
  })

  it('selects all fourteen v0.7 slots independently and permits multiple high-rarity parts', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const seen = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, new Set<string>()])) as Record<
      typeof VISUAL_SLOT_IDS[number],
      Set<string>
    >
    let hasMultipleHighRarityParts = false
    for (let index = 0; index < 400; index += 1) {
      const result = generateMonster({
        seed: `tier-${index}`,
        themeId: 'fungal',
        mode: 'normal',
        archetypeId: 'feline',
      }, catalog)
      expect(result.blocked).toBe(false)
      const highRarityCount = VISUAL_SLOT_IDS.filter(slotId => {
        const partId = result.spec.visualSlots[slotId].partId
        seen[slotId].add(partId)
        expect(result.spec.genome!.genes[slotId].P).toBe(partId)
        return /_[rl]_/.test(partId)
      }).length
      hasMultipleHighRarityParts ||= highRarityCount >= 2
    }
    for (const slotId of VISUAL_SLOT_IDS) {
      expect([...seen[slotId]].some(id => id.includes('_r_')), slotId).toBe(true)
      expect([...seen[slotId]].some(id => id.includes('_l_')), slotId).toBe(true)
    }
    expect(hasMultipleHighRarityParts).toBe(true)
  })

  it('keeps a fixed mixed-tier vector slot-scoped when one visual slot rerolls', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const initial = generateMonster({
      seed: 'vector-0', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
      slotId,
      initial.spec.visualSlots[slotId].partId,
    ]))).toEqual({
      bodyFrame: 'bodyFrame_l_1',
      headShape: 'headShape_n_8',
      eyes: 'eyes_n_4',
      mouthShape: 'mouthShape_n_6',
      oralDetail: 'oralDetail_r_1',
      headAppendage: 'headAppendage_n_7',
      arms: 'arms_r_2',
      legs: 'legs_r_3',
      tail: 'tail_n_1',
      extraAppendage: 'extraAppendage_n_8',
      surfaceMaterial: 'surfaceMaterial_n_2',
      pattern: 'pattern_r_4',
      colorScheme: 'colorScheme_l_1',
      effect: 'effect_n_5',
    })

    const rerolled = rerollSlot({ spec: initial.spec, slotId: 'eyes', locks: {}, catalog })

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.visualSlots.eyes.partId).toBe('eyes_n_5')
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId !== 'eyes') expect(rerolled.spec.visualSlots[slotId]).toEqual(initial.spec.visualSlots[slotId])
    }
  })

  it('keeps independently selected structural genes rather than applying derived slots', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const result = generateMonster({
      seed: 'v07-structure', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(result.blocked).toBe(false)
    expect(result.spec.anatomyBundleId).toBe('feline-sit')
    expect(result.spec.visualSlots.headShape.partId).toMatch(/^headShape_[nrl]_/)
    expect(result.spec.genome!.genes.headShape.P).toBe(result.spec.visualSlots.headShape.partId)
    expect(validateAnatomyBundleSpec(result.spec, catalog)).toEqual([])
  })
})
