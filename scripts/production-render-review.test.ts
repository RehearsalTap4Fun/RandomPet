import { describe, expect, it } from 'vitest'
import { resolveAttachmentTree } from '@qmonster/renderer-canvas'
import { loadCommittedProductionCatalog } from './build-production-catalog.js'
import { buildProductionReviewBundle } from '../apps/creator-web/src/production-render-review.js'

describe('production composition review bundle', () => {
  it('keeps the complete v0.2 composition catalog and resolves paired target nodes', async () => {
    const { catalog } = await loadCommittedProductionCatalog({ version: '0.2.0' })
    const rig = catalog.rigs.find(candidate => candidate.id === 'biped')!
    const target = catalog.parts.find(candidate => candidate.id === 'legs_mushroom')!

    const bundle = buildProductionReviewBundle(catalog, rig, target)
    const attachment = resolveAttachmentTree(bundle.spec, bundle.catalog)

    expect(bundle.catalog.compositionPolicy).toEqual(catalog.compositionPolicy)
    expect(bundle.catalog.parts).toHaveLength(catalog.parts.length)
    expect(bundle.catalog.parts.find(part => part.id === target.id)?.composition).toEqual(target.composition)
    expect(bundle.spec.rendererVersion).toBe('0.2.0')
    expect(bundle.spec.visualSlots.legs.partId).toBe('legs_mushroom')
    expect(bundle.spec.visualSlots.headAppendage.partId).toBe('head_appendage_none')
    expect(bundle.spec.visualSlots.tail.partId).toBe('tail_none')
    expect(bundle.spec.visualSlots.extraAppendage.partId).toBe('extra_appendage_none')
    expect(bundle.spec.visualSlots.effect.partId).toBe('effect_none')
    expect(attachment.diagnostics).toEqual([])
    expect(attachment.nodes.filter(node => node.part.id === target.id).map(node => node.node.assetPath)).toEqual([
      'nodes/legs_mushroom/left.webp',
      'nodes/legs_mushroom/right.webp',
    ])
  })
})
