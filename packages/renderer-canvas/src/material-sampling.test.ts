import { describe, expect, it } from 'vitest'
import { rgbaInsideTransformedRegion } from './material-sampling.js'

describe('rgbaInsideTransformedRegion', () => {
  it('excludes pixels inside the rotated AABB but outside the declared local polygon', () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 4)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels.set([255, 0, 0, 255], offset)
    }
    for (const [x, y] of [[1, 0], [2, 0], [1, 1], [2, 1]] as const) {
      pixels.set([0, 0, 255, 255], (y * 4 + x) * 4)
    }

    expect(rgbaInsideTransformedRegion(
      pixels, 4, 3, { x: 0, y: 0 },
      { x: 2, y: 0, scaleX: 1, scaleY: 1, rotationDegrees: 45 },
      { x: 0, y: 0, width: 2, height: 2 },
    )).toBe('rgba(0, 0, 255, 1)')
  })
})
