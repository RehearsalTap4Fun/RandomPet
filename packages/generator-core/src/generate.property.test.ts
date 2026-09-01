import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  GENOME_LAYERS,
  generateMonster,
  strongNonFacialFeatureCount,
  validateMonsterSpecAgainstCatalog,
  VISUAL_SLOT_IDS,
} from './index.js'
import { createRng, slotSeedParts } from './prng.js'
import { makeCompositionCatalogFixture, makeValidCatalogFixture } from './test-fixtures.js'

describe('generation properties', () => {
  it('keeps arbitrary generated phenotypes within the non-facial strong-feature budget', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    for (const slotId of ['surfaceMaterial', 'pattern', 'effect'] as const) {
      const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
      catalog.parts.push({
        ...structuredClone(source),
        id: `${slotId}_property_strong_nonfacial`,
        baseWeight: 1_000_000_000,
        composition: {
          ...structuredClone(source.composition!),
          visualIntensity: 'strong',
          renderNodes: source.composition!.renderNodes.map(node => ({
            ...node,
            id: `${slotId}_property_strong_nonfacial_${node.id}`,
          })),
        },
      })
    }

    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 64 }), seed => {
      const result = generateMonster({ seed, themeId: 'fungal', mode: 'normal' }, catalog)
      expect(strongNonFacialFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(1)
    }), { numRuns: 200 })
  })

  it('terminates with a legal result or structured errors for arbitrary seeds', () => {
    const catalog = makeValidCatalogFixture()
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 64 }), seed => {
      const result = generateMonster({ seed, themeId: 'fungal', mode: 'normal' }, catalog)
      expect(result.spec.seed).toBe(seed)
      if (result.blocked) {
        expect(result.diagnostics.some(item => item.severity === 'error')).toBe(true)
      } else {
        expect(Object.keys(result.spec.visualSlots)).toHaveLength(14)
        expect(Object.keys(result.spec.semanticTraits)).toHaveLength(8)
        expect(result.spec.genome).toBeDefined()
        for (const slotId of VISUAL_SLOT_IDS) {
          expect(result.spec.genome!.genes[slotId].P).toBe(result.spec.visualSlots[slotId].partId)
          for (const layer of GENOME_LAYERS) {
            expect(result.spec.genome!.genes[slotId][layer].length).toBeGreaterThan(0)
          }
        }
        expect(validateMonsterSpecAgainstCatalog(result.spec, catalog)
          .filter(item => item.severity === 'error')).toEqual([])
      }
    }), { numRuns: 1000 })
  })

  it('uses the fixed theme-pool and rarity distributions', () => {
    const catalog = makeValidCatalogFixture()
    const template = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts = (['N', 'R', 'L'] as const).flatMap(rarity => [
      { ...template, id: `eyes_theme_${rarity}`, rarity, themeIds: ['fungal'] },
      { ...template, id: `eyes_full_${rarity}`, rarity, themeIds: ['deep-sea'] },
    ])
    const counts = { theme: 0, N: 0, R: 0, L: 0 }
    for (let index = 0; index < 20_000; index += 1) {
      const rng = createRng(slotSeedParts(`distribution-${index}`, 'fungal', 'eyes', 0))
      const result = buildCandidates({
        catalog,
        slotId: 'eyes',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng,
      })
      if (result.trace.rangeMode === 'theme') counts.theme += 1
      counts[result.trace.rarity] += 1
    }
    expect(counts.theme, JSON.stringify(counts)).toBeGreaterThanOrEqual(13_600)
    expect(counts.theme, JSON.stringify(counts)).toBeLessThanOrEqual(14_400)
    expect(counts.N, JSON.stringify(counts)).toBeGreaterThanOrEqual(13_600)
    expect(counts.N, JSON.stringify(counts)).toBeLessThanOrEqual(14_400)
    expect(counts.R, JSON.stringify(counts)).toBeGreaterThanOrEqual(4_600)
    expect(counts.R, JSON.stringify(counts)).toBeLessThanOrEqual(5_400)
    expect(counts.L, JSON.stringify(counts)).toBeGreaterThanOrEqual(800)
    expect(counts.L, JSON.stringify(counts)).toBeLessThanOrEqual(1_200)
  })
})
