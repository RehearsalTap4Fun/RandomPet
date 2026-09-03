import {
  type AnimalArchetypeDefinition,
  type Catalog,
  type GenerationMode,
  type GenerationRequest,
  type SpecialFeatureAnchor,
  type ThemeId,
  type VisualSlotId,
} from './contracts.js'
import { createRng } from './prng.js'

export interface SpecialFeaturePlan {
  slotId: VisualSlotId | null
  anchor: SpecialFeatureAnchor | null
}

export function resolveArchetype(
  request: Pick<GenerationRequest, 'archetypeId'>,
  catalog: Catalog,
): AnimalArchetypeDefinition | null {
  if (catalog.version !== '0.6.0') return null
  return catalog.archetypes?.find(item => item.id === request.archetypeId) ?? null
}

export function planSpecialFeature(
  seed: string,
  themeId: ThemeId,
  mode: GenerationMode,
  archetype: AnimalArchetypeDefinition | null,
  catalog: Catalog,
): SpecialFeaturePlan {
  if (mode === 'normal' || archetype === null) return { slotId: null, anchor: null }
  const eligible = archetype.specialFeatureSlots.filter(slotId => catalog.parts.some(part => (
    part.slotId === slotId
      && part.archetypeIds?.includes(archetype.id) === true
      && part.featureTier === 'special'
      && part.specialFeatureAnchor !== undefined
  )))
  const slotId = eligible.length === 0
    ? null
    : eligible[Math.floor(createRng([seed, themeId, mode, archetype.id, 'special-feature']).nextFloat() * eligible.length)]!
  const part = slotId === null ? undefined : catalog.parts.find(candidate => (
    candidate.slotId === slotId
      && candidate.archetypeIds?.includes(archetype.id) === true
      && candidate.featureTier === 'special'
      && candidate.specialFeatureAnchor !== undefined
  ))
  return { slotId, anchor: part?.specialFeatureAnchor ?? null }
}
