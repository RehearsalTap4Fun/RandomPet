import { describe, expect, it } from 'vitest'
import { partitionSeamAlpha } from './seam-mask.js'

function alpha(...values: number[]) {
  const pixels = new Uint8ClampedArray(values.length * 4)
  values.forEach((value, index) => { pixels[index * 4 + 3] = value })
  return pixels
}

describe('partitionSeamAlpha', () => {
  it('changes asymmetric foreground and background seam pixels independently', () => {
    const bridge = alpha(255, 255, 255, 255)
    const transition = alpha(255, 255, 255, 255)

    const left = partitionSeamAlpha(bridge, transition, alpha(255, 255, 0, 0), alpha(0, 0, 0, 0))
    const right = partitionSeamAlpha(bridge, transition, alpha(0, 0, 0, 0), alpha(0, 0, 255, 255))

    expect(Array.from(left.filter((_, offset) => offset % 4 === 3))).toEqual([255, 255, 0, 0])
    expect(Array.from(right.filter((_, offset) => offset % 4 === 3))).toEqual([0, 0, 255, 255])
  })
})
