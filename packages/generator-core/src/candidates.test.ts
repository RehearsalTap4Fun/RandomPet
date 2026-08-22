import { describe, expect, it } from 'vitest'
import { buildCandidates, createRng, type Rng, type VisualPartDefinition } from './index.js'
import { makeValidCatalogFixture } from './test-fixtures.js'

function scriptedRng(...values: number[]): Rng {
  let index = 0
  return {
    nextFloat() {
      const value = values[index]
      index += 1
      if (value === undefined) throw new Error(`Unexpected RNG read at index ${index - 1}`)
      return value
    },
  }
}

describe('candidate pool boundaries', () => {
  it('never exposes a cross-theme colorScheme candidate across many deterministic seeds', () => {
    const catalog = makeValidCatalogFixture()
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    catalog.parts = [
      { ...color, id: 'color_fungal', themeIds: ['fungal'] },
      { ...color, id: 'color_deep_sea', themeIds: ['deep-sea'] },
      { ...color, id: 'color_shadow', themeIds: ['shadow'] },
    ]

    for (let seed = 0; seed < 1_000; seed += 1) {
      const result = buildCandidates({
        catalog,
        slotId: 'colorScheme',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng: createRng(['hard-theme-color', seed]),
      })
      expect(result.trace.rangeMode).toBe('theme')
      expect(result.trace.candidateIds).toEqual(['color_fungal'])
      expect(result.part?.id).toBe('color_fungal')
    }
  })

  it('retains both 70-percent theme and 30-percent full-pool branches for non-color slots', () => {
    const catalog = makeValidCatalogFixture()
    const eye = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts = [
      { ...eye, id: 'eyes_fungal', themeIds: ['fungal'] },
      { ...eye, id: 'eyes_deep_sea', themeIds: ['deep-sea'] },
    ]
    const counts = { theme: 0, full: 0 }
    for (let seed = 0; seed < 1_000; seed += 1) {
      const result = buildCandidates({
        catalog,
        slotId: 'eyes',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng: createRng(['soft-theme-eyes', seed]),
      })
      counts[result.trace.rangeMode] += 1
    }
    expect(counts.theme).toBeGreaterThanOrEqual(650)
    expect(counts.theme).toBeLessThanOrEqual(750)
    expect(counts.full).toBe(1_000 - counts.theme)
  })

  it('forces the theme branch below 0.7 and the full-pool branch at 0.7', () => {
    const catalog = makeValidCatalogFixture()
    const themePart = catalog.parts.find(part => part.slotId === 'eyes')!
    const fullOnlyPart = { ...themePart, id: 'eyes_full_only', themeIds: ['deep-sea' as const] }
    catalog.parts = [themePart, fullOnlyPart]

    const themed = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0.699_999, 0, 0.999),
    })
    const full = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0.7, 0, 0.999),
    })

    expect(themed.trace.rangeMode).toBe('theme')
    expect(themed.trace.candidateIds).toEqual(['eyes_asymmetric'])
    expect(themed.part?.id).toBe('eyes_asymmetric')
    expect(full.trace.rangeMode).toBe('full')
    expect(full.trace.candidateIds).toEqual(['eyes_asymmetric', 'eyes_full_only'])
    expect(full.part?.id).toBe('eyes_full_only')
  })

  it('falls back to the full pool only when the selected theme pool is empty', () => {
    const catalog = makeValidCatalogFixture()
    const part = catalog.parts.find(item => item.slotId === 'eyes')!
    catalog.parts = [{ ...part, id: 'eyes_deep_sea_only', themeIds: ['deep-sea'] }]

    const result = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0, 0),
    })

    expect(result.trace.rangeMode).toBe('full')
    expect(result.trace.candidateIds).toEqual(['eyes_deep_sea_only'])
    expect(result.part?.id).toBe('eyes_deep_sea_only')
  })

  it('renormalizes N and L rarity weights when R is unavailable', () => {
    const catalog = makeValidCatalogFixture()
    const normal = catalog.parts.find(part => part.slotId === 'eyes')!
    const legendary = { ...normal, id: 'eyes_legendary', rarity: 'L' as const }
    catalog.parts = [normal, legendary]

    const normalResult = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0.92, 0),
    })
    const legendaryResult = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0.94, 0),
    })

    expect(normalResult.trace.rarityRoll).toBe('N')
    expect(normalResult.part?.id).toBe('eyes_asymmetric')
    expect(legendaryResult.trace.rarityRoll).toBe('L')
    expect(legendaryResult.part?.id).toBe('eyes_legendary')
  })

  it('applies every hard filter before theme and rarity pooling', () => {
    const catalog = makeValidCatalogFixture()
    const eye = catalog.parts.find(part => part.slotId === 'eyes')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const selectedArms = { ...arms, excludes: ['eyes_reverse_excluded'] }
    const candidates: VisualPartDefinition[] = [
      { ...eye, id: 'eyes_valid' },
      { ...eye, id: 'eyes_wrong_rig', compatibleRigs: ['biped'] },
      { ...eye, id: 'eyes_missing_socket', socket: 'missingSocket' },
      { ...eye, id: 'eyes_forward_excluded', excludes: [selectedArms.id] },
      { ...eye, id: 'eyes_reverse_excluded' },
      { ...eye, id: 'eyes_missing_asset', assetPath: '' },
    ]
    catalog.parts = [selectedArms, ...candidates]

    const result = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: { arms: { partId: selectedArms.id, rigId: 'blob' } },
      rng: scriptedRng(0, 0, 0),
    })

    expect(result.trace.rangeMode).toBe('theme')
    expect(result.trace.rarityRoll).toBe('N')
    expect(result.trace.candidateIds).toEqual(['eyes_valid'])
    expect(result.trace.finalWeights).toEqual({ eyes_valid: 1 })
    expect(result.part?.id).toBe('eyes_valid')
  })
})
