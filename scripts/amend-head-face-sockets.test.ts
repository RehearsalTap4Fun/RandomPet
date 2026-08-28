import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  amendHeadFaceSockets,
  HEAD_FACE_SAFE_ZONE_TOP_INSET_PX,
  HEAD_FACE_VERTICAL_GAP_PX,
} from './amend-head-face-sockets.js'

describe('Task 10 head face-socket amendment', () => {
  it('places all 12 eyes at least 80px inside the safe-zone then keeps mouths 120px below', async () => {
    expect(HEAD_FACE_SAFE_ZONE_TOP_INSET_PX).toBe(80)
    expect(HEAD_FACE_VERTICAL_GAP_PX).toBe(120)
    const source = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
    const sourceBefore = structuredClone(source)
    const expectedSockets: Record<string, readonly [number, number]> = {
      'head_mushroom_cap:biped': [1160, 1280],
      'head_mushroom_cap:blob': [1100, 1220],
      'head_mushroom_cap:floating': [1130, 1250],
      'head_round_dome:biped': [1130, 1250],
      'head_round_dome:blob': [1100, 1220],
      'head_round_dome:floating': [1130, 1250],
      'head_angler_bulb:biped': [1160, 1280],
      'head_angler_bulb:blob': [1144, 1264],
      'head_angler_bulb:floating': [1160, 1280],
      'head_shadow_hood:biped': [1130, 1250],
      'head_shadow_hood:blob': [1100, 1220],
      'head_shadow_hood:floating': [1130, 1250],
    }

    const amended = amendHeadFaceSockets(source)
    const amendedHeads = amended.assets
      .filter((asset: any) => asset.slotId === 'headShape')
    expect(amendedHeads.flatMap((asset: any) => asset.variants)).toHaveLength(12)
    for (const asset of amendedHeads) {
      for (const variant of asset.variants) {
        const key = `${asset.id}:${variant.rigId}`
        expect([
          variant.featureSockets.eyes.y,
          variant.featureSockets.mouth.y,
        ]).toEqual(expectedSockets[key])
        expect(variant.featureSockets.eyes.y - variant.faceSafeZones[0].y)
          .toBeGreaterThanOrEqual(HEAD_FACE_SAFE_ZONE_TOP_INSET_PX)
        expect(variant.featureSockets.mouth.y - variant.featureSockets.eyes.y)
          .toBeGreaterThanOrEqual(HEAD_FACE_VERTICAL_GAP_PX)
      }
    }
    const stripFaceY = (value: any) => {
      const clone = structuredClone(value)
      for (const asset of clone.assets.filter((item: any) => item.slotId === 'headShape')) {
        for (const variant of asset.variants) {
          variant.featureSockets.eyes.y = 0
          variant.featureSockets.mouth.y = 0
        }
      }
      return clone
    }
    expect(stripFaceY(amended)).toEqual(stripFaceY(sourceBefore))
    expect(source).toEqual(sourceBefore)
    expect(amended).not.toBe(source)
    expect(amendHeadFaceSockets(amended)).toEqual(amended)
  })
})
