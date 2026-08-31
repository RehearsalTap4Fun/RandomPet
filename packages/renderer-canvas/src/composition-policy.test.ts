import { describe, expect, it } from 'vitest'
import type { Catalog } from '@qmonster/generator-core'
import { compositionMetricsMeetThresholds } from './composition-policy.js'
import type { CompositionMetrics } from './types.js'

const policy = {
  motifSlots: [], surpriseRatio: 0.3, maxStrongFeatures: 2,
  optionalNoneRate: { min: 0.35, max: 0.5 },
  frameBounds: { x: 96, y: 60, width: 1856, height: 1892 },
  faceInsideRatio: 0.84, faceVisibleRatio: 0.84,
} satisfies NonNullable<Catalog['compositionPolicy']>

function metrics(overrides: Partial<CompositionMetrics> = {}): CompositionMetrics {
  return {
    eyesInsideRatio: 0.8,
    eyesVisibleRatio: 0.84,
    mouthInsideRatio: 0.84,
    mouthVisibleRatio: 0.84,
    visibleBounds: { x: 96, y: 60, width: 1856, height: 1892 },
    ...overrides,
  }
}

describe('composition metric policy', () => {
  it('accepts the exact v0.3 face and frame boundaries', () => {
    expect(compositionMetricsMeetThresholds(metrics(), policy)).toBe(true)
  })

  it.each([
    ['eyes inside', { eyesInsideRatio: 0.799999 }],
    ['eyes visible', { eyesVisibleRatio: 0.839999 }],
    ['mouth inside', { mouthInsideRatio: 0.839999 }],
    ['mouth visible', { mouthVisibleRatio: 0.839999 }],
    ['frame top', { visibleBounds: { x: 96, y: 59, width: 1856, height: 1892 } }],
  ] as const)('rejects a value below the %s boundary', (_label, overrides) => {
    expect(compositionMetricsMeetThresholds(metrics(overrides), policy)).toBe(false)
  })
})
