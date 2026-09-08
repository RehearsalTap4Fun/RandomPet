import { describe, expect, it } from 'vitest'
import { V08_REGION_IDS, VISUAL_SLOT_IDS, parseCatalog, type ResourceRef } from '@qmonster/generator-core'
import {
  buildCompleteV08Inventory,
  buildV08CatalogDocument,
  validateV08SourceInventory,
} from './assemble-v08-catalog.js'

const hash = 'a'.repeat(64)
const resource = (name: string): ResourceRef => ({
  assetPath: `assets/v0.8.0/${name}.webp`,
  assetSha256: hash,
  pngPath: `assets/v0.8.0/${name}.png`,
  pngSha256: hash,
})

function runtimeResources() {
  return {
    sourceMasterSha256: hash,
    structure: resource('rigs/feline-sit-v1/structure'),
    regions: Object.fromEntries(V08_REGION_IDS.map(regionId => [
      regionId, resource(`rigs/feline-sit-v1/masks/${regionId}`),
    ])) as Record<typeof V08_REGION_IDS[number], ResourceRef>,
    traits: Object.fromEntries(buildCompleteV08Inventory(hash).traits.map(trait => [
      trait.id, resource(`traits/${trait.slotId}/${trait.id}`),
    ])),
  }
}

describe('assemble v0.8 catalog', () => {
  it('requires exactly 8 N, 4 R, and 1 L source record per visual slot', () => {
    const inventory = buildCompleteV08Inventory(hash)
    inventory.traits = inventory.traits.filter(item => item.id !== 'eyes_l_nebula-iris')

    expect(validateV08SourceInventory(inventory)).toContain('V08_SOURCE_INVENTORY_INVALID:eyes:L')
  })

  it('builds all 182 traits as species-rig expressions and emits no bridges', () => {
    const inventory = buildCompleteV08Inventory(hash)
    const catalog = buildV08CatalogDocument(inventory, runtimeResources())

    expect(catalog.parts).toHaveLength(182)
    expect(catalog.parts.every(part => part.composition?.mode === 'species-rig')).toBe(true)
    expect(catalog.transitionBridges).toBeUndefined()
    expect(Object.keys(catalog.anatomyBundles![0]!.partPools!)).toEqual(VISUAL_SLOT_IDS)
    expect(parseCatalog(catalog)).toMatchObject({ ok: true })
  })

  it('keeps inventory generation deterministic and bound to one master', () => {
    const first = buildCompleteV08Inventory(hash)
    const second = buildCompleteV08Inventory(hash)

    expect(first).toEqual(second)
    expect(new Set(first.traits.map(item => item.sourceMasterSha256))).toEqual(new Set([hash]))
    expect(new Set(first.traits.map(item => item.speciesRigId))).toEqual(new Set(['feline-sit-v1']))
  })
})
