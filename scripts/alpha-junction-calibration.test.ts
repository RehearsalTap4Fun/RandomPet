import { describe, expect, it } from 'vitest'

interface FixtureMask {
  width: number
  height: number
  alpha: Uint8Array
  bounds: { x: number; y: number; width: number; height: number }
}

function maskFromRows(rows: readonly string[]): FixtureMask {
  const height = rows.length
  const width = rows[0]!.length
  const alpha = new Uint8Array(width * height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    expect(rows[y]).toHaveLength(width)
    for (let x = 0; x < width; x += 1) {
      if (rows[y]![x] !== '#') continue
      alpha[y * width + x] = 255
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    width,
    height,
    alpha,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

describe('alpha junction calibration', () => {
  it('moves a body head socket when the fixture opaque top contour moves', async () => {
    const modulePath = './alpha-junction-calibration.js'
    const calibration = await import(modulePath).catch(() => null) as null | {
      calibrateBodySocket: (
        mask: FixtureMask,
        input: { socket: 'head'; insetPx: number },
      ) => { x: number; y: number }
    }
    expect(calibration, 'alpha-junction-calibration module must provide the catalog geometry behavior').not.toBeNull()
    if (calibration === null) return

    const high = maskFromRows([
      '.........',
      '..#####..',
      '..#####..',
      '..#####..',
      '..#####..',
      '.........',
    ])
    const low = maskFromRows([
      '.........',
      '.........',
      '.........',
      '..#####..',
      '..#####..',
      '.........',
    ])

    expect(calibration.calibrateBodySocket(high, { socket: 'head', insetPx: 1 })).toEqual({ x: 4, y: 2 })
    expect(calibration.calibrateBodySocket(low, { socket: 'head', insetPx: 1 })).toEqual({ x: 4, y: 4 })
  })
})
