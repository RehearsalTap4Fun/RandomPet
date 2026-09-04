import { deriveBundleStructuralSlots } from './anatomy-bundle.js'
import { generateMonster } from './generate.js'
import { createRng, pickWeighted } from './prng.js'
import type {
  AnatomyBundleDefinition,
  Catalog,
  GenerationRequest,
  GenerationResult,
  MonsterSpec,
} from './contracts.js'

export function selectAnatomyBundle(
  request: GenerationRequest,
  catalog: Catalog,
): AnatomyBundleDefinition | null {
  const candidates = (catalog.anatomyBundles ?? []).filter(bundle => (
    bundle.archetypeId === request.archetypeId
  ))
  if (candidates.length === 0) return null
  const bodyFrameRoll = request.slotRolls?.bodyFrame ?? 0
  return pickWeighted(candidates, () => 1, createRng([
    request.seed,
    request.themeId,
    'anatomy-bundle',
    String(bodyFrameRoll),
  ]))
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
