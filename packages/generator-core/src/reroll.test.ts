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
} from './index.js'
import {
  makeInterfaceCatalogFixture,
  makeValidCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidMonsterSpecFixture,
} from './test-fixtures.js'

describe('rerollSlot', () => {
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
