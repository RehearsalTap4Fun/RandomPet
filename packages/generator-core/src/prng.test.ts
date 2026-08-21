import { describe, expect, it } from 'vitest'
import { createRng, pickWeighted, slotSeedParts, type Rng } from './prng.js'

describe('stable PRNG', () => {
  it('matches the committed golden vector', () => {
    const rng = createRng(slotSeedParts('84721937', 'fungal', 'eyes', 0))
    expect(rng.nextFloat()).toBeCloseTo(0.8443717986810952, 15)
    expect(rng.nextFloat()).toBeCloseTo(0.8479310672264546, 15)
    expect(rng.nextFloat()).toBeCloseTo(0.009995558764785528, 15)
  })

  it('never selects a zero-weight item', () => {
    const rng = createRng(['weighted', 'fixture'])
    const result = pickWeighted(
      [{ id: 'zero', weight: 0 }, { id: 'live', weight: 4 }],
      item => item.weight,
      rng,
    )
    expect(result.id).toBe('live')
  })

  it('skips non-positive weights even when the roll is at the upper boundary', () => {
    const rng: Rng = { nextFloat: () => 1 }
    const result = pickWeighted(
      [{ id: 'live', weight: 4 }, { id: 'zero', weight: 0 }],
      item => item.weight,
      rng,
    )
    expect(result.id).toBe('live')
  })

  it('rejects empty and all-non-positive weighted collections', () => {
    const rng = createRng(['errors', 'fixture'])
    expect(() => pickWeighted([], () => 1, rng)).toThrow(
      'Cannot pick from an empty weighted collection',
    )
    expect(() => pickWeighted([{ weight: 0 }, { weight: -1 }], item => item.weight, rng)).toThrow(
      'Cannot pick from a weighted collection with no positive weight',
    )
  })

  it('builds independent slot seed parts in order', () => {
    expect(slotSeedParts('seed', 'fungal', 'eyes', 3)).toEqual([
      'seed', 'fungal', 'eyes', '3',
    ])
  })
})
