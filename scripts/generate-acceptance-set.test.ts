import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { parseCatalog } from '@qmonster/generator-core'
import type { CompositionMetrics } from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import v03ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.3.0/catalog.json'

function makeValidRenderedAcceptanceEntry() {
  const compositionMetrics: CompositionMetrics = {
    eyesInsideRatio: 1,
    eyesVisibleRatio: 1,
    mouthInsideRatio: 1,
    mouthVisibleRatio: 1,
    visibleBounds: { x: 100, y: 100, width: 800, height: 800 },
  }
  return {
    catalogVersion: '0.3.0' as const,
    strongFeatureCount: 2,
    surpriseSlots: 3,
    motifOpportunityCount: 12,
    compositionMetrics,
    renderDiagnostics: [],
    connectorMetrics: [{
      connectorId: 'neck',
      receiverCoverage: 0.9,
      plugCoverage: 0.9,
      largestComponentRatio: 0.99,
      centerlineGapPixels: 2,
      childOutsideBodyRatio: null,
    }],
    resolvedAssetPaths: ['assets/v0.3.0/structural/biped/nodes/body.webp'],
  }
}

describe('acceptance manifest', () => {
  it('uses exact v0.3 by default and accepts the release --version spelling', async () => {
    const module = await import('./generate-acceptance-set.js')
    expect(module.parseAcceptanceArguments([])).toEqual({
      seedStart: 2026082101,
      count: 20,
      catalogVersion: '0.3.0',
    })
    expect(module.parseAcceptanceArguments(['--version', '0.3.0'])).toEqual({
      seedStart: 2026082101,
      count: 20,
      catalogVersion: '0.3.0',
    })
    expect(module.parseAcceptanceArguments(['--catalog-version', '0.2.0'])).toEqual({
      seedStart: 2026082101,
      count: 20,
      catalogVersion: '0.2.0',
    })
  })

  it('accepts an explicit staging directory below artifacts/acceptance without changing the default', async () => {
    const module = await import('./generate-acceptance-set.js')
    const requested = 'artifacts/acceptance/v0.3-phaseb-candidate'

    expect(module.parseAcceptanceArguments(['--output-directory', requested])).toEqual({
      seedStart: 2026082101,
      count: 20,
      catalogVersion: '0.3.0',
      outputDirectory: requested,
    })
    expect(module.resolveAcceptanceOutputDirectory(process.cwd(), '0.3.0', requested)).toEqual({
      relativePath: requested,
      absolutePath: resolve(process.cwd(), requested),
    })
    expect(module.resolveAcceptanceOutputDirectory(process.cwd(), '0.3.0')).toEqual({
      relativePath: 'artifacts/acceptance/v0.3',
      absolutePath: resolve(process.cwd(), 'artifacts/acceptance/v0.3'),
    })
  })

  it.each([
    resolve(process.cwd(), 'outside-acceptance'),
    '../outside-acceptance',
    'artifacts/acceptance/../outside-acceptance',
    'artifacts/review/v0.3-phaseb-candidate',
    'artifacts/acceptance',
  ])('rejects an unsafe acceptance output directory: %s', async requested => {
    const module = await import('./generate-acceptance-set.js')

    expect(() => module.resolveAcceptanceOutputDirectory(
      process.cwd(), '0.3.0', requested,
    )).toThrow('artifacts/acceptance')
  })

  it('contains the fixed 20 creatures plus the first-hatch regression', async () => {
    const { buildAcceptanceManifest } = await import('./generate-acceptance-set.js')
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const productionCatalog = parsedCatalog.value
    const themes = ['deep-sea', 'fungal', 'shadow'] as const
    const entries = await buildAcceptanceManifest(productionCatalog)
    expect(entries).toHaveLength(21)
    expect(entries.slice(0, 20).map(item => item.seed)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(2026082101 + index)),
    )
    expect(entries.slice(0, 20).map(item => item.themeId)).toEqual(
      Array.from({ length: 20 }, (_, index) => themes[index % themes.length]),
    )
    expect(entries[20]).toEqual(expect.objectContaining({
      seed: 'qmonster-v0.1-first-hatch',
      themeId: 'fungal',
      regression: true,
    }))
    expect(new Set(entries.map(item => item.rigId))).toEqual(new Set(['blob', 'biped', 'floating']))
  })

  it('builds fixed twenty seeds plus first-hatch through explicit v0.3', async () => {
    const { buildAcceptanceManifest } = await import('./generate-acceptance-set.js')
    const parsedCatalog = parseCatalog(v03ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const entries = await buildAcceptanceManifest(parsedCatalog.value)

    expect(entries).toHaveLength(21)
    expect(entries.every(item => item.catalogVersion === '0.3.0')).toBe(true)
    expect(entries.every(item => item.spec.catalogVersion === '0.3.0')).toBe(true)
    expect(entries.every(item => item.spec.rendererVersion === '0.3.0')).toBe(true)
    const expandedCompatibility = entries.find(item => item.seed === '2026082118')!
    expect(expandedCompatibility.spec.visualSlots.bodyFrame.partId).toBe('body_biped_tall')
    expect(expandedCompatibility.spec.visualSlots.headShape.partId).toBe('head_round_dome')
    const selectedHead = parsedCatalog.value.parts.find(part => (
      part.id === expandedCompatibility.spec.visualSlots.headShape.partId
    ))!
    expect(selectedHead.composition?.motifTags).toContain('shadow')
  })

  it.each([
    ['warnings', { generationDiagnostics: [{ severity: 'warning', code: 'TEST', path: [], message: 'warning' }] }],
    ['strong features over budget', { strongFeatureCount: 3 }],
    ['surprise slots over budget', { surpriseSlots: 4 }],
    ['missing face metrics', { compositionMetrics: null }],
    ['eyes outside the safe zone', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, eyesInsideRatio: 0.79 } }],
    ['eyes hidden', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, eyesVisibleRatio: 0.839999 } }],
    ['mouth outside the safe zone', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, mouthInsideRatio: 0.839999 } }],
    ['mouth hidden', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, mouthVisibleRatio: 0.839999 } }],
    ['render diagnostics', { renderDiagnostics: [{ severity: 'warning', code: 'TEST', path: [], message: 'warning' }] }],
    ['missing connector metrics', { connectorMetrics: null }],
    ['empty connector metrics', { connectorMetrics: [] }],
    ['receiver connector under coverage', { connectorMetrics: [{ ...makeValidRenderedAcceptanceEntry().connectorMetrics[0], receiverCoverage: 0.619999 }] }],
    ['plug connector under coverage', { connectorMetrics: [{ ...makeValidRenderedAcceptanceEntry().connectorMetrics[0], plugCoverage: 0.899999 }] }],
    ['disconnected structural alpha', { connectorMetrics: [{ ...makeValidRenderedAcceptanceEntry().connectorMetrics[0], largestComponentRatio: 0.989999 }] }],
    ['connector centerline gap over two pixels', { connectorMetrics: [{ ...makeValidRenderedAcceptanceEntry().connectorMetrics[0], centerlineGapPixels: 2.000001 }] }],
    ['missing exact asset resources', { resolvedAssetPaths: [] }],
  ])('rejects %s from composition acceptance', async (_label, patch) => {
    const { assertCompositionAcceptance } = await import('./generate-acceptance-set.js')
    expect(() => assertCompositionAcceptance({
      ...makeValidRenderedAcceptanceEntry(),
      generationDiagnostics: [],
      ...patch,
    })).toThrow('composition acceptance')
  })

  it('accepts machine metrics at the exact composition thresholds', async () => {
    const { assertCompositionAcceptance } = await import('./generate-acceptance-set.js')
    expect(() => assertCompositionAcceptance({
      ...makeValidRenderedAcceptanceEntry(),
      generationDiagnostics: [],
      compositionMetrics: {
        ...makeValidRenderedAcceptanceEntry().compositionMetrics,
        eyesInsideRatio: 0.8,
        eyesVisibleRatio: 0.84,
        mouthInsideRatio: 0.84,
        mouthVisibleRatio: 0.84,
      },
      connectorMetrics: [{
        ...makeValidRenderedAcceptanceEntry().connectorMetrics[0],
        receiverCoverage: 0.62,
        plugCoverage: 0.90,
      }],
    })).not.toThrow()
  })

  it('accepts the exact v0.3 master frame with y60 and unchanged bottom1952', async () => {
    const { assertCompositionAcceptance } = await import('./generate-acceptance-set.js')
    expect(() => assertCompositionAcceptance({
      ...makeValidRenderedAcceptanceEntry(),
      generationDiagnostics: [],
      compositionMetrics: {
        ...makeValidRenderedAcceptanceEntry().compositionMetrics,
        visibleBounds: { x: 96, y: 60, width: 1856, height: 1892 },
      },
    })).not.toThrow()
  })

  it.each([
    ['left95', { x: 95, y: 60, width: 1856, height: 1892 }],
    ['top59', { x: 96, y: 59, width: 1856, height: 1892 }],
    ['bottom1953', { x: 96, y: 60, width: 1856, height: 1893 }],
  ])('rejects v0.3 visible bounds outside the catalog master-space frame at %s', async (_label, visibleBounds) => {
    const { assertCompositionAcceptance } = await import('./generate-acceptance-set.js')
    expect(() => assertCompositionAcceptance({
      ...makeValidRenderedAcceptanceEntry(),
      generationDiagnostics: [],
      compositionMetrics: {
        ...makeValidRenderedAcceptanceEntry().compositionMetrics,
        visibleBounds,
      },
    })).toThrow('composition acceptance')
  })

  it('rebuilds byte-equivalent public specs for the fixed acceptance inputs', async () => {
    const { buildAcceptanceManifest } = await import('./generate-acceptance-set.js')
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    expect(await buildAcceptanceManifest(parsedCatalog.value))
      .toEqual(await buildAcceptanceManifest(parsedCatalog.value))
  })
})
