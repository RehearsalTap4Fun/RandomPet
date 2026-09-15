import { describe, expect, it } from 'vitest'
import {
  COMBINATION_SLOTS,
  COMBINATION_OPTIONS,
  generateFelineCombination,
  mutationSelectionsFromList,
  parseFelineCombinationSpec,
  rerollFelineCombination,
  rerollFelineCombinationSlot,
  setFelineCombinationSelection,
  type FelineCombinationSpec,
} from './feline-combination.js'

describe('feline combination candidate', () => {
  it('counts the option space without traversing combinations and parses representative choices', () => {
    expect(Object.values(COMBINATION_OPTIONS).reduce((count, options) => count * options.length, 1)).toBe(5184)
    expect(['crown', 'ears', 'neck', 'back', 'tailTip'].reduce((count, slot) => count * COMBINATION_OPTIONS[slot as keyof typeof COMBINATION_OPTIONS].length, 1)).toBe(288)
    for (const crown of COMBINATION_OPTIONS.crown) {
      expect(parseFelineCombinationSpec(generateFelineCombination('crown-sample', { crown })).ok).toBe(true)
    }
  })

  it('permits all five mutation positions and rejects all repeated positions', () => {
    expect(mutationSelectionsFromList(['antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'])).toEqual({
      crown: 'antlers', ears: 'fin-ears', neck: 'small-lion-mane', back: 'small-wings', tailTip: 'forked-tail-tip',
    })
    expect(mutationSelectionsFromList([])).toEqual({ crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none' })
    expect(() => mutationSelectionsFromList(['dragon-horns', 'antlers'])).toThrow(/crown/)
    expect(() => mutationSelectionsFromList(['fin-ears', 'fin-ears'])).toThrow(/ears/)
    expect(() => mutationSelectionsFromList(['gill-feathers'])).toThrow(/Unknown mutation/)
    expect(() => mutationSelectionsFromList(['none'])).toThrow(/Unknown mutation/)
    expect(() => mutationSelectionsFromList(null as never)).toThrow(/list/i)
  })

  it('replays seeds and preserves explicit choices without coupling random substreams', () => {
    const initial = generateFelineCombination('sample')
    expect(generateFelineCombination('sample')).toEqual(initial)
    const chosen = generateFelineCombination('sample', { coat: 'tuxedo', crown: 'antlers' })
    expect(chosen.selections).toEqual({ ...initial.selections, coat: 'tuxedo', crown: 'antlers' })
    const restored = parseFelineCombinationSpec(JSON.parse(JSON.stringify(chosen)))
    expect(restored).toEqual({ ok: true, value: chosen })
    if (!restored.ok) throw new Error('Expected restored spec')
    expect(rerollFelineCombination(restored.value)).toEqual(rerollFelineCombination(chosen))
  })

  it('rerolls only the requested slot and produces order-independent slot streams', () => {
    const initial = generateFelineCombination('isolated')
    for (const slot of COMBINATION_SLOTS) {
      const next = rerollFelineCombinationSlot(initial, slot)
      expect(next.rolls).toEqual({ ...initial.rolls, [slot]: 1 })
      for (const other of COMBINATION_SLOTS.filter(value => value !== slot)) {
        expect(next.selections[other]).toBe(initial.selections[other])
      }
      expect(rerollFelineCombinationSlot(initial, slot)).toEqual(next)
    }
    expect(rerollFelineCombinationSlot(rerollFelineCombinationSlot(initial, 'coat'), 'crown'))
      .toEqual(rerollFelineCombinationSlot(rerollFelineCombinationSlot(initial, 'crown'), 'coat'))
    // A reroll can repeat an option; across a sequence it must actually sample the stream.
    const seen = new Set<string>()
    let rolling = initial
    for (let count = 0; count < 50; count++) {
      rolling = rerollFelineCombinationSlot(rolling, 'coat')
      seen.add(rolling.selections.coat)
    }
    expect(seen.size).toBe(6)
  })

  it('preserves locked slots for local and whole rerolls while allowing deliberate selection', () => {
    const initial = generateFelineCombination('locks', { crown: 'dragon-horns' })
    initial.locks = ['crown', 'coat']
    expect(rerollFelineCombinationSlot(initial, 'crown')).toEqual(initial)
    const next = rerollFelineCombination(initial)
    expect(next.locks).toEqual(initial.locks)
    for (const slot of COMBINATION_SLOTS) {
      expect(next.rolls[slot]).toBe(initial.locks.includes(slot) ? 0 : 1)
      if (initial.locks.includes(slot)) expect(next.selections[slot]).toBe(initial.selections[slot])
    }
    const chosen = setFelineCombinationSelection(initial, 'crown', 'antlers')
    expect(chosen).toEqual({ ...initial, selections: { ...initial.selections, crown: 'antlers' } })
  })

  it.each([
    ['null', () => null],
    ['wrong schema', (s: FelineCombinationSpec) => ({ ...s, schemaVersion: '0.4.0' })],
    ['wrong catalog', (s: FelineCombinationSpec) => ({ ...s, catalogVersion: '0.9.0' })],
    ['unknown root key', (s: FelineCombinationSpec) => ({ ...s, extra: true })],
    ['unknown selection key', (s: FelineCombinationSpec) => ({ ...s, selections: { ...s.selections, extra: 'none' } })],
    ['missing selection', (s: FelineCombinationSpec) => ({ ...s, selections: { coat: 'tuxedo' } })],
    ['unknown coat', (s: FelineCombinationSpec) => ({ ...s, selections: { ...s.selections, coat: 'orange' } })],
    ['wrong position', (s: FelineCombinationSpec) => ({ ...s, selections: { ...s.selections, crown: 'fin-ears' } })],
    ['blank seed', (s: FelineCombinationSpec) => ({ ...s, seed: '  ' })],
    ['numeric seed', (s: FelineCombinationSpec) => ({ ...s, seed: 5 })],
    ['missing roll', (s: FelineCombinationSpec) => ({ ...s, rolls: {} })],
    ['extra roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, extra: 0 } })],
    ['negative roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, coat: -1 } })],
    ['fractional roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, coat: 0.5 } })],
    ['infinite roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, coat: Infinity } })],
    ['NaN roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, coat: NaN } })],
    ['unsafe roll', (s: FelineCombinationSpec) => ({ ...s, rolls: { ...s.rolls, coat: Number.MAX_SAFE_INTEGER + 1 } })],
    ['invalid lock', (s: FelineCombinationSpec) => ({ ...s, locks: ['horns'] })],
    ['duplicate lock', (s: FelineCombinationSpec) => ({ ...s, locks: ['coat', 'coat'] })],
  ])('returns diagnostics for %s', (_, corrupt) => {
    const result = parseFelineCombinationSpec(corrupt(generateFelineCombination('valid')))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected rejection')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', message: expect.any(String), path: expect.any(Array) })
  })

  it('rejects invalid operations and exhausted counters without partial changes', () => {
    const initial = generateFelineCombination('operations')
    expect(() => generateFelineCombination('')).toThrow(/seed/i)
    expect(() => generateFelineCombination('   ')).toThrow(/seed/i)
    expect(() => generateFelineCombination('ok', { coat: 'wrong' } as never)).toThrow(/coat/i)
    expect(() => generateFelineCombination('ok', { extra: 'wrong' } as never)).toThrow()
    expect(() => setFelineCombinationSelection(initial, 'crown', 'fin-ears' as never)).toThrow(/crown/i)
    expect(() => setFelineCombinationSelection(initial, 'wrong' as never, 'none' as never)).toThrow(/slot/i)
    expect(() => rerollFelineCombinationSlot(initial, 'wrong' as never)).toThrow(/slot/i)
    expect(() => rerollFelineCombination({ ...initial, seed: '' })).toThrow(/seed/i)
    initial.rolls.coat = Number.MAX_SAFE_INTEGER
    expect(() => rerollFelineCombinationSlot(initial, 'coat')).toThrow(/exhausted|overflow/i)
    expect(() => rerollFelineCombination(initial)).toThrow(/exhausted|overflow/i)
    expect(initial.rolls.coat).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('detaches nested state for every output including locked rerolls and parsed inputs', () => {
    const initial = generateFelineCombination('copies')
    initial.locks = ['coat']
    const parsed = parseFelineCombinationSpec(initial)
    if (!parsed.ok) throw new Error('Expected parsed spec')
    const outputs = [parsed.value, rerollFelineCombination(initial), rerollFelineCombinationSlot(initial, 'coat'), setFelineCombinationSelection(initial, 'coat', 'tuxedo')]
    for (const output of outputs) {
      expect(output).not.toBe(initial)
      expect(output.selections).not.toBe(initial.selections)
      expect(output.rolls).not.toBe(initial.rolls)
      expect(output.locks).not.toBe(initial.locks)
    }
    const all = [generateFelineCombination('copy-a'), generateFelineCombination('copy-b')]
    expect(all[0]!.selections).not.toBe(all[1]!.selections)
    expect(all[0]!.rolls).not.toBe(all[1]!.rolls)
    expect(all[0]!.locks).not.toBe(all[1]!.locks)
  })
})
