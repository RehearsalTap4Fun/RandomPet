import {
  SEMANTIC_SLOT_IDS,
  type Catalog,
  type MonsterSpec,
  type SemanticSlotId,
  type SemanticTraitSelection,
  type VisualSelection,
  type VisualSlotId,
} from './contracts.js'
import { createRng } from './prng.js'

const SEMANTIC_SOURCES: Record<Exclude<SemanticSlotId, 'personality' | 'quirk'>, readonly VisualSlotId[]> = {
  frame: ['bodyFrame'],
  appendage: ['extraAppendage', 'tail', 'legs', 'arms'],
  headAndEyes: ['eyes', 'headAppendage', 'headShape'],
  mouth: ['oralDetail', 'mouthShape'],
  surface: ['surfaceMaterial'],
  pattern: ['pattern', 'colorScheme'],
}

function projectVisualGroup(
  semanticSlotId: Exclude<SemanticSlotId, 'personality' | 'quirk'>,
  visualSlots: Record<VisualSlotId, VisualSelection>,
  catalog: Catalog,
): SemanticTraitSelection {
  const order = SEMANTIC_SOURCES[semanticSlotId]
  const orderIndex = new Map(order.map((slotId, index) => [slotId, index]))
  const ranked = order.flatMap(slotId => {
    const selection = visualSlots[slotId]
    const part = catalog.parts.find(item => item.id === selection.partId && item.slotId === slotId)
    if (part?.semanticTraitId === null || part?.semanticTraitId === undefined) return []
    const definition = catalog.semanticTraits.find(item => item.id === part.semanticTraitId)
    if (definition?.semanticSlotId !== semanticSlotId) return []
    return [{ slotId, traitId: part.semanticTraitId, priority: part.semanticPriority }]
  }).sort((left, right) =>
    right.priority - left.priority
    || (orderIndex.get(left.slotId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.slotId) ?? Number.MAX_SAFE_INTEGER),
  )
  const traitIds = [...new Set(ranked.map(item => item.traitId))]
  if (traitIds.length === 0) {
    const fallback = catalog.semanticTraits.find(item => item.semanticSlotId === semanticSlotId)?.id
      ?? `unknown_${semanticSlotId}`
    return { primaryTraitId: fallback, detailTraitIds: [] }
  }
  return { primaryTraitId: traitIds[0]!, detailTraitIds: traitIds.slice(1) }
}

function selectSemanticOnly(slotId: 'personality' | 'quirk', seed: string, catalog: Catalog): SemanticTraitSelection {
  const candidates = catalog.semanticTraits.filter(item => item.semanticSlotId === slotId)
  const rng = createRng([seed, slotId])
  const selected = candidates[Math.floor(rng.nextFloat() * candidates.length)]
  return { primaryTraitId: selected?.id ?? `unknown_${slotId}`, detailTraitIds: [] }
}

export function projectSemanticTraits(
  visualSlots: Record<VisualSlotId, VisualSelection>,
  seed: string,
  catalog: Catalog,
): MonsterSpec['semanticTraits'] {
  return Object.fromEntries(SEMANTIC_SLOT_IDS.map(slotId => [
    slotId,
    slotId === 'personality' || slotId === 'quirk'
      ? selectSemanticOnly(slotId, seed, catalog)
      : projectVisualGroup(slotId, visualSlots, catalog),
  ])) as MonsterSpec['semanticTraits']
}
