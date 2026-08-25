import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { makeCompositionCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { validateCatalogStructure } from '@qmonster/generator-core'
import type { Catalog } from '@qmonster/generator-core'
import { validateProductionMetadata } from '../packages/asset-catalog/src/production-validation.js'
import { buildInterfaceCatalog, validateInterfaceSourceIndex } from './build-interface-catalog.js'

const hashFor = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('buildInterfaceCatalog', () => {
  it('builds the exact biped structural slice and three bridge classes from processed hashes', async () => {
    const base = makeCompositionCatalogFixture()
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
    for (const asset of manifest.assets) {
      if (base.parts.some(part => part.id === asset.id)) continue
      const template = base.parts.find(part => part.slotId === asset.slotId)!
      base.parts.push({ ...structuredClone(template), id: asset.id })
    }
    const processed = Object.fromEntries(manifest.assets.map((asset: any) => [asset.id, {
      pngPath: `assets/v0.3.0/parts/${asset.id}.png`, pngSha256: hashFor(`${asset.id}:png`),
      webpPath: `assets/v0.3.0/parts/${asset.id}.webp`, webpSha256: hashFor(`${asset.id}:webp`),
      renderNodes: Object.fromEntries(asset.renderNodes.map((node: any) => [node.id, {
        pngPath: `assets/v0.3.0/nodes/${asset.id}/${node.id}.png`, pngSha256: hashFor(`${asset.id}:${node.id}:png`),
        webpPath: `assets/v0.3.0/nodes/${asset.id}/${node.id}.webp`, webpSha256: hashFor(`${asset.id}:${node.id}:webp`),
      }])),
      connectorHashes: Object.fromEntries(asset.connectors.map((connector: any) => [connector.id, {
        contourMaskSha256: hashFor(`${asset.id}:${connector.id}:contour`),
        foregroundMaskSha256: hashFor(`${asset.id}:${connector.id}:foreground`),
        backgroundMaskSha256: hashFor(`${asset.id}:${connector.id}:background`),
      }])),
    }]))
    const bridges = Object.fromEntries(manifest.bridges.map((bridge: any) => [bridge.connectorClass, {
      neutralPngSha256: hashFor(`${bridge.id}:png`), neutralWebpSha256: hashFor(`${bridge.id}:webp`),
      frontMaskSha256: hashFor(`${bridge.id}:front`), backMaskSha256: hashFor(`${bridge.id}:back`),
    }]))
    const retainedPartId = base.parts.find(part => part.slotId === 'eyes')!.id
    const removedPartId = base.parts.find(part => (
      ['bodyFrame', 'headShape', 'arms', 'legs'].includes(part.slotId)
      && !manifest.assets.some((asset: any) => asset.id === part.id)
    ))!.id
    const semanticExclude = base.semanticTraits[1]!.id
    const modifierExclude = base.modifiers[1]!.id
    base.semanticTraits[0]!.boosts = { [retainedPartId]: 2, [removedPartId]: 3 }
    base.semanticTraits[0]!.excludes = [semanticExclude]
    base.semanticTraits[0]!.visualMapping = {
      sourcePartIds: [retainedPartId, removedPartId],
      suggestedParts: [removedPartId, retainedPartId],
      effectPartIds: [retainedPartId, removedPartId],
      assetIds: [removedPartId, retainedPartId],
      sourceSlots: ['eyes'],
      mood: 'curious',
    }
    base.modifiers[0]!.boosts = { [retainedPartId]: 4, [removedPartId]: 5 }
    base.modifiers[0]!.excludes = [modifierExclude]

    const catalog = buildInterfaceCatalog({ baseCatalog: base, manifest, processedAssets: processed, processedBridges: bridges })

    expect(catalog.version).toBe('0.3.0')
    expect(catalog.parts.filter(part => ['bodyFrame', 'headShape', 'arms', 'legs'].includes(part.slotId)).map(part => part.id)).toEqual([
      'body_biped_peanut', 'body_biped_tall', 'head_mushroom_cap',
      'arms_short_plush', 'arms_long_noodle', 'legs_webbed', 'legs_mushroom',
    ])
    expect(catalog.parts.find(part => part.id === 'head_round_dome')).toBeUndefined()
    expect(catalog.transitionBridges?.map(bridge => bridge.connectorClass)).toEqual(['neck', 'shoulder', 'hip'])
    const arms = catalog.parts.find(part => part.id === 'arms_short_plush')!
    expect(arms.composition?.mode).toBe('interface')
    if (arms.composition?.mode !== 'interface') throw new Error('expected interface composition')
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.connectorId)).toEqual(['shoulderLeft', 'shoulderRight'])
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.assetPath)).toEqual([
      'assets/v0.3.0/nodes/arms_short_plush/arms_short_plush-shoulderLeft.webp',
      'assets/v0.3.0/nodes/arms_short_plush/arms_short_plush-shoulderRight.webp',
    ])
    expect(catalog.semanticTraits[0]?.boosts).toEqual({ [retainedPartId]: 2 })
    expect(catalog.semanticTraits[0]?.excludes).toEqual([semanticExclude])
    expect(catalog.semanticTraits[0]?.visualMapping).toEqual({
      sourcePartIds: [retainedPartId],
      suggestedParts: [retainedPartId],
      effectPartIds: [retainedPartId],
      assetIds: [retainedPartId],
      sourceSlots: ['eyes'],
      mood: 'curious',
    })
    expect(catalog.modifiers[0]?.boosts).toEqual({ [retainedPartId]: 4 })
    expect(catalog.modifiers[0]?.excludes).toEqual([modifierExclude])
    expect(validateCatalogStructure(catalog)).toEqual([])

    const duplicateProcessed = structuredClone(processed)
    const paired = Object.values(duplicateProcessed.arms_short_plush.renderNodes) as any[]
    paired[1].pngPath = paired[0].pngPath
    paired[1].pngSha256 = paired[0].pngSha256
    expect(() => buildInterfaceCatalog({ baseCatalog: base, manifest, processedAssets: duplicateProcessed, processedBridges: bridges }))
      .toThrow('canonical distinct paths and hashes')
  })

  it('keeps retired structural IDs out of the real generated semantic mappings', async () => {
    const catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8')) as Catalog
    const partMappingFields = ['suggestedParts', 'effectPartIds', 'sourcePartIds', 'assetIds']
    const mappedPartIds = catalog.semanticTraits.flatMap(trait => partMappingFields.flatMap(field => {
      const value = trait.visualMapping?.[field]
      return Array.isArray(value) ? value : []
    }))

    expect(mappedPartIds).not.toContain('head_round_dome')
    expect(validateProductionMetadata(catalog).filter(diagnostic => (
      diagnostic.code === 'PRODUCTION_DANGLING_VISUAL_MAPPING'
      && diagnostic.message.includes('head_round_dome')
    ))).toEqual([])
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
        reviewRecordSha256: hashFor('review'),
        sourceResources: [...new Set([asset.sourcePngPath, ...asset.renderNodes.map((node: any) => node.sourcePngPath)])]
          .map(path => ({ path, sha256: hashFor(path) })),
      })),
      ...manifest.bridges.map((bridge: any) => ({
        sourceId: bridge.id,
        kind: 'interface-bridge',
        promptId: bridge.promptEvidence.promptId,
        promptPath: bridge.promptEvidence.promptPath,
        promptSha256: bridge.promptEvidence.promptSha256,
        reviewRecordPath: bridge.promptEvidence.reviewRecordPath,
        reviewRecordSha256: hashFor('review'),
        sourceResources: [{ path: bridge.sourcePngPath, sha256: hashFor(bridge.sourcePngPath) }],
      })),
    ]
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources })).not.toThrow()
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources: [...sources, structuredClone(sources[0])] }))
      .toThrow('duplicate:')
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources: [...sources, { ...structuredClone(sources[0]), sourceId: 'unexpected-interface' }] }))
      .toThrow('extra:')
    sources[0].sourceResources.pop()
    expect(() => validateInterfaceSourceIndex(manifest, { catalogVersion: '0.3.0', sources }))
      .toThrow('INTERFACE_SOURCE_INDEX_INVALID')
  })
})
