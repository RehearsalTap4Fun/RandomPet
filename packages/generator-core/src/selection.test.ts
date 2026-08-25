import { describe, expect, it } from 'vitest'
import { evaluatePartSelection, selectVisualPart } from './index.js'
import { makeInterfaceCatalogFixture, makeValidCompositionSpecFixture } from './test-fixtures.js'

describe('evaluatePartSelection', () => {
  it('returns the concrete connector blocker and original spec for an incompatible manual body', () => {
    const catalog = makeInterfaceCatalogFixture()
    const originalBody = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    if (originalBody.composition?.mode !== 'interface') throw new Error('Expected interface body')
    catalog.parts.push({
      ...structuredClone(originalBody),
      id: 'body_warped_manual',
      composition: {
        ...structuredClone(originalBody.composition),
        variantsByRig: {
          ...structuredClone(originalBody.composition.variantsByRig),
          blob: {
            ...structuredClone(originalBody.composition.variantsByRig.blob!),
            connectors: originalBody.composition.variantsByRig.blob!.connectors.map(connector => (
              connector.id === 'neck' ? { ...connector, width: 300 } : connector
            )),
          },
        },
      },
    })
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = selectVisualPart({
      spec, slotId: 'bodyFrame', partId: 'body_warped_manual', locks: {}, catalog,
    })

    expect(result.spec).toEqual(spec)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'CONNECTOR_WARP_EXCEEDED',
      path: ['visualSlots', 'headShape'],
      message: expect.stringContaining('widthRatio=0.3333333333333333'),
    }))
  })

  it('rejects a body replacement when any visible structural child exceeds its connector warp limit', () => {
    const catalog = makeInterfaceCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    expect(evaluatePartSelection(body, spec, catalog)).toEqual({
      selectable: false,
      rigId: 'blob',
      reason: 'connector',
    })
  })
})
