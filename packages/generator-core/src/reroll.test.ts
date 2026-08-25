import { describe, expect, it } from 'vitest'
import { rerollSlot } from './index.js'
import { makeInterfaceCatalogFixture, makeValidCompositionSpecFixture } from './test-fixtures.js'

describe('rerollSlot', () => {
  it('preserves structural children while excluding an incompatible body reroll candidate', () => {
    const catalog = makeInterfaceCatalogFixture()
    const originalBody = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    if (originalBody.composition?.mode !== 'interface') throw new Error('Expected interface body')
    catalog.parts.push({
      ...structuredClone(originalBody),
      id: 'body_warped',
      baseWeight: 999,
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

    const rerolled = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(rerolled.blocked).toBe(false)
    expect(rerolled.spec.visualSlots.bodyFrame.partId).toBe('body_blob')
    expect(rerolled.spec.visualSlots.headShape).toEqual(spec.visualSlots.headShape)
  })
})
