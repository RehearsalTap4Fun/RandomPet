import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { makeCompositionCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import { validateCatalogStructure } from '@qmonster/generator-core'
import type { Catalog } from '@qmonster/generator-core'
import { validateProductionMetadata } from '../packages/asset-catalog/src/production-validation.js'
import { buildInterfaceCatalog, validateInterfaceSourceIndex } from './build-interface-catalog.js'
import { interfaceVariantKey, structuralVariants } from './interface-source-schema.js'
import type { InterfaceSourceManifest } from './interface-source-schema.js'
import type { RetainedCoordinateMetadata } from './retain-v02-nonstructural-assets.js'

const hashFor = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('buildInterfaceCatalog', () => {
  it('preserves all v0.3 structural-union palette masks when catalog is rebuilt after color', async () => {
    const baseCatalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.2.0/catalog.json', 'utf8')) as Catalog
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as InterfaceSourceManifest
    const processed = JSON.parse(await readFile('asset-source/v0.3.0/production/processed-index.json', 'utf8')) as any
    const retainedMetadata = JSON.parse(await readFile('asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json', 'utf8')) as RetainedCoordinateMetadata
    const catalog = buildInterfaceCatalog({
      baseCatalog, manifest, processedAssets: processed.processedAssets, processedBridges: processed.processedBridges,
      retainedMetadata, sourceIndex: processed.sourceIndex,
    })
    for (const sourceId of ['color_deep_sea_coral', 'color_fungal_amber', 'color_shadow_violet']) {
      const part = catalog.parts.find(candidate => candidate.id === sourceId)!
      const audit = processed.sourceIndex.sources.find((candidate: any) => candidate.sourceId === sourceId).paletteMaskAudit
      expect(part.rigMaskPaths).toEqual(Object.fromEntries(Object.entries(audit.rigMasks).map(([rigId, value]: [string, any]) => [
        rigId,
        Object.fromEntries(Object.entries(value.paths).map(([role, path]) => [role, String(path).replaceAll('\\', '/').split('/assets/v0.3.0/')[1]])),
      ])))
      expect(part.rigMaskSha256).toEqual(Object.fromEntries(Object.entries(audit.rigMasks).map(([rigId, value]: [string, any]) => [rigId, value.sha256])))
    }
  })

  it('builds every non-none tail and extra identity for all rigs and preserves explicit none', async () => {
    const baseCatalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.2.0/catalog.json', 'utf8')) as Catalog
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as InterfaceSourceManifest
    const processed = JSON.parse(await readFile('asset-source/v0.3.0/production/processed-index.json', 'utf8')) as {
      processedAssets: Parameters<typeof buildInterfaceCatalog>[0]['processedAssets']
      processedBridges: Parameters<typeof buildInterfaceCatalog>[0]['processedBridges']
    }
    const retainedMetadata = JSON.parse(await readFile(
      'asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json', 'utf8',
    )) as RetainedCoordinateMetadata
    const catalog = buildInterfaceCatalog({
      baseCatalog,
      manifest,
      processedAssets: processed.processedAssets,
      processedBridges: processed.processedBridges,
      retainedMetadata,
    })
    const nonNoneVariants = (slotId: 'tail' | 'extraAppendage', rigId: 'blob' | 'biped' | 'floating') => (
      catalog.parts.filter(part => (
        part.slotId === slotId
        && part.composition?.mode === 'interface'
        && part.composition.isNone === false
        && part.composition.variantsByRig[rigId] !== undefined
      ))
    )

    for (const rigId of ['blob', 'biped', 'floating'] as const) {
      expect(nonNoneVariants('tail', rigId), `tail:${rigId}`).toHaveLength(3)
      expect(nonNoneVariants('extraAppendage', rigId), `extraAppendage:${rigId}`).toHaveLength(3)
    }
    for (const noneId of ['tail_none', 'extra_appendage_none']) {
      const none = catalog.parts.find(part => part.id === noneId)!
      expect(none.composition?.isNone).toBe(true)
      expect(none.composition?.mode).not.toBe('interface')
      if (none.composition?.mode === 'interface' || none.composition === undefined) throw new Error('expected resource-empty none')
      expect(none.composition.renderNodes).toEqual([])
      expect(none.assetPath).toBe('')
      expect(none.pngPath).toBeUndefined()
      expect(none.assetSha256).toBeUndefined()
      expect(none.pngSha256).toBeUndefined()
    }
    expect(Object.fromEntries(['tail_none', 'extra_appendage_none', 'effect_none'].map(id => [
      id,
      catalog.parts.find(part => part.id === id)?.baseWeight,
    ]))).toEqual({ tail_none: 1.8, extra_appendage_none: 1, effect_none: 0.1 })
    const eyes = catalog.parts.find(part => part.id === 'eyes_glossy_pair')!
    expect(eyes.composition?.mode).not.toBe('interface')
    if (eyes.composition?.mode === 'interface' || eyes.composition === undefined) throw new Error('expected attachment eyes')
    expect(eyes.composition.renderNodes).toHaveLength(3)
    expect(eyes.composition.renderNodes.map(node => node.compatibleRigs[0]).sort()).toEqual(['biped', 'blob', 'floating'])
    const body = catalog.parts.find(part => part.id === 'body_blob_round')!
    if (body.composition?.mode !== 'interface') throw new Error('expected interface body')
    expect(body.composition.variantsByRig.blob?.featureSockets).toMatchObject({
      overlay: retainedMetadata.bodyStructuralUnions.find(item => item.bodyId === 'body_blob_round')?.socket,
      effect: retainedMetadata.bodyStructuralUnions.find(item => item.bodyId === 'body_blob_round')?.socket,
    })
  })

  it('installs every arm and leg identity as an exact-rig variant', async () => {
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as {
      assets: Array<{
        id: string
        slotId: string
        variants: Array<{ rigId: 'blob' | 'biped' | 'floating' }>
      }>
    }
    const expected = {
      arms: ['arms_long_noodle', 'arms_paddle', 'arms_short_plush'],
      legs: ['legs_mushroom', 'legs_shadow_tiptoe', 'legs_stub_feet', 'legs_webbed'],
    } as const

    for (const rigId of ['blob', 'biped', 'floating'] as const) {
      for (const slotId of ['arms', 'legs'] as const) {
        const actual = manifest.assets
          .filter(asset => asset.slotId === slotId && asset.variants.some(variant => variant.rigId === rigId))
          .map(asset => asset.id)
          .sort()
        expect(actual, `${slotId}:${rigId}`).toEqual([...expected[slotId]])
      }
    }
  })

  it('contains five body variants and four head identities for every rig', async () => {
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as {
      assets: Array<{
        id: string
        slotId: string
        rigId?: 'blob' | 'biped' | 'floating'
        variants?: Array<{ rigId: 'blob' | 'biped' | 'floating' }>
      }>
    }
    const structuralVariants = manifest.assets.flatMap(asset => (
      asset.variants?.map(variant => ({ partId: asset.id, slotId: asset.slotId, rigId: variant.rigId }))
      ?? (asset.rigId === undefined ? [] : [{ partId: asset.id, slotId: asset.slotId, rigId: asset.rigId }])
    ))

    expect(structuralVariants.filter(item => item.slotId === 'bodyFrame')).toHaveLength(5)
    for (const rigId of ['blob', 'biped', 'floating'] as const) {
      expect(structuralVariants
        .filter(item => item.slotId === 'headShape' && item.rigId === rigId)
        .map(item => item.partId)
        .sort()).toEqual([
        'head_angler_bulb', 'head_mushroom_cap', 'head_round_dome', 'head_shadow_hood',
      ])
    }
  })

  it('builds every exact-rig structural variant and five bridge classes from processed hashes', async () => {
    const base = makeCompositionCatalogFixture()
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as InterfaceSourceManifest
    const variants = structuralVariants(manifest)
    for (const asset of manifest.assets) {
      if (base.parts.some(part => part.id === asset.id)) continue
      const template = base.parts.find(part => part.slotId === asset.slotId)!
      base.parts.push({ ...structuredClone(template), id: asset.id })
    }
    const processed = Object.fromEntries(variants.map(asset => [interfaceVariantKey(asset.partId, asset.rigId), {
      pngPath: `assets/v0.3.0/parts/${asset.rigId}/${asset.partId}.png`, pngSha256: hashFor(`${asset.partId}:${asset.rigId}:png`),
      webpPath: `assets/v0.3.0/parts/${asset.rigId}/${asset.partId}.webp`, webpSha256: hashFor(`${asset.partId}:${asset.rigId}:webp`),
      renderNodes: Object.fromEntries(asset.renderNodes.map(node => [node.id, {
        pngPath: `assets/v0.3.0/nodes/${asset.rigId}/${asset.partId}/${node.id}.png`, pngSha256: hashFor(`${asset.partId}:${asset.rigId}:${node.id}:png`),
        webpPath: `assets/v0.3.0/nodes/${asset.rigId}/${asset.partId}/${node.id}.webp`, webpSha256: hashFor(`${asset.partId}:${asset.rigId}:${node.id}:webp`),
      }])),
      connectorHashes: Object.fromEntries(asset.connectors.map(connector => [connector.id, {
        contourMaskSha256: hashFor(`${asset.partId}:${asset.rigId}:${connector.id}:contour`),
        foregroundMaskSha256: hashFor(`${asset.partId}:${asset.rigId}:${connector.id}:foreground`),
        backgroundMaskSha256: hashFor(`${asset.partId}:${asset.rigId}:${connector.id}:background`),
      }])),
    }]))
    const bridges = Object.fromEntries(manifest.bridges.map(bridge => [`${bridge.rigId}:${bridge.connectorClass}`, {
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
    const transformedSource = variants.find(item => item.partId === 'legs_stub_feet' && item.rigId === 'biped')!
    transformedSource.renderNodes[0]!.transform = { scale: 0.92, mirrorX: false }

    const catalog = buildInterfaceCatalog({ baseCatalog: base, manifest, processedAssets: processed, processedBridges: bridges })

    expect(catalog.version).toBe('0.3.0')
    expect(catalog.parts.filter(part => ['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'].includes(part.slotId) && part.composition?.isNone === false).map(part => part.id)).toEqual(manifest.assets.map(asset => asset.id))
    expect(catalog.parts.find(part => part.id === 'head_round_dome')?.composition?.mode).toBe('interface')
    expect(catalog.transitionBridges?.map(bridge => `${bridge.rigId}:${bridge.connectorClass}`)).toEqual([
      'biped:neck', 'biped:shoulder', 'biped:hip',
      'blob:neck', 'blob:shoulder', 'blob:hip',
      'floating:neck', 'floating:shoulder', 'floating:hip',
      'blob:tail', 'blob:extra',
      'biped:tail', 'biped:extra',
      'floating:tail', 'floating:extra',
    ])
    const arms = catalog.parts.find(part => part.id === 'arms_short_plush')!
    expect(arms.composition?.mode).toBe('interface')
    if (arms.composition?.mode !== 'interface') throw new Error('expected interface composition')
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.connectorId)).toEqual(['shoulderLeft', 'shoulderRight'])
    expect(arms.composition.variantsByRig.biped?.renderNodes.map(node => node.assetPath)).toEqual([
      'assets/v0.3.0/nodes/biped/arms_short_plush/arms_short_plush-shoulderLeft.webp',
      'assets/v0.3.0/nodes/biped/arms_short_plush/arms_short_plush-shoulderRight.webp',
    ])
    const transformedPart = catalog.parts.find(part => part.id === 'legs_stub_feet')!
    if (transformedPart.composition?.mode !== 'interface') throw new Error('expected interface composition')
    expect(transformedPart.composition.variantsByRig.biped?.renderNodes[0]?.transform).toEqual({ scale: 0.92, mirrorX: false })
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
    const paired = Object.values(duplicateProcessed['arms_short_plush:biped'].renderNodes) as any[]
    paired[1].pngPath = paired[0].pngPath
    paired[1].pngSha256 = paired[0].pngSha256
    expect(() => buildInterfaceCatalog({ baseCatalog: base, manifest, processedAssets: duplicateProcessed, processedBridges: bridges }))
      .toThrow('canonical distinct paths and hashes')
  })

  it('maps only the re-authored connection-aware round head after retiring the flawed source', async () => {
    const catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8')) as Catalog
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as InterfaceSourceManifest
    const partMappingFields = ['suggestedParts', 'effectPartIds', 'sourcePartIds', 'assetIds']
    const mappedPartIds = catalog.semanticTraits.flatMap(trait => partMappingFields.flatMap(field => {
      const value = trait.visualMapping?.[field]
      return Array.isArray(value) ? value : []
    }))

    const roundVariants = structuralVariants(manifest).filter(item => item.partId === 'head_round_dome')
    expect(mappedPartIds).toContain('head_round_dome')
    expect(roundVariants.map(item => item.rigId).sort()).toEqual(['biped', 'blob', 'floating'])
    expect(roundVariants.every(item => (
      item.promptEvidence.promptId === 'task7-head-natural-neck-rework'
      && item.sourcePngPath.includes('/structural/')
      && !item.sourcePngPath.includes('/retired/')
    ))).toBe(true)
    expect(validateProductionMetadata(catalog).filter(diagnostic => (
      diagnostic.code === 'PRODUCTION_DANGLING_VISUAL_MAPPING'
      && diagnostic.message.includes('head_round_dome')
    ))).toEqual([])
  })

  it('requires exact source-index coverage for every master node and bridge source PNG', async () => {
    const manifest = JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8')) as InterfaceSourceManifest
    const variants = structuralVariants(manifest)
    const sources = [
      ...variants.map(asset => ({
        sourceId: interfaceVariantKey(asset.partId, asset.rigId),
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
