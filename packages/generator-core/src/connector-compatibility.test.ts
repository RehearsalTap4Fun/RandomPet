import { describe, expect, it } from 'vitest'
import {
  evaluateConnectorPair,
  selectVisualPart,
  validateStructuralSelections,
  type Catalog,
  type MonsterSpec,
} from './index.js'
import {
  makeInterfaceCatalogFixture,
  makeValidCompositionSpecFixture,
} from './test-fixtures.js'

function makeExactRigCatalog(): Catalog {
  const catalog = makeInterfaceCatalogFixture()
  const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
  const head = catalog.parts.find(part => part.slotId === 'headShape')!
  const bodyVariant = body.composition!.mode === 'interface'
    ? body.composition.variantsByRig.biped!
    : undefined
  const headVariant = head.composition!.mode === 'interface'
    ? head.composition.variantsByRig.biped!
    : undefined
  if (bodyVariant === undefined || headVariant === undefined) throw new Error('Expected biped interface variants')

  catalog.parts.push(
    {
      ...structuredClone(body),
      id: 'body_biped_peanut',
      compatibleRigs: ['biped'],
      composition: {
        ...structuredClone(body.composition!),
        variantsByRig: {
          biped: { ...structuredClone(bodyVariant), materialFamily: 'short-fur' },
        },
      } as typeof body.composition,
    },
    {
      ...structuredClone(head),
      id: 'head_round_dome',
      compatibleRigs: ['biped'],
      composition: {
        ...structuredClone(head.composition!),
        variantsByRig: {
          biped: { ...structuredClone(headVariant), materialFamily: 'mushroom-velvet' },
        },
      } as typeof head.composition,
    },
  )
  catalog.transitionBridges = catalog.transitionBridges!.map(bridge => (
    bridge.rigId === 'biped' && bridge.connectorClass === 'neck'
      ? { ...bridge, id: 'bridge_biped_neck_fur', materialFamilies: ['short-fur', 'mushroom-velvet'] }
      : bridge
  ))
  return catalog
}

function makeInterfaceSpec(catalog: Catalog): MonsterSpec {
  const spec = makeValidCompositionSpecFixture(catalog)
  spec.catalogVersion = '0.3.0'
  spec.rendererVersion = '0.3.0'
  for (const selection of Object.values(spec.visualSlots)) selection.rigId = 'biped'
  spec.visualSlots.bodyFrame.partId = 'body_biped_peanut'
  spec.visualSlots.headShape.partId = 'head_round_dome'
  return spec
}

function makeIncompatibleInterfaceCatalog(): Catalog {
  const catalog = makeExactRigCatalog()
  const body = catalog.parts.find(part => part.id === 'body_biped_peanut')!
  const variant = body.composition!.mode === 'interface' ? body.composition.variantsByRig.biped! : undefined
  if (variant === undefined) throw new Error('Expected biped interface variant')
  catalog.parts.push({
    ...structuredClone(body),
    id: 'body_biped_tall',
    composition: {
      ...structuredClone(body.composition!),
      variantsByRig: {
        biped: {
          ...structuredClone(variant),
          connectors: variant.connectors.map(connector => (
            connector.id === 'neck' ? { ...connector, width: 300 } : connector
          )),
        },
      },
    } as typeof body.composition,
  })
  return catalog
}

describe('evaluateConnectorPair', () => {
  it('blocks a selected child whose recorded rig differs from the body even when both variants exist', () => {
    const catalog = makeInterfaceCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'
    spec.visualSlots.headShape.rigId = 'biped'

    expect(validateStructuralSelections(spec, catalog)).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'CONNECTOR_VARIANT_MISSING',
      path: ['visualSlots', 'headShape'],
    }))
  })

  it('accepts an exact-rig pair only when one bridge satisfies both warp limits', () => {
    const catalog = makeExactRigCatalog()

    expect(evaluateConnectorPair(catalog, 'body_biped_peanut', 'head_round_dome', 'biped', 'neck'))
      .toEqual(expect.objectContaining({ ok: true, bridgeId: 'bridge_biped_neck_fur' }))
  })

  it('rejects cross-rig fallback and width ratios outside either side limits', () => {
    const catalog = makeExactRigCatalog()

    expect(evaluateConnectorPair(catalog, 'body_biped_peanut', 'head_round_dome', 'blob', 'neck'))
      .toEqual(expect.objectContaining({ ok: false, code: 'CONNECTOR_VARIANT_MISSING' }))
    const head = catalog.parts.find(part => part.id === 'head_round_dome')!
    const plug = (head.composition!.mode === 'interface' ? head.composition.variantsByRig.biped : undefined)!.connectors
      .find(connector => connector.id === 'neck')!
    plug.width = 300
    expect(evaluateConnectorPair(catalog, 'body_biped_peanut', 'head_round_dome', 'biped', 'neck'))
      .toEqual(expect.objectContaining({ ok: false, code: 'CONNECTOR_WARP_EXCEEDED' }))
  })

  it('excludes an incompatible manual body replacement without mutating selections', () => {
    const catalog = makeIncompatibleInterfaceCatalog()
    const spec = makeInterfaceSpec(catalog)
    const result = selectVisualPart({ spec, slotId: 'bodyFrame', partId: 'body_biped_tall', locks: {}, catalog })

    expect(result.blocked).toBe(true)
    expect(result.spec.visualSlots).toEqual(spec.visualSlots)
  })
})
