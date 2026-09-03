import {
  NON_FACIAL_VISUAL_SLOT_IDS,
  STRUCTURAL_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type RigId,
  type ThemeId,
  type VisualSlotId,
} from './contracts.js'
import { createRng } from './prng.js'

export type MotifMode = 'neutral' | 'dominant' | 'surprise'

export interface CompositionPlan {
  motifModes: Record<VisualSlotId, MotifMode>
  maxStrongFeatures: number
  maxStrongNonFacialFeatures: number
}

export interface CompositionAllowance {
  motifMode: MotifMode
  remainingStrong: number
  remainingStrongNonFacial: number
  requiredDominantStructuralSlots?: VisualSlotId[]
}

function neutralMotifModes(): Record<VisualSlotId, MotifMode> {
  return Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, 'neutral'])) as Record<VisualSlotId, MotifMode>
}

export function planComposition(
  seed: string,
  themeId: ThemeId,
  rigId: RigId,
  catalog: Catalog,
): CompositionPlan {
  const motifModes = neutralMotifModes()
  const policy = catalog.compositionPolicy
  if (policy === undefined) {
    return {
      motifModes,
      maxStrongFeatures: Number.MAX_SAFE_INTEGER,
      maxStrongNonFacialFeatures: Number.MAX_SAFE_INTEGER,
    }
  }

  const ranked = policy.motifSlots
    .map(slotId => ({
      slotId,
      roll: createRng([seed, themeId, rigId, slotId, 'motif-plan']).nextFloat(),
    }))
    .sort((left, right) => left.roll - right.roll
      || VISUAL_SLOT_IDS.indexOf(left.slotId) - VISUAL_SLOT_IDS.indexOf(right.slotId))
  const surprise = new Set(ranked.slice(0, Math.floor(ranked.length * policy.surpriseRatio)).map(item => item.slotId))
  for (const slotId of policy.motifSlots) {
    motifModes[slotId] = surprise.has(slotId) ? 'surprise' : 'dominant'
  }
  return {
    motifModes,
    maxStrongFeatures: policy.maxStrongFeatures,
    maxStrongNonFacialFeatures: policy.maxStrongNonFacialFeatures ?? Number.MAX_SAFE_INTEGER,
  }
}

export function strongFeatureCount(spec: MonsterSpec, catalog: Catalog): number {
  return strongFeatureCountForSelections(spec.visualSlots, catalog)
}

export function strongFeatureCountForSelections(
  selections: Partial<Record<VisualSlotId, { partId: string }>>,
  catalog: Catalog,
): number {
  return VISUAL_SLOT_IDS.reduce((count, slotId) => {
    const partId = selections[slotId]?.partId
    if (partId === undefined) return count
    const part = catalog.parts.find(candidate => candidate.id === partId && candidate.slotId === slotId)
    return count + (part?.composition?.visualIntensity === 'strong' && !part.composition.isNone ? 1 : 0)
  }, 0)
}

export function strongNonFacialFeatureCount(spec: MonsterSpec, catalog: Catalog): number {
  return strongNonFacialFeatureCountForSelections(spec.visualSlots, catalog)
}

export function strongNonFacialFeatureCountForSelections(
  selections: Partial<Record<VisualSlotId, { partId: string }>>,
  catalog: Catalog,
): number {
  return NON_FACIAL_VISUAL_SLOT_IDS.reduce((count, slotId) => {
    const partId = selections[slotId]?.partId
    const part = catalog.parts.find(item => item.slotId === slotId && item.id === partId)
    return count + (part?.composition?.visualIntensity === 'strong' && !part.composition.isNone ? 1 : 0)
  }, 0)
}

export function rendererVersionForCatalog(catalog: Catalog): '0.1.0' | '0.2.0' | '0.3.0' | '0.4.0' | '0.5.0' {
  switch (catalog.version) {
    case '0.1.0': return '0.1.0'
    case '0.2.0': return '0.2.0'
    case '0.3.0': return '0.3.0'
    case '0.4.0': return '0.4.0'
    case '0.5.0': return '0.5.0'
    default: throw new Error(`Unsupported catalog version: ${catalog.version}`)
  }
}

export function compositionAllowanceForSlot(
  slotId: VisualSlotId,
  plan: CompositionPlan,
  strongFeaturesUsed: number,
  strongNonFacialFeaturesUsed: number,
): CompositionAllowance {
  return {
    motifMode: plan.motifModes[slotId],
    remainingStrong: Math.max(0, plan.maxStrongFeatures - strongFeaturesUsed),
    remainingStrongNonFacial: Math.max(
      0,
      plan.maxStrongNonFacialFeatures - strongNonFacialFeaturesUsed,
    ),
    ...(slotId === 'bodyFrame' ? {
      requiredDominantStructuralSlots: STRUCTURAL_SLOT_IDS.filter(candidate => candidate !== 'bodyFrame')
        .filter(candidate => plan.motifModes[candidate] === 'dominant'),
    } : {}),
  }
}

export function validateCompositionSelections(
  spec: MonsterSpec,
  catalog: Catalog,
  plan: CompositionPlan,
): Diagnostic[] {
  const strongFeatures = strongFeatureCount(spec, catalog)
  const strongNonFacialFeatures = strongNonFacialFeatureCount(spec, catalog)
  const diagnostics: Diagnostic[] = []
  if (strongFeatures > plan.maxStrongFeatures) {
    diagnostics.push({
      severity: 'warning',
      code: 'COMPOSITION_INTENSITY_EXCEEDED',
      path: ['visualSlots'],
      message: `Composition has ${strongFeatures} strong features; the recommended maximum is ${plan.maxStrongFeatures}.`,
    })
  }
  if (strongNonFacialFeatures > plan.maxStrongNonFacialFeatures) {
    diagnostics.push({
      severity: 'warning',
      code: 'COMPOSITION_NONFACIAL_INTENSITY_EXCEEDED',
      path: ['visualSlots'],
      message: `Composition has ${strongNonFacialFeatures} strong non-facial features; the recommended maximum is ${plan.maxStrongNonFacialFeatures}.`,
    })
  }
  return diagnostics
}
