import type {
  Catalog,
  ConnectorProfile,
  InterfacePartComposition,
  RenderNodeDefinition,
  TransitionBridgeDefinition,
  VisualPartDefinition,
} from '@qmonster/generator-core'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InterfaceSourceManifest } from './interface-source-schema.js'
import { validateInterfaceSourceIndex as assertInterfaceSourceIndex } from './interface-source-schema.js'
import { productionPaths } from './production-paths.js'
export { validateInterfaceSourceIndex } from './interface-source-schema.js'

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

// The Task 6 slice replaces only the four supplied structural slots. Preserve
// the v0.2 optional-none tail and extra-appendage entries so a complete spec can
// still select an explicit absence for those slots.
const structuralSlots = new Set(['bodyFrame', 'headShape', 'arms', 'legs'])
const sha256 = /^[a-f0-9]{64}$/u
const canonicalRuntime = /^assets\/v0\.3\.0\/.+\.(?:png|webp)$/u

function validateProcessedNodeResources(sourceId: string, processed: ProcessedInterfaceAsset): void {
  const nodes = Object.values(processed.renderNodes)
  const paths = nodes.flatMap(node => [node.pngPath, node.webpPath])
  const hashes = nodes.flatMap(node => [node.pngSha256, node.webpSha256])
  if (
    !canonicalRuntime.test(processed.pngPath) || !canonicalRuntime.test(processed.webpPath)
    || !sha256.test(processed.pngSha256) || !sha256.test(processed.webpSha256)
    || paths.some(path => !canonicalRuntime.test(path))
    || new Set(paths).size !== paths.length
    || hashes.some(hash => !sha256.test(hash))
    || new Set(hashes).size !== hashes.length
  ) throw new Error(`INTERFACE_CATALOG_INVALID: render node resources must have canonical distinct paths and hashes for ${sourceId}`)
}

export function buildInterfaceCatalog(input: {
  baseCatalog: Catalog
  manifest: InterfaceSourceManifest
  processedAssets: Record<string, ProcessedInterfaceAsset>
  processedBridges: Record<string, ProcessedInterfaceBridge>
}): Catalog {
  const existing = new Map(input.baseCatalog.parts.map(part => [part.id, part]))
  const processedNodePaths = new Set<string>()
  const processedNodeHashes = new Set<string>()
  const structuralParts: VisualPartDefinition[] = input.manifest.assets.map(source => {
    const base = existing.get(source.id)
    const processed = input.processedAssets[source.id]
    if (base === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing base metadata for ${source.id}`)
    if (processed === undefined) throw new Error(`INTERFACE_CATALOG_INVALID: missing processed asset for ${source.id}`)
    validateProcessedNodeResources(source.id, processed)
    for (const node of Object.values(processed.renderNodes)) {
      for (const path of [node.pngPath, node.webpPath]) {
        if (processedNodePaths.has(path)) throw new Error(`INTERFACE_CATALOG_INVALID: render node paths must be globally distinct: ${path}`)
        processedNodePaths.add(path)
      }
      for (const hash of [node.pngSha256, node.webpSha256]) {
        if (processedNodeHashes.has(hash)) throw new Error(`INTERFACE_CATALOG_INVALID: render node hashes must be globally distinct for ${source.id}`)
        processedNodeHashes.add(hash)
      }
    }
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
          ...(source.slotId === 'headShape' ? {
            // Keep the shared face declaration inside the tall-body review
            // frame while preserving the accepted head art and connector.
            faceSafeZones: [{ x: 760, y: 1136, width: 528, height: 310 }],
            featureSockets: {
              eyes: { x: 1024, y: 1236 },
              mouth: { x: 1024, y: 1376 },
              headAppendage: { x: 1024, y: 1116 },
            },
          } : {}),
        },
      },
    }
    const { approvedTransforms: _approvedTransforms, ...baseWithoutTransforms } = base
    return {
      ...baseWithoutTransforms,
      compatibleRigs: ['biped'],
      assetPath: processed.webpPath,
      assetSha256: processed.webpSha256,
      pngPath: processed.pngPath,
      pngSha256: processed.pngSha256,
      composition,
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
  const parts = [
    ...input.baseCatalog.parts.filter(part => (
      !structuralSlots.has(part.slotId)
      && (!['tail', 'extraAppendage'].includes(part.slotId) || part.composition?.isNone === true)
    )).map(part => ({ ...part, compatibleRigs: ['biped'] as const })),
    ...structuralParts,
  ] as VisualPartDefinition[]
  const partIds = new Set(parts.map(part => part.id))
  const retainExistingPartBoosts = <T extends { boosts?: Record<string, number> }>(definition: T): T => (
    definition.boosts === undefined
      ? definition
      : {
          ...definition,
          boosts: Object.fromEntries(Object.entries(definition.boosts).filter(([partId]) => partIds.has(partId))),
        }
  )
  const semanticPartIdArrayFields = ['suggestedParts', 'effectPartIds', 'sourcePartIds', 'assetIds'] as const
  const retainExistingSemanticPartReferences = <T extends {
    boosts?: Record<string, number>
    visualMapping?: Record<string, unknown>
  }>(definition: T): T => {
    const retained = retainExistingPartBoosts(definition)
    if (retained.visualMapping === undefined) return retained
    const visualMapping = { ...retained.visualMapping }
    for (const field of semanticPartIdArrayFields) {
      const references = visualMapping[field]
      if (Array.isArray(references)) {
        visualMapping[field] = references.filter(reference => (
          typeof reference !== 'string' || partIds.has(reference)
        ))
      }
    }
    return { ...retained, visualMapping }
  }
  return {
    ...input.baseCatalog,
    version: '0.3.0',
    rigs: input.baseCatalog.rigs,
    parts,
    semanticTraits: input.baseCatalog.semanticTraits.map(retainExistingSemanticPartReferences),
    modifiers: input.baseCatalog.modifiers.map(retainExistingPartBoosts),
    transitionBridges,
  }
}

function isDirectExecution(): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  try {
    return realpathSync(resolve(invoked)) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  const args = process.argv.slice(2).join(' ')
  if (args !== '--slice biped' && args !== '--version 0.3.0 --slice biped') {
    throw new Error('Usage: tsx scripts/build-interface-catalog.ts --version 0.3.0 --slice biped')
  }
  const paths = productionPaths('0.3.0')
  const manifest = JSON.parse(await readFile(join(paths.sourceRoot, 'interface-manifest.json'), 'utf8')) as InterfaceSourceManifest
  const processed = JSON.parse(await readFile(join(paths.sourceRoot, 'production', 'processed-index.json'), 'utf8')) as {
    processedAssets: Record<string, ProcessedInterfaceAsset>
    processedBridges: Record<string, ProcessedInterfaceBridge>
    sourceIndex: Record<string, unknown>
  }
  assertInterfaceSourceIndex(manifest, processed.sourceIndex)
  const base = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.2.0/catalog.json', 'utf8')) as Catalog
  const catalog = buildInterfaceCatalog({
    baseCatalog: base, manifest,
    processedAssets: processed.processedAssets,
    processedBridges: processed.processedBridges,
  })
  const documents: Record<string, unknown> = {
    'catalog.json': catalog,
    'themes.json': catalog.themes,
    'rigs.json': catalog.rigs,
    'parts.json': catalog.parts,
    'semantic-traits.json': catalog.semanticTraits,
    'modifiers.json': catalog.modifiers,
  }
  for (const [name, value] of Object.entries(documents)) {
    const path = join(paths.catalogDirectory, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
  }
  await mkdir(dirname(paths.sourceIndexPath), { recursive: true })
  await writeFile(paths.sourceIndexPath, `${JSON.stringify(processed.sourceIndex, null, 2)}\n`)
  console.log(JSON.stringify({ version: catalog.version, parts: catalog.parts.length }))
}
