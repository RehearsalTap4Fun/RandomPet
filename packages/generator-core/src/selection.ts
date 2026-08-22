import { checkPartCompatibility } from './candidates.js'
import type {
  Catalog,
  MonsterSpec,
  RigId,
  VisualPartDefinition,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'

export type PartSelectionBlockReason = 'theme' | 'rig' | 'selection'

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

  const descendants = descendantsOf(part.slotId, catalog)
  const stableSelections = Object.fromEntries(Object.entries(spec.visualSlots).filter(
    ([slotId]) => !descendants.has(slotId as VisualSlotId),
  )) as Partial<Record<VisualSlotId, VisualSelection>>
  if (!checkPartCompatibility(part, rigId, catalog, stableSelections)) {
    return { selectable: false, rigId, reason: 'selection' }
  }
  return { selectable: true, rigId, reason: null }
}
