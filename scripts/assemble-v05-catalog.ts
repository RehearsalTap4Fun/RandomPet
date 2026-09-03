export const V05_ACTIVE_TAIL_IDS = ['tail_cat_long', 'tail_dog_long'] as const
export const V05_RIG_IDS = ['blob', 'biped', 'floating'] as const
const V05_RETAINED_EXTRA_IDS = ['extra_moth_wings', 'extra_soft_tentacles', 'extra_side_fins'] as const

type V05TailId = typeof V05_ACTIVE_TAIL_IDS[number]
type V05RigId = typeof V05_RIG_IDS[number]

export interface V05TailRuntimeResource {
  previewPngPath: string
  previewPngSha256: string
  previewWebpPath: string
  previewWebpSha256: string
  nodePngPath: string
  nodePngSha256: string
  nodeWebpPath: string
  nodeWebpSha256: string
  contourMaskPath: string
  contourMaskSha256: string
  foregroundMaskPath: string
  foregroundMaskSha256: string
  backgroundMaskPath: string
  backgroundMaskSha256: string
}

export type V05TailRuntimeResources = Record<V05TailId, Record<V05RigId, V05TailRuntimeResource>>

const LEGACY_TAIL_REPLACEMENTS: Record<string, V05TailId> = {
  tail_fish_fan: 'tail_dog_long',
  tail_soft_curl: 'tail_cat_long',
  tail_mushroom_cluster: 'tail_dog_long',
}

function replaceLegacyTailReferences<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/tail_(?:fish_fan|soft_curl|mushroom_cluster)/gu, match => LEGACY_TAIL_REPLACEMENTS[match]!)) as T
}

function replaceAssetVersion<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('assets/v0.4.0/', 'assets/v0.5.0/')) as T
}

function displayMetadata(tailId: V05TailId): Pick<Record<string, unknown>, 'displayName' | 'flavorText' | 'description'> {
  return tailId === 'tail_cat_long'
    ? {
        displayName: '长弯猫尾',
        flavorText: '它会先思考，再用尾尖轻轻打一个问号。',
        description: 'a single slim long plush cat tail with one gentle natural curve and a rounded tip',
      }
    : {
        displayName: '长摇狗尾',
        flavorText: '尾巴一动，空气就被悄悄摇得很友好。',
        description: 'a single slightly thicker long plush dog tail with a natural relaxed curve and a rounded tip',
      }
}

function makeTailPart(template: any, tailId: V05TailId, resources: V05TailRuntimeResources): any {
  const part = structuredClone(template)
  const blob = resources[tailId].blob
  part.id = tailId
  part.semanticTraitId = tailId
  Object.assign(part, displayMetadata(tailId))
  part.assetPath = blob.previewWebpPath
  part.assetSha256 = blob.previewWebpSha256
  part.pngPath = blob.previewPngPath
  part.pngSha256 = blob.previewPngSha256
  for (const rigId of V05_RIG_IDS) {
    const variant = part.composition.variantsByRig[rigId]
    const resource = resources[tailId][rigId]
    variant.renderNodes = [{
      ...variant.renderNodes[0],
      id: `${tailId}-${rigId}-tailRoot`,
      connectorId: 'tailRoot',
      assetPath: resource.nodeWebpPath,
      assetSha256: resource.nodeWebpSha256,
      pngPath: resource.nodePngPath,
      pngSha256: resource.nodePngSha256,
      parentSlot: 'bodyFrame',
      socket: 'tailRoot',
      layer: 'rearAppendage',
      compatibleRigs: [rigId],
    }]
    variant.connectors = [{
      ...variant.connectors[0],
      id: 'tailRoot',
      role: 'plug',
      connectorClass: 'tail',
      rigId,
      contourMaskPath: resource.contourMaskPath,
      contourMaskSha256: resource.contourMaskSha256,
      foregroundMaskPath: resource.foregroundMaskPath,
      foregroundMaskSha256: resource.foregroundMaskSha256,
      backgroundMaskPath: resource.backgroundMaskPath,
      backgroundMaskSha256: resource.backgroundMaskSha256,
    }]
  }
  return part
}

export function makeV05Catalog(v04Catalog: any, resources: V05TailRuntimeResources): any {
  const catalog = replaceLegacyTailReferences(replaceAssetVersion(v04Catalog))
  const template = catalog.parts.find((part: { id: string }) => part.id === 'tail_cat_long')
  if (template === undefined) throw new Error('V05_TAIL_TEMPLATE_MISSING')
  catalog.version = '0.5.0'
  catalog.parts = catalog.parts
    .filter((part: { slotId: string, id: string }) => part.slotId !== 'tail' || part.id === 'tail_none')
    .concat(V05_ACTIVE_TAIL_IDS.map(tailId => makeTailPart(template, tailId, resources)))
  catalog.modifiers = catalog.modifiers
    .filter((modifier: { id: string }) => modifier.id !== 'mutation_double_head')
    .map((modifier: { excludes?: string[] }) => ({
      ...modifier,
      excludes: (modifier.excludes ?? []).filter(id => id !== 'mutation_double_head'),
    }))
  return catalog
}

function manifestConnector(connector: any): any {
  const {
    rigId: _rigId,
    contourMaskSha256: _contourMaskSha256,
    foregroundMaskSha256: _foregroundMaskSha256,
    backgroundMaskSha256: _backgroundMaskSha256,
    ...value
  } = connector
  return value
}

function manifestBridge(bridge: any, source: any): any {
  const {
    neutralAssetPath,
    neutralAssetSha256: _neutralAssetSha256,
    neutralPngSha256: _neutralPngSha256,
    frontMaskSha256: _frontMaskSha256,
    backMaskSha256: _backMaskSha256,
    ...paths
  } = bridge
  return { ...source, ...paths, neutralWebpPath: neutralAssetPath }
}

function manifestVariant(source: any, runtime: any): any {
  const sourceNodes = new Map(source.renderNodes.map((node: any) => [node.connectorId ?? node.id, node]))
  return {
    ...source,
    rigId: runtime.rigId,
    materialFamily: runtime.materialFamily,
    connectors: runtime.connectors.map(manifestConnector),
    renderNodes: runtime.renderNodes.map((node: any) => ({
      id: node.id,
      ...(node.connectorId === undefined ? {} : { connectorId: node.connectorId }),
      sourcePngPath: (sourceNodes.get(node.connectorId ?? node.id) ?? sourceNodes.get(node.id) ?? source).sourcePngPath,
      ...(node.transform === undefined ? {} : { transform: node.transform }),
    })),
    ...(runtime.faceSafeZones === undefined ? {} : { faceSafeZones: runtime.faceSafeZones }),
    ...(runtime.featureSockets === undefined ? {} : { featureSockets: runtime.featureSockets }),
  }
}

const TAIL_PROMPT_EVIDENCE = {
  promptId: 'qmonster-v05-single-head-long-tail',
  promptPath: 'asset-source/v0.5.0/prompts/long-tail-prompts.json',
  promptSha256: '0'.repeat(64),
  reviewRecordPath: 'packages/asset-catalog/review/v0.5.0/long-tail-review-record.json',
} as const

export function makeV05InterfaceManifest(v03Manifest: any, v05Catalog: any, tailPromptEvidence = TAIL_PROMPT_EVIDENCE): any {
  const catalogParts = new Map(v05Catalog.parts
    .filter((part: any) => part.composition?.mode === 'interface')
    .map((part: any) => [part.id, part]))
  const assets = v03Manifest.assets
    .filter((asset: any) => asset.slotId !== 'tail')
    .map((asset: any) => {
      const part = catalogParts.get(asset.id)
      if (part === undefined) throw new Error(`V05_INTERFACE_PART_MISSING:${asset.id}`)
      return {
        ...asset,
        variants: asset.variants.map((variant: any) => {
          const runtime = part.composition.variantsByRig[variant.rigId]
          if (runtime === undefined) throw new Error(`V05_INTERFACE_VARIANT_MISSING:${asset.id}:${variant.rigId}`)
          return manifestVariant(variant, runtime)
        }),
      }
    })
  for (const tailId of V05_ACTIVE_TAIL_IDS) {
    const part = catalogParts.get(tailId)
    if (part === undefined) throw new Error(`V05_INTERFACE_TAIL_MISSING:${tailId}`)
    assets.push({
      id: tailId,
      slotId: 'tail',
      variants: V05_RIG_IDS.map(rigId => {
        const runtime = part.composition.variantsByRig[rigId]
        const sourcePngPath = `asset-source/v0.5.0/generation/long-tail/${tailId}-${rigId}-source.png`
        return {
          rigId,
          materialFamily: runtime.materialFamily,
          sourcePngPath,
          promptEvidence: tailPromptEvidence,
          connectors: runtime.connectors.map(manifestConnector),
          renderNodes: runtime.renderNodes.map((node: any) => ({
            id: node.id,
            ...(node.connectorId === undefined ? {} : { connectorId: node.connectorId }),
            sourcePngPath,
            ...(node.transform === undefined ? {} : { transform: node.transform }),
          })),
        }
      }),
    })
  }
  const runtimeBridges = new Map((v05Catalog.transitionBridges ?? []).map((bridge: any) => [bridge.id, bridge]))
  return {
    ...v03Manifest,
    catalogVersion: '0.5.0',
    assets,
    bridges: v03Manifest.bridges.map((bridge: any) => {
      const runtime = runtimeBridges.get(bridge.id)
      if (runtime === undefined) throw new Error(`V05_INTERFACE_BRIDGE_MISSING:${bridge.id}`)
      return manifestBridge(runtime, bridge)
    }),
  }
}

export function makeV05SourceIndex(
  v04SourceIndex: any,
  resources: V05TailRuntimeResources,
  evidence: {
    promptSha256: string
    reviewRecordSha256: string
    sourceSha256: Record<V05TailId, Record<V05RigId, string>>
  },
): any {
  const index = replaceAssetVersion(v04SourceIndex)
  index.catalogVersion = '0.5.0'
  index.sources = index.sources.map((source: { sourceId?: unknown, sourceResources?: unknown }) => {
    if (
      typeof source.sourceId !== 'string'
      || !V05_RETAINED_EXTRA_IDS.some(id => source.sourceId.startsWith(`${id}:`))
      || !Array.isArray(source.sourceResources)
    ) return source
    return {
      ...source,
      sourceResources: source.sourceResources.map((resource: { path?: unknown }) => ({
        ...resource,
        ...(typeof resource.path === 'string' && resource.path.startsWith('asset-source/v0.3.0/masks/')
          ? { path: resource.path.replace('asset-source/v0.3.0/masks/', 'asset-source/v0.5.0/masks/') }
          : {}),
      })),
    }
  })
  index.sources = index.sources.filter((source: { sourceId?: unknown }) => {
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId : ''
    return !['tail_fish_fan:', 'tail_soft_curl:', 'tail_mushroom_cluster:'].some(prefix => sourceId.startsWith(prefix))
  })
  for (const tailId of V05_ACTIVE_TAIL_IDS) for (const rigId of V05_RIG_IDS) {
    const resource = resources[tailId][rigId]
    const sourcePath = `asset-source/v0.5.0/generation/long-tail/${tailId}-${rigId}-source.png`
    const maskRoot = `asset-source/v0.5.0/masks/${rigId}/${tailId}`
    index.sources.push({
      sourceId: `${tailId}:${rigId}`,
      kind: 'interface-structural',
      promptId: TAIL_PROMPT_EVIDENCE.promptId,
      promptPath: TAIL_PROMPT_EVIDENCE.promptPath,
      promptSha256: evidence.promptSha256,
      reviewRecordPath: TAIL_PROMPT_EVIDENCE.reviewRecordPath,
      reviewRecordSha256: evidence.reviewRecordSha256,
      sourceResources: [
        { path: sourcePath, sha256: evidence.sourceSha256[tailId][rigId] },
        { path: `${maskRoot}/tailRoot-contour.png`, sha256: resource.contourMaskSha256 },
        { path: `${maskRoot}/tailRoot-foreground.png`, sha256: resource.foregroundMaskSha256 },
        { path: `${maskRoot}/tailRoot-background.png`, sha256: resource.backgroundMaskSha256 },
      ],
      runtimeResources: [
        { path: resource.previewWebpPath, sha256: resource.previewWebpSha256 },
        { path: resource.previewPngPath, sha256: resource.previewPngSha256 },
        { path: resource.nodeWebpPath, sha256: resource.nodeWebpSha256 },
        { path: resource.nodePngPath, sha256: resource.nodePngSha256 },
        { path: resource.contourMaskPath, sha256: resource.contourMaskSha256 },
        { path: resource.foregroundMaskPath, sha256: resource.foregroundMaskSha256 },
        { path: resource.backgroundMaskPath, sha256: resource.backgroundMaskSha256 },
      ],
    })
  }
  return index
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function prettyJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

async function writeReleaseFile(path: string, bytes: Buffer): Promise<void> {
  try {
    await lstat(path)
    throw new Error(`V05_RELEASE_TARGET_EXISTS_NO_OVERWRITE:${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes, { flag: 'wx' })
}

export function legacyTailRuntimePath(path: string): boolean {
  return /(?:^|\/)(?:tail_fish_fan|tail_soft_curl|tail_mushroom_cluster)(?:[-./]|$)/u.test(path.replaceAll('\\', '/'))
}

async function copyV04RuntimeAssets(sourceRoot: string, outputRoot: string, prefix = ''): Promise<void> {
  const entries = await readdir(join(sourceRoot, prefix), { withFileTypes: true })
  for (const entry of entries) {
    const portable = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (legacyTailRuntimePath(portable)) continue
    if (entry.isDirectory()) {
      await copyV04RuntimeAssets(sourceRoot, outputRoot, portable)
      continue
    }
    if (!entry.isFile()) continue
    const target = join(outputRoot, portable)
    try {
      await lstat(target)
      throw new Error(`V05_ASSET_TARGET_EXISTS_NO_OVERWRITE:${target}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(sourceRoot, portable), target, 0)
  }
}

async function copyV03RetainedExtraSourceMasks(repositoryRoot: string): Promise<void> {
  for (const rigId of V05_RIG_IDS) for (const partId of V05_RETAINED_EXTRA_IDS) for (const connectorId of ['extraLeft', 'extraRight']) for (const kind of ['contour', 'foreground', 'background']) {
    const relative = `masks/${rigId}/${partId}/${connectorId}-${kind}.png`
    await writeReleaseFile(
      join(repositoryRoot, 'asset-source', 'v0.5.0', relative),
      await readFile(join(repositoryRoot, 'asset-source', 'v0.3.0', relative)),
    )
  }
}

function runtimePath(path: unknown): string | undefined {
  if (typeof path !== 'string' || path === '') return undefined
  return path.startsWith('assets/v0.5.0/') ? path.slice('assets/v0.5.0/'.length) : path
}

function referencedV05RuntimePaths(catalog: any, sourceIndex: any): Set<string> {
  const paths = new Set<string>()
  const add = (path: unknown): void => {
    const portable = runtimePath(path)
    if (portable !== undefined) paths.add(portable)
  }
  for (const part of catalog.parts) {
    add(part.assetPath)
    add(part.pngPath)
    for (const masks of Object.values(part.rigMaskPaths ?? {}) as any[]) {
      if (masks === undefined) continue
      add(masks.primary)
      add(masks.secondary)
      add(masks.accent)
    }
    if (part.composition?.mode !== 'interface') continue
    for (const variant of Object.values(part.composition.variantsByRig ?? {}) as any[]) {
      for (const node of variant.renderNodes ?? []) {
        add(node.assetPath)
        add(node.pngPath)
      }
      for (const connector of variant.connectors ?? []) {
        add(connector.contourMaskPath)
        add(connector.foregroundMaskPath)
        add(connector.backgroundMaskPath)
      }
    }
  }
  for (const rig of catalog.rigs) if (rig.sourceId !== undefined) {
    add(`rigs/${rig.sourceId}.png`)
    add(`rigs/${rig.sourceId}.webp`)
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    add(bridge.neutralAssetPath)
    add(bridge.neutralPngPath)
    add(bridge.frontMaskPath)
    add(bridge.backMaskPath)
  }
  for (const source of sourceIndex.sources ?? []) for (const resource of source.runtimeResources ?? []) add(resource.path)
  return paths
}

async function pruneUnreferencedV05RuntimeAssets(assetRoot: string, catalog: any, sourceIndex: any, prefix = '', referenced = referencedV05RuntimePaths(catalog, sourceIndex)): Promise<void> {
  const entries = await readdir(join(assetRoot, prefix), { withFileTypes: true })
  for (const entry of entries) {
    const portable = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      await pruneUnreferencedV05RuntimeAssets(assetRoot, catalog, sourceIndex, portable, referenced)
      continue
    }
    if (!entry.isFile() || (!portable.endsWith('.png') && !portable.endsWith('.webp'))) continue
    if (!referenced.has(portable)) await unlink(join(assetRoot, portable))
  }
}

async function assetResource(assetRoot: string, path: string): Promise<{ path: string, sha256: string }> {
  const prefix = 'assets/v0.5.0/'
  if (!path.startsWith(prefix)) throw new Error(`V05_ASSET_PATH_INVALID:${path}`)
  const bytes = await readFile(join(assetRoot, path.slice(prefix.length)))
  return { path, sha256: digest(bytes) }
}

async function tailRuntimeResources(assetRoot: string): Promise<V05TailRuntimeResources> {
  const result = {} as V05TailRuntimeResources
  for (const tailId of V05_ACTIVE_TAIL_IDS) {
    result[tailId] = {} as Record<V05RigId, V05TailRuntimeResource>
    for (const rigId of V05_RIG_IDS) {
      const root = `assets/v0.5.0/structural/${rigId}/${tailId}`
      const nodeRoot = `${root}/nodes/${tailId}-${rigId}-tailRoot`
      const connectorRoot = `assets/v0.5.0/connectors/${rigId}/${tailId}-tailRoot`
      const [previewPng, previewWebp, nodePng, nodeWebp, contour, foreground, background] = await Promise.all([
        assetResource(assetRoot, `${root}.png`),
        assetResource(assetRoot, `${root}.webp`),
        assetResource(assetRoot, `${nodeRoot}.png`),
        assetResource(assetRoot, `${nodeRoot}.webp`),
        assetResource(assetRoot, `${connectorRoot}-contour.png`),
        assetResource(assetRoot, `${connectorRoot}-foreground.png`),
        assetResource(assetRoot, `${connectorRoot}-background.png`),
      ])
      result[tailId][rigId] = {
        previewPngPath: previewPng.path,
        previewPngSha256: previewPng.sha256,
        previewWebpPath: previewWebp.path,
        previewWebpSha256: previewWebp.sha256,
        nodePngPath: nodePng.path,
        nodePngSha256: nodePng.sha256,
        nodeWebpPath: nodeWebp.path,
        nodeWebpSha256: nodeWebp.sha256,
        contourMaskPath: contour.path,
        contourMaskSha256: contour.sha256,
        foregroundMaskPath: foreground.path,
        foregroundMaskSha256: foreground.sha256,
        backgroundMaskPath: background.path,
        backgroundMaskSha256: background.sha256,
      }
    }
  }
  return result
}

const LONG_TAIL_PROMPTS = {
  schemaVersion: 'qmonster-v05-long-tail-prompts-v1',
  constraints: [
    'one connected long tubular tail component only',
    'genuine transparency is recovered deterministically when the generator encodes a neutral checkerboard matte',
    'no body, head, limbs, face, fins, fans, forks, fish-tail form, mushroom cluster, detached ornament, shadow, text, or background',
  ],
  prompts: {
    tail_cat_long: 'Slim plush cat-like long tail with one gentle natural curve and a rounded tip.',
    tail_dog_long: 'Slightly thicker plush dog-like long tail with a natural relaxed curve and a rounded tip.',
  },
} as const

export async function assembleV05Catalog(options: { repositoryRoot?: string } = {}): Promise<{ catalog: any, sourceIndex: any }> {
  const root = resolve(options.repositoryRoot ?? process.cwd())
  const packageRoot = join(root, 'packages', 'asset-catalog')
  const catalogRoot = join(packageRoot, 'catalog', 'v0.5.0')
  const assetRoot = join(packageRoot, 'assets', 'v0.5.0')
  const releaseTargets = [
    join(catalogRoot, 'catalog.json'),
    join(packageRoot, 'source-index-v0.5.0.json'),
    join(packageRoot, 'audit', 'v0.5.0', 'evidence-manifest.json'),
    join(packageRoot, 'review', 'v0.5.0', 'review-record.json'),
    join(root, 'asset-source', 'v0.5.0', 'interface-manifest.json'),
  ]
  for (const target of releaseTargets) {
    try {
      await lstat(target)
      throw new Error(`V05_RELEASE_TARGET_EXISTS_NO_OVERWRITE:${target}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await copyV04RuntimeAssets(join(packageRoot, 'assets', 'v0.4.0'), assetRoot)
  const resources = await tailRuntimeResources(assetRoot)
  const sourceHashes = {} as Record<V05TailId, Record<V05RigId, string>>
  for (const tailId of V05_ACTIVE_TAIL_IDS) {
    sourceHashes[tailId] = {} as Record<V05RigId, string>
    for (const rigId of V05_RIG_IDS) {
      const sourcePath = join(root, 'asset-source', 'v0.5.0', 'generation', 'long-tail', `${tailId}-${rigId}-source.png`)
      sourceHashes[tailId][rigId] = digest(await readFile(sourcePath))
      for (const [kind, runtimePath] of [
        ['contour', resources[tailId][rigId].contourMaskPath],
        ['foreground', resources[tailId][rigId].foregroundMaskPath],
        ['background', resources[tailId][rigId].backgroundMaskPath],
      ] as const) {
        const target = join(root, 'asset-source', 'v0.5.0', 'masks', rigId, tailId, `tailRoot-${kind}.png`)
        await writeReleaseFile(target, await readFile(join(assetRoot, runtimePath.slice('assets/v0.5.0/'.length))))
      }
    }
  }
  const promptBytes = prettyJson(LONG_TAIL_PROMPTS)
  const promptPath = join(root, 'asset-source', 'v0.5.0', 'prompts', 'long-tail-prompts.json')
  await writeReleaseFile(promptPath, promptBytes)
  const tailReview = {
    schemaVersion: 'qmonster-v05-long-tail-technical-review-v1',
    catalogVersion: '0.5.0',
    decision: 'technical-validation-ready',
    visualReview: 'not performed; user review is intentionally retained',
    tailIds: V05_ACTIVE_TAIL_IDS,
    rigIds: V05_RIG_IDS,
    recovery: 'border-connected-near-neutral-checkerboard-v1 with a single structural component gate',
  }
  const tailReviewBytes = prettyJson(tailReview)
  const tailReviewPath = join(packageRoot, 'review', 'v0.5.0', 'long-tail-review-record.json')
  await writeReleaseFile(tailReviewPath, tailReviewBytes)

  const [v04Catalog, v03Manifest, v04SourceIndex] = await Promise.all([
    readFile(join(packageRoot, 'catalog', 'v0.4.0', 'catalog.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'asset-source', 'v0.3.0', 'interface-manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(packageRoot, 'source-index-v0.4.0.json'), 'utf8').then(JSON.parse),
  ])
  const catalog = makeV05Catalog(v04Catalog, resources)
  const manifest = makeV05InterfaceManifest(v03Manifest, catalog, {
    ...TAIL_PROMPT_EVIDENCE,
    promptSha256: digest(promptBytes),
  })
  const sourceIndex = makeV05SourceIndex(v04SourceIndex, resources, {
    promptSha256: digest(promptBytes),
    reviewRecordSha256: digest(tailReviewBytes),
    sourceSha256: sourceHashes,
  })
  await copyV03RetainedExtraSourceMasks(root)
  await pruneUnreferencedV05RuntimeAssets(assetRoot, catalog, sourceIndex)
  const evidenceManifest = buildProductionEvidenceManifest(sourceIndex)
  const evidenceBytes = prettyJson(evidenceManifest)
  const releaseReview = {
    schemaVersion: 'qmonster-v05-catalog-release-review-v1',
    catalogVersion: '0.5.0',
    basedOnCatalogVersion: '0.4.0',
    decision: 'technical-validation-ready',
    visualReview: 'not performed; user review is intentionally retained',
    removedModifierIds: ['mutation_double_head'],
    activeTailIds: ['tail_none', ...V05_ACTIVE_TAIL_IDS],
    evidenceManifestPath: 'packages/asset-catalog/audit/v0.5.0/evidence-manifest.json',
    evidenceManifestSha256: digest(evidenceBytes),
  }
  const splitFiles: Array<[string, unknown]> = [
    ['catalog.json', catalog],
    ['themes.json', catalog.themes],
    ['rigs.json', catalog.rigs],
    ['parts.json', catalog.parts],
    ['semantic-traits.json', catalog.semanticTraits],
    ['modifiers.json', catalog.modifiers],
  ]
  for (const [name, value] of splitFiles) await writeReleaseFile(join(catalogRoot, name), prettyJson(value))
  await writeReleaseFile(join(root, 'asset-source', 'v0.5.0', 'interface-manifest.json'), prettyJson(manifest))
  await writeReleaseFile(join(packageRoot, 'source-index-v0.5.0.json'), prettyJson(sourceIndex))
  await writeReleaseFile(join(packageRoot, 'audit', 'v0.5.0', 'evidence-manifest.json'), evidenceBytes)
  await writeReleaseFile(join(packageRoot, 'review', 'v0.5.0', 'review-record.json'), prettyJson(releaseReview))
  return { catalog, sourceIndex }
}
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { buildProductionEvidenceManifest } from '../packages/asset-catalog/src/evidence-root.js'
