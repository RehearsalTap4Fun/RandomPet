import { checkPartCompatibility } from './candidates.js'
import { GENERATION_ORDER, resolveSlot } from './generate.js'
import type {
  Catalog,
  Diagnostic,
  GenerationRequest,
  GenerationResult,
  MonsterSpec,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'
import { projectSemanticTraits } from './projection.js'
import { descendantsOf, evaluatePartSelection } from './selection.js'
import { selectRigId } from './rig-selection.js'

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

function result(spec: MonsterSpec, diagnostics: Diagnostic[]): GenerationResult {
  return { spec, diagnostics, blocked: diagnostics.some(item => item.severity === 'error') }
}

function cloneSpec(spec: MonsterSpec): MonsterSpec {
  return structuredClone(spec)
}

function generationContext(
  spec: MonsterSpec,
  affected: Set<VisualSlotId>,
  slotId: VisualSlotId,
): Partial<Record<VisualSlotId, VisualSelection>> {
  const currentIndex = GENERATION_ORDER.indexOf(slotId)
  return Object.fromEntries(Object.entries(spec.visualSlots).filter(([candidateSlotId]) => {
    const candidate = candidateSlotId as VisualSlotId
    return !affected.has(candidate) || GENERATION_ORDER.indexOf(candidate) < currentIndex
  })) as Partial<Record<VisualSlotId, VisualSelection>>
}

function regenerateDescendants(
  spec: MonsterSpec,
  origin: VisualSlotId,
  locks: SlotLocks,
  catalog: Catalog,
  diagnostics: Diagnostic[],
): void {
  const descendants = descendantsOf(origin, catalog)
  const affected = new Set<VisualSlotId>([origin, ...descendants])
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  for (const slotId of GENERATION_ORDER) {
    if (!descendants.has(slotId)) continue
    if (locks[slotId]) continue
    spec.visualSlots[slotId] = resolveSlot(
      generationRequest,
      catalog,
      slotId,
      spec.visualSlots.bodyFrame.rigId,
      generationContext(spec, affected, slotId),
      diagnostics,
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
    return result(spec, diagnostics)
  }
  spec.slotRolls[request.slotId] += 1
  const generationRequest: GenerationRequest = {
    seed: spec.seed,
    themeId: spec.themeId,
    mode: 'normal',
    slotRolls: spec.slotRolls,
  }
  const affected = descendantsOf(request.slotId, request.catalog)
  affected.add(request.slotId)
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
    generationContext(spec, affected, request.slotId),
    diagnostics,
  )
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  return result(spec, diagnostics)
}

export function selectVisualPart(request: SelectVisualPartRequest): GenerationResult {
  const spec = cloneSpec(request.spec)
  const diagnostics: Diagnostic[] = []
  const part = request.catalog.parts.find(item => item.slotId === request.slotId && item.id === request.partId)
  const evaluation = part === undefined ? null : evaluatePartSelection(part, spec, request.catalog)
  if (part === undefined || evaluation === null || !evaluation.selectable || evaluation.rigId === null) {
    diagnostics.push({
      severity: 'error',
      code: part === undefined ? 'PART_NOT_FOUND' : 'PART_INCOMPATIBLE',
      path: ['visualSlots', request.slotId],
      message: `Part ${request.partId} cannot be selected for ${request.slotId}.`,
    })
    return result(spec, diagnostics)
  }
  const selection: VisualSelection = { partId: part.id, rigId: evaluation.rigId }
  spec.visualSlots[request.slotId] = selection
  regenerateDescendants(spec, request.slotId, request.locks, request.catalog, diagnostics)
  spec.semanticTraits = projectSemanticTraits(spec.visualSlots, spec.seed, request.catalog)
  return result(spec, diagnostics)
}
