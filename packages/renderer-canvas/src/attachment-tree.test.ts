import { describe, expect, it } from 'vitest'
import {
  makeCompositionCatalogFixture,
  makeValidCompositionSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import { resolveAttachmentTree } from './attachment-tree.js'

describe('resolveAttachmentTree', () => {
  it('resolves body -> head -> eyes through local sockets', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)

    const result = resolveAttachmentTree(spec, catalog)

    expect(result.diagnostics).toEqual([])
    expect(result.nodes.find(node => node.slotId === 'eyes')?.placement).toEqual({
      x: -1048, y: -648, scaleX: 1, scaleY: 1,
    })
    expect(result.parentChainBySlot.eyes).toEqual(['bodyFrame', 'headShape', 'eyes'])
  })

  it('does not fall back to canvas center for a missing child socket', () => {
    const catalog = makeCompositionCatalogFixture()
    delete catalog.parts.find(part => part.slotId === 'headShape')!
      .composition!.geometryByRig.blob!.sockets.eyes

    const result = resolveAttachmentTree(makeValidCompositionSpecFixture(catalog), catalog)

    expect(result.nodes.some(node => node.slotId === 'eyes')).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'COMPOSITION_SOCKET_MISSING',
      path: ['visualSlots', 'eyes'],
    }))
  })

  it('uses the signed parent scale when converting a mirrored child socket to world space', () => {
    const catalog = makeCompositionCatalogFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    head.composition!.renderNodes[0]!.transform = { scale: 1, mirrorX: true }

    const result = resolveAttachmentTree(makeValidCompositionSpecFixture(catalog), catalog)

    expect(result.diagnostics).toEqual([])
    expect(result.nodes.find(node => node.slotId === 'headShape')?.placement).toEqual({
      x: 1524, y: -324, scaleX: -1, scaleY: 1,
    })
    expect(result.nodes.find(node => node.slotId === 'eyes')?.placement).toEqual({
      x: 0, y: -648, scaleX: 1, scaleY: 1,
    })
  })

  it('expands a paired-arm selection into independently placed nodes', () => {
    const catalog = makeCompositionCatalogFixture()

    const result = resolveAttachmentTree(makeValidCompositionSpecFixture(catalog), catalog)
    const arms = result.nodes.filter(node => node.slotId === 'arms')

    expect(arms).toHaveLength(2)
    expect(arms.map(node => node.placement)).toEqual([
      { x: -364, y: -204, scaleX: 1, scaleY: 1 },
      { x: -284, y: -144, scaleX: 1, scaleY: 1 },
    ])
  })

  it('omits render nodes that are incompatible with the selected rig', () => {
    const catalog = makeCompositionCatalogFixture()
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    arms.composition!.renderNodes[1]!.compatibleRigs = ['biped']

    const result = resolveAttachmentTree(makeValidCompositionSpecFixture(catalog), catalog)

    expect(result.nodes.filter(node => node.slotId === 'arms').map(node => node.node.id))
      .toEqual(['arms_short_0'])
  })

  it('clones the complete head subtree and face zone at the alternate body socket', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = resolveAttachmentTree(spec, catalog)

    for (const slotId of [
      'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
    ] as const) {
      expect(result.nodes.filter(node => node.slotId === slotId)).toHaveLength(2)
    }
    expect(result.nodes.filter(node => node.key.endsWith(':double-head'))).toHaveLength(5)
    expect(result.faceSafeZones).toEqual([
      { x: -24, y: 76, width: 1048, height: 900 },
      { x: 56, y: 136, width: 1048, height: 900 },
    ])
    const oralDetails = result.nodes.filter(node => node.slotId === 'oralDetail')
    expect(oralDetails.map(node => node.placement)).toEqual([
      { x: -1492, y: -912, scaleX: 1, scaleY: 1 },
      { x: -1412, y: -852, scaleX: 1, scaleY: 1 },
    ])
    expect({
      oralDelta: {
        x: oralDetails[1]!.placement.x - oralDetails[0]!.placement.x,
        y: oralDetails[1]!.placement.y - oralDetails[0]!.placement.y,
      },
      faceZoneDelta: {
        x: result.faceSafeZones[1]!.x - result.faceSafeZones[0]!.x,
        y: result.faceSafeZones[1]!.y - result.faceSafeZones[0]!.y,
      },
    }).toEqual({ oralDelta: { x: 80, y: 60 }, faceZoneDelta: { x: 80, y: 60 } })
  })

  it('moves misplaced eyes by the alternate-head delta and declares the translated safe zone', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'aberration_misplaced_eye')!
    spec.aberrations = [{ id: modifier.id, overrides: structuredClone(modifier.overrides) }]

    const result = resolveAttachmentTree(spec, catalog)

    expect(result.nodes.find(node => node.slotId === 'eyes')?.placement).toEqual({
      x: -968, y: -588, scaleX: 1, scaleY: 1,
    })
    expect(result.faceSafeZones).toEqual([
      { x: -24, y: 76, width: 1048, height: 900 },
      { x: 56, y: 136, width: 1048, height: 900 },
    ])
  })
})
