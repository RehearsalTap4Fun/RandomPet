import { describe, expect, it } from 'vitest'
import * as core from './index.js'
import { generateMonster } from './generate.js'
import { parseCatalog } from './catalog-schema.js'
import { STRUCTURAL_SLOT_IDS, type Catalog, type MonsterSpec } from './contracts.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'

function productionCatalog(): Catalog {
  const parsed = parseCatalog(v06ProductionCatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Expected the v0.6 production catalog to parse.')
  return parsed.value
}

function specForBundle(bundleId: string, mode: 'normal' | 'mutation' = 'normal'): [MonsterSpec, Catalog] {
  const catalog = productionCatalog()
  const bundle = catalog.anatomyBundles!.find(item => item.id === bundleId)!
  const generated = generateMonster({
    seed: `rarity-${bundleId}-${mode}`,
    themeId: 'shadow',
    mode,
    archetypeId: 'feline',
    lockedSelections: Object.fromEntries(STRUCTURAL_SLOT_IDS.map(slotId => [slotId, bundle.derivedSlots[slotId]])),
  }, catalog)
  expect(generated.blocked).toBe(false)
  return [generated.spec, catalog]
}

describe('collection rarity', () => {
  it('uses the selected legendary Bundle as the collection rarity', () => {
    const deriveCollectionRarity = (core as {
      deriveCollectionRarity?: (spec: MonsterSpec, catalog: Catalog) => string
    }).deriveCollectionRarity
    expect(deriveCollectionRarity).toBeTypeOf('function')
    if (deriveCollectionRarity === undefined) return
    const [spec, catalog] = specForBundle('feline-sit-violet-curl')

    expect(deriveCollectionRarity(spec, catalog)).toBe('L')
  })

  it('lets a rare mutation raise a normal Bundle collection rarity', () => {
    const deriveCollectionRarity = (core as {
      deriveCollectionRarity?: (spec: MonsterSpec, catalog: Catalog) => string
    }).deriveCollectionRarity
    expect(deriveCollectionRarity).toBeTypeOf('function')
    if (deriveCollectionRarity === undefined) return
    const [spec, catalog] = specForBundle('feline-sit-saffron-longtail', 'mutation')

    expect(deriveCollectionRarity(spec, catalog)).toBe('R')
  })
})
