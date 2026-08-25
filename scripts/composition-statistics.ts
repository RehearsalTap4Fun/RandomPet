import {
  generateMonster,
  planComposition,
  strongFeatureCount,
  type Catalog,
  type ThemeId,
} from '@qmonster/generator-core'

const THEMES: readonly ThemeId[] = ['deep-sea', 'fungal', 'shadow']
const OPTIONAL_SLOTS = ['headAppendage', 'tail', 'extraAppendage', 'effect'] as const

export function measureCompositionDistribution(
  catalog: Catalog,
  seeds: readonly string[],
): {
  optionalNoneRates: Record<typeof OPTIONAL_SLOTS[number], number>
  maximumStrongFeatures: number
  maximumSurpriseSlots: number
} {
  if (seeds.length === 0) throw new Error('Composition distribution requires at least one seed.')
  const noneCounts: Record<typeof OPTIONAL_SLOTS[number], number> = {
    headAppendage: 0,
    tail: 0,
    extraAppendage: 0,
    effect: 0,
  }
  let maximumStrongFeatures = 0
  let maximumSurpriseSlots = 0

  for (const [index, seed] of seeds.entries()) {
    const themeId = THEMES[index % THEMES.length]!
    const generated = generateMonster({ seed, themeId, mode: 'normal' }, catalog)
    if (generated.blocked) throw new Error(`Composition distribution generation failed for ${seed}.`)
    for (const slotId of OPTIONAL_SLOTS) {
      const selected = generated.spec.visualSlots[slotId]
      const part = catalog.parts.find(candidate => candidate.slotId === slotId && candidate.id === selected.partId)
      if (part?.composition?.isNone === true) noneCounts[slotId] += 1
    }
    maximumStrongFeatures = Math.max(maximumStrongFeatures, strongFeatureCount(generated.spec, catalog))
    const rigId = generated.spec.visualSlots.bodyFrame.rigId
    const plan = planComposition(seed, themeId, rigId, catalog)
    const surpriseSlots = (catalog.compositionPolicy?.motifSlots ?? []).filter(slotId => {
      if (plan.motifModes[slotId] !== 'surprise') return false
      const selected = generated.spec.visualSlots[slotId]
      return catalog.parts.find(candidate => candidate.slotId === slotId && candidate.id === selected.partId)
        ?.composition?.isNone === false
    }).length
    maximumSurpriseSlots = Math.max(maximumSurpriseSlots, surpriseSlots)
  }

  return {
    optionalNoneRates: Object.fromEntries(OPTIONAL_SLOTS.map(slotId => [
      slotId,
      noneCounts[slotId] / seeds.length,
    ])) as Record<typeof OPTIONAL_SLOTS[number], number>,
    maximumStrongFeatures,
    maximumSurpriseSlots,
  }
}
