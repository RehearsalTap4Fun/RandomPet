import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { makeValidCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { buildInterfaceCatalog, validateInterfaceSourceIndex } from './build-interface-catalog.js'

const hash = 'a'.repeat(64)

describe('buildInterfaceCatalog', () => {
  it('builds the exact biped structural slice and three bridge classes from processed hashes', async () => {
    const base = makeValidCatalogFixture()
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
    for (const asset of manifest.assets) {
      if (base.parts.some(part => part.id === asset.id)) continue
      const template = base.parts.find(part => part.slotId === asset.slotId)!
      base.parts.push({ ...structuredClone(template), id: asset.id })
    }
    const processed = Object.fromEntries(manifest.assets.map((asset: any) => [asset.id, {
      pngPath: `parts/${asset.id}.png`, pngSha256: hash,
      webpPath: `parts/${asset.id}.webp`, webpSha256: hash,
      renderNodes: Object.fromEntries(asset.renderNodes.map((node: any) => [node.id, {
        pngPath: `nodes/${asset.id}/${node.id}.png`, pngSha256: hash,
        webpPath: `nodes/${asset.id}/${node.id}.webp`, webpSha256: hash,
      }])),
      connectorHashes: Object.fromEntries(asset.connectors.map((connector: any) => [connector.id, {
        contourMaskSha256: hash, foregroundMaskSha256: hash, backgroundMaskSha256: hash,
      }])),
    }]))
    const bridges = Object.fromEntries(manifest.bridges.map((bridge: any) => [bridge.connectorClass, {
      neutralPngSha256: hash, neutralWebpSha256: hash, frontMaskSha256: hash, backMaskSha256: hash,
    }]))

    const catalog = buildInterfaceCatalog({ baseCatalog: base, manifest, processedAssets: processed, processedBridges: bridges })

    expect(catalog.version).toBe('0.3.0')
    expect(catalog.parts.filter(part => ['bodyFrame', 'headShape', 'arms', 'legs'].includes(part.slotId)).map(part => part.id)).toEqual([
      'body_biped_peanut', 'body_biped_tall', 'head_round_dome', 'head_mushroom_cap',
      'arms_short_plush', 'arms_long_noodle', 'legs_webbed', 'legs_mushroom',
    ])
    expect(catalog.transitionBridges?.map(bridge => bridge.connectorClass)).toEqual(['neck', 'shoulder', 'hip'])
    const arms = catalog.parts.find(part => part.id === 'arms_short_plush')!
    expect(arms.composition?.mode).toBe('interface')
    if (arms.composition?.mode !== 'interface') throw new Error('expected interface composition')
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.connectorId)).toEqual(['shoulderLeft', 'shoulderRight'])
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.assetPath)).toEqual([
      'nodes/arms_short_plush/arms_short_plush-shoulderLeft.webp',
      'nodes/arms_short_plush/arms_short_plush-shoulderRight.webp',
    ])
  })

  it('requires exact source-index coverage for every master node and bridge source PNG', async () => {
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
    const sources = [
      ...manifest.assets.map((asset: any) => ({
        sourceId: asset.id,
        kind: 'interface-structural',
        promptId: asset.promptEvidence.promptId,
        promptPath: asset.promptEvidence.promptPath,
        promptSha256: asset.promptEvidence.promptSha256,
        reviewRecordPath: asset.promptEvidence.reviewRecordPath,
        sourceResources: [...new Set([asset.sourcePngPath, ...asset.renderNodes.map((node: any) => node.sourcePngPath)])]
          .map(path => ({ path, sha256: hash })),
      })),
      ...manifest.bridges.map((bridge: any) => ({
        sourceId: bridge.id,
        kind: 'interface-bridge',
        promptId: bridge.promptEvidence.promptId,
        promptPath: bridge.promptEvidence.promptPath,
        promptSha256: bridge.promptEvidence.promptSha256,
        reviewRecordPath: bridge.promptEvidence.reviewRecordPath,
        sourceResources: [{ path: bridge.sourcePngPath, sha256: hash }],
      })),
    ]
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources })).not.toThrow()
    sources[0].sourceResources.pop()
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources }))
      .toThrow('INTERFACE_SOURCE_INDEX_INVALID')
  })
})
