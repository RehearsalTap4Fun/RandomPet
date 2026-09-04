import {
  STRUCTURAL_SLOT_IDS,
  type AnatomyBundleDefinition,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type StructuralSlotId,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'

export function resolveAnatomyBundle(
  spec: MonsterSpec,
  catalog: Catalog,
): AnatomyBundleDefinition | null {
  if (spec.anatomyBundleId === undefined) return null
  return catalog.anatomyBundles?.find(bundle => bundle.id === spec.anatomyBundleId) ?? null
}

export function deriveBundleStructuralSlots(
  bundle: AnatomyBundleDefinition,
): Pick<Record<VisualSlotId, VisualSelection>, StructuralSlotId> {
  return Object.fromEntries(STRUCTURAL_SLOT_IDS.map(slotId => [
    slotId,
    { partId: bundle.derivedSlots[slotId], rigId: bundle.rigId },
  ])) as Pick<Record<VisualSlotId, VisualSelection>, StructuralSlotId>
}

export function validateAnatomyBundleSpec(spec: MonsterSpec, catalog: Catalog): Diagnostic[] {
  const bundle = resolveAnatomyBundle(spec, catalog)
  if (spec.anatomyBundleId === undefined) return []
  if (bundle === null) {
    return [{
      severity: 'error',
      code: 'SPEC_ANATOMY_BUNDLE_UNKNOWN',
      path: ['anatomyBundleId'],
      message: `Unknown anatomy bundle ${spec.anatomyBundleId}.`,
    }]
  }
  if (spec.archetypeId !== undefined && spec.archetypeId !== bundle.archetypeId) {
    return [{
      severity: 'error',
      code: 'SPEC_ANATOMY_BUNDLE_ARCHETYPE_MISMATCH',
      path: ['anatomyBundleId'],
      message: `Anatomy bundle ${bundle.id} requires archetype ${bundle.archetypeId}.`,
    }]
  }
  const expected = deriveBundleStructuralSlots(bundle)
  return STRUCTURAL_SLOT_IDS.flatMap(slotId => {
    const actual = spec.visualSlots[slotId]
    const selection = expected[slotId]
    return actual.partId === selection.partId && actual.rigId === selection.rigId
      ? []
      : [{
        severity: 'error' as const,
        code: 'SPEC_ANATOMY_BUNDLE_SLOT_MISMATCH',
        path: ['visualSlots', slotId],
        message: `Structural slot ${slotId} must match anatomy bundle ${bundle.id}.`,
      }]
  })
}
