import { describe, expect, it } from 'vitest'
import { measureFeatureAlpha, measureVisibleBounds } from './composition-metrics.js'

function alphaMask(
  width: number,
  height: number,
  points: readonly (readonly [number, number])[],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of points) pixels[(y * width + x) * 4 + 3] = 255
  return pixels
}

describe('composition alpha metrics', () => {
  it('computes safe-zone and post-occluder alpha ratios', () => {
    const feature = alphaMask(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]])
    const occluder = alphaMask(4, 4, [[2, 1]])

    const metric = measureFeatureAlpha(
      feature, occluder, 4, 4, { x: 1, y: 1, width: 2, height: 2 },
    )

    expect(metric.insideRatio).toBe(1)
    expect(metric.visibleRatio).toBe(0.75)
  })

  it('treats alpha inside any declared face zone as in-zone', () => {
    const feature = alphaMask(4, 2, [[0, 0], [3, 1]])
    const occluder = new Uint8ClampedArray(4 * 2 * 4)

    const metric = measureFeatureAlpha(feature, occluder, 4, 2, [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 3, y: 1, width: 1, height: 1 },
    ])

    expect(metric.insideRatio).toBe(1)
    expect(metric.visibleRatio).toBe(1)
  })

  it('returns null bounds for a transparent image and exact bounds otherwise', () => {
    expect(measureVisibleBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
    expect(measureVisibleBounds(alphaMask(4, 4, [[1, 2], [3, 3]]), 4, 4))
      .toEqual({ x: 1, y: 2, width: 3, height: 2 })
  })
})
