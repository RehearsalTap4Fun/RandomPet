import { deriveBundleStructuralSlots } from './anatomy-bundle.js'
import { generateMonster } from './generate.js'
import { createRng, pickWeighted } from './prng.js'
import type {
  AnatomyBundleDefinition,
  Catalog,
  GenerationRequest,
  Rarity,
  GenerationResult,
  MonsterSpec,
  StructuralSlotId,
} from './contracts.js'
import {
  isIndependentPartCatalog,
  RARITY_WEIGHTS,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
} from './contracts.js'

export function selectAnatomyBundle(
  request: GenerationRequest,
  catalog: Catalog,
): AnatomyBundleDefinition | null {
  const candidates = (catalog.anatomyBundles ?? []).filter(bundle => (
    bundle.archetypeId === request.archetypeId
    && (isIndependentPartCatalog(catalog)
      ? VISUAL_SLOT_IDS.every(slotId => (
        request.lockedSelections?.[slotId] === undefined
        || bundle.partPools?.[slotId].includes(request.lockedSelections[slotId]!) === true
      ))
      : STRUCTURAL_SLOT_IDS.every((slotId: StructuralSlotId) => (
        request.lockedSelections?.[slotId] === undefined
        || bundle.derivedSlots[slotId] === request.lockedSelections[slotId]
      )))
  ))
  if (candidates.length === 0) return null
  const availableRarities = (['N', 'R', 'L'] as const).filter(rarity => (
    candidates.some(bundle => bundle.rarity === rarity)
  ))
  const bodyFrameRoll = request.slotRolls?.bodyFrame ?? 0
  const rng = createRng([
    request.seed,
    request.themeId,
    'anatomy-bundle',
    String(bodyFrameRoll),
  ])
  const rarity = pickWeighted(availableRarities, (tier: Rarity) => RARITY_WEIGHTS[tier], rng)
  return pickWeighted(candidates.filter(bundle => bundle.rarity === rarity), bundle => bundle.baseWeight, rng)
}

export function applyAnatomyBundle(
  spec: MonsterSpec,
  bundle: AnatomyBundleDefinition,
): MonsterSpec {
  const applied = structuredClone(spec)
  applied.anatomyBundleId = bundle.id
  applied.archetypeId = bundle.archetypeId
  Object.assign(applied.visualSlots, deriveBundleStructuralSlots(bundle))
  if (applied.genome !== undefined) {
    for (const [slotId, selection] of Object.entries(deriveBundleStructuralSlots(bundle))) {
      const genes = applied.genome.genes[slotId as keyof typeof applied.genome.genes]
      genes.P = selection.partId
      genes.H1 = selection.partId
      genes.H2 = selection.partId
      genes.H3 = selection.partId
    }
  }
  return applied
}

export function rerollAnatomyBundle(request: {
  spec: MonsterSpec
  catalog: Catalog
  locked: boolean
}): GenerationResult {
  if (request.locked) {
    return {
      spec: structuredClone(request.spec),
      diagnostics: [{
        severity: 'error',
        code: 'ANATOMY_BUNDLE_LOCKED',
        path: ['anatomyBundleId'],
        message: 'The anatomy bundle is locked.',
      }],
      blocked: true,
      affectedSlots: [],
    }
  }
  const slotRolls = { ...request.spec.slotRolls, bodyFrame: request.spec.slotRolls.bodyFrame + 1 }
  return generateMonster({
    seed: request.spec.seed,
    themeId: request.spec.themeId,
    mode: request.spec.mutation !== null
      ? 'mutation'
      : request.spec.aberrations.length > 0 ? 'aberration' : 'normal',
    ...(request.spec.archetypeId === undefined ? {} : { archetypeId: request.spec.archetypeId }),
    slotRolls,
  }, request.catalog)
}
