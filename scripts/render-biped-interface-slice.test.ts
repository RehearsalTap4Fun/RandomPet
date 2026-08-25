import { describe, expect, it } from 'vitest'
import {
  buildBipedSliceManifest,
  makeBipedSliceCatalog,
} from './render-biped-interface-slice.js'

describe('biped interface slice manifest', () => {
  it('renders every canonical two-by-one-by-two-by-two biped combination exactly once', async () => {
    const catalog = makeBipedSliceCatalog()
    const manifest = await buildBipedSliceManifest(catalog)

    expect(catalog.options.headShape).toEqual(['head_mushroom_cap'])
    expect(manifest.entryCount).toBe(8)
    expect(manifest.entries).toHaveLength(8)
    expect(new Set(manifest.entries.map(item => item.structuralKey)).size).toBe(8)
    expect(manifest.entries.every(item => item.selections.headShape === 'head_mushroom_cap')).toBe(true)
    expect(manifest.entries[0]?.structuralKey).toBe(
      'body_biped_peanut|head_mushroom_cap|arms_short_plush|legs_webbed',
    )
    expect(manifest.entries[7]?.structuralKey).toBe(
      'body_biped_tall|head_mushroom_cap|arms_long_noodle|legs_mushroom',
    )
  })
})
