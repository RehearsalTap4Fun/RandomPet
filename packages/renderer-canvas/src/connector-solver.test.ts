import { describe, expect, it } from 'vitest'
import type { ConnectorProfile, TransitionBridgeDefinition } from '@qmonster/generator-core'
import { solveConnector } from './connector-solver.js'

const hash = 'a'.repeat(64)

function profile(role: 'receiver' | 'plug'): ConnectorProfile {
  return {
    id: 'neck',
    role,
    connectorClass: 'neck',
    rigId: 'biped',
    origin: role === 'receiver' ? { x: 120, y: 80 } : { x: 0, y: 0 },
    tangent: { x: 1, y: 0 },
    outwardNormal: role === 'receiver' ? { x: 0, y: -1 } : { x: 0, y: 1 },
    width: 40,
    depth: 24,
    contourMaskPath: `${role}-contour.png`,
    contourMaskSha256: hash,
    foregroundMaskPath: `${role}-front.png`,
    foregroundMaskSha256: hash,
    backgroundMaskPath: `${role}-back.png`,
    backgroundMaskSha256: hash,
    materialSampleRegion: { x: 0, y: 0, width: 2, height: 2 },
    warpLimits: {
      widthRatio: { min: 0.8, max: 1.2 },
      depthRatio: { min: 0.8, max: 1.2 },
      rotationDegrees: { min: -15, max: 15 },
    },
  }
}

function bridge(): TransitionBridgeDefinition {
  return {
    id: 'biped_neck_bridge',
    rigId: 'biped',
    connectorClass: 'neck',
    materialFamilies: ['soft-skin'],
    neutralAssetPath: 'assets/v0.3.0/bridges/biped/neck.webp',
    neutralPngPath: 'assets/v0.3.0/bridges/biped/neck.png',
    neutralAssetSha256: hash,
    neutralPngSha256: hash,
    frontMaskPath: 'assets/v0.3.0/bridges/biped/neck-front.png',
    frontMaskSha256: hash,
    backMaskPath: 'assets/v0.3.0/bridges/biped/neck-back.png',
    backMaskSha256: hash,
  }
}

describe('solveConnector', () => {
  it('aligns plug origin and direction to the receiver without mutating profiles', () => {
    const receiver = profile('receiver')
    const plug = profile('plug')
    const originalReceiver = structuredClone(receiver)
    const originalPlug = structuredClone(plug)

    const result = solveConnector(receiver, plug, bridge())

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      childPlacement: { x: 120, y: 80, scaleX: 1, scaleY: 1 },
      widthRatio: 1,
      depthRatio: 1,
      rotationDegrees: 0,
    }))
    expect(receiver).toEqual(originalReceiver)
    expect(plug).toEqual(originalPlug)
  })

  it('rejects mismatched profiles and exceeded warp before producing placement', () => {
    const wrongRig = profile('plug')
    wrongRig.rigId = 'blob'
    expect(solveConnector(profile('receiver'), wrongRig, bridge())).toMatchObject({
      ok: false, code: 'CONNECTOR_PROFILE_INVALID',
    })

    const tooWide = profile('plug')
    tooWide.width = 80
    expect(solveConnector(profile('receiver'), tooWide, bridge())).toMatchObject({
      ok: false, code: 'CONNECTOR_WARP_EXCEEDED',
    })
  })

  it('rotates an in-range plug tangent onto the receiver direction', () => {
    const plug = profile('plug')
    const radians = 10 * Math.PI / 180
    plug.tangent = { x: Math.cos(radians), y: Math.sin(radians) }

    const result = solveConnector(profile('receiver'), plug, bridge())

    expect(result).toMatchObject({
      ok: true,
      rotationDegrees: 10,
      childPlacement: { rotationDegrees: -10 },
      plugTangent: { x: 1, y: 0 },
    })
  })
})
