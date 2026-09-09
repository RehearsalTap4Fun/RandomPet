import type { Diagnostic } from './contracts.js'
import type { MonsterSpecV09, ResolvedV09Catalog, V09TraitSlotId } from './v09-contracts.js'
import { V09_TRAIT_SLOT_IDS } from './v09-contracts.js'
import { generateMonsterV09, selectV09TraitForSlot, type V09GenerationResult } from './v09-generation.js'
import { parseMonsterSpecV09 } from './v09-schema.js'

export interface V09RerollSlotRequest {
  spec: MonsterSpecV09
  slotId: V09TraitSlotId
}

export interface V09RerollSkeletonRequest {
  spec: MonsterSpecV09
}

function invalidSpecResult(spec: MonsterSpecV09, diagnostics: Diagnostic[]): V09GenerationResult {
  return { spec, diagnostics, blocked: true, affectedSlots: [] }
}

function validSpec(spec: MonsterSpecV09): Diagnostic[] {
  const parsed = parseMonsterSpecV09(spec)
  return parsed.ok ? [] : parsed.diagnostics
}

function mouthSocketIsClosed(traitId: string, catalog: ResolvedV09Catalog): boolean {
  const trait = catalog.sealedTraits.find(candidate => candidate.traitId === traitId)
  return trait?.kind === 'mouth' && trait.oralSocketClass === 'closed'
}

function sameSelection(
  left: MonsterSpecV09['visualSlots'][V09TraitSlotId],
  right: MonsterSpecV09['visualSlots'][V09TraitSlotId],
): boolean {
  return left.traitId === right.traitId && left.rarity === right.rarity && left.roll === right.roll
}

export function rerollV09Slot(
  request: V09RerollSlotRequest,
  catalog: ResolvedV09Catalog,
): V09GenerationResult {
  const invalidDiagnostics = validSpec(request.spec)
  if (invalidDiagnostics.length > 0) return invalidSpecResult(request.spec, invalidDiagnostics)
  const prior = request.spec.visualSlots[request.slotId]
  const incremented = { ...request.spec, visualSlots: { ...request.spec.visualSlots, [request.slotId]: { ...prior, roll: prior.roll + 1 } } }
  const selected = selectV09TraitForSlot(incremented, request.slotId, catalog)
  if (selected.diagnostics.length > 0) return invalidSpecResult(request.spec, selected.diagnostics)
  const visualSlots = { ...incremented.visualSlots, [request.slotId]: selected.selection }
  const affectedSlots: V09TraitSlotId[] = [request.slotId]
  if (request.slotId === 'mouthShape' && (
    mouthSocketIsClosed(request.spec.visualSlots.mouthShape.traitId, catalog)
    !== mouthSocketIsClosed(selected.selection.traitId, catalog)
  )) {
    const oral = selectV09TraitForSlot({ ...incremented, visualSlots }, 'oralDetail', catalog)
    if (oral.diagnostics.length > 0) return invalidSpecResult(request.spec, oral.diagnostics)
    if (!sameSelection(visualSlots.oralDetail, oral.selection)) {
      visualSlots.oralDetail = oral.selection
      affectedSlots.push('oralDetail')
    }
  }
  return {
    spec: { ...incremented, visualSlots },
    diagnostics: [],
    blocked: false,
    affectedSlots,
  }
}

export function rerollV09Skeleton(
  request: V09RerollSkeletonRequest,
  catalog: ResolvedV09Catalog,
): V09GenerationResult {
  const invalidDiagnostics = validSpec(request.spec)
  if (invalidDiagnostics.length > 0) return invalidSpecResult(request.spec, invalidDiagnostics)
  const generated = generateMonsterV09({
    seed: request.spec.seed,
    skeletonRoll: request.spec.skeletonSelection.roll + 1,
    slotRolls: Object.fromEntries(V09_TRAIT_SLOT_IDS.map(slotId => [slotId, request.spec.visualSlots[slotId].roll])) as Record<V09TraitSlotId, number>,
  }, catalog)
  return generated
}
