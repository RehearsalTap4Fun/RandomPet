import { describe, expect, it } from 'vitest'
import {
  GENOME_LAYERS,
  generateMonster,
  generateVisualLayer,
  genomeLayerSeed,
  rerollSlot,
  selectVisualPart,
  strongNonFacialFeatureCount,
  VISUAL_SLOT_IDS,
  parseCatalog,
} from './index.js'
import {
  makeV07FelinePartLibraryFixture,
  makeInterfaceCatalogFixture,
  makeValidCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidMonsterSpecFixture,
} from './test-fixtures.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'

function makeTwoBundleV07Fixture() {
  const catalog = makeV07FelinePartLibraryFixture()
  const [firstBundle] = catalog.anatomyBundles
  if (firstBundle === undefined) throw new Error('Expected v0.7 feline bundle')
  const displacedEye = catalog.parts.find(part => part.id === firstBundle.partPools.eyes[0])
  if (displacedEye === undefined) throw new Error('Expected v0.7 eye part')
  const lockedEye = { ...structuredClone(displacedEye), id: 'eyes_n_second_bundle' }
  catalog.parts.push(lockedEye)
  const secondBundle = {
    ...structuredClone(firstBundle),
    id: 'feline-sit-alternate',
    baseWeight: 1,
    partPools: {
      ...structuredClone(firstBundle.partPools),
      eyes: [
        ...firstBundle.partPools.eyes.filter(partId => partId !== displacedEye.id),
        lockedEye.id,
      ],
    },
  }
  firstBundle.baseWeight = 1_000_000
  catalog.anatomyBundles.push(secondBundle)
  return { catalog, firstBundle, secondBundle, lockedEyeId: lockedEye.id }
}

describe('rerollSlot', () => {
  it('rerolls a public v0.7 bodyFrame spec without a genome through the preserved bundle pool', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const initial = generateMonster({
      seed: 'nog-0', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog).spec
    delete initial.genome
    const before = structuredClone(initial)
    const bundle = catalog.anatomyBundles.find(item => item.id === initial.anatomyBundleId)!

    const rerolled = rerollSlot({ spec: initial, slotId: 'bodyFrame', locks: {}, catalog })

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.genome).toBeUndefined()
    expect(rerolled.spec.anatomyBundleId).toBe(before.anatomyBundleId)
    expect(bundle.partPools.bodyFrame).toContain(rerolled.spec.visualSlots.bodyFrame.partId)
    expect(rerolled.spec.visualSlots.bodyFrame.partId).not.toBe(before.visualSlots.bodyFrame.partId)
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId !== 'bodyFrame') expect(rerolled.spec.visualSlots[slotId]).toEqual(before.visualSlots[slotId])
    }
  })

  it('rolls back a public v0.7 bodyFrame spec without a genome on a candidate failure', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const initial = generateMonster({
      seed: 'nog-0', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog).spec
    delete initial.genome
    const before = structuredClone(initial)
    const bundle = catalog.anatomyBundles.find(item => item.id === initial.anatomyBundleId)!
    for (const partId of bundle.partPools.bodyFrame) {
      catalog.parts.find(part => part.id === partId)!.compatibleRigs = []
    }

    const rerolled = rerollSlot({ spec: initial, slotId: 'bodyFrame', locks: {}, catalog })

    expect(rerolled.blocked).toBe(true)
    expect(rerolled.spec).toEqual({
      ...before,
      slotRolls: { ...before.slotRolls, bodyFrame: before.slotRolls.bodyFrame + 1 },
    })
    expect(rerolled.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_CANDIDATE', path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('keeps the v0.7 bundle and every non-body slot during a bodyFrame reroll with a local lock', () => {
    const { catalog, secondBundle, lockedEyeId } = makeTwoBundleV07Fixture()
    const initial = generateMonster({
      seed: 'v07-body-reroll',
      themeId: 'fungal',
      mode: 'normal',
      archetypeId: 'feline',
      lockedSelections: { eyes: lockedEyeId },
    }, catalog).spec
    const before = structuredClone(initial)

    const rerolled = rerollSlot({ spec: initial, slotId: 'bodyFrame', locks: { eyes: true }, catalog })

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.anatomyBundleId).toBe(secondBundle.id)
    expect(rerolled.spec.slotRolls.bodyFrame).toBe(before.slotRolls.bodyFrame + 1)
    expect(rerolled.spec.visualSlots.eyes.partId).toBe(lockedEyeId)
    expect(secondBundle.partPools.bodyFrame).toContain(rerolled.spec.visualSlots.bodyFrame.partId)
    expect(rerolled.spec.visualSlots.bodyFrame.partId).not.toBe(before.visualSlots.bodyFrame.partId)
    for (const slotId of VISUAL_SLOT_IDS) {
      if (slotId !== 'bodyFrame') expect(rerolled.spec.visualSlots[slotId]).toEqual(before.visualSlots[slotId])
    }
    expect(rerolled.spec.genome!.genes.bodyFrame.P).toBe(rerolled.spec.visualSlots.bodyFrame.partId)
  })

  it('rolls back a v0.7 bodyFrame reroll when the current bundle has no compatible body candidate', () => {
    const { catalog, lockedEyeId } = makeTwoBundleV07Fixture()
    const initial = generateMonster({
      seed: 'v07-body-reroll-rollback',
      themeId: 'fungal',
      mode: 'normal',
      archetypeId: 'feline',
      lockedSelections: { eyes: lockedEyeId },
    }, catalog).spec
    const selectedBundle = catalog.anatomyBundles.find(bundle => bundle.id === initial.anatomyBundleId)!
    for (const partId of selectedBundle.partPools.bodyFrame) {
      catalog.parts.find(part => part.id === partId)!.compatibleRigs = []
    }

    const rerolled = rerollSlot({ spec: initial, slotId: 'bodyFrame', locks: { eyes: true }, catalog })

    expect(rerolled.blocked).toBe(true)
    expect(rerolled.spec).toEqual({
      ...initial,
      slotRolls: { ...initial.slotRolls, bodyFrame: initial.slotRolls.bodyFrame + 1 },
    })
    expect(rerolled.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_CANDIDATE', path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('permits v0.7 structural rerolls and selections from the selected bundle pool', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const initial = generateMonster({
      seed: 'v07-reroll', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog).spec
    const bundle = catalog.anatomyBundles[0]!
    const selected = selectVisualPart({
      spec: initial,
      slotId: 'tail',
      partId: bundle.partPools.tail[1]!,
      locks: {},
      catalog,
    })
    const rerolled = rerollSlot({ spec: selected.spec, slotId: 'tail', locks: {}, catalog })

    expect(selected.blocked).toBe(false)
    expect(selected.spec.visualSlots.tail.partId).toBe(bundle.partPools.tail[1])
    expect(rerolled.blocked).toBe(false)
    expect(bundle.partPools.tail).toContain(rerolled.spec.visualSlots.tail.partId)
    expect(rerolled.spec.genome!.genes.tail.P).toBe(rerolled.spec.visualSlots.tail.partId)
  })

  it('keeps v0.6 local rerolls inside the selected anatomy bundle pool', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = parsed.value
    const initial = generateMonster({ seed: 'feline-special-reroll', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline' }, catalog).spec
    const rerolled = rerollSlot({ spec: initial, slotId: 'eyes', locks: {}, catalog })

    expect(rerolled.blocked).toBe(false)
    const bundle = catalog.anatomyBundles!.find(item => item.id === initial.anatomyBundleId)!
    expect(bundle.allowedTraitPools.eyes).toContain(rerolled.spec.visualSlots.eyes.partId)
    expect(rerolled.spec.genome!.genes.eyes.P).toBe(rerolled.spec.visualSlots.eyes.partId)
  })

  it('rejects direct v0.6 structural-slot changes and preserves the current spec', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spec = generateMonster({ seed: 'feline-reroll', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline' }, parsed.value).spec
    const rerolled = rerollSlot({ spec, slotId: 'tail', locks: {}, catalog: parsed.value })
    const selected = selectVisualPart({ spec, slotId: 'tail', partId: spec.visualSlots.tail.partId, locks: {}, catalog: parsed.value })

    expect(rerolled.blocked).toBe(true)
    expect(rerolled.diagnostics).toContainEqual(expect.objectContaining({ code: 'ANATOMY_BUNDLE_SLOT_IMMUTABLE' }))
    expect(rerolled.spec).toEqual(spec)
    expect(selected.blocked).toBe(true)
    expect(selected.diagnostics).toContainEqual(expect.objectContaining({ code: 'ANATOMY_BUNDLE_SLOT_IMMUTABLE' }))
  })

  it('keeps a non-facial reroll within the remaining strong-feature budget', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const surface = catalog.parts.find(part => part.slotId === 'surfaceMaterial')!
    const pattern = catalog.parts.find(part => part.slotId === 'pattern')!
    const surfaceStrong = {
      ...structuredClone(surface),
      id: 'surface_reroll_strong',
      composition: { ...structuredClone(surface.composition!), visualIntensity: 'strong' as const },
    }
    const patternStrong = {
      ...structuredClone(pattern),
      id: 'pattern_reroll_strong',
      baseWeight: 1_000_000_000,
      composition: { ...structuredClone(pattern.composition!), visualIntensity: 'strong' as const },
    }
    catalog.parts.push(surfaceStrong, patternStrong)
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = catalog.version
    spec.rendererVersion = '0.3.0'
    spec.visualSlots.surfaceMaterial = { partId: surfaceStrong.id, rigId: 'blob' }

    const result = rerollSlot({ spec, slotId: 'pattern', locks: {}, catalog })

    expect(result.spec.visualSlots.pattern.partId).not.toBe(patternStrong.id)
    expect(strongNonFacialFeatureCount(result.spec, catalog)).toBeLessThanOrEqual(1)
  })

  it('rerolls the same dependency closure in all four genome layers', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'], eyes: ['mouthShape'] }
    const before = generateMonster({ seed: 'genome-closure', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const oldEyes = [...new Set(GENOME_LAYERS.map(layer => before.genome!.genes.eyes[layer]))]
    const oldMouths = [...new Set(GENOME_LAYERS.map(layer => before.genome!.genes.mouthShape[layer]))]
    for (const slotId of ['arms', 'eyes', 'mouthShape'] as const) {
      const source = catalog.parts.find(part => part.slotId === slotId)!
      for (const part of catalog.parts.filter(candidate => candidate.slotId === slotId)) part.baseWeight = 0
      const excluded = slotId === 'arms' ? oldEyes : slotId === 'eyes' ? oldMouths : []
      catalog.parts.push(...Array.from({ length: 8 }, (_, index) => ({
        ...source,
        id: `${slotId}_genome_variant_${index}`,
        baseWeight: 1,
        excludes: [...new Set([...source.excludes, ...excluded])],
      })))
    }
    const result = rerollSlot({ spec: before, slotId: 'arms', locks: {}, catalog })
    const slotRolls = { ...before.slotRolls, arms: before.slotRolls.arms + 1 }
    const expectedLayers = Object.fromEntries(GENOME_LAYERS.map(layer => [
      layer,
      generateVisualLayer({
        seed: genomeLayerSeed(before.seed, layer),
        themeId: before.themeId,
        slotRolls,
      }, catalog).visualSlots,
    ])) as Record<typeof GENOME_LAYERS[number], ReturnType<typeof generateVisualLayer>['visualSlots']>

    expect(result.affectedSlots).toEqual(['arms', 'eyes', 'mouthShape'])
    expect(result.revalidatedDiagnosticScopes).toEqual({
      visualSlots: result.affectedSlots,
      genomeGenes: Object.fromEntries(GENOME_LAYERS.map(layer => [layer, result.affectedSlots])),
    })
    const affected = new Set(result.affectedSlots)
    for (const slotId of VISUAL_SLOT_IDS) {
      for (const layer of GENOME_LAYERS) {
        if (affected.has(slotId)) {
          expect(expectedLayers[layer][slotId].partId, `precondition ${slotId}.${layer}`).not.toBe(
            before.genome!.genes[slotId][layer],
          )
          expect(result.spec.genome!.genes[slotId][layer], `${slotId}.${layer}`).toBe(
            expectedLayers[layer][slotId].partId,
          )
        }
      }
      if (!affected.has(slotId)) {
        expect(result.spec.genome!.genes[slotId]).toEqual(before.genome!.genes[slotId])
      }
    }
    const layerSignatures = GENOME_LAYERS.map(layer => result.affectedSlots
      .map(slotId => expectedLayers[layer][slotId].partId)
      .join('|'))
    expect(new Set(layerSignatures).size).toBe(GENOME_LAYERS.length)
  })

  it('applies locks to P but not hidden dependency descendants', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { arms: ['eyes'] }
    const before = generateMonster({ seed: 'genome-locks', themeId: 'fungal', mode: 'normal' }, catalog).spec
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    eyes.baseWeight = 0
    catalog.parts.push({ ...eyes, id: 'eyes_hidden_rerolled', baseWeight: 999 })
    const result = rerollSlot({ spec: before, slotId: 'arms', locks: { eyes: true }, catalog })

    expect(result.spec.genome!.genes.eyes.P).toBe(before.genome!.genes.eyes.P)
    expect(result.spec.visualSlots.eyes).toEqual(before.visualSlots.eyes)
    for (const layer of ['H1', 'H2', 'H3'] as const) {
      expect(result.spec.genome!.genes.eyes[layer]).toBe('eyes_hidden_rerolled')
    }
  })

  it('does not synthesize a genome while editing a legacy spec', () => {
    const catalog = makeValidCatalogFixture()
    const legacy = makeValidMonsterSpecFixture()

    expect(rerollSlot({ spec: legacy, slotId: 'eyes', locks: {}, catalog }).spec.genome).toBeUndefined()
    expect(selectVisualPart({
      spec: legacy,
      slotId: 'eyes',
      partId: legacy.visualSlots.eyes.partId,
      locks: {},
      catalog,
    }).spec.genome).toBeUndefined()
  })

  it('preserves non-origin structural descendants for a v0.3 body reroll', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.dependencies = { bodyFrame: ['headShape', 'arms'] }
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    catalog.parts.push(
      { ...structuredClone(head), id: 'head_would_regenerate', baseWeight: 999 },
      { ...structuredClone(arms), id: 'arms_would_regenerate', baseWeight: 999 },
    )
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(result.spec.visualSlots.headShape).toEqual(spec.visualSlots.headShape)
    expect(result.spec.visualSlots.arms).toEqual(spec.visualSlots.arms)
  })

  it('preserves a structural child when a non-structural dependency ancestor rerolls in v0.3', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.dependencies = { eyes: ['arms'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    catalog.parts.push({ ...structuredClone(arms), id: 'arms_would_regenerate_from_eyes', baseWeight: 999 })
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'eyes', locks: {}, catalog })

    expect(result.spec.visualSlots.arms).toEqual(spec.visualSlots.arms)
  })

  it('keeps previous selections while advancing the retry stream when no body candidate is compatible', () => {
    const catalog = makeInterfaceCatalogFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(result.blocked).toBe(true)
    expect(result.spec).toEqual({
      ...spec,
      slotRolls: { ...spec.slotRolls, bodyFrame: 1 },
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_CANDIDATE', path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('advances the body reroll stream after a cross-rig candidate fails against retained children', () => {
    const catalog = makeInterfaceCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'
    spec.seed = 'cross-rig-1'

    const failed = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })
    const recovered = rerollSlot({ spec: failed.spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(failed.blocked).toBe(true)
    expect(failed.spec.visualSlots).toEqual(spec.visualSlots)
    expect(failed.spec.slotRolls.bodyFrame).toBe(1)
    expect(recovered.blocked).toBe(false)
    expect(recovered.spec.slotRolls.bodyFrame).toBe(2)
  })

  it('preserves structural children while excluding an incompatible body reroll candidate', () => {
    const catalog = makeInterfaceCatalogFixture()
    const originalBody = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    if (originalBody.composition?.mode !== 'interface') throw new Error('Expected interface body')
    catalog.parts.push({
      ...structuredClone(originalBody),
      id: 'body_warped',
      baseWeight: 999,
      composition: {
        ...structuredClone(originalBody.composition),
        variantsByRig: {
          ...structuredClone(originalBody.composition.variantsByRig),
          blob: {
            ...structuredClone(originalBody.composition.variantsByRig.blob!),
            connectors: originalBody.composition.variantsByRig.blob!.connectors.map(connector => (
              connector.id === 'neck' ? { ...connector, width: 300 } : connector
            )),
          },
        },
      },
    })
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const rerolled = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.visualSlots.bodyFrame.partId).toBe('body_blob')
    expect(rerolled.spec.visualSlots.headShape).toEqual(spec.visualSlots.headShape)
  })
})
