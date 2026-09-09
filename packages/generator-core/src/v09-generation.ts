import type { Diagnostic } from './contracts.js'
import { createRng, pickWeighted } from './prng.js'
import {
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  type MonsterSpecV09,
  type ResolvedV09Catalog,
  type SealedTraitArtifactV1,
  type V09TraitRarity,
  type V09TraitSlotId,
} from './v09-contracts.js'

export interface V09GenerationRequest {
  seed: string
  slotRolls?: Partial<Record<V09TraitSlotId, number>>
  skeletonRoll?: number
}

export interface V09GenerationResult {
  spec: MonsterSpecV09
  diagnostics: Diagnostic[]
  blocked: boolean
  affectedSlots: V09TraitSlotId[]
}

const RARITY_WEIGHTS: Record<V09TraitRarity, number> = {
  common: 8,
  rare: 4,
  legendary: 1,
}

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function rollFor(request: V09GenerationRequest, slotId: V09TraitSlotId): number {
  const roll = request.slotRolls?.[slotId] ?? 0
  return Number.isInteger(roll) && roll >= 0 ? roll : 0
}

function missingSelection(slotId: V09TraitSlotId, roll: number): MonsterSpecV09['visualSlots'][V09TraitSlotId] {
  return { traitId: `missing_${slotId}`, rarity: 'common', roll }
}

function isClosedMouth(trait: SealedTraitArtifactV1 | undefined): boolean {
  return trait?.kind === 'mouth' && trait.oralSocketClass === 'closed'
}

function selectTrait(
  catalog: ResolvedV09Catalog,
  request: V09GenerationRequest,
  skeletonFamilyId: string,
  slotId: V09TraitSlotId,
  roll: number,
): { selection: MonsterSpecV09['visualSlots'][V09TraitSlotId]; trait?: SealedTraitArtifactV1; diagnostic?: Diagnostic } {
  const rng = createRng([request.seed, 'v0.9', 'slot', slotId, String(roll)])
  const rarity = pickWeighted(
    ['common', 'rare', 'legendary'] as const,
    value => RARITY_WEIGHTS[value],
    rng,
  )
  const candidates = catalog.sealedTraits.filter(trait => (
    trait.skeletonFamilyId === skeletonFamilyId && trait.slotId === slotId && trait.rarity === rarity
  ))
  if (candidates.length === 0) {
    return {
      selection: missingSelection(slotId, roll),
      diagnostic: diagnostic(
        'SKELETON_PROJECTION_MISSING',
        ['visualSlots', slotId],
        `No ${rarity} ${slotId} projection is sealed for skeleton ${skeletonFamilyId}.`,
      ),
    }
  }
  const trait = candidates[Math.floor(rng.nextFloat() * candidates.length)]!
  return { selection: { traitId: trait.traitId, rarity, roll }, trait }
}

function skeletonSpec(
  request: V09GenerationRequest,
  catalog: ResolvedV09Catalog,
): { spec: Pick<MonsterSpecV09, 'skeletonFamilyId' | 'assemblyTemplateId' | 'skeletonSelection'>; diagnostics: Diagnostic[] } {
  const roll = request.skeletonRoll ?? 0
  const fallback = {
    skeletonFamilyId: 'missing-skeleton',
    assemblyTemplateId: 'missing-assembly-template',
    skeletonSelection: { class: 'base' as const, candidateId: 'missing-skeleton', roll },
  }
  if (!Number.isInteger(roll) || roll < 0) {
    return { spec: fallback, diagnostics: [diagnostic('SKELETON_PROJECTION_MISSING', ['skeletonSelection'], 'No selectable v0.9 skeleton is available.')] }
  }
  const candidate = pickWeighted(
    catalog.skeletonPool.candidates,
    item => item.weight,
    createRng([request.seed, 'v0.9', 'skeleton', String(roll)]),
  )
  const skeleton = catalog.skeletonFamilies.find(item => item.skeletonFamilyId === candidate.skeletonFamilyId)
  if (skeleton === undefined) {
    return {
      spec: {
        skeletonFamilyId: candidate.skeletonFamilyId,
        assemblyTemplateId: 'missing-assembly-template',
        skeletonSelection: { class: candidate.skeletonClass, candidateId: candidate.skeletonFamilyId, roll },
      },
      diagnostics: [diagnostic('SKELETON_PROJECTION_MISSING', ['skeletonSelection'], `Skeleton ${candidate.skeletonFamilyId} has no sealed family projection.`)],
    }
  }
  return {
    spec: {
      skeletonFamilyId: skeleton.skeletonFamilyId,
      assemblyTemplateId: skeleton.assemblyTemplateId,
      skeletonSelection: { class: candidate.skeletonClass, candidateId: candidate.skeletonFamilyId, roll },
    },
    diagnostics: [],
  }
}

export function generateMonsterV09(
  request: V09GenerationRequest,
  catalog: ResolvedV09Catalog,
): V09GenerationResult {
  const selectedSkeleton = skeletonSpec(request, catalog)
  const diagnostics = [...selectedSkeleton.diagnostics]
  const visualSlots = {} as MonsterSpecV09['visualSlots']
  let selectedMouth: SealedTraitArtifactV1 | undefined

  for (const slotId of V09_TRAIT_SLOT_IDS) {
    const roll = rollFor(request, slotId)
    if (slotId === 'oralDetail' && isClosedMouth(selectedMouth)) {
      visualSlots[slotId] = { traitId: 'oral-none', rarity: 'common', roll }
      continue
    }
    const selected = selectTrait(catalog, request, selectedSkeleton.spec.skeletonFamilyId, slotId, roll)
    visualSlots[slotId] = selected.selection
    if (selected.diagnostic !== undefined) diagnostics.push(selected.diagnostic)
    if (slotId === 'mouthShape') selectedMouth = selected.trait
  }

  return {
    spec: {
      ...V09_VERSION_TUPLE,
      seed: request.seed,
      speciesRigId: 'feline-sit-v2',
      ...selectedSkeleton.spec,
      visualSlots,
    },
    diagnostics,
    blocked: diagnostics.some(item => item.severity === 'error'),
    affectedSlots: [...V09_TRAIT_SLOT_IDS],
  }
}

export function selectV09TraitForSlot(
  spec: MonsterSpecV09,
  slotId: V09TraitSlotId,
  catalog: ResolvedV09Catalog,
): { selection: MonsterSpecV09['visualSlots'][V09TraitSlotId]; diagnostics: Diagnostic[] } {
  const roll = spec.visualSlots[slotId].roll
  const selectedMouth = catalog.sealedTraits.find(trait => trait.traitId === spec.visualSlots.mouthShape.traitId)
  if (slotId === 'oralDetail' && isClosedMouth(selectedMouth)) {
    return { selection: { traitId: 'oral-none', rarity: 'common', roll }, diagnostics: [] }
  }
  const selected = selectTrait(catalog, { seed: spec.seed }, spec.skeletonFamilyId, slotId, roll)
  return { selection: selected.selection, diagnostics: selected.diagnostic === undefined ? [] : [selected.diagnostic] }
}
