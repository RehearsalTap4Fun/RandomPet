import { buildCandidates, checkPartCompatibility } from './candidates.js'
import {
  PART_RARITY_WEIGHTS,
  type Catalog,
  type Diagnostic,
  type GenerationRequest,
  type IndependentPartAnatomyBundleDefinition,
  type Rarity,
  type RigId,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'
import { createRng, pickWeighted, slotSeedParts, type Rng } from './prng.js'

export function pickIndependentPartTier(rng: Rng): Rarity {
  return pickWeighted(['N', 'R', 'L'] as const, tier => PART_RARITY_WEIGHTS[tier], rng)
}

export interface IndependentPartSelectionRequest extends Pick<
  GenerationRequest,
  'seed' | 'themeId' | 'archetypeId' | 'slotRolls' | 'lockedSelections'
> {}

function noCompatibleCandidate(
  diagnostics: Diagnostic[],
  slotId: VisualSlotId,
  rigId: RigId,
): VisualSelection {
  diagnostics.push({
    severity: 'error',
    code: 'NO_COMPATIBLE_CANDIDATE',
    path: ['visualSlots', slotId],
    message: `No compatible independent part candidate exists for ${slotId}.`,
  })
  return { partId: `missing_${slotId}`, rigId }
}

export function selectIndependentPoolPart(
  request: IndependentPartSelectionRequest,
  catalog: Catalog,
  bundle: IndependentPartAnatomyBundleDefinition,
  slotId: VisualSlotId,
  selections: Partial<Record<VisualSlotId, VisualSelection>>,
  diagnostics: Diagnostic[],
  excludedPartIds: readonly string[] = [],
): VisualSelection {
  const rigId = bundle.rigId
  const pool = bundle.partPools[slotId]
  const lockedPartId = request.lockedSelections?.[slotId]
  if (lockedPartId !== undefined) {
    const part = catalog.parts.find(candidate => candidate.slotId === slotId && candidate.id === lockedPartId)
    if (part === undefined) {
      diagnostics.push({
        severity: 'error', code: 'LOCK_NOT_FOUND', path: ['visualSlots', slotId],
        message: `Locked part ${lockedPartId} does not exist in ${slotId}.`,
      })
      return { partId: lockedPartId, rigId }
    }
    if (!pool.includes(part.id) || !checkPartCompatibility(part, rigId, catalog, selections, request.themeId)) {
      diagnostics.push({
        severity: 'error', code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', slotId],
        message: `Locked part ${lockedPartId} is incompatible with the selected anatomy bundle.`,
      })
    }
    return { partId: part.id, rigId }
  }

  const rerollIndex = request.slotRolls?.[slotId] ?? 0
  const rng = createRng([...slotSeedParts(request.seed, request.themeId, slotId, rerollIndex), 'part-rarity'])
  const tier = pickIndependentPartTier(rng)
  const candidateIds = pool.filter(partId => !excludedPartIds.includes(partId) && catalog.parts.some(part => (
    part.id === partId && part.slotId === slotId && part.rarity === tier
  )))
  const result = buildCandidates({
    catalog,
    slotId,
    themeId: request.themeId,
    rigId,
    selections,
    rng,
    ...(request.archetypeId === undefined ? {} : { archetypeId: request.archetypeId }),
    allowedPartIds: candidateIds,
  })
  return result.part === null
    ? noCompatibleCandidate(diagnostics, slotId, rigId)
    : { partId: result.part.id, rigId }
}
