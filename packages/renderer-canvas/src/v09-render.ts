import {
  V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS, V09_VERSION_TUPLE, isV09MaterialRegistry,
  parseMonsterSpecV09, parseSealedTraitArtifactV1, parseContentResourceId,
  type AssemblyTemplateV1, type CompositionGraphV1, type ContentResourceRef, type JsonResourceRef,
  type MonsterSpecV09, type PngResourceRef, type ResolvedV09Catalog, type SealedTraitArtifactV1,
  type SkeletonFamilyV1, type V09CompositionNodeId, type V09TraitSlotId,
} from '@qmonster/generator-core'
import { applyV09MaterialOperations, parseV09MaterialOperation, requireV09Pixels, V09RenderError, V09_SURFACE_ORDER, type V09DecodedMaterialOperation } from './v09-material-render.js'

export interface V09DecodedPng {
  /** Resolver verifies the profile-free PNG and its decoded content digest before returning. */
  sha256: string
  width: 2048
  height: 2048
  pixels: Uint8Array | Uint8ClampedArray
  drawable: CanvasImageSource
}

/** Trusted decoder boundary. No path, URL, placement, crop or scale parameters exist. */
export interface V09ResourceResolver {
  resolvePng(ref: PngResourceRef): Promise<V09DecodedPng>
  /** Verify canonical JSON digest before returning parsed, ordinary JSON data. */
  resolveJson(ref: JsonResourceRef): Promise<{ sha256: string; value: unknown }>
  /** Preserve exact straight RGBA bytes; no color conversion, interpolation or transform. */
  createDrawable(pixels: Uint8Array, width: 2048, height: 2048): Promise<CanvasImageSource>
}

export interface ResolvedCompositeV09 {
  readonly versionTuple: typeof V09_VERSION_TUPLE
  readonly speciesRigId: string
  readonly skeletonFamilyId: string
  readonly assemblyTemplateId: string
  readonly releaseManifestSha256: string
  /** Surface entries are operations, skeleton/replay entries are materialized privately. */
  readonly orderedNodes: Readonly<Record<V09CompositionNodeId, readonly ContentResourceRef[]>>
  readonly sourceArtifactSha256s: readonly string[]
}
export interface V09RenderResult { trace: V09CompositionNodeId[] }
type Nodes = Record<V09CompositionNodeId, ContentResourceRef[]>
type ReplayNode = 'eyePair.edgeOcclusionReplay' | 'mouth.edgeOcclusionReplay' | 'skeleton.attachmentOcclusionReplay'
interface CompositeState {
  family: SkeletonFamilyV1
  template: AssemblyTemplateV1
  replayMasks: Record<ReplayNode, PngResourceRef[]>
}
// Only composites resolved in this module may be rendered. A copied or injected graph
// never becomes trusted merely because its public fields have the same shape.
const resolved = new WeakMap<ResolvedCompositeV09, CompositeState>()
const surfaceNodes = ['surface.bodyColor', 'surface.pattern', 'surface.texture', 'surface.forepawDetail', 'surface.hindpawDetail', 'surface.tailSurface'] as const
function fail(code: string, message: string): never { throw new V09RenderError(code, message) }
function exactlyOne<T>(items: T[], code: string, message: string): T { if (items.length !== 1) fail(code, message); return items[0]! }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function verifyRef(ref: ContentResourceRef): void {
  if (!ref || parseContentResourceId(ref.resourceId) === undefined || ref.resourceId !== `sha256:${ref.sha256}`) fail('RESOURCE_HASH_MISMATCH', 'Content reference identity and digest must agree.')
  if (ref.mediaType === 'image/png') {
    if (ref.width !== 2048 || ref.height !== 2048 || Object.keys(ref).sort().join(',') !== 'height,mediaType,resourceId,sha256,width') fail('RESOURCE_HASH_MISMATCH', 'PNG references must be strict 2048x2048 resources.')
  } else if (!['application/qmonster-material-v1+json', 'application/qmonster-manifest-v1+json'].includes(ref.mediaType)
    || Object.keys(ref).sort().join(',') !== 'mediaType,resourceId,sha256') fail('RESOURCE_HASH_MISMATCH', 'Expected a strict JSON content reference.')
}
function validateGraph(graph: CompositionGraphV1): void {
  if (graph?.transformPolicy !== 'identity-only') fail('NON_IDENTITY_TRANSFORM', 'Only identity transforms are permitted.')
  if (graph.schemaVersion !== 'qmonster-composition-graph-v1' || graph.blendMode !== 'source-over-premultiplied-srgb'
    || graph.orderedNodes.length !== 21 || graph.orderedNodes.some((node, index) => node !== V09_COMPOSITION_NODE_IDS[index])
    || Object.keys(graph).sort().join(',') !== 'blendMode,orderedNodes,schemaVersion,transformPolicy') fail('COMPOSITION_GRAPH_MISMATCH', 'Expected exactly the frozen 21-node graph.')
}
function forbidPlacement(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['anchor', 'placement', 'transform', 'scale', 'rotation', 'offset', 'crop', 'zIndex', 'layerOrder', 'x', 'y'].includes(key)) fail('NON_IDENTITY_TRANSFORM', 'Runtime placement fields are forbidden.')
    if (['path', 'url', 'assetPath'].includes(key)) fail('RESOURCE_HASH_MISMATCH', 'Resources must be content references.')
    forbidPlacement(child)
  }
}

/** Resolve a spec to immutable resource roles without any spatial or layer expansion. */
export function resolveV09Composite(spec: MonsterSpecV09, catalog: ResolvedV09Catalog): ResolvedCompositeV09 {
  const parsed = parseMonsterSpecV09(spec)
  if (!parsed.ok) fail(parsed.diagnostics[0]?.code ?? 'SPEC_SCHEMA_INVALID', 'Expected a strict v0.9 spec.')
  spec = parsed.value
  if (Object.entries(V09_VERSION_TUPLE).some(([key, value]) => catalog.releaseManifest.versionTuple[key as keyof typeof V09_VERSION_TUPLE] !== value)) fail('VERSION_TUPLE_MISMATCH', 'Spec and catalog must use 0.4.0 / 0.9.0 / 0.9.0.')
  const family = structuredClone(exactlyOne(catalog.skeletonFamilies.filter(item => item.skeletonFamilyId === spec.skeletonFamilyId), 'SKELETON_PROJECTION_MISSING', 'Exactly one selected skeleton family is required.'))
  const templateIndex = catalog.assemblyTemplates.findIndex(item => item.assemblyTemplateId === spec.assemblyTemplateId)
  const template = structuredClone(exactlyOne(catalog.assemblyTemplates.filter(item => item.assemblyTemplateId === spec.assemblyTemplateId || item.skeletonFamilyId === spec.skeletonFamilyId), 'SKELETON_PROJECTION_MISSING', 'Exactly one owned assembly template is required.'))
  const candidate = exactlyOne(catalog.skeletonPool.candidates.filter(item => item.skeletonFamilyId === spec.skeletonFamilyId), 'SKELETON_PROJECTION_MISSING', 'Selected family must be declared by the skeleton pool.')
  if (family.assemblyTemplateId !== template.assemblyTemplateId || template.skeletonFamilyId !== family.skeletonFamilyId || family.speciesRigId !== spec.speciesRigId
    || family.skeletonClass !== spec.skeletonSelection.class || candidate.skeletonClass !== family.skeletonClass || spec.skeletonSelection.candidateId !== family.skeletonFamilyId
    || template.neutralMasterSha256 !== family.neutralMaster.sha256
    || family.canvas.width !== 2048 || family.canvas.height !== 2048 || template.canvas.width !== 2048 || template.canvas.height !== 2048) fail('SKELETON_PROJECTION_MISSING', 'Skeleton, template and selection identities must agree exactly.')
  if (!isV09MaterialRegistry(template.materialRegistry) || template.slots.surface.some(slot => !Object.hasOwn(template.materialRegistry, slot.ownerMaterialId))) fail('SURFACE_OWNER_VIOLATION', 'Every surface owner needs a unique registered 8-bit material index.')
  validateGraph(catalog.compositionGraph); validateGraph(template.compositionGraph)
  forbidPlacement(family); forbidPlacement(template)
  if (template.slots.surface.length !== 6 || template.slots.embedded.length !== 3 || template.slots.attachment.length !== 2) fail('TRAIT_SLOT_INCOMPATIBLE', 'Template must declare the fixed surface, embedded and attachment slots.')
  for (const slotId of V09_SURFACE_ORDER) exactlyOne(template.slots.surface.filter(slot => slot.kind === 'surface' && slot.slotId === slotId), 'TRAIT_SLOT_INCOMPATIBLE', 'Missing or duplicate surface template slot.')
  const eyes = exactlyOne(template.slots.embedded.filter(slot => slot.kind === 'eyePair'), 'TRAIT_SLOT_INCOMPATIBLE', 'Exactly one eye-pair template is required.')
  const mouth = exactlyOne(template.slots.embedded.filter(slot => slot.kind === 'mouth'), 'TRAIT_SLOT_INCOMPATIBLE', 'Exactly one mouth template is required.')
  const oral = exactlyOne(template.slots.embedded.filter(slot => slot.kind === 'oralDetail'), 'TRAIT_SLOT_INCOMPATIBLE', 'Exactly one oral template is required.')
  if (eyes.slotId !== 'eyes' || mouth.slotId !== 'mouthShape' || oral.slotId !== 'oralDetail' || oral.closedMouthSentinel !== 'oral-none') fail('TRAIT_SLOT_INCOMPATIBLE', 'Embedded slots have invalid identities.')
  const nodes = Object.fromEntries(V09_COMPOSITION_NODE_IDS.map(node => [node, []])) as unknown as Nodes
  const sourceArtifactSha256s: string[] = []
  const templateRef = catalog.releaseManifest.assemblyTemplates[templateIndex]
  if (!templateRef) fail('SKELETON_PROJECTION_MISSING', 'Selected template has no manifest identity.')
  verifyRef(templateRef)
  const selected = new Map<V09TraitSlotId, SealedTraitArtifactV1>()
  for (const slotId of V09_TRAIT_SLOT_IDS) {
    const selection = spec.visualSlots[slotId]
    if (slotId === 'oralDetail' && selection.traitId === 'oral-none') continue
    const matches = catalog.sealedTraits.map((trait, index) => ({ trait, index })).filter(({ trait }) => trait.slotId === slotId && trait.traitId === selection.traitId && trait.skeletonFamilyId === family.skeletonFamilyId)
    const match = exactlyOne(matches, 'SKELETON_PROJECTION_MISSING', `Exactly one selected ${slotId} projection is required.`)
    forbidPlacement(match.trait)
    const artifact = parseSealedTraitArtifactV1(match.trait)
    if (!artifact.ok) fail('TRAIT_SLOT_INCOMPATIBLE', 'Sealed projection contains invalid kind, slot or resource roles.')
    const trait = artifact.value
    if (trait.rarity !== selection.rarity || trait.assemblyTemplateId !== template.assemblyTemplateId || trait.assemblyTemplateSha256 !== templateRef.sha256 || trait.neutralMasterSha256 !== family.neutralMaster.sha256) fail('SKELETON_PROJECTION_MISSING', 'Projection rarity, family and template bindings must agree exactly.')
    const artifactRef = catalog.releaseManifest.sealedTraits[match.index]
    if (!artifactRef) fail('SKELETON_PROJECTION_MISSING', 'Sealed projection is not declared in the release manifest.')
    verifyRef(artifactRef); sourceArtifactSha256s.push(artifactRef.sha256)
    selected.set(slotId, trait)
  }
  const mouthTrait = selected.get('mouthShape')
  if (mouthTrait?.kind !== 'mouth') fail('TRAIT_SLOT_INCOMPATIBLE', 'Mouth selection needs a mouth projection.')
  const closed = mouthTrait.oralSocketClass === 'closed'
  const socketKey = closed ? 'oral-none' : mouthTrait.oralSocketClass
  const socket = Object.hasOwn(oral.socketRegistry, socketKey) ? oral.socketRegistry[socketKey] : undefined
  if (!socket || !socket.parentMouthTraitIds.includes(mouthTrait.traitId)
    || closed !== (spec.visualSlots.oralDetail.traitId === 'oral-none')) fail('TRAIT_SLOT_INCOMPATIBLE', 'Selected mouth and oral content do not share a declared open/closed socket.')
  const replayMasks: CompositeState['replayMasks'] = { 'eyePair.edgeOcclusionReplay': [eyes.occlusionReplayZone], 'mouth.edgeOcclusionReplay': [mouth.occlusionReplayZone], 'skeleton.attachmentOcclusionReplay': [] }
  for (const [slotId, trait] of selected) {
    const resources = trait.runtimeResources
    switch (trait.kind) {
      case 'surface':
        if (trait.runtimeResources.materialOperation.mediaType !== 'application/qmonster-material-v1+json') fail('TRAIT_SLOT_INCOMPATIBLE', 'Surface roles require material-operation JSON.')
        nodes[surfaceNodes[V09_SURFACE_ORDER.indexOf(trait.slotId)]!].push(trait.runtimeResources.materialOperation); break
      case 'eyePair': nodes['eyePair.underlay'].push(trait.runtimeResources.underlay); nodes['eyePair.content'].push(trait.runtimeResources.content); break
      case 'mouth': nodes['mouth.back'].push(trait.runtimeResources.mouthBack); nodes['mouth.front'].push(trait.runtimeResources.mouthFront); break
      case 'oralDetail': {
        const projections = trait.runtimeResources.oralProjections
        const projection = Object.hasOwn(projections, socketKey) ? projections[socketKey] : undefined
        if (!projection || Object.keys(projections).some(key => !Object.hasOwn(oral.socketRegistry, key))) fail('ORAL_SOCKET_INCOMPATIBLE', `Oral trait has no compatible projection for mouth socket ${socketKey}.`)
        nodes.oralDetail.push(projection); break
      }
      case 'attachment': {
        const attachment = exactlyOne(template.slots.attachment.filter(slot => slot.kind === 'attachment' && slot.slotId === slotId), 'TRAIT_SLOT_INCOMPATIBLE', 'Attachment must own exactly one template interface.')
        const iface = attachment.attachmentInterface
        if (trait.interfaceId !== iface.interfaceId || !iface.allowedShapeClasses.includes(trait.shapeClass)
          || (trait.runtimeResources.attachmentFront !== undefined) !== (iface.frontRootStencil !== undefined)) fail('TRAIT_SLOT_INCOMPATIBLE', 'Attachment roles or shape are incompatible with its fixed interface.')
        const mask = Object.hasOwn(family.fixedOccluderMasks, iface.fixedOccluderMaskId) ? family.fixedOccluderMasks[iface.fixedOccluderMaskId] : undefined
        if (!mask) fail('UNREGISTERED_ALPHA_SOURCE', 'Attachment replay must use its family-owned mask.')
        nodes['attachment.behind'].push(trait.runtimeResources.attachmentBehind)
        if (trait.runtimeResources.attachmentFront) nodes['attachment.front'].push(trait.runtimeResources.attachmentFront)
        if (!replayMasks['skeleton.attachmentOcclusionReplay'].some(ref => ref.resourceId === mask.resourceId)) replayMasks['skeleton.attachmentOcclusionReplay'].push(mask)
        break
      }
      case 'targetedEffect': {
        const effect = exactlyOne(template.slots.effect.filter(slot => slot.kind === 'targetedEffect' && slot.targetId === trait.targetId), 'TRAIT_SLOT_INCOMPATIBLE', 'Targeted effect needs one declared target.')
        if (!['targetedEffect.underlay', 'targetedEffect.overlay'].includes(effect.compositionNode)) fail('COMPOSITION_GRAPH_MISMATCH', 'Invalid targeted effect node.')
        nodes[effect.compositionNode].push(trait.runtimeResources.effectLayer); break
      }
      case 'ambientEffect': {
        const effect = exactlyOne(template.slots.effect.filter(slot => slot.kind === 'ambientEffect' && slot.zoneId === trait.zoneId), 'TRAIT_SLOT_INCOMPATIBLE', 'Ambient effect needs one declared zone.')
        if (effect.compositionNode !== (trait.zoneId === 'background' ? 'backgroundEffect' : 'foregroundAmbientEffect')) fail('COMPOSITION_GRAPH_MISMATCH', 'Ambient effect zone and node must agree.')
        nodes[effect.compositionNode].push(trait.runtimeResources.effectLayer); break
      }
    }
    Object.values(trait.kind === 'oralDetail' ? trait.runtimeResources.oralProjections : resources).forEach(verifyRef)
  }
  verifyRef(family.neutralMaster); verifyRef(family.materialMap); Object.values(replayMasks).flat().forEach(verifyRef)
  // Visible external rasters have exactly one occurrence and one owner. Material
  // inputs and template masks are not draws; derived replays have their own nodes.
  const visibleOwners = new Map<string, V09CompositionNodeId>()
  for (const node of V09_COMPOSITION_NODE_IDS) for (const ref of nodes[node]) if (ref.mediaType === 'image/png') {
    const previous = visibleOwners.get(ref.resourceId)
    if (previous !== undefined) fail('UNREGISTERED_ALPHA_SOURCE', `Visible resource ${ref.resourceId} is owned by both ${previous} and ${node}.`)
    visibleOwners.set(ref.resourceId, node)
  }
  const composite = freeze({ versionTuple: { ...V09_VERSION_TUPLE }, speciesRigId: spec.speciesRigId, skeletonFamilyId: family.skeletonFamilyId, assemblyTemplateId: template.assemblyTemplateId, releaseManifestSha256: catalog.releaseManifestSha256, orderedNodes: nodes, sourceArtifactSha256s })
  resolved.set(composite, freeze({ family, template, replayMasks }))
  return composite
}

function requireIdentity(context: CanvasRenderingContext2D): void {
  const matrix = context.getTransform()
  if ([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) fail('NON_IDENTITY_TRANSFORM', 'Destination transform must be identity.')
  if (context.canvas.width !== 2048 || context.canvas.height !== 2048) fail('NON_IDENTITY_TRANSFORM', 'Destination canvas must be 2048x2048.')
}

function replay(surface: Uint8Array, masks: readonly V09DecodedPng[]): Uint8Array {
  const output = new Uint8Array(surface.length)
  for (const mask of masks) for (let i = 0; i < surface.length; i += 4) {
    const pixels = mask.pixels
    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0 || (pixels[i + 3] !== 0 && pixels[i + 3] !== 255)) fail('UNREGISTERED_ALPHA_SOURCE', 'Replay masks must have zero RGB and binary alpha.')
    if (pixels[i + 3] === 255) output.set(surface.subarray(i, i + 4), i)
  }
  return output
}

/** Preflight and materialize the full frame before issuing any destination draw. */
export async function renderMonsterV09(context: CanvasRenderingContext2D, composite: ResolvedCompositeV09, resolver: V09ResourceResolver): Promise<V09RenderResult> {
  const state = resolved.get(composite)
  if (!state) fail('UNREGISTERED_ALPHA_SOURCE', 'Only an intact, catalog-resolved composite can supply resources and replay masks.')
  requireIdentity(context)
  forbidPlacement(resolver)
  const cache = new Map<string, Promise<V09DecodedPng>>()
  const load = (ref: PngResourceRef): Promise<V09DecodedPng> => {
    verifyRef(ref)
    let pending = cache.get(ref.resourceId)
    if (!pending) {
      pending = resolver.resolvePng(ref).then(value => {
        if (value.sha256 !== ref.sha256 || value.width !== 2048 || value.height !== 2048) fail('RESOURCE_HASH_MISMATCH', 'Resolver did not verify the requested 2048x2048 content.')
        requireV09Pixels(value.pixels, 'RESOURCE_HASH_MISMATCH')
        return { ...value, pixels: new Uint8Array(value.pixels) }
      }).catch(error => { if (error instanceof V09RenderError) throw error; throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'PNG resource could not be verified.', { cause: error }) })
      cache.set(ref.resourceId, pending)
    }
    return pending
  }
  const operations: V09DecodedMaterialOperation[] = []
  for (const [index, slotId] of V09_SURFACE_ORDER.entries()) {
    const ref = composite.orderedNodes[surfaceNodes[index]!]![0] as JsonResourceRef
    let document: Awaited<ReturnType<V09ResourceResolver['resolveJson']>>
    try { document = await resolver.resolveJson(ref) } catch (cause) { throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'Material JSON could not be verified.', { cause }) }
    if (document.sha256 !== ref.sha256) fail('RESOURCE_HASH_MISMATCH', 'Material JSON digest mismatch.')
    const operation = parseV09MaterialOperation(document.value)
    const owner = state.template.slots.surface.find(slot => slot.slotId === slotId)!.ownerMaterialId
    if (operation.ownerMaterialId !== owner) fail('SURFACE_OWNER_VIOLATION', 'Operation owner differs from its template slot.')
    const colorMap = operation.colorMap ? (await load(operation.colorMap)).pixels : undefined
    operations.push({ slotId, operation, colorMap })
  }
  const [neutral, map] = await Promise.all([load(state.family.neutralMaster), load(state.family.materialMap)])
  const surface = applyV09MaterialOperations({ neutralMaster: neutral.pixels, materialMap: map.pixels, materialRegistry: state.template.materialRegistry, operations })
  const draws = Object.fromEntries(V09_COMPOSITION_NODE_IDS.map(node => [node, []])) as unknown as Record<V09CompositionNodeId, CanvasImageSource[]>
  for (const node of V09_COMPOSITION_NODE_IDS) for (const ref of composite.orderedNodes[node]) if (ref.mediaType === 'image/png') draws[node].push((await load(ref)).drawable)
  // Validate every mask before asking the resolver to allocate generated drawables.
  const replays: Array<[ReplayNode, Uint8Array]> = []
  for (const node of Object.keys(state.replayMasks) as ReplayNode[]) replays.push([node, replay(surface, await Promise.all(state.replayMasks[node].map(load)))])
  try {
    draws['skeleton.base'].push(await resolver.createDrawable(surface.slice(), 2048, 2048))
    for (const [node, pixels] of replays) draws[node].push(await resolver.createDrawable(pixels, 2048, 2048))
  } catch (cause) { throw new V09RenderError('RESOURCE_MATERIALIZATION_FAILED', 'Generated skeleton or replay drawable could not be created.', { cause }) }
  requireIdentity(context)
  const trace: V09CompositionNodeId[] = []
  for (const node of V09_COMPOSITION_NODE_IDS) {
    trace.push(node)
    for (const drawable of draws[node]) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1; context.filter = 'none'; context.shadowColor = 'rgba(0,0,0,0)'; context.shadowBlur = 0; context.shadowOffsetX = 0; context.shadowOffsetY = 0
      context.drawImage(drawable, 0, 0)
    }
  }
  return { trace }
}
