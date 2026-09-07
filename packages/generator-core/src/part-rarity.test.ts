import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  pickIndependentPartTier,
  validateAnatomyBundleSpec,
  VISUAL_SLOT_IDS,
} from './index.js'
import { makeV07FelinePartLibraryFixture } from './test-fixtures.js'

describe('independent part rarity', () => {
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
