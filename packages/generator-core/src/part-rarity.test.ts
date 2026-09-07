import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  pickIndependentPartTier,
  validateAnatomyBundleSpec,
  type Rarity,
} from './index.js'
import { createRng } from './prng.js'
import { makeV07FelinePartLibraryFixture } from './test-fixtures.js'

describe('independent part rarity', () => {
  it('draws all independent tiers from the dedicated 8:4:1 weights', () => {
    const seen = new Set<Rarity>()
    for (let index = 0; index < 400; index += 1) {
      seen.add(pickIndependentPartTier(createRng([`tier-${index}`])))
    }
    expect(seen).toEqual(new Set(['N', 'R', 'L']))
  })

  it('selects each v0.7 eye part independently and projects it into the P gene', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const seen = new Set<string>()
    for (let index = 0; index < 400; index += 1) {
      const result = generateMonster({
        seed: `tier-${index}`,
        themeId: 'fungal',
        mode: 'normal',
        archetypeId: 'feline',
      }, catalog)
      expect(result.blocked).toBe(false)
      seen.add(result.spec.visualSlots.eyes.partId)
      expect(result.spec.genome!.genes.eyes.P).toBe(result.spec.visualSlots.eyes.partId)
    }
    expect([...seen].some(id => id.includes('_r_'))).toBe(true)
    expect([...seen].some(id => id.includes('_l_'))).toBe(true)
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
