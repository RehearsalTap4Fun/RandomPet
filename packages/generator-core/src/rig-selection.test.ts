import { describe, expect, it } from 'vitest'
import type { GenerationRequest } from './contracts.js'
import { selectRigId } from './rig-selection.js'
import { makeValidCatalogFixtureWithThreeRigs } from './test-fixtures.js'

describe('selectRigId', () => {
  it('is deterministic and covers every legal rig over fixed seeds', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const requests = Array.from({ length: 200 }, (_, index) => ({
      seed: String(2026082101 + index), themeId: 'fungal', mode: 'normal',
    } as const satisfies GenerationRequest))
    const first = requests.map(request => selectRigId(request, catalog))
    const second = requests.map(request => selectRigId(request, catalog))

    expect(second).toEqual(first)
    expect(new Set(first)).toEqual(new Set(['blob', 'biped', 'floating']))
  })

  it('changes only through the bodyFrame reroll index', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const base = { seed: 'rig-stream', themeId: 'shadow', mode: 'normal' } as const satisfies GenerationRequest

    expect(selectRigId(base, catalog)).toBe(selectRigId(base, catalog))
    const seen = new Set(Array.from({ length: 30 }, (_, rerollIndex) =>
      selectRigId({ ...base, slotRolls: { bodyFrame: rerollIndex } }, catalog)))
    expect(seen.size).toBeGreaterThan(1)
  })
})
