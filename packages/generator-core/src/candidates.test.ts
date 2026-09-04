import { describe, expect, it } from 'vitest'
import { buildCandidates, createRng, type Rng, type VisualPartDefinition } from './index.js'
import { makeCompositionCatalogFixture, makeInterfaceCatalogFixture, makeValidCatalogFixture } from './test-fixtures.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'
import { parseCatalog } from './catalog-schema.js'

function scriptedRng(...values: number[]): Rng {
  let index = 0
  return {
    nextFloat() {
      const value = values[index]
      index += 1
      if (value === undefined) throw new Error(`Unexpected RNG read at index ${index - 1}`)
      return value
    },
  }
}

function makeStrongCompositionEyesCatalog() {
  const catalog = makeCompositionCatalogFixture()
  const source = catalog.parts.find(part => part.slotId === 'eyes' && !part.composition!.isNone)!
  catalog.parts.push(
    {
      ...structuredClone(source),
      id: 'eyes_quiet_fungal',
      composition: { ...structuredClone(source.composition!), motifTags: ['fungal'], visualIntensity: 'quiet' },
    },
    {
      ...structuredClone(source),
      id: 'eyes_triple_foreign',
      composition: {
        ...structuredClone(source.composition!),
        motifTags: ['shadow'],
        visualIntensity: 'strong',
        renderNodes: source.composition!.renderNodes.map(node => ({ ...node, id: `eyes_triple_foreign_${node.id}` })),
      },
    },
  )
  return catalog
}

describe('candidate pool boundaries', () => {
  it('filters v0.6 local candidates to the selected anatomy bundle pool', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const bundle = parsed.value.anatomyBundles![0]!
    const normal = buildCandidates({
      catalog: parsed.value, slotId: 'eyes', themeId: 'fungal', rigId: bundle.rigId, selections: {},
      archetypeId: 'feline', specialFeature: { required: false, forbidden: true }, rng: createRng(['feline-normal']),
      allowedPartIds: bundle.allowedTraitPools.eyes,
    })

    expect(normal.trace.candidateIds).toEqual(bundle.allowedTraitPools.eyes)
    expect(normal.part?.id).toBe(bundle.allowedTraitPools.eyes![0])
  })

  it('forward-filters only bodies that empty a required dominant structural theme pool', () => {
    const catalog = makeInterfaceCatalogFixture()
    const compatibleBody = catalog.parts.find(part => part.id === 'body_blob')!
    const compatibleHead = catalog.parts.find(part => part.id === 'head_round')!
    const incompatibleBody = structuredClone(compatibleBody)
    incompatibleBody.id = 'body_without_fungal_head'
    if (incompatibleBody.composition?.mode !== 'interface') throw new Error('Expected interface body')
    incompatibleBody.composition.variantsByRig.blob!.connectors
      .find(connector => connector.id === 'neck')!.depth = 20
    const incompatibleAlternativeHead = structuredClone(compatibleHead)
    incompatibleAlternativeHead.id = 'head_fungal_warp_risk'
    if (incompatibleAlternativeHead.composition?.mode !== 'interface') throw new Error('Expected interface head')
    incompatibleAlternativeHead.composition.variantsByRig.blob!.connectors
      .find(connector => connector.id === 'neck')!.depth = 300
    catalog.parts.push(incompatibleBody, incompatibleAlternativeHead)

    const required = buildCandidates({
      catalog,
      slotId: 'bodyFrame', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: scriptedRng(0, 0),
      composition: {
        motifMode: 'dominant', remainingStrong: 2, remainingStrongNonFacial: 1,
        requiredDominantStructuralSlots: ['headShape'],
      },
    })
    const withoutForwardRequirement = buildCandidates({
      catalog,
      slotId: 'bodyFrame', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: scriptedRng(0, 0),
      composition: { motifMode: 'dominant', remainingStrong: 2, remainingStrongNonFacial: 1 },
    })
    const legacyCatalog = structuredClone(catalog)
    legacyCatalog.version = '0.2.0'
    const legacy = buildCandidates({
      catalog: legacyCatalog,
      slotId: 'bodyFrame', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: scriptedRng(0, 0),
      composition: {
        motifMode: 'dominant', remainingStrong: 2, remainingStrongNonFacial: 1,
        requiredDominantStructuralSlots: ['headShape'],
      },
    })

    expect(required.trace.candidateIds).toEqual(['body_blob'])
    expect(withoutForwardRequirement.trace.candidateIds).toEqual([
      'body_blob', 'body_without_fungal_head',
    ])
    expect(legacy.trace.candidateIds).toEqual(['body_blob', 'body_without_fungal_head'])
  })

  it('records connector exclusions before theme and rarity selection in interface catalogs', () => {
    const catalog = makeInterfaceCatalogFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300

    const result = buildCandidates({
      catalog,
      slotId: 'headShape', themeId: 'fungal', rigId: 'blob',
      selections: { bodyFrame: { partId: 'body_blob', rigId: 'blob' } },
      rng: scriptedRng(0, 0),
    })

    expect(result.trace.candidateIds).toEqual([])
    expect(result.trace.connectorExclusions).toEqual({ head_round: ['CONNECTOR_WARP_EXCEEDED'] })
  })

  it('filters foreign motifs and strong candidates when the current allowance is exhausted', () => {
    const result = buildCandidates({
      catalog: makeStrongCompositionEyesCatalog(),
      slotId: 'eyes', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: createRng(['budget-filter']),
      composition: { motifMode: 'dominant', remainingStrong: 0, remainingStrongNonFacial: 1 },
    })

    expect(result.trace.candidateIds).not.toContain('eyes_triple_foreign')
    expect(result.trace.candidateIds).toContain('eyes_quiet_fungal')
  })

  it('filters a strong non-facial candidate after that dedicated budget is exhausted', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const surface = catalog.parts.find(part => part.slotId === 'surfaceMaterial')!
    const pattern = catalog.parts.find(part => part.slotId === 'pattern')!
    const surfaceStrong: VisualPartDefinition = {
      ...structuredClone(surface),
      id: 'surface_strong',
      composition: { ...structuredClone(surface.composition!), visualIntensity: 'strong' },
    }
    const surfaceQuiet: VisualPartDefinition = {
      ...structuredClone(surface),
      id: 'surface_quiet',
      composition: { ...structuredClone(surface.composition!), visualIntensity: 'quiet' },
    }
    const patternStrong: VisualPartDefinition = {
      ...structuredClone(pattern),
      id: 'pattern_strong',
      composition: { ...structuredClone(pattern.composition!), visualIntensity: 'strong' },
    }
    const patternQuiet: VisualPartDefinition = {
      ...structuredClone(pattern),
      id: 'pattern_quiet',
      composition: { ...structuredClone(pattern.composition!), visualIntensity: 'quiet' },
    }
    catalog.parts = [surfaceStrong, surfaceQuiet, patternStrong, patternQuiet]

    const result = buildCandidates({
      catalog,
      slotId: 'pattern',
      themeId: 'fungal',
      rigId: 'blob',
      selections: { surfaceMaterial: { partId: 'surface_strong', rigId: 'blob' } },
      rng: createRng(['non-facial-budget']),
      composition: {
        motifMode: 'neutral',
        remainingStrong: 1,
        remainingStrongNonFacial: 0,
      },
    })

    expect(result.trace.candidateIds).not.toContain('pattern_strong')
    expect(result.part?.composition?.visualIntensity).not.toBe('strong')
  })

  it('lets a surprise slot draw both dominant and foreign motif candidates', () => {
    const result = buildCandidates({
      catalog: makeStrongCompositionEyesCatalog(),
      slotId: 'eyes', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: createRng(['surprise-pool']),
      composition: { motifMode: 'surprise', remainingStrong: 1, remainingStrongNonFacial: 1 },
    })

    expect(result.trace.candidateIds).toContain('eyes_quiet_fungal')
    expect(result.trace.candidateIds).toContain('eyes_triple_foreign')
  })

  it('treats explicit none as quiet and theme-neutral in a dominant pool', () => {
    const catalog = makeCompositionCatalogFixture()
    const none = catalog.parts.find(part => part.id === 'head_appendage_none')!
    const foreign = catalog.parts.find(part => part.slotId === 'headAppendage' && !part.composition!.isNone)!
    catalog.parts = [{
      ...structuredClone(none),
      assetPath: '',
      composition: { ...structuredClone(none.composition!), motifTags: ['shadow'], visualIntensity: 'strong' },
    }, {
      ...structuredClone(foreign),
      id: 'head_appendage_strong_foreign',
      composition: {
        ...structuredClone(foreign.composition!), motifTags: ['shadow'], visualIntensity: 'strong',
        renderNodes: foreign.composition!.renderNodes.map(node => ({ ...node, id: `foreign_${node.id}` })),
      },
    }]

    const result = buildCandidates({
      catalog, slotId: 'headAppendage', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: createRng(['none-is-neutral']),
      composition: { motifMode: 'dominant', remainingStrong: 0, remainingStrongNonFacial: 1 },
    })

    expect(result.trace.candidateIds).toEqual(['head_appendage_none'])
    expect(result.part?.id).toBe('head_appendage_none')
  })

  it('marks the trace when an empty dominant pool falls back to a foreign candidate', () => {
    const catalog = makeStrongCompositionEyesCatalog()
    catalog.parts = catalog.parts.filter(part => part.id === 'eyes_triple_foreign')

    const result = buildCandidates({
      catalog, slotId: 'eyes', themeId: 'fungal', rigId: 'blob', selections: {},
      rng: createRng(['dominant-fallback']),
      composition: { motifMode: 'dominant', remainingStrong: 1, remainingStrongNonFacial: 1 },
    })

    expect(result.trace.themeFallback).toBe(true)
    expect(result.trace.candidateIds).toEqual(['eyes_triple_foreign'])
  })

  it('never exposes a cross-theme colorScheme candidate across many deterministic seeds', () => {
    const catalog = makeValidCatalogFixture()
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    catalog.parts = [
      { ...color, id: 'color_fungal', themeIds: ['fungal'] },
      { ...color, id: 'color_deep_sea', themeIds: ['deep-sea'] },
      { ...color, id: 'color_shadow', themeIds: ['shadow'] },
    ]

    for (let seed = 0; seed < 1_000; seed += 1) {
      const result = buildCandidates({
        catalog,
        slotId: 'colorScheme',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng: createRng(['hard-theme-color', seed]),
      })
      expect(result.trace.rangeMode).toBe('theme')
      expect(result.trace.candidateIds).toEqual(['color_fungal'])
      expect(result.part?.id).toBe('color_fungal')
    }
  })

  it('keeps colorScheme hard-bound to the selected theme with composition planning enabled', () => {
    const catalog = makeValidCatalogFixture()
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    catalog.parts = [
      { ...color, id: 'color_fungal', themeIds: ['fungal'] },
      { ...color, id: 'color_deep_sea', themeIds: ['deep-sea'] },
      { ...color, id: 'color_shadow', themeIds: ['shadow'] },
    ]
    catalog.compositionPolicy = {
      motifSlots: ['eyes'],
      surpriseRatio: 0.3,
      maxStrongFeatures: 2,
      optionalNoneRate: { min: 0.35, max: 0.5 },
      frameBounds: { x: 96, y: 64, width: 1856, height: 1888 },
      faceInsideRatio: 0.8,
      faceVisibleRatio: 0.85,
    }

    for (let seed = 0; seed < 1_000; seed += 1) {
      const result = buildCandidates({
        catalog,
        slotId: 'colorScheme',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng: createRng(['composition-hard-theme-color', seed]),
        composition: { motifMode: 'neutral', remainingStrong: 2, remainingStrongNonFacial: 1 },
      })
      expect(result.trace.rangeMode).toBe('theme')
      expect(result.trace.candidateIds).toEqual(['color_fungal'])
      expect(result.part?.id).toBe('color_fungal')
    }
  })

  it('retains both 70-percent theme and 30-percent full-pool branches for non-color slots', () => {
    const catalog = makeValidCatalogFixture()
    const eye = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts = [
      { ...eye, id: 'eyes_fungal', themeIds: ['fungal'] },
      { ...eye, id: 'eyes_deep_sea', themeIds: ['deep-sea'] },
    ]
    const counts = { theme: 0, full: 0 }
    for (let seed = 0; seed < 1_000; seed += 1) {
      const result = buildCandidates({
        catalog,
        slotId: 'eyes',
        themeId: 'fungal',
        rigId: 'blob',
        selections: {},
        rng: createRng(['soft-theme-eyes', seed]),
      })
      counts[result.trace.rangeMode] += 1
    }
    expect(counts.theme).toBeGreaterThanOrEqual(650)
    expect(counts.theme).toBeLessThanOrEqual(750)
    expect(counts.full).toBe(1_000 - counts.theme)
  })

  it('forces the theme branch below 0.7 and the full-pool branch at 0.7', () => {
    const catalog = makeValidCatalogFixture()
    const themePart = catalog.parts.find(part => part.slotId === 'eyes')!
    const fullOnlyPart = { ...themePart, id: 'eyes_full_only', themeIds: ['deep-sea' as const] }
    catalog.parts = [themePart, fullOnlyPart]

    const themed = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0.699_999, 0, 0.999),
    })
    const full = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0.7, 0, 0.999),
    })

    expect(themed.trace.rangeMode).toBe('theme')
    expect(themed.trace.candidateIds).toEqual(['eyes_asymmetric'])
    expect(themed.part?.id).toBe('eyes_asymmetric')
    expect(full.trace.rangeMode).toBe('full')
    expect(full.trace.candidateIds).toEqual(['eyes_asymmetric', 'eyes_full_only'])
    expect(full.part?.id).toBe('eyes_full_only')
  })

  it('falls back to the full pool only when the selected theme pool is empty', () => {
    const catalog = makeValidCatalogFixture()
    const part = catalog.parts.find(item => item.slotId === 'eyes')!
    catalog.parts = [{ ...part, id: 'eyes_deep_sea_only', themeIds: ['deep-sea'] }]

    const result = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0, 0),
    })

    expect(result.trace.rangeMode).toBe('full')
    expect(result.trace.candidateIds).toEqual(['eyes_deep_sea_only'])
    expect(result.part?.id).toBe('eyes_deep_sea_only')
  })

  it('renormalizes N and L rarity weights when R is unavailable', () => {
    const catalog = makeValidCatalogFixture()
    const normal = catalog.parts.find(part => part.slotId === 'eyes')!
    const legendary = { ...normal, id: 'eyes_legendary', rarity: 'L' as const }
    catalog.parts = [normal, legendary]

    const normalResult = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0.92, 0),
    })
    const legendaryResult = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {},
      rng: scriptedRng(0, 0.94, 0),
    })

    expect(normalResult.trace.rarityRoll).toBe('N')
    expect(normalResult.part?.id).toBe('eyes_asymmetric')
    expect(legendaryResult.trace.rarityRoll).toBe('L')
    expect(legendaryResult.part?.id).toBe('eyes_legendary')
  })

  it('applies every hard filter before theme and rarity pooling', () => {
    const catalog = makeValidCatalogFixture()
    const eye = catalog.parts.find(part => part.slotId === 'eyes')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const selectedArms = { ...arms, excludes: ['eyes_reverse_excluded'] }
    const candidates: VisualPartDefinition[] = [
      { ...eye, id: 'eyes_valid' },
      { ...eye, id: 'eyes_wrong_rig', compatibleRigs: ['biped'] },
      { ...eye, id: 'eyes_missing_socket', socket: 'missingSocket' },
      { ...eye, id: 'eyes_forward_excluded', excludes: [selectedArms.id] },
      { ...eye, id: 'eyes_reverse_excluded' },
      { ...eye, id: 'eyes_missing_asset', assetPath: '' },
    ]
    catalog.parts = [selectedArms, ...candidates]

    const result = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: { arms: { partId: selectedArms.id, rigId: 'blob' } },
      rng: scriptedRng(0, 0, 0),
    })

    expect(result.trace.rangeMode).toBe('theme')
    expect(result.trace.rarityRoll).toBe('N')
    expect(result.trace.candidateIds).toEqual(['eyes_valid'])
    expect(result.trace.finalWeights).toEqual({ eyes_valid: 1 })
    expect(result.part?.id).toBe('eyes_valid')
  })
})
