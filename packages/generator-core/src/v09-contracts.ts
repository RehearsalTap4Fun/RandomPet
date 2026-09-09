/**
 * Frozen contracts for the isolated v0.9 release path.
 *
 * These declarations deliberately do not inherit any legacy visual-slot or
 * catalog types: a v0.9 caller must opt into the versioned contracts below.
 */
export const V09_VERSION_TUPLE = {
  schemaVersion: '0.4.0',
  catalogVersion: '0.9.0',
  rendererVersion: '0.9.0',
} as const

export const V09_TRAIT_SLOT_IDS = [
  'bodyColor', 'surfacePattern', 'surfaceTexture',
  'forepawDetail', 'hindpawDetail', 'tailSurface',
  'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'extraAppendage', 'effect',
] as const

export type V09TraitSlotId = typeof V09_TRAIT_SLOT_IDS[number]
export type V09SurfaceSlotId = Extract<V09TraitSlotId,
  'bodyColor' | 'surfacePattern' | 'surfaceTexture' | 'forepawDetail' | 'hindpawDetail' | 'tailSurface'>
export type V09AttachmentSlotId = Extract<V09TraitSlotId, 'headAppendage' | 'extraAppendage'>
export type V09TraitRarity = 'common' | 'rare' | 'legendary'

export const V09_COMPOSITION_NODE_IDS = [
  'backgroundEffect',
  'attachment.behind',
  'skeleton.base',
  'surface.bodyColor',
  'surface.pattern',
  'surface.texture',
  'surface.forepawDetail',
  'surface.hindpawDetail',
  'surface.tailSurface',
  'targetedEffect.underlay',
  'eyePair.underlay',
  'eyePair.content',
  'eyePair.edgeOcclusionReplay',
  'mouth.back',
  'oralDetail',
  'mouth.front',
  'mouth.edgeOcclusionReplay',
  'attachment.front',
  'skeleton.attachmentOcclusionReplay',
  'targetedEffect.overlay',
  'foregroundAmbientEffect',
] as const

export type V09CompositionNodeId = typeof V09_COMPOSITION_NODE_IDS[number]
export type StructuralShapeClass =
  | 'feline-standard' | 'cat-tail-long' | 'cat-tail-curled' | 'dog-tail-curled'
export type AttachmentShapeClass =
  | 'ear-horn-small' | 'ear-ornament' | 'mane-small' | 'collar'

export interface PngResourceRef {
  resourceId: string
  sha256: string
  mediaType: 'image/png'
  width: 2048
  height: 2048
}

export interface JsonResourceRef {
  resourceId: string
  sha256: string
  mediaType: 'application/qmonster-material-v1+json' | 'application/qmonster-manifest-v1+json'
}

export type ContentResourceRef = PngResourceRef | JsonResourceRef
export type V09Canvas = { width: 2048; height: 2048 }

export interface MonsterSpecV09 {
  schemaVersion: typeof V09_VERSION_TUPLE.schemaVersion
  catalogVersion: typeof V09_VERSION_TUPLE.catalogVersion
  rendererVersion: typeof V09_VERSION_TUPLE.rendererVersion
  seed: string
  speciesRigId: 'feline-sit-v2'
  skeletonFamilyId: string
  assemblyTemplateId: string
  skeletonSelection: {
    class: 'base' | 'legendary'
    candidateId: string
    roll: number
  }
  visualSlots: Record<V09TraitSlotId, {
    traitId: string
    rarity: V09TraitRarity
    roll: number
  }>
}

export interface SkeletonFamilyV1 {
  schemaVersion: 'qmonster-skeleton-family-v1'
  skeletonFamilyId: string
  skeletonClass: 'base' | 'legendary'
  structuralShapeClasses: StructuralShapeClass[]
  archetypeId: string
  poseId: string
  speciesRigId: string
  canvas: V09Canvas
  neutralMaster: PngResourceRef
  materialMap: PngResourceRef
  fixedOccluderMasks: Record<string, PngResourceRef>
  assemblyTemplateId: string
}

export interface SkeletonPoolV1 {
  schemaVersion: 'qmonster-skeleton-pool-v1'
  skeletonPoolId: string
  candidates: [
    { skeletonFamilyId: string; skeletonClass: 'base'; weight: 8 },
    { skeletonFamilyId: string; skeletonClass: 'legendary'; weight: 1 },
  ]
}

export interface CompositionGraphV1 {
  schemaVersion: 'qmonster-composition-graph-v1'
  orderedNodes: V09CompositionNodeId[]
  blendMode: 'source-over-premultiplied-srgb'
  transformPolicy: 'identity-only'
}

export interface SurfaceSlotTemplateV1 {
  kind: 'surface'
  slotId: V09SurfaceSlotId
  ownerMaterialId: string
  authoringZone: PngResourceRef
}

export interface EyePairSlotTemplateV1 {
  kind: 'eyePair'
  slotId: 'eyes'
  leftAuthoringZone: PngResourceRef
  rightAuthoringZone: PngResourceRef
  pairAuthoringZone: PngResourceRef
  occlusionReplayZone: PngResourceRef
}

export interface MouthSlotTemplateV1 {
  kind: 'mouth'
  slotId: 'mouthShape'
  authoringZone: PngResourceRef
  occlusionReplayZone: PngResourceRef
}

export interface OralDetailSlotTemplateV1 {
  kind: 'oralDetail'
  slotId: 'oralDetail'
  socketRegistry: Record<string, { authoringZone: PngResourceRef; parentMouthTraitIds: string[] }>
  closedMouthSentinel: 'oral-none'
}

export interface AttachmentSlotTemplateV1 {
  kind: 'attachment'
  slotId: V09AttachmentSlotId
  attachmentInterface: MasterAttachmentInterfaceV1
}

export interface TargetedEffectSlotTemplateV1 {
  kind: 'targetedEffect'
  slotId: 'effect'
  targetId: string
  authoringZone: PngResourceRef
  compositionNode: 'targetedEffect.underlay' | 'targetedEffect.overlay'
}

export interface AmbientEffectSlotTemplateV1 {
  kind: 'ambientEffect'
  slotId: 'effect'
  zoneId: 'background' | 'foreground'
  authoringZone: PngResourceRef
  compositionNode: 'backgroundEffect' | 'foregroundAmbientEffect'
}

export interface MasterAttachmentInterfaceV1 {
  interfaceId: string
  allowedShapeClasses: AttachmentShapeClass[]
  allowedZone: PngResourceRef
  rearRootStencil: PngResourceRef
  frontRootStencil?: PngResourceRef
  fixedOccluderMaskId: string
}

export interface AssemblyTemplateV1 {
  schemaVersion: 'qmonster-assembly-template-v1'
  assemblyTemplateId: string
  skeletonFamilyId: string
  canvas: V09Canvas
  neutralMasterSha256: string
  slots: {
    surface: SurfaceSlotTemplateV1[]
    embedded: Array<EyePairSlotTemplateV1 | MouthSlotTemplateV1 | OralDetailSlotTemplateV1>
    attachment: AttachmentSlotTemplateV1[]
    effect: Array<TargetedEffectSlotTemplateV1 | AmbientEffectSlotTemplateV1>
  }
  compositionGraph: CompositionGraphV1
}

interface SealedTraitArtifactBaseV1 {
  schemaVersion: 'qmonster-sealed-trait-v1'
  traitId: string
  rarity: V09TraitRarity
  skeletonFamilyId: string
  assemblyTemplateId: string
  assemblyTemplateSha256: string
  neutralMasterSha256: string
  authoringInputs: ContentResourceRef[]
  fullContextPreview: PngResourceRef
  sealerVersion: string
}

export interface SealedSurfaceTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'surface'
  slotId: V09SurfaceSlotId
  runtimeResources: { materialOperation: JsonResourceRef }
}

export interface SealedEyePairTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'eyePair'
  slotId: 'eyes'
  runtimeResources: { underlay: PngResourceRef; content: PngResourceRef }
}

export interface SealedMouthTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'mouth'
  slotId: 'mouthShape'
  oralSocketClass: string
  runtimeResources: { mouthBack: PngResourceRef; mouthFront: PngResourceRef }
}

export interface SealedOralDetailTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'oralDetail'
  slotId: 'oralDetail'
  runtimeResources: { oralProjection: PngResourceRef }
}

export interface SealedAttachmentTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'attachment'
  slotId: V09AttachmentSlotId
  interfaceId: string
  shapeClass: AttachmentShapeClass
  runtimeResources: { attachmentBehind: PngResourceRef; attachmentFront?: PngResourceRef }
}

export interface SealedTargetedEffectTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'targetedEffect'
  slotId: 'effect'
  targetId: string
  runtimeResources: { effectLayer: PngResourceRef }
}

export interface SealedAmbientEffectTraitArtifactV1 extends SealedTraitArtifactBaseV1 {
  kind: 'ambientEffect'
  slotId: 'effect'
  zoneId: 'background' | 'foreground'
  runtimeResources: { effectLayer: PngResourceRef }
}

export type SealedTraitArtifactV1 =
  | SealedSurfaceTraitArtifactV1
  | SealedEyePairTraitArtifactV1
  | SealedMouthTraitArtifactV1
  | SealedOralDetailTraitArtifactV1
  | SealedAttachmentTraitArtifactV1
  | SealedTargetedEffectTraitArtifactV1
  | SealedAmbientEffectTraitArtifactV1

export interface ReleaseManifestV09 {
  schemaVersion: 'qmonster-release-v1'
  versionTuple: typeof V09_VERSION_TUPLE
  speciesRig: JsonResourceRef
  skeletonPool: JsonResourceRef
  skeletonFamilies: JsonResourceRef[]
  assemblyTemplates: JsonResourceRef[]
  approvals: JsonResourceRef[]
  traitApprovals: JsonResourceRef[]
  traitInventory: JsonResourceRef
  sealedTraits: JsonResourceRef[]
  compositionGraph: JsonResourceRef
  rendererBuildSha256: string
}

/** A fully verified release loaded from content-addressed resources. */
export interface ResolvedV09Catalog {
  releaseManifestSha256: string
  releaseManifest: ReleaseManifestV09
  speciesRig: JsonResourceRef
  skeletonPool: SkeletonPoolV1
  skeletonFamilies: SkeletonFamilyV1[]
  assemblyTemplates: AssemblyTemplateV1[]
  sealedTraits: SealedTraitArtifactV1[]
  compositionGraph: CompositionGraphV1
}
