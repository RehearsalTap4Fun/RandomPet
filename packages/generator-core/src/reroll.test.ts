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

  it('keeps previous selections while advancing the retry stream when no body candidate is compatible', () => {
    const catalog = makeInterfaceCatalogFixture()
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'

    const result = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(result.blocked).toBe(true)
    expect(result.spec).toEqual({
      ...spec,
      slotRolls: { ...spec.slotRolls, bodyFrame: 1 },
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_COMPATIBLE_CANDIDATE', path: ['visualSlots', 'bodyFrame'],
    }))
  })

  it('advances the body reroll stream after a cross-rig candidate fails against retained children', () => {
    const catalog = makeInterfaceCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'
    spec.seed = 'cross-rig-1'

    const failed = rerollSlot({ spec, slotId: 'bodyFrame', locks: {}, catalog })
    const recovered = rerollSlot({ spec: failed.spec, slotId: 'bodyFrame', locks: {}, catalog })

    expect(failed.blocked).toBe(true)
    expect(failed.spec.visualSlots).toEqual(spec.visualSlots)
    expect(failed.spec.slotRolls.bodyFrame).toBe(1)
    expect(recovered.blocked).toBe(false)
    expect(recovered.spec.slotRolls.bodyFrame).toBe(2)
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
