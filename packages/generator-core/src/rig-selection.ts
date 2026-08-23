import type { Catalog, GenerationRequest, RigId } from './contracts.js'
import { createRng, pickWeighted, slotSeedParts } from './prng.js'

export function selectRigId(request: GenerationRequest, catalog: Catalog): RigId | null {
  const rerollIndex = request.slotRolls?.bodyFrame ?? 0
  const legal = catalog.rigs.filter(rig => catalog.parts.some(part =>
    part.slotId === 'bodyFrame'
    && part.compatibleRigs.includes(rig.id)
    && part.assetPath.trim().length > 0
    && part.baseWeight > 0,
  ))
  if (legal.length === 0) return null
  const rng = createRng([...slotSeedParts(
    request.seed, request.themeId, 'bodyFrame', rerollIndex,
  ), 'rig'])
  return pickWeighted(legal, () => 1, rng).id
}
