import { describe, expect, it } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import type { CompositionMetrics } from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'

function makeValidRenderedAcceptanceEntry() {
  const compositionMetrics: CompositionMetrics = {
    eyesInsideRatio: 1,
    eyesVisibleRatio: 1,
    mouthInsideRatio: 1,
    mouthVisibleRatio: 1,
    visibleBounds: { x: 100, y: 100, width: 800, height: 800 },
  }
  return {
    strongFeatureCount: 2,
    surpriseSlots: 3,
    motifOpportunityCount: 12,
    compositionMetrics,
    renderDiagnostics: [],
  }
}

describe('acceptance manifest', () => {
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

  it.each([
    ['warnings', { generationDiagnostics: [{ severity: 'warning', code: 'TEST', path: [], message: 'warning' }] }],
    ['strong features over budget', { strongFeatureCount: 3 }],
    ['surprise slots over budget', { surpriseSlots: 4 }],
    ['missing face metrics', { compositionMetrics: null }],
    ['eyes outside the safe zone', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, eyesInsideRatio: 0.79 } }],
    ['eyes hidden', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, eyesVisibleRatio: 0.84 } }],
    ['mouth outside the safe zone', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, mouthInsideRatio: 0.79 } }],
    ['mouth hidden', { compositionMetrics: { ...makeValidRenderedAcceptanceEntry().compositionMetrics, mouthVisibleRatio: 0.84 } }],
    ['render diagnostics', { renderDiagnostics: [{ severity: 'warning', code: 'TEST', path: [], message: 'warning' }] }],
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
        eyesVisibleRatio: 0.85,
        mouthInsideRatio: 0.8,
        mouthVisibleRatio: 0.85,
      },
    })).not.toThrow()
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
