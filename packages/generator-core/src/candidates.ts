import type {
  Catalog,
  RigId,
  ThemeId,
  VisualPartDefinition,
  VisualSelection,
  VisualSlotId,
} from './contracts.js'
import { connectorExclusionCodes, type StructuralPartSelection } from './connector-compatibility.js'
import type { MotifMode } from './composition.js'
import { pickWeighted, type Rng } from './prng.js'

type Rarity = VisualPartDefinition['rarity']

export interface CandidateTrace {
  rangeMode: 'theme' | 'full'
  themeFallback: boolean
  rarityRoll: Rarity
  rarity: Rarity
  candidateIds: string[]
  finalWeights: Record<string, number>
  connectorExclusions: Record<string, string[]>
}

export interface BuildCandidatesInput {
  catalog: Catalog
  slotId: VisualSlotId
  themeId: ThemeId
  rigId: RigId
  selections: Partial<Record<VisualSlotId, VisualSelection>>
  rng: Rng
  composition?: {
    motifMode: MotifMode
    remainingStrong: number
  }
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

function structuralSelections(
  catalog: Catalog,
  selections: Partial<Record<VisualSlotId, VisualSelection>>,
): Map<Extract<VisualSlotId, 'bodyFrame' | 'headShape' | 'arms' | 'legs' | 'tail' | 'extraAppendage'>, StructuralPartSelection> {
  const structural = new Map<Extract<VisualSlotId, 'bodyFrame' | 'headShape' | 'arms' | 'legs' | 'tail' | 'extraAppendage'>, StructuralPartSelection>()
  for (const [slotId, selection] of Object.entries(selections) as [VisualSlotId, VisualSelection][]) {
    if (!['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'].includes(slotId)) continue
    const part = catalog.parts.find(candidate => candidate.id === selection.partId && candidate.slotId === slotId)
    if (part !== undefined) structural.set(slotId as Extract<VisualSlotId, 'bodyFrame' | 'headShape' | 'arms' | 'legs' | 'tail' | 'extraAppendage'>, { part, rigId: selection.rigId })
  }
  return structural
}

export function buildCandidates(input: BuildCandidatesInput): CandidateResult {
  const selectedPartIds = new Set(Object.entries(input.selections)
    .filter(([slotId]) => slotId !== input.slotId)
    .map(([, selection]) => selection.partId))
  const selectedParts = input.catalog.parts.filter(part => selectedPartIds.has(part.id))
  const selectedStructuralParts = structuralSelections(input.catalog, input.selections)
  const connectorExclusions: Record<string, string[]> = {}
  const compatible = input.catalog.parts.filter(part => {
    if (part.slotId !== input.slotId || !isHardCompatible(part, input.rigId, input.catalog, selectedPartIds, selectedParts)) return false
    const exclusions = connectorExclusionCodes(input.catalog, part, input.rigId, selectedStructuralParts)
    if (exclusions.length > 0) {
      connectorExclusions[part.id] = exclusions
      return false
    }
    return true
  })

  let themeFallback = false
  let rangeMode: CandidateTrace['rangeMode']
  let range: VisualPartDefinition[]
  if (input.composition !== undefined && input.catalog.compositionPolicy !== undefined) {
    const withinIntensityBudget = compatible.filter(part => (
      input.composition!.remainingStrong > 0
      || part.composition?.isNone === true
      || part.composition?.visualIntensity !== 'strong'
    ))
    if (input.slotId === 'colorScheme') {
      rangeMode = 'theme'
      range = withinIntensityBudget.filter(part => part.themeIds.includes(input.themeId))
    } else if (input.composition.motifMode === 'dominant') {
      const dominantPool = withinIntensityBudget.filter(part => (
        part.composition?.isNone === true || part.composition?.motifTags.includes(input.themeId)
      ))
      themeFallback = dominantPool.length === 0 && withinIntensityBudget.length > 0
      rangeMode = themeFallback ? 'full' : 'theme'
      range = themeFallback ? withinIntensityBudget : dominantPool
    } else {
      rangeMode = 'full'
      range = withinIntensityBudget
    }
  } else {
    const themePool = compatible.filter(part => part.themeIds.includes(input.themeId))
    const themeRoll = input.rng.nextFloat()
    const hardThemeBound = input.slotId === 'colorScheme'
    const useThemePool = hardThemeBound || (themeRoll < 0.7 && themePool.length > 0)
    rangeMode = useThemePool ? 'theme' : 'full'
    range = useThemePool ? themePool : compatible
  }
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
      themeFallback,
      rarityRoll: rarity,
      rarity,
      candidateIds: candidates.map(item => item.id),
      finalWeights,
      connectorExclusions,
    },
  }
}

export function checkPartCompatibility(
  part: VisualPartDefinition,
  rigId: RigId,
  catalog: Catalog,
  selections: Partial<Record<VisualSlotId, VisualSelection>>,
  themeId: ThemeId,
): boolean {
  if (part.slotId === 'colorScheme' && !part.themeIds.includes(themeId)) return false
  const selectedPartIds = new Set(Object.values(selections).map(selection => selection.partId))
  const replacedSelection = selections[part.slotId]
  if (replacedSelection !== undefined) selectedPartIds.delete(replacedSelection.partId)
  selectedPartIds.delete(part.id)
  const selectedParts = catalog.parts.filter(item => selectedPartIds.has(item.id))
  return isHardCompatible(part, rigId, catalog, selectedPartIds, selectedParts)
    && connectorExclusionCodes(catalog, part, rigId, structuralSelections(catalog, selections)).length === 0
}
