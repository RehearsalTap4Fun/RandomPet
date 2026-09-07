import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  createRng,
  descendantsOf,
  GENOME_LAYERS,
  GENERATION_ORDER,
  generateMonster,
  generateVisualLayer,
  generationOrderForCatalog,
  genomeLayerSeed,
  parseCatalog,
  rerollSlot,
  evaluatePartSelection,
  planComposition,
  selectVisualPart,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  validateMonsterGenome,
  validateAnatomyBundleSpec,
  VISUAL_SLOT_IDS,
  type Catalog,
  type GenerationRequest,
} from './index.js'
import {
  makeCompositionCatalogFixture,
  makeValidCatalogFixture,
  makeValidCatalogFixtureWithThreeRigs,
} from './test-fixtures.js'
import productionCatalogDocument from '../../asset-catalog/catalog/v0.3.0/catalog.json'
import v05ProductionCatalogDocument from '../../asset-catalog/catalog/v0.5.0/catalog.json'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'

const baseRequest = {
  seed: '84721937',
  themeId: 'fungal',
  mode: 'normal',
} as const satisfies GenerationRequest

function makeStrongBudgetCatalog(): Catalog {
  const catalog = makeCompositionCatalogFixture()
  for (const slotId of ['headShape', 'eyes', 'effect'] as const) {
    const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
    const strong = {
      ...structuredClone(source),
      id: `${slotId}_forced_strong`,
      composition: {
        ...structuredClone(source.composition!),
        visualIntensity: 'strong' as const,
        renderNodes: source.composition!.renderNodes.map(node => ({
          ...node,
          id: `${slotId}_forced_strong_${node.id}`,
        })),
      },
    }
    catalog.parts = catalog.parts.filter(part => part.slotId !== slotId)
    catalog.parts.push(strong)
  }
  return catalog
}

function makeNonFacialStrongBudgetCatalog(): Catalog {
  const catalog = makeCompositionCatalogFixture()
  catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
  for (const slotId of ['surfaceMaterial', 'pattern', 'effect'] as const) {
    const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
    catalog.parts.push({
      ...structuredClone(source),
      id: `${slotId}_forced_strong_nonfacial`,
      baseWeight: 1_000_000_000,
      composition: {
        ...structuredClone(source.composition!),
        visualIntensity: 'strong',
        renderNodes: source.composition!.renderNodes.map(node => ({
          ...node,
          id: `${slotId}_forced_strong_nonfacial_${node.id}`,
        })),
      },
    })
  }
  return catalog
}

describe('generateMonster', () => {
  it('generates a contract-valid feline anatomy bundle with no more than one altered-mode special feature', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const catalog = parsedCatalog.value
    const countSpecialFeatures = (spec: ReturnType<typeof generateMonster>['spec']) => (
      Object.values(spec.visualSlots).filter(selection => (
        catalog.parts.find(part => part.id === selection.partId)?.featureTier === 'special'
      )).length
    )

    const generated = generateMonster({
      seed: 'feline-contract', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline',
    }, catalog)
    const normal = generateMonster({
      seed: 'feline-contract', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(generated.blocked).toBe(false)
    expect(generated.spec).toMatchObject({
      schemaVersion: '0.2.0', catalogVersion: '0.6.0', rendererVersion: '0.6.0', archetypeId: 'feline',
    })
    expect(new Set(Object.values(generated.spec.visualSlots).map(item => item.rigId))).toEqual(new Set(['feline-sit']))
    expect(generated.spec.anatomyBundleId).toBeDefined()
    expect(countSpecialFeatures(generated.spec)).toBeLessThanOrEqual(1)
    expect(countSpecialFeatures(normal.spec)).toBe(0)
    expect(validateAnatomyBundleSpec(generated.spec, catalog)).toEqual([])
    expect(validateAnatomyBundleSpec(normal.spec, catalog)).toEqual([])
  })

  it('fails closed when a v0.6 request does not resolve its archetype', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const generated = generateMonster({ seed: 'feline-no-archetype', themeId: 'fungal', mode: 'normal' }, parsedCatalog.value)

    expect(generated.blocked).toBe(true)
    expect(generated.diagnostics).toContainEqual(expect.objectContaining({ code: 'ARCHETYPE_UNSUPPORTED' }))
  })

  it('returns a blocked result instead of throwing when no feline anatomy bundle is available', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const catalog = structuredClone(parsedCatalog.value)
    catalog.anatomyBundles = []

    expect(() => generateMonster({
      seed: 'feline-no-bundle', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)).not.toThrow()

    const generated = generateMonster({
      seed: 'feline-no-bundle', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(generated.blocked).toBe(true)
    expect(generated.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ANATOMY_BUNDLE_UNAVAILABLE', path: ['anatomyBundleId'],
    }))
  })

  it('selects the bundle that owns a locked structural part during global generation', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const catalog = parsedCatalog.value
    const lockedBundle = catalog.anatomyBundles!.find(bundle => bundle.id === 'feline-sit-saffron-longtail')!

    const generated = generateMonster({
      seed: 'remediation-0', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
      lockedSelections: { tail: lockedBundle.derivedSlots.tail },
    }, catalog)

    expect(generated.blocked).toBe(false)
    expect(generated.spec.anatomyBundleId).toBe(lockedBundle.id)
    expect(generated.spec.visualSlots.tail.partId).toBe(lockedBundle.derivedSlots.tail)
  })

  it('blocks contradictory structural locks instead of selecting a different anatomy bundle', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const catalog = parsedCatalog.value
    const saffron = catalog.anatomyBundles!.find(bundle => bundle.id === 'feline-sit-saffron-longtail')!
    const silver = catalog.anatomyBundles!.find(bundle => bundle.id === 'feline-sit-silver-curl')!

    const generated = generateMonster({
      seed: 'remediation-0', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
      lockedSelections: {
        bodyFrame: silver.derivedSlots.bodyFrame,
        tail: saffron.derivedSlots.tail,
      },
    }, catalog)

    expect(generated.blocked).toBe(true)
    expect(generated.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ANATOMY_BUNDLE_UNAVAILABLE', path: ['anatomyBundleId'],
    }))
  })

  it('blocks a local generation lock that is outside the selected anatomy bundle pool', () => {
    const parsedCatalog = parseCatalog(v06ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const generated = generateMonster({
      seed: 'feline-locked-altered-specials', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline',
      lockedSelections: { eyes: 'eyes_feline_bundle_feline_sit_saffron_longtail' },
    }, parsedCatalog.value)

    expect(generated.blocked).toBe(true)
    expect(generated.diagnostics).toContainEqual(expect.objectContaining({ code: 'LOCK_INCOMPATIBLE' }))
  })

  it('resolves visual slots in the composition dependency order', () => {
    expect(GENERATION_ORDER).toEqual([
      'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
      'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
      'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
    ])
  })

  it('preserves the fixed production first-hatch phenotype', () => {
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const generated = generateMonster({
      seed: 'qmonster-v0.1-first-hatch',
      themeId: 'fungal',
      mode: 'normal',
    }, parsedCatalog.value)

    expect(Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
      slotId,
      generated.spec.visualSlots[slotId],
    ]))).toEqual({
      bodyFrame: { partId: 'body_biped_peanut', rigId: 'biped' },
      headShape: { partId: 'head_round_dome', rigId: 'biped' },
      eyes: { partId: 'eyes_sleepy_crescent', rigId: 'biped' },
      mouthShape: { partId: 'mouth_soft_pout', rigId: 'biped' },
      oralDetail: { partId: 'oral_lolling_tongue', rigId: 'biped' },
      headAppendage: { partId: 'head_appendage_none', rigId: 'biped' },
      arms: { partId: 'arms_long_noodle', rigId: 'biped' },
      legs: { partId: 'legs_stub_feet', rigId: 'biped' },
      tail: { partId: 'tail_soft_curl', rigId: 'biped' },
      extraAppendage: { partId: 'extra_soft_tentacles', rigId: 'biped' },
      surfaceMaterial: { partId: 'surface_short_fur', rigId: 'biped' },
      pattern: { partId: 'pattern_soft_spots', rigId: 'biped' },
      colorScheme: { partId: 'color_fungal_amber', rigId: 'biped' },
      effect: { partId: 'effect_none', rigId: 'biped' },
    })
  })

  it('generates only the single-head long-tail v0.5 pool across deterministic modes and seeds', () => {
    const parsedCatalog = parseCatalog(v05ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    expect(parsedCatalog.value.parts.filter(part => part.slotId === 'tail').map(part => part.id).sort()).toEqual([
      'tail_cat_long', 'tail_dog_long', 'tail_none',
    ])
    expect(parsedCatalog.value.modifiers.map(modifier => modifier.id)).not.toContain('mutation_double_head')
    for (const mode of ['normal', 'mutation', 'aberration'] as const) for (let index = 0; index < 40; index += 1) {
      const generated = generateMonster({
        seed: `v05-single-head-long-tail-${mode}-${index}`,
        themeId: ['deep-sea', 'fungal', 'shadow'][index % 3]!,
        mode,
      }, parsedCatalog.value)

      expect(generated.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      expect(['tail_none', 'tail_cat_long', 'tail_dog_long']).toContain(generated.spec.visualSlots.tail.partId)
      expect(generated.spec.mutation?.id).not.toBe('mutation_double_head')
      expect(Object.keys(generated.spec.visualSlots).filter(slotId => slotId === 'headShape')).toHaveLength(1)
    }
  })

  it('generates a deterministic complete genome whose P matches the phenotype', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const left = generateMonster(baseRequest, catalog)
    const right = generateMonster(baseRequest, catalog)

    expect(left.spec.genome).toEqual(right.spec.genome)
    expect(left.spec.genome?.genomeVersion).toBe('0.1.0')
    for (const slotId of VISUAL_SLOT_IDS) {
      expect(left.spec.genome?.genes[slotId].P).toBe(left.spec.visualSlots[slotId].partId)
      expect(Object.keys(left.spec.genome!.genes[slotId])).toEqual(['P', 'H1', 'H2', 'H3'])
    }
  })

  it('derives every hidden layer independently and ignores P locks', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...eyes, id: 'eyes_locked_only' })
    const request = { seed: 'independent-layers', themeId: 'fungal', mode: 'normal' } as const
    const unlocked = generateMonster(request, catalog).spec
    const locked = generateMonster({ ...request, lockedSelections: { eyes: 'eyes_locked_only' } }, catalog).spec

    expect(locked.genome!.genes.eyes.P).toBe('eyes_locked_only')
    for (const layer of ['H1', 'H2', 'H3'] as const) {
      const standalone = generateVisualLayer({
        seed: genomeLayerSeed(request.seed, layer),
        themeId: request.themeId,
      }, catalog)
      for (const slotId of VISUAL_SLOT_IDS) {
        expect(locked.genome!.genes[slotId][layer]).toBe(standalone.visualSlots[slotId].partId)
        expect(locked.genome!.genes[slotId][layer]).toBe(unlocked.genome!.genes[slotId][layer])
      }
    }
  })

  it('never auto-generates more than two strong parts over 500 seeds', () => {
    const catalog = makeStrongBudgetCatalog()

    for (let index = 0; index < 500; index += 1) {
      const result = generateMonster({ seed: `strong-${index}`, themeId: 'fungal', mode: 'normal' }, catalog)
      expect(strongFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(2)
    }
  })

  it('never auto-generates more than one strong non-facial selection', () => {
    const catalog = makeNonFacialStrongBudgetCatalog()

    for (let index = 0; index < 500; index += 1) {
      const result = generateMonster({ seed: `nonfacial-${index}`, themeId: 'fungal', mode: 'normal' }, catalog)
      expect(strongNonFacialFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(1)
    }
  })

  it('reserves a locked strong non-facial selection before its slot is reached', () => {
    const catalog = makeNonFacialStrongBudgetCatalog()

    const result = generateMonster({
      seed: 'locked-nonfacial-budget',
      themeId: 'fungal',
      mode: 'normal',
      lockedSelections: { pattern: 'pattern_forced_strong_nonfacial' },
    }, catalog)

    expect(result.spec.visualSlots.pattern.partId).toBe('pattern_forced_strong_nonfacial')
    expect(result.spec.visualSlots.surfaceMaterial.partId).not.toBe('surfaceMaterial_forced_strong_nonfacial')
    expect(strongNonFacialFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(1)
  })

  it('reports every visual slot as affected during initial generation', () => {
    const result = generateMonster(baseRequest, makeValidCatalogFixture())

    expect(result.affectedSlots).toEqual([
      'bodyFrame', 'colorScheme', 'surfaceMaterial', 'pattern',
      'headShape', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
      'eyes', 'mouthShape', 'oralDetail', 'effect',
    ])
  })

  it('keeps legacy affected slots in the legacy generation order', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { bodyFrame: ['colorScheme', 'eyes'] }
    const initial = generateMonster(baseRequest, catalog)
    const rerolled = rerollSlot({ spec: initial.spec, slotId: 'bodyFrame', locks: {}, catalog })
    const selected = selectVisualPart({
      spec: initial.spec,
      slotId: 'bodyFrame',
      partId: initial.spec.visualSlots.bodyFrame.partId,
      locks: {},
      catalog,
    })

    expect(initial.affectedSlots).toEqual([
      'bodyFrame', 'colorScheme', 'surfaceMaterial', 'pattern',
      'headShape', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
      'eyes', 'mouthShape', 'oralDetail', 'effect',
    ])
    expect(rerolled.affectedSlots).toEqual([...generationOrderForCatalog(catalog)])
    expect(selected.affectedSlots).toEqual(['bodyFrame', 'colorScheme', 'eyes'])
  })

  it('reports composition affected slots in structure-first order', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.dependencies = { bodyFrame: ['colorScheme', 'eyes'] }
    const initial = generateMonster(baseRequest, catalog)
    const rerolled = rerollSlot({ spec: initial.spec, slotId: 'bodyFrame', locks: {}, catalog })
    const selected = selectVisualPart({
      spec: initial.spec,
      slotId: 'bodyFrame',
      partId: initial.spec.visualSlots.bodyFrame.partId,
      locks: {},
      catalog,
    })

    expect(initial.affectedSlots).toEqual(GENERATION_ORDER)
    expect(rerolled.affectedSlots).toEqual([...generationOrderForCatalog(catalog)])
    expect(selected.affectedSlots).toEqual(['bodyFrame', 'eyes', 'colorScheme'])
  })

  it('repeats the same spec for the same request and catalog', () => {
    const catalog = makeValidCatalogFixture()
    expect(generateMonster(baseRequest, catalog).spec).toEqual(generateMonster(baseRequest, catalog).spec)
  })

  it('isolates direct slot streams from unrelated catalog growth', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster(baseRequest, catalog).spec
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const expanded: Catalog = {
      ...catalog,
      parts: [...catalog.parts, { ...eyes, id: 'eyes_unrelated_variant', baseWeight: 999 }],
    }
    const after = generateMonster(baseRequest, expanded).spec
    expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('retains an incompatible lock and blocks export', () => {
    const catalog = makeValidCatalogFixture()
    const legs = catalog.parts.find(part => part.slotId === 'legs')!
    const lockedPart = { ...legs, id: 'legs_spring', compatibleRigs: ['biped'] as const }
    const restricted: Catalog = {
      ...catalog,
      parts: [...catalog.parts, lockedPart],
    }
    const result = generateMonster(
      { ...baseRequest, lockedSelections: { bodyFrame: 'body_blob', legs: 'legs_spring' } },
      restricted,
    )
    expect(result.spec.visualSlots.legs.partId).toBe('legs_spring')
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'legs'] }),
    )
  })

  it('retains a locked cross-theme color scheme and blocks', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const result = generateMonster({
      seed: 'theme-lock', themeId: 'shadow', mode: 'normal',
      lockedSelections: { colorScheme: 'color_fungal_amber' },
    }, catalog)

    expect(result.spec.visualSlots.colorScheme.partId).toBe('color_fungal_amber')
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'colorScheme'],
    }))
  })

  it('marks a cross-theme color scheme as not manually selectable', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const spec = generateMonster({ seed: 'theme-manual', themeId: 'shadow', mode: 'normal' }, catalog).spec
    const fungalColor = catalog.parts.find(part => part.id === 'color_fungal_amber')!

    expect(evaluatePartSelection(fungalColor, spec, catalog)).toEqual({
      selectable: false,
      rigId: spec.visualSlots.bodyFrame.rigId,
      reason: 'theme',
    })
  })

  it('selects the same mutation for the same request', () => {
    const request = { ...baseRequest, mode: 'mutation' } as const
    const catalog = makeValidCatalogFixture()
    const first = generateMonster(request, catalog)
    const second = generateMonster(request, catalog)

    expect(first.blocked).toBe(false)
    expect(first.spec.mutation).toEqual(second.spec.mutation)
    expect(first.spec.mutation).not.toBeNull()
    expect(first.spec.aberrations).toEqual([])
  })

  it('includes structural catalog errors in generation diagnostics', () => {
    const catalog = makeValidCatalogFixture()
    catalog.parts = catalog.parts.filter(part => part.slotId !== 'arms')
    const result = generateMonster(baseRequest, catalog)
    expect(result.blocked).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CATALOG_SLOT_UNCOVERED' }))
  })
})

describe('candidate rules', () => {
  it('does not filter a reroll candidate because it excludes the stale same-slot selection', () => {
    const catalog = makeValidCatalogFixture()
    const oldTail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    const replacement = { ...oldTail, id: 'tail_fresh', excludes: [oldTail.id] }
    catalog.parts = [replacement]
    const candidate = buildCandidates({
      catalog,
      slotId: 'tail',
      themeId: 'fungal',
      rigId: 'blob',
      selections: { tail: { partId: oldTail.id, rigId: 'blob' } },
      rng: createRng(['candidate-reroll']),
    })
    expect(candidate.trace.candidateIds).toEqual(['tail_fresh'])
    expect(candidate.part?.id).toBe('tail_fresh')
  })

  it('combines base, active theme, and every active semantic boost multiplier', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    const legs = catalog.parts.find(part => part.slotId === 'legs')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const boostingLegs = { ...legs, boosts: { [eyes.semanticTraitId!]: 4 } }
    const boostingArms = { ...arms, boosts: { [eyes.semanticTraitId!]: 5 } }
    catalog.parts = [
      boostingLegs,
      boostingArms,
      { ...eyes, id: 'eyes_weighted', baseWeight: 3, themeWeights: { fungal: 2 } },
    ]
    const candidate = buildCandidates({
      catalog,
      slotId: 'eyes',
      themeId: 'fungal',
      rigId: 'blob',
      selections: {
        legs: { partId: boostingLegs.id, rigId: 'blob' },
        arms: { partId: boostingArms.id, rigId: 'blob' },
      },
      rng: { nextFloat: () => 0 },
    })
    expect(candidate.trace.finalWeights).toEqual({ eyes_weighted: 120 })
  })
})

describe('local changes', () => {
  function makeRigSwitchCatalog(): Catalog {
    const catalog = makeValidCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    const descendants = VISUAL_SLOT_IDS.filter(slotId => slotId !== 'bodyFrame')
    const originalParts = catalog.parts.filter(part => part.slotId !== 'bodyFrame')
    catalog.dependencies = { bodyFrame: descendants }
    catalog.parts = [
      { ...body, compatibleRigs: ['blob'] },
      {
        ...body,
        id: 'body_biped_manual',
        baseWeight: 0,
        compatibleRigs: ['biped'],
        semanticTraitId: 'frame_biped',
      },
      {
        ...body,
        id: 'body_floating_manual',
        baseWeight: 0,
        compatibleRigs: ['floating'],
        semanticTraitId: 'frame_floating',
      },
      ...originalParts.map(part => ({ ...part, compatibleRigs: ['blob'] as const })),
      ...descendants.flatMap(slotId => {
        const source = originalParts.find(part => part.slotId === slotId)!
        return [
          { ...source, id: `${slotId}_biped`, compatibleRigs: ['biped'] as const },
          { ...source, id: `${slotId}_floating`, compatibleRigs: ['floating'] as const },
        ]
      }),
    ]
    catalog.semanticTraits.push(
      { id: 'frame_biped', semanticSlotId: 'frame' },
      { id: 'frame_floating', semanticSlotId: 'frame' },
    )
    return catalog
  }

  it.each([
    ['body_biped_manual', 'biped', 'frame_biped'],
    ['body_floating_manual', 'floating', 'frame_floating'],
  ] as const)('manual body selection changes to the target %s rig and rebuilds every unlocked descendant', (
    partId,
    targetRig,
    frameTrait,
  ) => {
    const catalog = makeRigSwitchCatalog()
    const before = generateMonster(baseRequest, catalog).spec
    const snapshot = structuredClone(before)

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId,
      locks: {},
      catalog,
    })

    expect(selected.blocked).toBe(false)
    expect(selected.revalidatedDiagnosticScopes).toEqual({
      visualSlots: [...generationOrderForCatalog(catalog)],
      fullGenome: true,
    })
    expect(selected.spec.visualSlots.bodyFrame).toEqual({ partId, rigId: targetRig })
    for (const slotId of VISUAL_SLOT_IDS) {
      expect(selected.spec.visualSlots[slotId].rigId, slotId).toBe(targetRig)
      if (slotId !== 'bodyFrame') {
        expect(selected.spec.visualSlots[slotId].partId, slotId).toBe(`${slotId}_${targetRig}`)
      }
    }
    expect(selected.spec.semanticTraits.frame.primaryTraitId).toBe(frameTrait)
    expect(before).toEqual(snapshot)
  })

  it('rebuilds every hidden layer after a manual body-frame selection', () => {
    const catalog = makeRigSwitchCatalog()
    const before = generateMonster(baseRequest, catalog).spec
    const originalBody = catalog.parts.find(part => part.id === before.visualSlots.bodyFrame.partId)!
    originalBody.baseWeight = 0
    catalog.parts.push({ ...originalBody, id: 'body_hidden_rebuilt', baseWeight: 999 })

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_biped_manual',
      locks: {},
      catalog,
    })

    expect(selected.blocked).toBe(false)
    for (const layer of ['H1', 'H2', 'H3'] as const) {
      const expected = generateVisualLayer({
        seed: genomeLayerSeed(before.seed, layer),
        themeId: before.themeId,
        slotRolls: before.slotRolls,
      }, catalog).visualSlots
      for (const slotId of VISUAL_SLOT_IDS) {
        expect(selected.spec.genome!.genes[slotId][layer], `${slotId}.${layer}`).toBe(
          expected[slotId].partId,
        )
      }
      expect(selected.spec.genome!.genes.bodyFrame[layer]).toBe('body_hidden_rebuilt')
      expect(selected.spec.genome!.genes.bodyFrame[layer]).not.toBe(before.genome!.genes.bodyFrame[layer])
    }
  })

  it('keeps the current rig when a manual body part supports it', () => {
    const catalog = makeRigSwitchCatalog()
    const body = catalog.parts.find(part => part.id === 'body_biped_manual')!
    catalog.parts.push({
      ...body,
      id: 'body_current_rig',
      compatibleRigs: ['floating', 'blob'],
    })
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_current_rig',
      locks: {},
      catalog,
    })

    expect(selected.spec.visualSlots.bodyFrame.rigId).toBe('blob')
  })

  it('uses stable catalog rig order when a manual body part supports multiple new rigs', () => {
    const catalog = makeRigSwitchCatalog()
    const body = catalog.parts.find(part => part.id === 'body_biped_manual')!
    catalog.parts.push({
      ...body,
      id: 'body_catalog_order',
      compatibleRigs: ['floating', 'biped'],
    })
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_catalog_order',
      locks: {},
      catalog,
    })

    expect(selected.spec.visualSlots.bodyFrame.rigId).toBe('biped')
  })

  it('manual cross-rig body selection preserves a compatible locked descendant', () => {
    const catalog = makeRigSwitchCatalog()
    const eyes = catalog.parts.find(part => part.id === 'eyes_asymmetric')!
    catalog.parts = catalog.parts.map(part => (
      part.id === eyes.id ? { ...part, compatibleRigs: ['blob', 'biped'] } : part
    ))
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_biped_manual',
      locks: { eyes: true },
      catalog,
    })

    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.eyes).toEqual({
      partId: before.visualSlots.eyes.partId,
      rigId: 'biped',
    })
  })

  it('keeps a manual cross-rig body replacement transactional when a lock is incompatible', () => {
    const catalog = makeRigSwitchCatalog()
    const before = generateMonster(baseRequest, catalog).spec

    const selected = selectVisualPart({
      spec: before,
      slotId: 'bodyFrame',
      partId: 'body_biped_manual',
      locks: { legs: true },
      catalog,
    })

    expect(selected.spec).toEqual(before)
    expect(selected.blocked).toBe(true)
    expect(selected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'legs'] }),
    )
  })

  it('manual color selection is bound to the current theme without hard-binding other slots', () => {
    const catalog = makeValidCatalogFixture()
    const color = catalog.parts.find(part => part.slotId === 'colorScheme')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push(
      { ...color, id: 'color_deep_sea_only', themeIds: ['deep-sea'] },
      { ...eyes, id: 'eyes_deep_sea_only', themeIds: ['deep-sea'] },
    )
    const before = generateMonster(baseRequest, catalog).spec
    const snapshot = structuredClone(before)

    const rejected = selectVisualPart({
      spec: before,
      slotId: 'colorScheme',
      partId: 'color_deep_sea_only',
      locks: {},
      catalog,
    })
    const crossThemeEyes = selectVisualPart({
      spec: before,
      slotId: 'eyes',
      partId: 'eyes_deep_sea_only',
      locks: {},
      catalog,
    })

    expect(rejected.blocked).toBe(true)
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'PART_INCOMPATIBLE', path: ['visualSlots', 'colorScheme'] }),
    )
    expect(rejected.spec).toEqual(snapshot)
    expect(before).toEqual(snapshot)
    expect(crossThemeEyes.blocked).toBe(false)
    expect(crossThemeEyes.spec.visualSlots.eyes.partId).toBe('eyes_deep_sea_only')
  })

  it('rerolls a slot without changing independent slots', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster(baseRequest, catalog).spec
    const after = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec
    expect(after.slotRolls.eyes).toBe(before.slotRolls.eyes + 1)
    expect(after.visualSlots.bodyFrame).toEqual(before.visualSlots.bodyFrame)
    expect(after.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('uses rerollIndex to change only the target slot stream and counter', () => {
    const catalog = makeValidCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...eyes, id: 'eyes_second' })
    const before = generateMonster(baseRequest, catalog).spec
    const direct = generateMonster({ ...baseRequest, slotRolls: { eyes: 1 } }, catalog).spec
    const rerolled = rerollSlot({ spec: before, slotId: 'eyes', locks: {}, catalog }).spec

    expect(before.visualSlots.eyes.partId).toBe('eyes_asymmetric')
    expect(direct.visualSlots.eyes.partId).toBe('eyes_second')
    expect(rerolled.visualSlots.eyes).toEqual(direct.visualSlots.eyes)
    expect(rerolled.slotRolls).toEqual({ ...before.slotRolls, eyes: 1 })
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId === 'eyes') continue
      expect(rerolled.visualSlots[slotId], slotId).toEqual(before.visualSlots[slotId])
      expect(rerolled.slotRolls[slotId], slotId).toBe(before.slotRolls[slotId])
    }
  })

  it('rerolls a parent stream without stale unlocked descendant constraints', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { arms: ['eyes'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const expanded: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, baseWeight: 0 },
        { ...arms, id: 'arms_rerolled', baseWeight: 999, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_descendant' },
      ],
    }
    const direct = generateMonster({ ...baseRequest, slotRolls: { arms: 1 } }, expanded).spec
    const rerolled = rerollSlot({ spec: before, slotId: 'arms', locks: {}, catalog: expanded }).spec
    expect(direct.visualSlots.arms.partId).toBe('arms_rerolled')
    expect(rerolled.visualSlots.arms).toEqual(direct.visualSlots.arms)
    expect(rerolled.visualSlots.eyes).toEqual(direct.visualSlots.eyes)
  })

  it('rerolls only unlocked descendants', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { bodyFrame: ['legs', 'tail'], legs: ['effect'] }
    const before = generateMonster(baseRequest, catalog).spec
    const result = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { tail: true }, catalog })
    expect(result.spec.slotRolls.bodyFrame).toBe(1)
    expect(result.spec.slotRolls.legs).toBe(0)
    expect(result.spec.visualSlots.tail).toEqual({
      partId: before.visualSlots.tail.partId,
      rigId: result.spec.visualSlots.bodyFrame.rigId,
    })
  })

  it('rebuilds all four complete layers for a body-frame reroll', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const before = generateMonster({ seed: 'body-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const bodies = catalog.parts.filter(part => part.slotId === 'bodyFrame')
    for (const body of bodies) body.baseWeight = 0
    catalog.parts.push({
      ...bodies[0]!,
      id: 'body_genome_rebuilt',
      baseWeight: 999,
      compatibleRigs: catalog.rigs.map(rig => rig.id),
    })
    const after = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { tail: true }, catalog })
    const slotRolls = { ...before.slotRolls, bodyFrame: before.slotRolls.bodyFrame + 1 }

    expect(after.affectedSlots).toEqual([...generationOrderForCatalog(catalog)])
    expect(after.revalidatedDiagnosticScopes).toEqual({
      visualSlots: [...generationOrderForCatalog(catalog)],
      fullGenome: true,
    })
    expect(after.spec.slotRolls.bodyFrame).toBe(before.slotRolls.bodyFrame + 1)
    expect(after.spec.genome!.genes.tail.P).toBe(before.genome!.genes.tail.P)
    for (const layer of GENOME_LAYERS) {
      const expected = generateVisualLayer({
        seed: genomeLayerSeed(before.seed, layer),
        themeId: before.themeId,
        slotRolls,
        ...(layer === 'P' ? { lockedSelections: { tail: before.visualSlots.tail.partId } } : {}),
      }, catalog).visualSlots
      for (const slotId of VISUAL_SLOT_IDS) {
        expect(after.spec.genome!.genes[slotId][layer], `${slotId}.${layer}`).toBe(expected[slotId].partId)
      }
    }
    for (const layer of ['H1', 'H2', 'H3'] as const) {
      expect(after.spec.genome!.genes.bodyFrame[layer]).toBe('body_genome_rebuilt')
      expect(VISUAL_SLOT_IDS.some(slotId => (
        after.spec.genome!.genes[slotId][layer] !== before.genome!.genes[slotId][layer]
      )), layer).toBe(true)
    }
    expect(validateMonsterGenome(after.spec, catalog)).toEqual([])
  })

  it('reports the target and every regenerated or revalidated descendant', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { bodyFrame: ['legs', 'tail'], legs: ['effect'] }
    const spec = generateMonster(baseRequest, catalog).spec

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: { tail: true }, catalog })

    expect(result.affectedSlots).toEqual([...generationOrderForCatalog(catalog)])
  })

  it('reports only the target slot when a reroll is blocked by its lock', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster(baseRequest, catalog).spec

    const result = rerollSlot({ spec, slotId: 'eyes', locks: { eyes: true }, catalog })

    expect(result.affectedSlots).toEqual(['eyes'])
  })

  it('checks locked descendants after unlocked descendants finish recomputing', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { bodyFrame: ['arms', 'eyes'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const changed: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_after_lock' },
      ],
    }
    const rerolled = rerollSlot({ spec: before, slotId: 'bodyFrame', locks: { arms: true }, catalog: changed })
    expect(rerolled.spec.visualSlots.arms).toEqual({
      partId: before.visualSlots.arms.partId,
      rigId: rerolled.spec.visualSlots.bodyFrame.rigId,
    })
    expect(rerolled.spec.visualSlots.eyes.partId).toBe('eyes_after_lock')
    expect(rerolled.blocked).toBe(false)
  })

  it('changes exactly the target and unlocked transitive descendants while preserving a locked descendant', () => {
    const baseCatalog = makeValidCatalogFixture()
    baseCatalog.dependencies = { arms: ['eyes'], eyes: ['mouthShape'], mouthShape: ['effect'] }
    const before = generateMonster(baseRequest, baseCatalog).spec
    const arms = baseCatalog.parts.find(part => part.slotId === 'arms')!
    const eyes = baseCatalog.parts.find(part => part.slotId === 'eyes')!
    const mouth = baseCatalog.parts.find(part => part.slotId === 'mouthShape')!
    const effect = baseCatalog.parts.find(part => part.slotId === 'effect')!
    const changed: Catalog = {
      ...baseCatalog,
      parts: [
        ...baseCatalog.parts.filter(part => part.id !== arms.id),
        { ...arms, baseWeight: 0 },
        { ...arms, id: 'arms_changed', baseWeight: 999, excludes: [eyes.id] },
        { ...eyes, id: 'eyes_changed', excludes: [mouth.id] },
        { ...mouth, id: 'mouth_changed', excludes: [effect.id] },
      ],
    }
    const after = rerollSlot({
      spec: before,
      slotId: 'arms',
      locks: { effect: true },
      catalog: changed,
    })
    const changedSlots = VISUAL_SLOT_IDS.filter(
      slotId => after.spec.visualSlots[slotId].partId !== before.visualSlots[slotId].partId,
    )

    expect(changedSlots).toEqual([])
    expect(after.spec.visualSlots).toEqual(before.visualSlots)
    expect(after.spec.visualSlots.effect).toEqual(before.visualSlots.effect)
    expect(after.spec.slotRolls).toEqual({ ...before.slotRolls, arms: 1 })
    expect(after.blocked).toBe(true)
    expect(after.diagnostics).toEqual([
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'effect'] }),
    ])
  })

  it('manual selection bypasses weights but rejects a hard-incompatible part', () => {
    const catalog = makeValidCatalogFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push({ ...tail, id: 'tail_manual', baseWeight: 0 })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_manual', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.tail.partId).toBe('tail_manual')

    const wrongRig = catalog.rigs.find(rig => rig.id !== before.visualSlots.bodyFrame.rigId)!
    catalog.parts.push({ ...tail, id: 'tail_wrong_rig', compatibleRigs: [wrongRig.id] })
    const rejected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_wrong_rig', locks: {}, catalog })
    expect(rejected.blocked).toBe(true)
    expect(rejected.spec.visualSlots.tail).toEqual(before.visualSlots.tail)
  })

  it('reports only the target slot when a manual selection is rejected', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster(baseRequest, catalog).spec

    const result = selectVisualPart({ spec, slotId: 'eyes', partId: 'missing_eyes', locks: {}, catalog })

    expect(result.affectedSlots).toEqual(['eyes'])
  })

  it('reports the target and descendants after a manual selection', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { headShape: ['eyes'] }
    const spec = generateMonster(baseRequest, catalog).spec

    const result = selectVisualPart({
      spec,
      slotId: 'headShape',
      partId: spec.visualSlots.headShape.partId,
      locks: {},
      catalog,
    })

    expect(result.affectedSlots).toEqual(['headShape', 'eyes'])
  })

  it('manual selection does not treat the replaced same-slot part as an active exclusion', () => {
    const catalog = makeValidCatalogFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push({ ...tail, id: 'tail_replacement', excludes: [tail.id] })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({ spec: before, slotId: 'tail', partId: 'tail_replacement', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.tail.partId).toBe('tail_replacement')
  })

  it('manual parent selection replaces an incompatible unlocked descendant', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push(
      { ...arms, id: 'arms_manual', baseWeight: 0, excludes: [eyes.id] },
      { ...eyes, id: 'eyes_compatible' },
    )
    const before = generateMonster(baseRequest, catalog).spec
    expect(before.visualSlots.eyes.partId).toBe(eyes.id)
    const selected = selectVisualPart({ spec: before, slotId: 'arms', partId: 'arms_manual', locks: {}, catalog })
    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.arms.partId).toBe('arms_manual')
    expect(selected.spec.visualSlots.eyes.partId).toBe('eyes_compatible')
  })

  it('synchronizes every affected P gene after manual parent selection', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    catalog.parts.push({ ...arms, id: 'arms_manual_gene', baseWeight: 0 })
    const before = generateMonster({ seed: 'manual-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const after = selectVisualPart({ spec: before, slotId: 'arms', partId: 'arms_manual_gene', locks: {}, catalog })

    for (const slotId of after.affectedSlots) {
      expect(after.spec.genome!.genes[slotId].P).toBe(after.spec.visualSlots[slotId].partId)
    }
    expect(after.revalidatedDiagnosticScopes).toEqual({
      visualSlots: after.affectedSlots,
      genomeGenes: { P: after.affectedSlots },
    })
    expect(after.spec.genome!.genes.arms.H1).toBe(before.genome!.genes.arms.H1)
  })

  it('rolls back an ordinary manual selection when the stored genome is invalid', () => {
    const catalog = makeValidCatalogFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail' && !part.id.endsWith('_none'))!
    catalog.parts.push({ ...tail, id: 'tail_manual_invalid_genome', baseWeight: 0 })
    const before = generateMonster({ seed: 'manual-invalid-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
    before.genome!.genes.eyes.H2 = 'missing_hidden_eyes'
    const snapshot = structuredClone(before)

    const selected = selectVisualPart({
      spec: before,
      slotId: 'tail',
      partId: 'tail_manual_invalid_genome',
      locks: {},
      catalog,
    })

    expect(selected.blocked).toBe(true)
    expect(selected.affectedSlots).toEqual([])
    expect(selected.revalidatedDiagnosticScopes).toEqual({})
    expect(selected.spec).toEqual(snapshot)
    expect(selected.spec).not.toBe(before)
    expect(selected.spec.genome).not.toBe(before.genome)
    expect(selected.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H2'],
    }))
  })

  it('rolls back phenotype and genome together when one hidden layer cannot materialize', () => {
    const catalog = makeValidCatalogFixture()
    const before = generateMonster({ seed: 'atomic-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec
    before.genome!.genes.eyes.H2 = 'missing_hidden_eyes'
    const result = rerollSlot({ spec: before, slotId: 'tail', locks: {}, catalog })

    expect(result.blocked).toBe(true)
    expect(result.revalidatedDiagnosticScopes).toEqual({})
    expect(result.spec.visualSlots).toEqual(before.visualSlots)
    expect(result.spec.genome).toEqual(before.genome)
    expect(result.spec.slotRolls.tail).toBe(before.slotRolls.tail + 1)
  })

  it('keeps manual parent selection transactional when a locked descendant is incompatible', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    catalog.parts.push({ ...arms, id: 'arms_manual', baseWeight: 0, excludes: [eyes.id] })
    const before = generateMonster(baseRequest, catalog).spec
    const selected = selectVisualPart({
      spec: before,
      slotId: 'arms',
      partId: 'arms_manual',
      locks: { eyes: true },
      catalog,
    })
    expect(selected.spec).toEqual(before)
    expect(selected.blocked).toBe(true)
    expect(selected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LOCK_INCOMPATIBLE', path: ['visualSlots', 'eyes'] }),
    )
  })

  it('keeps unrelated motif assignments and selections stable during a local reroll', () => {
    const catalog = makeStrongBudgetCatalog()
    const initial = generateMonster({ seed: 'local-budget', themeId: 'shadow', mode: 'normal' }, catalog).spec
    const locks = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [slotId, false])) as Record<typeof VISUAL_SLOT_IDS[number], boolean>
    const rerolled = rerollSlot({ spec: initial, slotId: 'eyes', locks, catalog }).spec
    const rigId = initial.visualSlots.bodyFrame.rigId

    expect(rerolled.visualSlots.tail).toEqual(initial.visualSlots.tail)
    expect(planComposition(initial.seed, initial.themeId, rigId, catalog))
      .toEqual(planComposition(rerolled.seed, rerolled.themeId, rigId, catalog))
    expect(strongFeatureCount(rerolled, catalog)).toBeLessThanOrEqual(2)
  })

  it('preserves a third manual strong selection and returns an intensity warning for a legacy phenotype', () => {
    const catalog = makeStrongBudgetCatalog()
    const initial = generateMonster(baseRequest, catalog).spec
    delete initial.genome
    const third = selectVisualPart({
      spec: initial,
      slotId: 'effect',
      partId: 'effect_forced_strong',
      locks: {},
      catalog,
    })

    expect(third.spec.visualSlots.effect.partId).toBe('effect_forced_strong')
    expect(third.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'COMPOSITION_INTENSITY_EXCEEDED',
    }))
  })
})
