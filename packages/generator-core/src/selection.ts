import { checkPartCompatibility } from './candidates.js'
import { connectorExclusionCodes, type StructuralPartSelection } from './connector-compatibility.js'
import {
  STRUCTURAL_SLOT_IDS,
  type StructuralSlotId,
  type Catalog,
  type MonsterSpec,
  type RigId,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'

export type PartSelectionBlockReason = 'theme' | 'rig' | 'selection' | 'connector'

function selectedStructuralParts(spec: MonsterSpec, catalog: Catalog) {
  const selected = new Map<StructuralSlotId, StructuralPartSelection>()
  for (const slotId of STRUCTURAL_SLOT_IDS) {
    const part = catalog.parts.find(candidate => candidate.id === spec.visualSlots[slotId].partId && candidate.slotId === slotId)
    if (part !== undefined) selected.set(slotId, { part, rigId: spec.visualSlots[slotId].rigId })
  }
  return selected
}

export interface PartSelectionEvaluation {
  selectable: boolean
  rigId: RigId | null
  reason: PartSelectionBlockReason | null
}

export function descendantsOf(slotId: VisualSlotId, catalog: Catalog): Set<VisualSlotId> {
  const descendants = new Set<VisualSlotId>()
  const visit = (parent: VisualSlotId): void => {
    for (const child of catalog.dependencies[parent] ?? []) {
      if (descendants.has(child)) continue
      descendants.add(child)
      visit(child)
    }
  }
  visit(slotId)
  return descendants
}

function selectionRigId(
  part: VisualPartDefinition,
  currentRigId: RigId,
  catalog: Catalog,
): RigId | null {
  if (part.slotId !== 'bodyFrame') return currentRigId
  if (part.compatibleRigs.includes(currentRigId)) return currentRigId
  return catalog.rigs.find(rig => part.compatibleRigs.includes(rig.id))?.id ?? null
}

export function evaluatePartSelection(
  part: VisualPartDefinition,
  spec: MonsterSpec,
  catalog: Catalog,
): PartSelectionEvaluation {
  const rigId = selectionRigId(part, spec.visualSlots.bodyFrame.rigId, catalog)
  if (part.slotId === 'colorScheme' && !part.themeIds.includes(spec.themeId)) {
    return { selectable: false, rigId, reason: 'theme' }
  }
  if (rigId === null) return { selectable: false, rigId, reason: 'rig' }

  if (connectorExclusionCodes(catalog, part, rigId, selectedStructuralParts(spec, catalog)).length > 0) {
    return { selectable: false, rigId, reason: 'connector' }
  }

  const descendants = descendantsOf(part.slotId, catalog)
  const stableSelections = Object.fromEntries(Object.entries(spec.visualSlots).filter(
    ([slotId]) => !descendants.has(slotId as VisualSlotId),
  )) as Partial<Record<VisualSlotId, VisualSelection>>
  if (!checkPartCompatibility(part, rigId, catalog, stableSelections, spec.themeId)) {
    return { selectable: false, rigId, reason: 'selection' }
  }
  return { selectable: true, rigId, reason: null }
}
