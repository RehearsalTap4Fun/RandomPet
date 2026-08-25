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

  it('rejects non-finite solved connector geometry', () => {
    const invalid = solved()
    invalid.plugOrigin.x = Number.NaN
    expect(() => buildBridgeMesh(invalid)).toThrow('finite')
  })
})
