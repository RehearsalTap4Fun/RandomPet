import { describe, expect, it } from 'vitest'
import { generateMonster, type Catalog } from './index.js'
import { makeValidCatalogFixture } from './test-fixtures.js'

function catalogWithOnlyModifier(id: string): Catalog {
  const catalog = makeValidCatalogFixture()
  const modifier = catalog.modifiers.find(item => item.id === id)
  if (modifier === undefined) {
    throw new Error(`Fixture modifier ${id} is missing.`)
  }
  return { ...catalog, modifiers: [modifier] }
}

describe('modifier applications', () => {
  it('keeps base visual slots unchanged when applying albino', () => {
    const catalog = catalogWithOnlyModifier('mutation_albino')
    const normal = generateMonster({ seed: '84721937', themeId: 'fungal', mode: 'normal' }, catalog)
    const mutated = generateMonster({ seed: '84721937', themeId: 'fungal', mode: 'mutation' }, catalog)

    expect(mutated.blocked).toBe(false)
    expect(mutated.spec.visualSlots).toEqual(normal.spec.visualSlots)
    expect(mutated.spec.mutation).toEqual({
      id: 'mutation_albino',
      overrides: { palette: 'albino' },
    })
  })

  it('stores double-head expansion as an override without displacing base slots', () => {
    const catalog = catalogWithOnlyModifier('mutation_double_head')
    const result = generateMonster({ seed: '84721937', themeId: 'fungal', mode: 'mutation' }, catalog)

    expect(result.blocked).toBe(false)
    expect(result.spec.mutation).toEqual({
      id: 'mutation_double_head',
      overrides: { duplicateLayerGroup: 'head' },
    })
    expect(result.spec.visualSlots.headShape.partId).toBe('head_round')
  })

  it('stores color-discord as the only aberration', () => {
    const result = generateMonster(
      { seed: '84721937', themeId: 'fungal', mode: 'aberration' },
      catalogWithOnlyModifier('aberration_color_discord'),
    )

    expect(result.blocked).toBe(false)
    expect(result.spec.mutation).toBeNull()
    expect(result.spec.aberrations).toEqual([{
      id: 'aberration_color_discord',
      overrides: { palette: 'discord' },
    }])
  })

  it('includes a mutation only when the selected aberration requests one', () => {
    const catalog = makeValidCatalogFixture()
    const aberration = catalog.modifiers.find(item => item.id === 'aberration_misplaced_eye')!
    const mutation = catalog.modifiers.find(item => item.id === 'mutation_albino')!
    catalog.modifiers = [{ ...aberration, requiresMutation: true }, mutation]

    const result = generateMonster({ seed: '84721937', themeId: 'fungal', mode: 'aberration' }, catalog)

    expect(result.blocked).toBe(false)
    expect(result.spec.mutation?.id).toBe('mutation_albino')
    expect(result.spec.aberrations).toEqual([{
      id: 'aberration_misplaced_eye',
      overrides: { socket: 'headAlternate' },
    }])
  })
})
