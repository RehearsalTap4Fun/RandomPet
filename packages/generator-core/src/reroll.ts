import { checkPartCompatibility } from './candidates.js'
import {
  connectorExclusions,
  type StructuralPartSelection,
  validateStructuralSelections,
} from './connector-compatibility.js'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { generationOrderForCatalog, resolveSlot } from './generate.js'
import type {
  Catalog,
  Diagnostic,
  GenerationRequest,
  GenerationResult,
  MonsterSpec,
  StructuralSlotId,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'
import { projectSemanticTraits } from './projection.js'
import { descendantsOf, evaluatePartSelection } from './selection.js'
import { selectRigId } from './rig-selection.js'
import {
  compositionAllowanceForSlot,
  planComposition,
  strongFeatureCountForSelections,
  validateCompositionSelections,
} from './composition.js'

export type SlotLocks = Partial<Record<VisualSlotId, boolean>>

export interface RerollSlotRequest {
  spec: MonsterSpec
  slotId: VisualSlotId
  locks: SlotLocks
  catalog: Catalog
}

export interface SelectVisualPartRequest extends RerollSlotRequest {
  partId: string
}

const STRUCTURAL_SLOTS = new Set<StructuralSlotId>([
  'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
])

function isInterfaceCatalog(catalog: Catalog): boolean {
  return catalog.version === '0.3.0'
}

function isStructuralSlot(slotId: VisualSlotId): slotId is StructuralSlotId {
  return STRUCTURAL_SLOTS.has(slotId as StructuralSlotId)
}

function selectedStructuralParts(spec: MonsterSpec, catalog: Catalog) {
  const selected = new Map<StructuralSlotId, StructuralPartSelection>()
  for (const slotId of STRUCTURAL_SLOTS) {
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => candidate.id === selection.partId && candidate.slotId === slotId)
    if (part !== undefined) selected.set(slotId, { part, rigId: selection.rigId })
  }
  return selected
}

function result(
  spec: MonsterSpec,
  diagnostics: Diagnostic[],
  affectedSlots: VisualSlotId[],
): GenerationResult {
  return { spec, diagnostics, blocked: diagnostics.some(item => item.severity === 'error'), affectedSlots }
}

function orderedAffectedSlots(origin: VisualSlotId, catalog: Catalog): VisualSlotId[] {
  const affected = descendantsOf(origin, catalog)
  if (isInterfaceCatalog(catalog)) {
    for (const slotId of affected) {
      if (slotId !== origin && isStructuralSlot(slotId)) affected.delete(slotId)
    }
  }
  affected.add(origin)
  return generationOrderForCatalog(catalog).filter(slotId => affected.has(slotId))
}

function cloneSpec(spec: MonsterSpec): MonsterSpec {
  return structuredClone(spec)
}

function generationContext(
  spec: MonsterSpec,
  affected: Set<VisualSlotId>,
  slotId: VisualSlotId,
  catalog: Catalog,
): Partial<Record<VisualSlotId, VisualSelection>> {
  const generationOrder = generationOrderForCatalog(catalog)
  const currentIndex = generationOrder.indexOf(slotId)
  return Object.fromEntries(Object.entries(spec.visualSlots).filter(([candidateSlotId]) => {
    const candidate = candidateSlotId as VisualSlotId
    return !affected.has(candidate) || generationOrder.indexOf(candidate) < currentIndex
  })) as Partial<Record<VisualSlotId, VisualSelection>>
}

function compositionAllowanceForReplacement(
  spec: MonsterSpec,
  slotId: VisualSlotId,
  catalog: Catalog,
) {
  const otherSelections = Object.fromEntries(VISUAL_SLOT_IDS.filter(candidate => candidate !== slotId).map(candidate => [
    candidate,
    spec.visualSlots[candidate],
  ])) as Partial<Record<VisualSlotId, VisualSelection>>
  const plan = planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, catalog)
  return compositionAllowanceForSlot(slotId, plan, strongFeatureCountForSelections(otherSelections, catalog))
}

function regenerateDescendants(
  spec: MonsterSpec,
  origin: VisualSlotId,
  locks: SlotLocks,
  catalog: Catalog,
  diagnostics: Diagnostic[],
): void {
  const descendants = descendantsOf(origin, catalog)
  if (isInterfaceCatalog(catalog)) {
    for (const slotId of descendants) {
      if (slotId !== origin && isStructuralSlot(slotId)) descendants.delete(slotId)
    }
  }
  const affected = new Set<VisualSlotId>([origin, ...descendants])
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  for (const slotId of generationOrderForCatalog(catalog)) {
    if (!descendants.has(slotId)) continue
    if (locks[slotId]) continue
    spec.visualSlots[slotId] = resolveSlot(
      generationRequest,
      catalog,
      slotId,
      spec.visualSlots.bodyFrame.rigId,
      generationContext(spec, affected, slotId, catalog),
      diagnostics,
      compositionAllowanceForReplacement(spec, slotId, catalog),
    )
  }
  for (const slotId of descendants) {
    if (!locks[slotId]) continue
    const selectedPartId = spec.visualSlots[slotId].partId
    spec.visualSlots[slotId] = {
      partId: selectedPartId,
      rigId: spec.visualSlots.bodyFrame.rigId,
    }
    const part = catalog.parts.find(item => item.id === selectedPartId && item.slotId === slotId)
    if (part === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCK_NOT_FOUND',
        path: ['visualSlots', slotId],
        message: `Locked part ${selectedPartId} no longer exists.`,
      })
    } else if (!checkPartCompatibility(part, spec.visualSlots.bodyFrame.rigId, catalog, spec.visualSlots, spec.themeId)) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCK_INCOMPATIBLE',
        path: ['visualSlots', slotId],
        message: `Locked part ${part.id} is incompatible with the changed selection.`,
      })
    }
  }
}

export function rerollSlot(request: RerollSlotRequest): GenerationResult {
  const spec = cloneSpec(request.spec)
  const diagnostics: Diagnostic[] = []
  if (request.locks[request.slotId]) {
    diagnostics.push({ severity: 'error', code: 'SLOT_LOCKED', path: ['visualSlots', request.slotId], message: `${request.slotId} is locked.` })
    return result(spec, diagnostics, [request.slotId])
  }
  spec.slotRolls[request.slotId] += 1
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  const affectedSlots = orderedAffectedSlots(request.slotId, request.catalog)
  const affected = new Set(affectedSlots)
  if (request.slotId === 'bodyFrame') {
    const rigId = selectRigId(generationRequest, request.catalog)
    if (rigId === null) {
      diagnostics.push({
        severity: 'error',
        code: 'NO_COMPATIBLE_RIG',
        path: ['visualSlots', 'bodyFrame'],
        message: 'No legal bodyFrame rig is available in the catalog.',
      })
    } else {
      spec.visualSlots.bodyFrame.rigId = rigId
    }
  }
  spec.visualSlots[request.slotId] = resolveSlot(
    generationRequest,
    request.catalog,
    request.slotId,
    spec.visualSlots.bodyFrame.rigId,
    generationContext(spec, affected, request.slotId, request.catalog),
    diagnostics,
    compositionAllowanceForReplacement(spec, request.slotId, request.catalog),
  )
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  diagnostics.push(...validateCompositionSelections(
    spec,
    request.catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, request.catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, request.catalog))
  if (isInterfaceCatalog(request.catalog) && diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, affectedSlots)
  }
  return result(spec, diagnostics, affectedSlots)
}

export function selectVisualPart(request: SelectVisualPartRequest): GenerationResult {
  const spec = cloneSpec(request.spec)
  const diagnostics: Diagnostic[] = []
  const part = request.catalog.parts.find(item => item.slotId === request.slotId && item.id === request.partId)
  const evaluation = part === undefined ? null : evaluatePartSelection(part, spec, request.catalog)
  const connectorFailures = part !== undefined && evaluation !== null && evaluation.rigId !== null
    ? connectorExclusions(request.catalog, part, evaluation.rigId, selectedStructuralParts(spec, request.catalog))
    : []
  if (part === undefined || evaluation === null || !evaluation.selectable || evaluation.rigId === null) {
    for (const failure of connectorFailures) {
      diagnostics.push({
        severity: 'error',
        code: failure.result.code,
        path: ['visualSlots', failure.slotId],
        message: failure.result.message,
      })
    }
    if (diagnostics.length > 0) return result(spec, diagnostics, [request.slotId])
    diagnostics.push({
      severity: 'error',
      code: part === undefined ? 'PART_NOT_FOUND' : 'PART_INCOMPATIBLE',
      path: ['visualSlots', request.slotId],
      message: `Part ${request.partId} cannot be selected for ${request.slotId}.`,
    })
    return result(spec, diagnostics, [request.slotId])
  }
  const selection: VisualSelection = { partId: part.id, rigId: evaluation.rigId }
  spec.visualSlots[request.slotId] = selection
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  diagnostics.push(...validateCompositionSelections(
    spec,
    request.catalog,
    planComposition(spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, request.catalog),
  ))
  diagnostics.push(...validateStructuralSelections(spec, request.catalog))
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return result(cloneSpec(request.spec), diagnostics, orderedAffectedSlots(request.slotId, request.catalog))
  }
  return result(spec, diagnostics, orderedAffectedSlots(request.slotId, request.catalog))
}
