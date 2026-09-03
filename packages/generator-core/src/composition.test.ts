import { describe, expect, it } from 'vitest'
import {
  type Catalog,
  type MonsterSpec,
  type VisualPartDefinition,
  type VisualSlotId,
} from './contracts.js'
import {
  makeCompositionCatalogFixture,
  makeInterfaceCatalogFixture,
  makeLegacyCatalogFixture,
  makeValidCompositionSpecFixture,
} from './test-fixtures.js'
import {
  planComposition,
  rendererVersionForCatalog,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  validateCompositionSelections,
} from './composition.js'

export function makeCompositionCatalogFixtureWithStrongParts(): Catalog {
  const catalog = makeCompositionCatalogFixture()
  for (const slotId of ['headShape', 'eyes', 'effect'] as const) {
    const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
    const quietFungal: VisualPartDefinition = {
      ...structuredClone(source),
      id: `${slotId}_quiet_fungal`,
      composition: {
        ...structuredClone(source.composition!),
        motifTags: ['fungal'],
        visualIntensity: 'quiet',
      },
    }
    const strongForeign: VisualPartDefinition = {
      ...structuredClone(source),
      id: `${slotId}_triple_foreign`,
      composition: {
        ...structuredClone(source.composition!),
        motifTags: ['shadow'],
        visualIntensity: 'strong',
        renderNodes: source.composition!.renderNodes.map(node => ({
          ...node,
          id: `${slotId}_triple_foreign_${node.id}`,
        })),
      },
    }
    catalog.parts.push(quietFungal, strongForeign)
  }
  return catalog
}

export function selectStrongParts(
  spec: MonsterSpec,
  catalog: Catalog,
  slotIds: readonly VisualSlotId[],
): void {
  for (const slotId of slotIds) {
    const part = catalog.parts.find(candidate => (
      candidate.slotId === slotId && candidate.composition?.visualIntensity === 'strong'
    ))!
    spec.visualSlots[slotId] = { partId: part.id, rigId: 'blob' }
  }
}

describe('composition planning', () => {
  it('routes catalog 0.4.0 to renderer 0.4.0', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.version = '0.4.0'
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1

    expect(rendererVersionForCatalog(catalog)).toBe('0.4.0')
  })

  it('maps catalog versions to exact renderers without fallback', () => {
    expect(rendererVersionForCatalog(makeLegacyCatalogFixture())).toBe('0.1.0')
    expect(rendererVersionForCatalog(makeCompositionCatalogFixture())).toBe('0.2.0')
    expect(rendererVersionForCatalog(makeInterfaceCatalogFixture())).toBe('0.3.0')
  })

  it('routes catalog 0.5.0 to renderer 0.5.0 without falling back', () => {
    const catalog = makeLegacyCatalogFixture() as Catalog
    catalog.version = '0.5.0'

    expect(rendererVersionForCatalog(catalog)).toBe('0.5.0')
  })

  it('routes catalog 0.6.0 to renderer 0.6.0 without falling back', () => {
    const catalog = makeLegacyCatalogFixture() as Catalog
    catalog.version = '0.6.0'

    expect(rendererVersionForCatalog(catalog)).toBe('0.6.0')
  })

  it('assigns at most floor(M * 0.3) stable surprise opportunities', () => {
    const catalog = makeCompositionCatalogFixture()
    const first = planComposition('motif-seed', 'fungal', 'blob', catalog)
    const second = planComposition('motif-seed', 'fungal', 'blob', catalog)

    expect(second).toEqual(first)
    const surprise = Object.values(first.motifModes).filter(mode => mode === 'surprise')
    expect(surprise).toHaveLength(Math.floor(catalog.compositionPolicy!.motifSlots.length * 0.3))
  })

  it('reports three manual strong selections as a warning without changing them', () => {
    const catalog = makeCompositionCatalogFixtureWithStrongParts()
    const spec = makeValidCompositionSpecFixture(catalog)
    selectStrongParts(spec, catalog, ['headShape', 'eyes', 'effect'])

    const diagnostics = validateCompositionSelections(spec, catalog, planComposition(
      spec.seed, spec.themeId, spec.visualSlots.bodyFrame.rigId, catalog,
    ))

    expect(diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'COMPOSITION_INTENSITY_EXCEEDED',
    }))
    expect(spec.visualSlots.headShape.partId).toBe('headShape_triple_foreign')
    expect(spec.visualSlots.eyes.partId).toBe('eyes_strong')
    expect(spec.visualSlots.effect.partId).toBe('effect_triple_foreign')
  })

  it('reports exactly one warning for a manual spec over the non-facial strong-feature budget', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const spec = makeValidCompositionSpecFixture(catalog)
    for (const slotId of ['surfaceMaterial', 'pattern'] as const) {
      const source = catalog.parts.find(part => part.slotId === slotId)!
      const strong: VisualPartDefinition = {
        ...structuredClone(source),
        id: `${slotId}_manual_strong`,
        composition: { ...structuredClone(source.composition!), visualIntensity: 'strong' },
      }
      catalog.parts.push(strong)
      spec.visualSlots[slotId] = { partId: strong.id, rigId: 'blob' }
    }
    const plan = planComposition(spec.seed, spec.themeId, 'blob', catalog)
    const diagnostics = validateCompositionSelections(spec, catalog, plan)

    expect(strongNonFacialFeatureCount(spec, catalog)).toBe(2)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'COMPOSITION_NONFACIAL_INTENSITY_EXCEEDED',
        path: ['visualSlots'],
      }),
    )
  })

  it('does not spend strong-feature budget on an explicit none', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const none = catalog.parts.find(part => part.id === 'effect_none')!
    none.composition = { ...none.composition!, visualIntensity: 'strong' }
    spec.visualSlots.effect = { partId: none.id, rigId: 'blob' }

    expect(strongFeatureCount(spec, catalog)).toBe(0)
  })
})
