import type {
  Catalog,
  RigId,
  ThemeId,
  VisualPartDefinition,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'
import { pickWeighted, type Rng } from './prng.js'

type Rarity = VisualPartDefinition['rarity']

export interface CandidateTrace {
  rangeMode: 'theme' | 'full'
  rarityRoll: Rarity
  rarity: Rarity
  candidateIds: string[]
  finalWeights: Record<string, number>
}

export interface BuildCandidatesInput {
  catalog: Catalog
  slotId: VisualSlotId
  themeId: ThemeId
  rigId: RigId
  selections: Partial<Record<VisualSlotId, VisualSelection>>
  rng: Rng
}

export interface CandidateResult {
  part: VisualPartDefinition | null
  trace: CandidateTrace
}

const RARITY_WEIGHTS: Record<Rarity, number> = { N: 70, R: 25, L: 5 }

function isHardCompatible(
  part: VisualPartDefinition,
  rigId: RigId,
  catalog: Catalog,
  selectedPartIds: Set<string>,
  selectedParts: VisualPartDefinition[],
): boolean {
  const rig = catalog.rigs.find(item => item.id === rigId)
  return part.assetPath.trim().length > 0
    && part.compatibleRigs.includes(rigId)
    && (part.socket === null || rig?.sockets[part.socket] !== undefined)
    && !part.excludes.some(id => selectedPartIds.has(id))
    && !selectedParts.some(selected => selected.excludes.includes(part.id))
}

export function buildCandidates(input: BuildCandidatesInput): CandidateResult {
  const selectedPartIds = new Set(Object.entries(input.selections)
    .filter(([slotId]) => slotId !== input.slotId)
    .map(([, selection]) => selection.partId))
  const selectedParts = input.catalog.parts.filter(part => selectedPartIds.has(part.id))
  const compatible = input.catalog.parts.filter(part =>
    part.slotId === input.slotId
    && isHardCompatible(part, input.rigId, input.catalog, selectedPartIds, selectedParts),
  )

  const themePool = compatible.filter(part => part.themeIds.includes(input.themeId))
  const themeRoll = input.rng.nextFloat()
  const hardThemeBound = input.slotId === 'colorScheme'
  const useThemePool = hardThemeBound || (themeRoll < 0.7 && themePool.length > 0)
  const rangeMode: CandidateTrace['rangeMode'] = useThemePool ? 'theme' : 'full'
  const range = useThemePool ? themePool : compatible
  const availableRarities = (['N', 'R', 'L'] as const).filter(rarity =>
    range.some(part => part.rarity === rarity),
  )

  let rarity: Rarity = availableRarities[0] ?? 'N'
  if (availableRarities.length > 0) {
    rarity = pickWeighted(availableRarities, item => RARITY_WEIGHTS[item], input.rng)
  } else {
    input.rng.nextFloat()
  }
  const candidates = range.filter(part => part.rarity === rarity)
  const finalWeights = Object.fromEntries(candidates.map(part => {
    const themeMultiplier = part.themeWeights[input.themeId] ?? 1
    const boostMultiplier = part.semanticTraitId === null
      ? 1
      : selectedParts.reduce(
        (total, selected) => total * (selected.boosts[part.semanticTraitId!] ?? 1),
        1,
      )
    return [part.id, part.baseWeight * themeMultiplier * boostMultiplier]
  }))
  const positiveCandidates = candidates.filter(part => (finalWeights[part.id] ?? 0) > 0)
  const part = positiveCandidates.length === 0
    ? null
    : pickWeighted(positiveCandidates, item => finalWeights[item.id] ?? 0, input.rng)

  return {
    part,
    trace: {
      rangeMode,
      rarityRoll: rarity,
      rarity,
      candidateIds: candidates.map(item => item.id),
      finalWeights,
    },
  }
}

export function checkPartCompatibility(
  part: VisualPartDefinition,
  rigId: RigId,
  catalog: Catalog,
  selections: Partial<Record<VisualSlotId, VisualSelection>>,
): boolean {
  const selectedPartIds = new Set(Object.values(selections).map(selection => selection.partId))
  const replacedSelection = selections[part.slotId]
  if (replacedSelection !== undefined) selectedPartIds.delete(replacedSelection.partId)
  selectedPartIds.delete(part.id)
  const selectedParts = catalog.parts.filter(item => selectedPartIds.has(item.id))
  return isHardCompatible(part, rigId, catalog, selectedPartIds, selectedParts)
}
