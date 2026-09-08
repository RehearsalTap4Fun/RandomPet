import { describe, expect, it } from 'vitest'
import * as generatorCore from './index.js'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { makeV08SpeciesRigCatalogFixture } from './test-fixtures.js'

function validator(): (catalog: any) => Array<{ code: string; path: string[] }> {
  const candidate = (generatorCore as Record<string, unknown>).validateV08SpeciesRigCatalog
  expect(candidate).toBeTypeOf('function')
  return candidate as (catalog: any) => Array<{ code: string; path: string[] }>
}

describe('validateV08SpeciesRigCatalog', () => {
  it('accepts the complete canonical fixture', () => {
    expect(validator()(makeV08SpeciesRigCatalogFixture())).toEqual([])
  })

  it('rejects a trait whose master and owner differ from the locked policy', () => {
    const catalog = makeV08SpeciesRigCatalogFixture() as any
    const pattern = catalog.parts.find((part: any) => part.slotId === 'pattern')
    pattern.composition.sourceMasterSha256 = 'f'.repeat(64)
    pattern.composition.ownerRegionId = 'faceSafeZone'

    expect(validator()(catalog).map(item => item.code)).toEqual(expect.arrayContaining([
      'V08_PART_MASTER_MISMATCH',
      'V08_PART_OWNER_REGION_INVALID',
    ]))
  })

  it('requires exactly 8 N, 4 R, and 1 L traits in every pool', () => {
    const catalog = makeV08SpeciesRigCatalogFixture() as any
    catalog.anatomyBundles[0].partPools.tail.pop()

    expect(validator()(catalog)).toContainEqual(expect.objectContaining({
      code: 'V08_PART_POOL_RARITY_COUNT_INVALID',
      path: ['anatomyBundles', '0', 'partPools', 'tail'],
    }))
  })

  it('rejects rig policy drift and non-unit transforms', () => {
    const catalog = makeV08SpeciesRigCatalogFixture() as any
    catalog.speciesRigs[0].layerOrder = [...VISUAL_SLOT_IDS]
    catalog.speciesRigs[0].allowedSlotExpressions.eyes = 'body-clipped'
    catalog.parts.find((part: any) => part.slotId === 'eyes').approvedTransforms = [
      { scale: 0.9, mirrorX: false },
    ]

    expect(validator()(catalog).map(item => item.code)).toEqual(expect.arrayContaining([
      'V08_LAYER_ORDER_INVALID',
      'V08_ALLOWED_EXPRESSION_INVALID',
      'V08_PART_TRANSFORM_INVALID',
    ]))
  })

  it('rejects missing rig and bundle collections explicitly', () => {
    const catalog = makeV08SpeciesRigCatalogFixture() as any
    catalog.speciesRigs = []
    catalog.anatomyBundles = []

    expect(validator()(catalog).map(item => item.code)).toEqual(expect.arrayContaining([
      'V08_SPECIES_RIG_MISSING',
      'V08_ANATOMY_BUNDLE_MISSING',
    ]))
  })

  it('rejects duplicated pool candidates and resources outside v0.8', () => {
    const catalog = makeV08SpeciesRigCatalogFixture() as any
    const tailPool = catalog.anatomyBundles[0].partPools.tail
    tailPool[8] = tailPool[0]
    catalog.parts.find((part: any) => part.id === tailPool[0]).assetPath = 'assets/v0.7.0/tail.webp'

    expect(validator()(catalog).map(item => item.code)).toEqual(expect.arrayContaining([
      'V08_PART_POOL_DUPLICATE',
      'V08_PART_RESOURCE_INVALID',
      'V08_PART_POOL_RARITY_COUNT_INVALID',
    ]))
  })
})
