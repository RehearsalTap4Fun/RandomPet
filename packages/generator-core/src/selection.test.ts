import { describe, expect, it } from 'vitest'
import { evaluatePartSelection } from './index.js'
import { makeInterfaceCatalogFixture, makeValidCompositionSpecFixture } from './test-fixtures.js'

describe('evaluatePartSelection', () => {
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
