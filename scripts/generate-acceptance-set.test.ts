import { describe, expect, it } from 'vitest'
import { parseCatalog } from '@qmonster/generator-core'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.1.0/catalog.json'

describe('acceptance manifest', () => {
  it('uses exact seeds, cycles themes, and naturally covers every rig', async () => {
    const { buildAcceptanceManifest } = await import('./generate-acceptance-set.js')
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const productionCatalog = parsedCatalog.value
    const themes = ['deep-sea', 'fungal', 'shadow'] as const
    const entries = await buildAcceptanceManifest(productionCatalog)
    expect(entries.map(item => item.seed)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(2026082101 + index)),
    )
    expect(entries.map(item => item.themeId)).toEqual(
      Array.from({ length: 20 }, (_, index) => themes[index % themes.length]),
    )
    expect(new Set(entries.map(item => item.rigId))).toEqual(new Set(['blob', 'biped', 'floating']))
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
