import { describe, expect, it } from 'vitest'
import type { AnimalArchetypeDefinition, Catalog } from './contracts.js'
import { planSpecialFeature, resolveArchetype } from './archetype-plan.js'
import { makeValidCatalogFixture } from './test-fixtures.js'

const feline: AnimalArchetypeDefinition = {
  id: 'feline',
  displayName: '坐姿猫',
  rigIds: ['feline-sit'],
  defaultRigId: 'feline-sit',
  requiredVisibleSlots: ['bodyFrame', 'headShape', 'tail'],
  integratedSlots: ['arms', 'legs', 'extraAppendage'],
  specialFeatureSlots: ['headAppendage', 'surfaceMaterial', 'tail'],
}

function makeFelineCatalog(): Catalog {
  const catalog = makeValidCatalogFixture()
  catalog.version = '0.6.0'
  catalog.archetypes = [feline]
  for (const part of catalog.parts) part.archetypeIds = ['feline']
  const tail = catalog.parts.find(part => part.slotId === 'tail')!
  tail.featureTier = 'special'
  tail.specialFeatureAnchor = 'tailTip'
  return catalog
}

describe('archetype planning', () => {
  it('resolves only a requested v0.6 catalog archetype', () => {
    const catalog = makeFelineCatalog()

    expect(resolveArchetype({ archetypeId: 'feline' }, catalog)).toEqual(feline)
    expect(resolveArchetype({ archetypeId: 'canine' }, catalog)).toBeNull()
    expect(resolveArchetype({ archetypeId: 'feline' }, { ...catalog, version: '0.5.0' })).toBeNull()
  })

  it('keeps normal mode free of special features', () => {
    expect(planSpecialFeature('seed', 'fungal', 'normal', feline, makeFelineCatalog()))
      .toEqual({ slotId: null, anchor: null })
  })

  it('plans one deterministic eligible special feature for altered modes', () => {
    const catalog = makeFelineCatalog()

    expect(planSpecialFeature('seed', 'fungal', 'mutation', feline, catalog))
      .toEqual({ slotId: 'tail', anchor: 'tailTip' })
    expect(planSpecialFeature('seed', 'fungal', 'mutation', feline, catalog))
      .toEqual({ slotId: 'tail', anchor: 'tailTip' })
  })
})
