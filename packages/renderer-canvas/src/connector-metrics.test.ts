import { describe, expect, it } from 'vitest'
import { measureConnectorAlpha } from './connector-metrics.js'

function mask(width: number, height: number, points: readonly (readonly [number, number])[]) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of points) pixels[(y * width + x) * 4 + 3] = 255
  return pixels
}

describe('measureConnectorAlpha', () => {
  it('requires both bridge ends, one connected structure, and external limbs', () => {
    const structure = mask(6, 3, [
      [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
      [0, 0], [1, 0], [2, 0],
    ])
    const body = mask(6, 3, [[0, 1], [1, 1], [2, 1]])
    const child = mask(6, 3, [[2, 1], [3, 1], [4, 1], [5, 1]])
    const metric = measureConnectorAlpha({
      connectorId: 'shoulderLeft', structure, body, child, width: 6, height: 3,
      receiverEnd: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      plugEnd: [{ x: 3, y: 1 }, { x: 4, y: 1 }],
      centerline: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    })

    expect(metric.receiverCoverage).toBe(1)
    expect(metric.plugCoverage).toBe(1)
    expect(metric.largestComponentRatio).toBe(1)
    expect(metric.centerlineGapPixels).toBe(0)
    expect(metric.childOutsideBodyRatio).toBe(0.75)
  })

  it('reports uncovered ends, centerline gaps, disconnected alpha, and absent child masks', () => {
    const structure = mask(5, 1, [[0, 0], [1, 0], [3, 0]])
    const metric = measureConnectorAlpha({
      connectorId: 'neck', structure, width: 5, height: 1,
      receiverEnd: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      plugEnd: [{ x: 3, y: 0 }, { x: 4, y: 0 }],
      centerline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    })

    expect(metric.receiverCoverage).toBe(1)
    expect(metric.plugCoverage).toBe(0.5)
    expect(metric.largestComponentRatio).toBeCloseTo(2 / 3)
    expect(metric.centerlineGapPixels).toBe(1)
    expect(metric.childOutsideBodyRatio).toBeNull()
  })
})
