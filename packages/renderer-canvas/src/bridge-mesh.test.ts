import { describe, expect, it } from 'vitest'
import { buildBridgeMesh } from './bridge-mesh.js'
import type { SolvedConnector } from './connector-solver.js'

function solved(): SolvedConnector {
  return {
    ok: true,
    connectorId: 'neck',
    bridgeId: 'biped_neck_bridge',
    childPlacement: { x: 120, y: 80, scaleX: 1, scaleY: 1 },
    receiverOrigin: { x: 120, y: 80 },
    plugOrigin: { x: 120, y: 104 },
    receiverTangent: { x: 1, y: 0 },
    plugTangent: { x: 1, y: 0 },
    receiverNormal: { x: 0, y: 1 },
    plugNormal: { x: 0, y: -1 },
    receiverWidth: 40,
    plugWidth: 20,
    receiverDepth: 24,
    plugDepth: 24,
    widthRatio: 0.5,
    depthRatio: 1,
    rotationDegrees: 0,
  }
}

describe('buildBridgeMesh', () => {
  it('builds a bounded four-by-four bridge mesh with both end rows fixed', () => {
    const mesh = buildBridgeMesh(solved())

    expect(mesh.rows).toHaveLength(4)
    expect(mesh.rows.every(row => row.length === 4)).toBe(true)
    expect(mesh.rows[0]).toEqual([
      { x: 100, y: 80 }, { x: 113.33333333333333, y: 80 },
      { x: 126.66666666666666, y: 80 }, { x: 140, y: 80 },
    ])
    expect(mesh.rows[3]).toEqual([
      { x: 110, y: 104 }, { x: 116.66666666666667, y: 104 },
      { x: 123.33333333333333, y: 104 }, { x: 130, y: 104 },
    ])
    expect(mesh.triangles).toHaveLength(18)
  })

  it('fixes asymmetric bridge endpoints to the declared raster contour frontiers', () => {
    const pixels = (points: readonly (readonly [number, number])[]) => {
      const value = new Uint8ClampedArray(16 * 16 * 4)
      for (const [x, y] of points) value[(y * 16 + x) * 4 + 3] = 255
      return value
    }
    const receiverContour = {
      pixels: pixels([[2, 3], [8, 3], [3, 4], [7, 4]]), width: 16, height: 16,
    }
    const plugContour = {
      pixels: pixels([[4, 12], [11, 12], [5, 13], [10, 13]]), width: 16, height: 16,
    }

    const mesh = buildBridgeMesh(solved(), { receiver: receiverContour, plug: plugContour })

    expect(mesh.rows[0]![0]).toEqual({ x: 3.5, y: 4 })
    expect(mesh.rows[0]![3]).toEqual({ x: 7.5, y: 4 })
    expect(mesh.rows[3]![0]).toEqual({ x: 4.5, y: 13 })
    expect(mesh.rows[3]![3]).toEqual({ x: 11.5, y: 13 })
  })

  it('rejects non-finite solved connector geometry', () => {
    const invalid = solved()
    invalid.plugOrigin.x = Number.NaN
    expect(() => buildBridgeMesh(invalid)).toThrow('finite')
  })
})
