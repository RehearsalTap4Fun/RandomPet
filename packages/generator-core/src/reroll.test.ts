import { describe, expect, it } from 'vitest'
import { rerollSlot } from './index.js'
import { makeInterfaceCatalogFixture, makeValidCompositionSpecFixture } from './test-fixtures.js'

describe('rerollSlot', () => {
  it('preserves non-origin structural descendants for a v0.3 body reroll', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.dependencies = { bodyFrame: ['headShape', 'arms'] }
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    catalog.parts.push(
      { ...structuredClone(head), id: 'head_would_regenerate', baseWeight: 999 },
      { ...structuredClone(arms), id: 'arms_would_regenerate', baseWeight: 999 },
    )
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(result.spec.visualSlots.headShape).toEqual(spec.visualSlots.headShape)
    expect(result.spec.visualSlots.arms).toEqual(spec.visualSlots.arms)
  })

  it('preserves a structural child when a non-structural dependency ancestor rerolls in v0.3', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.dependencies = { eyes: ['arms'] }
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    catalog.parts.push({ ...structuredClone(arms), id: 'arms_would_regenerate_from_eyes', baseWeight: 999 })
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'eyes', locks: {}, catalog })

    expect(result.spec.visualSlots.arms).toEqual(spec.visualSlots.arms)
  })

  it('keeps the previous spec when no rerolled body is connector-compatible with retained children', () => {
    const catalog = makeInterfaceCatalogFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(result.blocked).toBe(true)
    expect(result.spec).toEqual(spec)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_CANDIDATE', path: ['visualSlots', 'bodyFrame'],
    }))
  })

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
