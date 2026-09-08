import { describe, expect, it } from 'vitest'
import { parseCatalog, type Catalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import v08CatalogDocument from '../../../packages/asset-catalog/catalog/v0.8.0/catalog.json'
import { createCatalogReportModel } from './catalog-report.js'

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected the v0.6 production catalog to be valid.')
const parsedV08Catalog = parseCatalog(v08CatalogDocument)
if (!parsedV08Catalog.ok) throw new Error('Expected the v0.8 production catalog to be valid.')

function reportFor(catalog: Catalog, archetypeId: string) {
  const report = createCatalogReportModel(catalog)
  const archetype = report.archetypes.find(item => item.id === archetypeId)
  if (archetype === undefined) throw new Error(`Expected ${archetypeId} report.`)
  return archetype
}

describe('createCatalogReportModel', () => {
  it('derives exact 8:4:1 counts for every v0.8 feline part slot', () => {
    const feline = reportFor(parsedV08Catalog.value, 'feline')

    expect(feline.bundleCounts).toEqual({ N: 1, R: 0, L: 0 })
    for (const row of feline.categoryRows.filter(row => !['wholeAppearance', 'mutation'].includes(row.id))) {
      expect(row.counts).toEqual({ N: 8, R: 4, L: 1 })
    }
    expect(feline.bundles[0]?.localTraits.find(group => group.slotId === 'eyes')?.parts[12]).toMatchObject({
      id: 'eyes_l_nebula-iris', rarity: 'L', ownerRegionId: 'eyesRegion', expressionKind: 'face-clipped',
    })
  })

  it('separates a later archetype from the feline report', () => {
    const catalog = structuredClone(parsedCatalog.value)
    const felineBundle = catalog.anatomyBundles?.[0]
    if (felineBundle === undefined) throw new Error('Expected a feline bundle fixture.')
    catalog.anatomyBundles?.push({
      ...felineBundle,
      id: 'canine-sit-test',
      archetypeId: 'canine',
    })

    const report = createCatalogReportModel(catalog)

    expect(report.defaultArchetypeId).toBe('feline')
    expect(report.archetypes.find(item => item.id === 'feline')?.bundleCounts).toEqual({ N: 5, R: 2, L: 1 })
    expect(report.archetypes.find(item => item.id === 'canine')?.bundleCounts).toEqual({ N: 1, R: 0, L: 0 })
  })

  it('uses the stable bundle identifier when a bundle has no display name', () => {
    const catalog = structuredClone(parsedCatalog.value)
    const bundle = catalog.anatomyBundles?.[0]
    if (bundle === undefined) throw new Error('Expected a bundle fixture.')
    bundle.id = 'bundle_without_name'

    expect(reportFor(catalog, 'feline').bundles[0]?.label).toBe('bundle_without_name')
  })
})
