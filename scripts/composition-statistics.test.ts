import { describe, expect, it } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import interfaceCatalogDocument from '../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import { measureCompositionDistribution } from './composition-statistics.js'

describe('composition distribution', () => {
  it('keeps optional-none density and composition budgets over 10,000 seeds', () => {
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const seeds = Array.from({ length: 10_000 }, (_, index) => `composition-${String(index).padStart(5, '0')}`)

    const result = measureCompositionDistribution(parsedCatalog.value, seeds)

    for (const noneRate of Object.values(result.optionalNoneRates)) {
      expect(noneRate).toBeGreaterThanOrEqual(0.35)
      expect(noneRate).toBeLessThanOrEqual(0.5)
    }
    expect(result.maximumStrongFeatures).toBeLessThanOrEqual(2)
    expect(result.maximumSurpriseSlots).toBeLessThanOrEqual(3)
  }, 60_000)

  it('keeps the complete v0.3 catalog inside unchanged budgets over 10,000 theme-cycled seeds', () => {
    const parsedCatalog = parseCatalog(interfaceCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const seeds = Array.from({ length: 10_000 }, (_, index) => `v03-composition-${String(index).padStart(5, '0')}`)

    const result = measureCompositionDistribution(parsedCatalog.value, seeds)

    for (const noneRate of Object.values(result.optionalNoneRates)) {
      expect(noneRate).toBeGreaterThanOrEqual(0.35)
      expect(noneRate).toBeLessThanOrEqual(0.5)
    }
    expect(result.maximumStrongFeatures).toBeLessThanOrEqual(2)
    expect(result.maximumSurpriseSlots).toBeLessThanOrEqual(
      Math.floor(parsedCatalog.value.compositionPolicy!.motifSlots.length * 0.3),
    )
  }, 60_000)
})
