import { describe, expect, it } from 'vitest'
import { parseInterfaceSourceManifest } from './interface-source-schema.js'

const hash = 'a'.repeat(64)

export function makeValidInterfaceSourceManifest(): any {
  const assets = [
    ['body_biped_peanut', 'bodyFrame'],
    ['body_biped_tall', 'bodyFrame'],
    ['head_round_dome', 'headShape'],
    ['head_mushroom_cap', 'headShape'],
    ['arms_short_plush', 'arms'],
    ['arms_long_noodle', 'arms'],
    ['legs_webbed', 'legs'],
    ['legs_mushroom', 'legs'],
  ].map(([id, slotId]) => ({
    id,
    slotId,
    rigId: 'biped',
    materialFamily: id.includes('mushroom') ? 'mushroom-velvet' : 'short-fur',
    sourcePngPath: `asset-source/v0.3.0/production/${id}.png`,
    promptEvidence: {
      promptId: id,
      promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
      promptSha256: hash,
      reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
    },
    connectors: slotId === 'bodyFrame'
      ? ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight'].map(connector => profile(id, connector, 'receiver'))
      : (slotId === 'headShape' ? ['neck'] : slotId === 'arms' ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight'])
        .map(connector => profile(id, connector, 'plug')),
    renderNodes: slotId === 'bodyFrame'
      ? [{ id: `${id}-body`, sourcePngPath: `asset-source/v0.3.0/production/${id}.png` }]
      : (slotId === 'headShape' ? ['neck'] : slotId === 'arms' ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight'])
        .map(connectorId => ({ id: `${id}-${connectorId}`, connectorId, sourcePngPath: `asset-source/v0.3.0/production/nodes/${id}/${connectorId}.png` })),
  }))
  return {
    schemaVersion: 'interface-source-v1',
    catalogVersion: '0.3.0',
    rigId: 'biped',
    canvasSize: 2048,
    assets,
    bridges: ['neck', 'shoulder', 'hip'].map(connectorClass => ({
      id: `biped-${connectorClass}-bridge`,
      rigId: 'biped',
      connectorClass,
      materialFamilies: ['short-fur', 'mushroom-velvet'],
      sourcePngPath: `asset-source/v0.3.0/production/bridges/${connectorClass}.png`,
      neutralPngPath: `assets/v0.3.0/bridges/biped/${connectorClass}.png`,
      neutralWebpPath: `assets/v0.3.0/bridges/biped/${connectorClass}.webp`,
      frontMaskPath: `assets/v0.3.0/bridges/biped/${connectorClass}-front.png`,
      backMaskPath: `assets/v0.3.0/bridges/biped/${connectorClass}-back.png`,
      promptEvidence: {
        promptId: `bridge-${connectorClass}`,
        promptPath: 'asset-source/v0.3.0/prompts/structural-prompts.json',
        promptSha256: hash,
        reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/review-record.json',
      },
    })),
  }
}

function profile(assetId: string, id: string, role: 'receiver' | 'plug'): any {
  const connectorClass = id.startsWith('shoulder') ? 'shoulder' : id.startsWith('hip') ? 'hip' : 'neck'
  return {
    id,
    role,
    connectorClass,
    origin: { x: 1024, y: 1024 },
    tangent: { x: 1, y: 0 },
    outwardNormal: { x: 0, y: role === 'receiver' ? -1 : 1 },
    width: 256,
    depth: 128,
    contourMaskPath: `assets/v0.3.0/connectors/biped/${assetId}-${id}-contour.png`,
    foregroundMaskPath: `assets/v0.3.0/connectors/biped/${assetId}-${id}-foreground.png`,
    backgroundMaskPath: `assets/v0.3.0/connectors/biped/${assetId}-${id}-background.png`,
    materialSampleRegion: { x: 896, y: 896, width: 256, height: 256 },
    warpLimits: {
      widthRatio: { min: 0.85, max: 1.15 },
      depthRatio: { min: 0.8, max: 1.2 },
      rotationDegrees: { min: -12, max: 12 },
    },
  }
}

describe('parseInterfaceSourceManifest', () => {
  it('requires exact biped slice assets, connector masks, and three bridge classes', () => {
    expect(parseInterfaceSourceManifest(makeValidInterfaceSourceManifest()).ok).toBe(true)
    const invalid = makeValidInterfaceSourceManifest()
    delete invalid.bridges.find((item: any) => item.connectorClass === 'neck')!.frontMaskPath
    expect(parseInterfaceSourceManifest(invalid).ok).toBe(false)
  })

  it('rejects a missing slice asset and a plug without a one-to-one render node', () => {
    const missing = makeValidInterfaceSourceManifest()
    missing.assets = missing.assets.filter((item: any) => item.id !== 'legs_mushroom')
    expect(parseInterfaceSourceManifest(missing).ok).toBe(false)

    const duplicate = makeValidInterfaceSourceManifest()
    const arms = duplicate.assets.find((item: any) => item.id === 'arms_short_plush')
    arms.renderNodes[1].connectorId = 'shoulderLeft'
    expect(parseInterfaceSourceManifest(duplicate).ok).toBe(false)
  })

  it('rejects zero-length connector tangent and normal vectors', () => {
    const invalid = makeValidInterfaceSourceManifest()
    invalid.assets[0].connectors[0].tangent = { x: 0, y: 0 }
    invalid.assets[0].connectors[0].outwardNormal = { x: 0, y: 0 }
    expect(parseInterfaceSourceManifest(invalid).ok).toBe(false)
  })

  it('rejects duplicate render node IDs and paired source paths', () => {
    const invalid = makeValidInterfaceSourceManifest()
    const arms = invalid.assets.find((item: any) => item.id === 'arms_short_plush')
    arms.renderNodes[1].id = arms.renderNodes[0].id
    arms.renderNodes[1].sourcePngPath = arms.renderNodes[0].sourcePngPath
    expect(parseInterfaceSourceManifest(invalid).ok).toBe(false)
  })

  it('rejects duplicate bridge IDs and noncanonical runtime paths', () => {
    const duplicate = makeValidInterfaceSourceManifest()
    duplicate.bridges[1].id = duplicate.bridges[0].id
    expect(parseInterfaceSourceManifest(duplicate).ok).toBe(false)

    for (const path of [
      'assets/v0.3.0/bridges/biped/../neck.png',
      'assets\\v0.3.0\\bridges\\biped\\neck.png',
      'assets/v0.3.0/bridges//biped/neck.png',
      'assets/v0.3.0/bridges/biped/neck?draft.png',
    ]) {
      const invalid = makeValidInterfaceSourceManifest()
      invalid.bridges[0].neutralPngPath = path
      expect(parseInterfaceSourceManifest(invalid).ok).toBe(false)
    }
  })
})
