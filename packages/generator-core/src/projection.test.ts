import { describe, expect, it } from 'vitest'
import { projectSemanticTraits } from './projection.js'
import { makeValidCatalogFixture, makeValidMonsterSpecFixture } from './test-fixtures.js'

describe('projectSemanticTraits', () => {
  it('chooses the highest semantic priority and retains details', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.visualSlots.tail.partId = 'tail_anchor'
    spec.visualSlots.legs.partId = 'legs_webbed'
    const projection = projectSemanticTraits(spec.visualSlots, spec.seed, catalog)
    expect(projection.appendage).toEqual({
      primaryTraitId: 'appendage_anchor_tail',
      detailTraitIds: ['appendage_webbed_feet'],
    })
  })

  it('fills all eight slots and deterministically selects semantic-only traits', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const traits = projectSemanticTraits(spec.visualSlots, spec.seed, catalog)
    expect(Object.keys(traits)).toHaveLength(8)
    expect(traits.personality).toEqual(projectSemanticTraits(spec.visualSlots, spec.seed, catalog).personality)
    expect(traits.quirk).toEqual(projectSemanticTraits(spec.visualSlots, spec.seed, catalog).quirk)
  })
})
