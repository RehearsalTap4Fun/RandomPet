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
})
