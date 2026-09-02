import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  parseCatalog,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  validateMonsterSpecAgainstCatalog,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import interfaceCatalogDocument from '../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import v04ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.4.0/catalog.json'
import problemSeeds from '../tests/fixtures/v04-problem-seeds.json'
import {
  buildCompositionStatisticsEvidence,
  measureCompositionDistribution,
  parseCompositionStatisticsArguments,
} from './composition-statistics.js'

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

  it('reports each supplied generation mode and both strong-feature maxima', () => {
    const parsedCatalog = parseCatalog(v04ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const result = measureCompositionDistribution(
      parsedCatalog.value,
      ['v04-0001', 'v04-0002', 'v04-0003'],
      ['normal', 'mutation', 'aberration'],
    )

    expect(result.maximumStrongFeatures).toBeLessThanOrEqual(2)
    expect(result.maximumStrongNonFacialFeatures).toBeLessThanOrEqual(1)
    expect(result.generationErrorCount).toBe(0)
    expect(Object.keys(result.byMode)).toEqual(['normal', 'mutation', 'aberration'])
    expect(result.byMode).toEqual({
      normal: expect.objectContaining({
        maximumStrongFeatures: expect.any(Number),
        maximumStrongNonFacialFeatures: expect.any(Number),
        generationErrorCount: 0,
      }),
      mutation: expect.objectContaining({
        maximumStrongFeatures: expect.any(Number),
        maximumStrongNonFacialFeatures: expect.any(Number),
        generationErrorCount: 0,
      }),
      aberration: expect.objectContaining({
        maximumStrongFeatures: expect.any(Number),
        maximumStrongNonFacialFeatures: expect.any(Number),
        generationErrorCount: 0,
      }),
    })
  })

  it('keeps the twelve observed v0.4 inputs deterministic, valid, and inside both budgets', () => {
    const parsedCatalog = parseCatalog(v04ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const themes = ['deep-sea', 'fungal', 'shadow'] as const

    const firstPass = problemSeeds.seeds.map((seed, index) => generateMonster({
      seed,
      themeId: themes[index % themes.length]!,
      mode: 'normal',
    }, parsedCatalog.value))
    const secondPass = problemSeeds.seeds.map((seed, index) => generateMonster({
      seed,
      themeId: themes[index % themes.length]!,
      mode: 'normal',
    }, parsedCatalog.value))

    expect(problemSeeds.sourceBatch).toBe('random-genome-20260901-a')
    expect(problemSeeds.seeds).toHaveLength(12)
    expect(firstPass).toEqual(secondPass)
    for (const generated of firstPass) {
      expect(generated.blocked).toBe(false)
      expect(generated.spec.catalogVersion).toBe('0.4.0')
      expect(generated.spec.rendererVersion).toBe('0.4.0')
      expect(validateMonsterSpecAgainstCatalog(generated.spec, parsedCatalog.value)
        .filter(item => item.severity === 'error')).toEqual([])
      expect(strongFeatureCount(generated.spec, parsedCatalog.value)).toBeLessThanOrEqual(2)
      expect(strongNonFacialFeatureCount(generated.spec, parsedCatalog.value)).toBeLessThanOrEqual(1)
    }
  })

  it('parses the exact production statistics command and rejects duplicate modes', () => {
    expect(parseCompositionStatisticsArguments([
      '--version', '0.4.0',
      '--seeds', '10000',
      '--modes', 'normal,mutation,aberration',
    ])).toEqual({
      version: '0.4.0',
      seedCount: 10_000,
      modes: ['normal', 'mutation', 'aberration'],
    })
    expect(parseCompositionStatisticsArguments([
      '--version', '0.4.0',
      '--seeds', '10000',
      '--modes', 'normal mutation aberration',
    ])).toEqual({
      version: '0.4.0',
      seedCount: 10_000,
      modes: ['normal', 'mutation', 'aberration'],
    })
    expect(() => parseCompositionStatisticsArguments([
      '--version', '0.4.0',
      '--seeds', '10000',
      '--modes', 'normal,normal',
    ])).toThrow('distinct')
  })

  it('builds deterministic audit evidence from an explicit mode cross product', () => {
    const parsedCatalog = parseCatalog(v04ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const evidence = buildCompositionStatisticsEvidence(
      parsedCatalog.value,
      3,
      ['normal', 'mutation', 'aberration'],
    )

    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: 'qmonster-v0.4-composition-statistics-v1',
      catalogVersion: '0.4.0',
      seedCountPerMode: 3,
      totalSampleCount: 9,
      modes: ['normal', 'mutation', 'aberration'],
      maximumStrongFeaturesLimit: 2,
      maximumStrongNonFacialFeaturesLimit: 1,
      generationErrorCount: 0,
    }))
    expect(Object.keys(evidence.byMode)).toEqual(['normal', 'mutation', 'aberration'])
    expect(evidence).toEqual(buildCompositionStatisticsEvidence(
      parsedCatalog.value,
      3,
      ['normal', 'mutation', 'aberration'],
    ))
  })
})
