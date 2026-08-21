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

  it('uses independent deterministic personality and quirk substreams', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    catalog.semanticTraits.push(
      { id: 'personality_bold', semanticSlotId: 'personality' },
      { id: 'personality_patient', semanticSlotId: 'personality' },
      { id: 'quirk_hums', semanticSlotId: 'quirk' },
      { id: 'quirk_collects_shells', semanticSlotId: 'quirk' },
    )
    const traits = projectSemanticTraits(spec.visualSlots, spec.seed, catalog)

    expect(Object.keys(traits)).toHaveLength(8)
    expect(traits.personality).toEqual({ primaryTraitId: 'personality_patient', detailTraitIds: [] })
    expect(traits.quirk).toEqual({ primaryTraitId: 'quirk_hums', detailTraitIds: [] })
    expect(projectSemanticTraits(spec.visualSlots, spec.seed, catalog)).toEqual(traits)
  })

  it('uses fixed equal-priority tie-breaks and stably deduplicates trait IDs', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const traitsByPartId: Record<string, string> = {
      extra_wings: 'appendage_extra',
      tail_anchor: 'appendage_shared',
      legs_webbed: 'appendage_shared',
      arms_short: 'appendage_arms',
      eyes_asymmetric: 'head_eyes',
      head_antennae: 'head_appendage',
      head_round: 'head_shape',
      oral_teeth: 'mouth_oral',
      mouth_wide: 'mouth_shape_trait',
      pattern_spots: 'pattern_visual',
      color_scheme_ocean: 'pattern_color',
    }
    const slotByTraitId = {
      appendage_extra: 'appendage',
      appendage_shared: 'appendage',
      appendage_arms: 'appendage',
      head_eyes: 'headAndEyes',
      head_appendage: 'headAndEyes',
      head_shape: 'headAndEyes',
      mouth_oral: 'mouth',
      mouth_shape_trait: 'mouth',
      pattern_visual: 'pattern',
      pattern_color: 'pattern',
    } as const
    catalog.parts = catalog.parts.map(part => {
      const semanticTraitId = traitsByPartId[part.id]
      return semanticTraitId === undefined ? part : { ...part, semanticTraitId, semanticPriority: 10 }
    })
    catalog.semanticTraits.push(...Object.entries(slotByTraitId).map(([id, semanticSlotId]) => ({ id, semanticSlotId })))

    const projection = projectSemanticTraits(spec.visualSlots, spec.seed, catalog)
    expect(projection.appendage).toEqual({
      primaryTraitId: 'appendage_extra',
      detailTraitIds: ['appendage_shared', 'appendage_arms'],
    })
    expect(projection.headAndEyes).toEqual({
      primaryTraitId: 'head_eyes',
      detailTraitIds: ['head_appendage', 'head_shape'],
    })
    expect(projection.mouth).toEqual({
      primaryTraitId: 'mouth_oral',
      detailTraitIds: ['mouth_shape_trait'],
    })
    expect(projection.pattern).toEqual({
      primaryTraitId: 'pattern_visual',
      detailTraitIds: ['pattern_color'],
    })
  })
})
