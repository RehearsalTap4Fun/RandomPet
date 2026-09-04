import type { Catalog, GenerationRequest, RigId } from './contracts.js'
import { createRng, pickWeighted, slotSeedParts } from './prng.js'
import { resolveArchetype } from './archetype-plan.js'

export function selectRigId(request: GenerationRequest, catalog: Catalog): RigId | null {
  const archetype = resolveArchetype(request, catalog)
  if (catalog.version === '0.6.0' && archetype === null) return null
  const rerollIndex = request.slotRolls?.bodyFrame ?? 0
  const legal = catalog.rigs.filter(rig => catalog.parts.some(part =>
    part.slotId === 'bodyFrame'
    && part.compatibleRigs.includes(rig.id)
    && (archetype === null || part.archetypeIds?.includes(archetype.id) === true)
    && (archetype === null || archetype.rigIds.includes(rig.id))
    && part.assetPath.trim().length > 0
    && part.baseWeight > 0,
  ))
  if (legal.length === 0) return null
  const rng = createRng([...slotSeedParts(
    request.seed, request.themeId, 'bodyFrame', rerollIndex,
  ), 'rig'])
  return archetype === null ? pickWeighted(legal, () => 1, rng).id : archetype.defaultRigId
}
