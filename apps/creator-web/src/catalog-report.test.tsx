import { describe, expect, it } from 'vitest'
import { parseCatalog, type Catalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import { createCatalogReportModel } from './catalog-report.js'

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) throw new Error('Expected the v0.6 production catalog to be valid.')

function reportFor(catalog: Catalog, archetypeId: string) {
  const report = createCatalogReportModel(catalog)
  const archetype = report.archetypes.find(item => item.id === archetypeId)
  if (archetype === undefined) throw new Error(`Expected ${archetypeId} report.`)
  return archetype
}

describe('createCatalogReportModel', () => {
  it('derives feline tier counts and keeps local parts separate from whole appearances', () => {
    const feline = reportFor(parsedCatalog.value, 'feline')

    expect(feline.bundleCounts).toEqual({ N: 5, R: 2, L: 1 })
    expect(feline.categoryRows.find(row => row.id === 'eyes')?.counts).toEqual({ N: 8, R: 0, L: 0 })
    expect(feline.categoryRows.find(row => row.id === 'mutation')?.counts).toEqual({ N: 0, R: 4, L: 0 })
    expect(feline.bundles.find(bundle => bundle.id === 'feline-sit-violet-curl')?.rarity).toBe('L')
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
