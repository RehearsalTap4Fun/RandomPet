import { describe, expect, it, vi } from 'vitest'
import {
  buildV08ReviewInputs,
  mapV08ReviewInputsOneShot,
  parseV08ReviewBatchArguments,
} from './generate-v08-user-review-batch.js'

describe('v0.8 user-review batch', () => {
  it('creates exactly ten stable review inputs', () => {
    const inputs = buildV08ReviewInputs('qmonster-v08-review', 10)

    expect(inputs.map(item => item.seed)).toEqual([
      'qmonster-v08-review-001',
      'qmonster-v08-review-002',
      'qmonster-v08-review-003',
      'qmonster-v08-review-004',
      'qmonster-v08-review-005',
      'qmonster-v08-review-006',
      'qmonster-v08-review-007',
      'qmonster-v08-review-008',
      'qmonster-v08-review-009',
      'qmonster-v08-review-010',
    ])
    expect(inputs.every(item => item.mode === 'normal')).toBe(true)
    expect(inputs.map(item => item.themeId)).toEqual([
      'deep-sea', 'fungal', 'shadow', 'deep-sea', 'fungal',
      'shadow', 'deep-sea', 'fungal', 'shadow', 'deep-sea',
    ])
  })

  it('rejects every batch size except ten', () => {
    expect(() => buildV08ReviewInputs('qmonster-v08-review', 9)).toThrow('exactly 10')
    expect(() => buildV08ReviewInputs('qmonster-v08-review', 11)).toThrow('exactly 10')
  })

  it('renders each review input once and preserves its identity', async () => {
    const inputs = buildV08ReviewInputs('qmonster-v08-review', 10)
    const generate = vi.fn((input: typeof inputs[number]) => ({ seed: input.seed }))
    const render = vi.fn(async (input: typeof inputs[number]) => ({ inputIndex: input.index }))

    const outputs = await mapV08ReviewInputsOneShot(inputs, { generate, render })

    expect(generate).toHaveBeenCalledTimes(10)
    expect(render).toHaveBeenCalledTimes(10)
    expect(outputs.map(item => item.input.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('stops after a missing render instead of retrying or replacing the seed', async () => {
    const [input] = buildV08ReviewInputs('qmonster-v08-review', 10)
    const generate = vi.fn(() => ({ generated: true }))
    const render = vi.fn(async () => undefined)

    await expect(mapV08ReviewInputsOneShot([input!], { generate, render })).rejects.toThrow('missing render')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('accepts only the exact v0.8 production command', () => {
    expect(parseV08ReviewBatchArguments([
      '--catalog-version', '0.8.0',
      '--seed', 'qmonster-v08-review',
      '--count', '10',
      '--output-directory', 'artifacts/acceptance/v0.8.0-feline',
    ])).toEqual({
      catalogVersion: '0.8.0',
      batchSeed: 'qmonster-v08-review',
      count: 10,
      outputDirectory: 'artifacts/acceptance/v0.8.0-feline',
    })
    expect(() => parseV08ReviewBatchArguments([
      '--catalog-version', '0.6.0', '--seed', 'seed', '--count', '10',
      '--output-directory', 'artifacts/acceptance/v0.8.0-feline',
    ])).toThrow('0.8.0')
    expect(() => parseV08ReviewBatchArguments([
      '--catalog-version', '0.8.0', '--seed', 'seed', '--count', '10',
      '--output-directory', 'artifacts/acceptance/v0.8.0-feline', '--retry', '1',
    ])).toThrow('Unknown')
  })
})
