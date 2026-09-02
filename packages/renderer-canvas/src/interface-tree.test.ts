import { describe, expect, it } from 'vitest'
import {
  makeInterfaceCatalogFixture,
  makeValidCompositionSpecFixture,
} from '@qmonster/generator-core/test-fixtures'
import { resolveInterfaceTree } from './interface-tree.js'

function interfaceFixture() {
  const catalog = makeInterfaceCatalogFixture()
  const spec = makeValidCompositionSpecFixture(catalog)
  spec.catalogVersion = '0.3.0'
  spec.rendererVersion = '0.3.0'
  return { catalog, spec }
}

function v04InterfaceFixture() {
  const { catalog, spec } = interfaceFixture()
  catalog.version = '0.4.0'
  catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
  spec.catalogVersion = '0.4.0'
  spec.rendererVersion = '0.4.0'
  return { catalog, spec }
}

describe('resolveInterfaceTree', () => {
  it('uses selected exact-rig variants and resolves declared bridge identities without mutation', () => {
    const { catalog, spec } = interfaceFixture()
    const originalSpec = structuredClone(spec)
    const originalCatalog = structuredClone(catalog)

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.diagnostics).toEqual([])
    expect(result.nodes.find(node => node.slotId === 'bodyFrame')?.key).toContain('_blob')
    expect(result.bridges).toHaveLength(8)
    expect(result.bridges.map(item => item.connectorId)).toEqual([
      'neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight',
      'tailRoot', 'extraLeft', 'extraRight',
    ])
    expect(result.bridges[0]).toMatchObject({
      bridge: { id: 'blob_neck_bridge' },
      solved: { ok: true, childPlacement: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
    })
    expect(spec).toEqual(originalSpec)
    expect(catalog).toEqual(originalCatalog)
  })

  it('associates plug connectors to render nodes by connector ID instead of array position', () => {
    const { catalog, spec } = interfaceFixture()
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    if (arms.composition?.mode !== 'interface') throw new Error('expected interface arms')
    const variant = arms.composition.variantsByRig.blob!
    variant.renderNodes.reverse()

    const result = resolveInterfaceTree(spec, catalog)

    const armsByConnector = Object.fromEntries(result.bridges
      .filter(bridge => bridge.plug.connectorClass === 'shoulder')
      .map(bridge => [bridge.connectorId, bridge.childNodeKey]))
    expect(armsByConnector).toEqual({
      shoulderLeft: expect.stringContaining('short_0'),
      shoulderRight: expect.stringContaining('short_1'),
    })
  })

  it('blocks a malformed runtime variant that reuses one connector ID', () => {
    const { catalog, spec } = interfaceFixture()
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    if (arms.composition?.mode !== 'interface') throw new Error('expected interface arms')
    const variant = arms.composition.variantsByRig.blob!
    variant.renderNodes[1]!.connectorId = variant.renderNodes[0]!.connectorId

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.nodes).toEqual([])
    expect(result.bridges).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'CONNECTOR_PROFILE_INVALID', path: ['visualSlots', 'arms'],
    }))
  })

  it('translates head face zones and reanchors face nodes through variant feature sockets', () => {
    const { catalog, spec } = interfaceFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('expected interface head')
    const headVariant = head.composition.variantsByRig.blob!
    headVariant.featureSockets = { eyes: { x: 900, y: 800 } }
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    if (eyes.composition?.mode === 'interface' || eyes.composition === undefined) {
      throw new Error('expected attachment eyes')
    }
    eyes.composition.geometryByRig.blob!.sockets.eyes = { x: 0, y: 0 }

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.faceSafeZones).toEqual([{ x: 500, y: 400, width: 1048, height: 900 }])
    expect(result.nodes.find(node => node.slotId === 'eyes')?.placement).toEqual({
      x: -124, y: -224, scaleX: 1, scaleY: 1,
    })
  })

  it('bounds a rotated face-safe-zone from all four transformed corners', () => {
    const { catalog, spec } = interfaceFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('expected interface head')
    const variant = head.composition.variantsByRig.blob!
    const plug = variant.connectors.find(connector => connector.id === 'neck')!
    const angle = 10 * Math.PI / 180
    plug.tangent = { x: Math.cos(angle), y: Math.sin(angle) }

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.faceSafeZones[0]).toEqual({
      x: expect.closeTo(399.604, 3),
      y: expect.closeTo(318.488, 3),
      width: expect.closeTo(1188.362, 3),
      height: expect.closeTo(1068.310, 3),
    })
  })

  it('short-circuits without render nodes or bridges on exact-rig structural errors', () => {
    const { catalog, spec } = interfaceFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('expected interface head')
    delete head.composition.variantsByRig.blob

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.nodes).toEqual([])
    expect(result.bridges).toEqual([])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'CONNECTOR_VARIANT_MISSING', path: ['visualSlots', 'headShape'],
    }))
  })

  it('duplicates the exact-v0.4 complete face subtree and paired face zone at headAlternate', () => {
    const { catalog, spec } = v04InterfaceFixture()
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.diagnostics).toEqual([])
    for (const slotId of [
      'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
    ] as const) {
      expect(result.nodes.filter(node => node.slotId === slotId)).toHaveLength(2)
    }
    expect(result.nodes.filter(node => node.key.endsWith(':double-head'))).toHaveLength(5)
    expect(result.faceSafeZones).toEqual([
      { x: 500, y: 400, width: 1048, height: 900 },
      { x: 796, y: 440, width: 1048, height: 900 },
    ])
    expect(result.nodes.filter(node => node.slotId === 'oralDetail').map(node => node.placement)).toEqual([
      { x: -524, y: -324, scaleX: 1, scaleY: 1 },
      { x: -228, y: -284, scaleX: 1, scaleY: 1 },
    ])
  })

  it('relocates only exact-v0.4 misplaced eyes and adds the matching face zone', () => {
    const { catalog, spec } = v04InterfaceFixture()
    const baseline = resolveInterfaceTree(spec, catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'aberration_misplaced_eye')!
    spec.aberrations = [{ id: modifier.id, overrides: structuredClone(modifier.overrides) }]

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.diagnostics).toEqual([])
    expect(result.nodes.filter(node => node.slotId === 'eyes').map(node => node.placement)).toEqual([
      { x: 296, y: 40, scaleX: 1, scaleY: 1 },
    ])
    for (const slotId of ['headShape', 'mouthShape', 'oralDetail', 'headAppendage'] as const) {
      expect(result.nodes.filter(node => node.slotId === slotId).map(node => node.placement)).toEqual(
        baseline.nodes.filter(node => node.slotId === slotId).map(node => node.placement),
      )
    }
    expect(result.faceSafeZones).toEqual([
      { x: 500, y: 400, width: 1048, height: 900 },
      { x: 796, y: 440, width: 1048, height: 900 },
    ])
  })

  it('fails closed when an exact-v0.4 modifier destination is absent', () => {
    const { catalog, spec } = v04InterfaceFixture()
    delete catalog.rigs.find(rig => rig.id === 'blob')!.sockets.headAlternate
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    const result = resolveInterfaceTree(spec, catalog)

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'RENDER_SOCKET_MISSING',
      path: ['mutation', 'overrides', 'socket'],
    }))
    expect(result.nodes).toEqual([])
    expect(result.bridges).toEqual([])
    expect(result.faceSafeZones).toEqual([])
  })
})
