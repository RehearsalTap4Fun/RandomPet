import type {
  Catalog,
  ConnectorProfile,
  InterfacePartComposition,
  RenderNodeDefinition,
  TransitionBridgeDefinition,
  VisualPartDefinition,
} from '@qmonster/generator-core'
import type { InterfaceSourceManifest } from './interface-source-schema.js'

export interface ProcessedInterfaceAsset {
  pngPath: string
  pngSha256: string
  webpPath: string
  webpSha256: string
  renderNodes: Record<string, {
    pngPath: string
    pngSha256: string
    webpPath: string
    webpSha256: string
  }>
  connectorHashes: Record<string, {
    contourMaskSha256: string
    foregroundMaskSha256: string
    backgroundMaskSha256: string
  }>
}

export interface ProcessedInterfaceBridge {
  neutralPngSha256: string
  neutralWebpSha256: string
  frontMaskSha256: string
  backMaskSha256: string
}

const structuralSlots = new Set(['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'])
const sha256 = /^[a-f0-9]{64}$/u

export function validateInterfaceSourceIndex(manifest: InterfaceSourceManifest, sourceIndex: unknown): void {
  const index = sourceIndex !== null && typeof sourceIndex === 'object' && !Array.isArray(sourceIndex)
    ? sourceIndex as Record<string, unknown>
    : {}
  const sources = Array.isArray(index.sources) ? index.sources : []
  const indexed = new Map<string, Record<string, any>>()
  for (const value of sources) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const source = value as Record<string, any>
    if (typeof source.sourceId !== 'string' || indexed.has(source.sourceId)) continue
    indexed.set(source.sourceId, source)
  }
  const expected = [
    ...manifest.assets.map(asset => ({
      sourceId: asset.id,
      kind: 'interface-structural',
      evidence: asset.promptEvidence,
      paths: [...new Set([asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)])],
    })),
    ...manifest.bridges.map(bridge => ({
      sourceId: bridge.id,
      kind: 'interface-bridge',
      evidence: bridge.promptEvidence,
      paths: [bridge.sourcePngPath],
    })),
  ]
  const invalid: string[] = []
  if (index.catalogVersion !== manifest.catalogVersion) invalid.push('catalogVersion')
  for (const item of expected) {
    const source = indexed.get(item.sourceId)
    const resources = Array.isArray(source?.sourceResources) ? source.sourceResources : []
    const byPath = new Map(resources.flatMap((resource: unknown) => (
      resource !== null && typeof resource === 'object' && !Array.isArray(resource)
        && typeof (resource as Record<string, unknown>).path === 'string'
        ? [[(resource as Record<string, any>).path, (resource as Record<string, any>).sha256] as const]
        : []
    )))
    if (
      source === undefined
      || source.kind !== item.kind
      || source.promptId !== item.evidence.promptId
      || source.promptPath !== item.evidence.promptPath
      || source.promptSha256 !== item.evidence.promptSha256
      || source.reviewRecordPath !== item.evidence.reviewRecordPath
      || resources.length !== item.paths.length
      || item.paths.some(path => !sha256.test(byPath.get(path) ?? ''))
      || resources.some((resource: any) => typeof resource?.path !== 'string' || !item.paths.includes(resource.path))
    ) invalid.push(item.sourceId)
  }
  if (invalid.length > 0) throw new Error(`INTERFACE_SOURCE_INDEX_INVALID: ${invalid.join(', ')}`)
}

export function buildInterfaceCatalog(input: {
  baseCatalog: Catalog
  manifest: InterfaceSourceManifest
  processedAssets: Record<string, ProcessedInterfaceAsset>
  processedBridges: Record<string, ProcessedInterfaceBridge>
}): Catalog {
  const existing = new Map(input.baseCatalog.parts.map(part => [part.id, part]))
  const structuralParts: VisualPartDefinition[] = input.manifest.assets.map(source => {
    const base = existing.get(source.id)
    const processed = input.processedAssets[source.id]
    if (base === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing base metadata for ${source.id}`)
    if (processed === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing processed asset for ${source.id}`)
    const connectors: ConnectorProfile[] = source.connectors.map(profile => {
      const hashes = processed.connectorHashes[profile.id]
      if (hashes === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing connector hashes for ${source.id}:${profile.id}`)
      return { ...profile, rigId: 'biped', ...hashes }
    })
    const renderNodes: RenderNodeDefinition[] = source.renderNodes.map(node => {
      const nodeAsset = processed.renderNodes[node.id]
      if (nodeAsset === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing processed render node for ${source.id}:${node.id}`)
      return {
        id: node.id,
        ...(node.connectorId === undefined ? {} : { connectorId: node.connectorId }),
        assetPath: nodeAsset.webpPath,
        pngPath: nodeAsset.pngPath,
        assetSha256: nodeAsset.webpSha256,
        pngSha256: nodeAsset.pngSha256,
        parentSlot: source.slotId === 'bodyFrame' ? null : 'bodyFrame',
        socket: node.connectorId ?? null,
        origin: { x: 1024, y: 1024 },
        transform: { scale: 1, mirrorX: false },
        layer: source.slotId === 'bodyFrame' ? 'body' : source.slotId === 'headShape' ? 'head' : 'frontAppendage',
        compatibleRigs: ['biped'],
        clipPolicy: 'none',
      }
    })
    const composition: InterfacePartComposition = {
      mode: 'interface',
      isNone: false,
      motifTags: base.composition?.motifTags ?? [],
      visualIntensity: base.composition?.visualIntensity ?? 'quiet',
      variantsByRig: {
        biped: {
          rigId: 'biped', materialFamily: source.materialFamily, renderNodes, connectors,
        },
      },
    }
    return {
      ...base,
      compatibleRigs: ['biped'],
      assetPath: processed.webpPath,
      assetSha256: processed.webpSha256,
      pngPath: processed.pngPath,
      pngSha256: processed.pngSha256,
      composition,
      approvedTransforms: undefined,
    }
  })
  const transitionBridges: TransitionBridgeDefinition[] = input.manifest.bridges.map(source => {
    const processed = input.processedBridges[source.connectorClass]
    if (processed === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing bridge hashes for ${source.connectorClass}`)
    return {
      id: source.id,
      rigId: 'biped',
      connectorClass: source.connectorClass,
      materialFamilies: source.materialFamilies,
      neutralAssetPath: source.neutralWebpPath,
      neutralPngPath: source.neutralPngPath,
      neutralAssetSha256: processed.neutralWebpSha256,
      neutralPngSha256: processed.neutralPngSha256,
      frontMaskPath: source.frontMaskPath,
      frontMaskSha256: processed.frontMaskSha256,
      backMaskPath: source.backMaskPath,
      backMaskSha256: processed.backMaskSha256,
    }
  })
  return {
    ...input.baseCatalog,
    version: '0.3.0',
    rigs: input.baseCatalog.rigs.filter(rig => rig.id === 'biped'),
    parts: [
      ...input.baseCatalog.parts.filter(part => !structuralSlots.has(part.slotId)).map(part => ({ ...part, compatibleRigs: ['biped'] as const })),
      ...structuralParts,
    ] as VisualPartDefinition[],
    transitionBridges,
  }
}
