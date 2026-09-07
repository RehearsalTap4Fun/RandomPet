export const VISUAL_SLOT_IDS = [
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
] as const

export const GENOME_VERSION = '0.1.0' as const
export const GENOME_LAYERS = ['P', 'H1', 'H2', 'H3'] as const
export type GenomeLayer = typeof GENOME_LAYERS[number]

export interface SlotGenes {
  P: string
  H1: string
  H2: string
  H3: string
}

export interface MonsterGenome {
  genomeVersion: typeof GENOME_VERSION
  genes: Record<VisualSlotId, SlotGenes>
}

export const STRUCTURAL_SLOT_IDS = [
  'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
] as const satisfies readonly (typeof VISUAL_SLOT_IDS[number])[]

export const NON_FACIAL_VISUAL_SLOT_IDS = [
  'surfaceMaterial', 'pattern', 'effect',
] as const satisfies readonly (typeof VISUAL_SLOT_IDS[number])[]
export type NonFacialVisualSlotId = typeof NON_FACIAL_VISUAL_SLOT_IDS[number]

export const SEMANTIC_SLOT_IDS = [
  'frame', 'appendage', 'headAndEyes', 'mouth',
  'surface', 'pattern', 'personality', 'quirk',
] as const

export type VisualSlotId = typeof VISUAL_SLOT_IDS[number]
export type SemanticSlotId = typeof SEMANTIC_SLOT_IDS[number]
export type ThemeId = 'deep-sea' | 'fungal' | 'shadow'
export type GenerationMode = 'normal' | 'mutation' | 'aberration'
export const ANIMAL_ARCHETYPE_IDS = ['feline', 'canine', 'lagomorph'] as const
export type AnimalArchetypeId = typeof ANIMAL_ARCHETYPE_IDS[number]
export type SpecialFeatureAnchor = 'ear' | 'back' | 'tailTip'
export type FeatureTier = 'base' | 'special'
export type RigId = 'blob' | 'biped' | 'floating' | 'feline-sit'
export type RenderLayer =
  | 'groundShadow' | 'rearAppendage' | 'body' | 'surface' | 'pattern'
  | 'frontAppendage' | 'head' | 'faceAndHeadwear' | 'foregroundEffect'
export type Severity = 'warning' | 'error'
export type ClipPolicy = 'none' | 'body' | 'protect-face'
export type VisualIntensity = 'quiet' | 'strong'

export interface Point2D { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface RenderNodeDefinition {
  id: string
  connectorId?: string
  assetPath: string
  pngPath?: string
  assetSha256?: string
  pngSha256?: string
  parentSlot: VisualSlotId | null
  socket: string | null
  origin: Point2D
  transform: ApprovedTransform
  layer: RenderLayer
  compatibleRigs: RigId[]
  clipPolicy: ClipPolicy
}

export interface CompositionGeometry {
  sockets: Record<string, Point2D>
  faceSafeZone?: Rect
}

export type StructuralSlotId = typeof STRUCTURAL_SLOT_IDS[number]

export const LOCAL_VISUAL_SLOT_IDS = [
  'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
] as const satisfies readonly (typeof VISUAL_SLOT_IDS[number])[]
export type LocalVisualSlotId = typeof LOCAL_VISUAL_SLOT_IDS[number]
export type Rarity = 'N' | 'R' | 'L'
export const RARITY_WEIGHTS: Record<Rarity, number> = { N: 70, R: 25, L: 5 }
export const PART_RARITY_WEIGHTS: Record<Rarity, number> = { N: 8, R: 4, L: 1 }
export const INDEPENDENT_PART_POOL_COUNTS: Record<Rarity, number> = { N: 8, R: 4, L: 1 }

const STRUCTURAL_SLOT_ID_SET = new Set<VisualSlotId>(STRUCTURAL_SLOT_IDS)
const LOCAL_VISUAL_SLOT_ID_SET = new Set<VisualSlotId>(LOCAL_VISUAL_SLOT_IDS)

export function isStructuralSlot(slotId: VisualSlotId): slotId is StructuralSlotId {
  return STRUCTURAL_SLOT_ID_SET.has(slotId)
}

export function isLocalVisualSlot(slotId: VisualSlotId): slotId is LocalVisualSlotId {
  return LOCAL_VISUAL_SLOT_ID_SET.has(slotId)
}
export type ConnectorRole = 'receiver' | 'plug'
export type ConnectorClass = 'neck' | 'shoulder' | 'hip' | 'tail' | 'extra'
export type MaterialFamily = 'short-fur' | 'mushroom-velvet' | 'soft-skin'

export interface WarpLimits {
  widthRatio: { min: number; max: number }
  depthRatio: { min: number; max: number }
  rotationDegrees: { min: number; max: number }
}

export interface ConnectorProfile {
  id: string
  role: ConnectorRole
  connectorClass: ConnectorClass
  rigId: RigId
  origin: Point2D
  tangent: Point2D
  outwardNormal: Point2D
  width: number
  depth: number
  contourMaskPath: string
  contourMaskSha256: string
  foregroundMaskPath: string
  foregroundMaskSha256: string
  backgroundMaskPath: string
  backgroundMaskSha256: string
  materialSampleRegion: Rect
  warpLimits: WarpLimits
}

export interface StructuralVariantDefinition {
  rigId: RigId
  materialFamily: MaterialFamily
  renderNodes: RenderNodeDefinition[]
  connectors: ConnectorProfile[]
  faceSafeZones?: Rect[]
  featureSockets?: Record<string, Point2D>
}

export interface TransitionBridgeDefinition {
  id: string
  rigId: RigId
  connectorClass: ConnectorClass
  materialFamilies: MaterialFamily[]
  neutralAssetPath: string
  neutralPngPath: string
  neutralAssetSha256: string
  neutralPngSha256: string
  frontMaskPath: string
  frontMaskSha256: string
  backMaskPath: string
  backMaskSha256: string
}

interface CompositionMetadata {
  isNone: boolean
  motifTags: ThemeId[]
  visualIntensity: VisualIntensity
}

export interface AttachmentPartComposition extends CompositionMetadata {
  mode?: 'attachment'
  renderNodes: RenderNodeDefinition[]
  geometryByRig: Partial<Record<RigId, CompositionGeometry>>
}

export interface InterfacePartComposition extends CompositionMetadata {
  mode: 'interface'
  variantsByRig: Partial<Record<RigId, StructuralVariantDefinition>>
}

export interface BundlePartComposition extends Omit<AttachmentPartComposition, 'mode'> {
  mode: 'bundle'
  bundleId: string
}

export type PartComposition = AttachmentPartComposition | InterfacePartComposition | BundlePartComposition

export function isAttachmentPartComposition(
  composition: PartComposition | undefined,
): composition is AttachmentPartComposition {
  return composition !== undefined && (composition.mode === undefined || composition.mode === 'attachment')
}

export interface CompositionPolicy {
  motifSlots: VisualSlotId[]
  surpriseRatio: 0.3
  maxStrongFeatures: 2
  maxStrongNonFacialFeatures?: 1
  optionalNoneRate: { min: 0.35; max: 0.5 }
  frameBounds: Rect
  faceInsideRatio: 0.8 | 0.84
  faceVisibleRatio: 0.84 | 0.85
}

export interface Diagnostic {
  severity: Severity
  code: string
  path: string[]
  message: string
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] }

export interface Palette {
  primary: string
  secondary: string
  accent: string
}

export interface VisualSelection {
  partId: string
  rigId: RigId
  transform?: ApprovedTransform
}

export interface SemanticTraitSelection {
  primaryTraitId: string
  detailTraitIds: string[]
}

export interface ModifierOverrides {
  palette?: Palette
  duplicateLayerGroup?: 'head'
  relocateSlot?: 'eyes'
  socket?: string
}

export interface ModifierApplication {
  id: string
  overrides: ModifierOverrides
}

export interface MonsterSpec {
  schemaVersion: string
  catalogVersion: string
  rendererVersion: string
  seed: string
  themeId: ThemeId
  palette: Palette
  slotRolls: Record<VisualSlotId, number>
  visualSlots: Record<VisualSlotId, VisualSelection>
  genome?: MonsterGenome
  semanticTraits: Record<SemanticSlotId, SemanticTraitSelection>
  mutation: ModifierApplication | null
  aberrations: ModifierApplication[]
  archetypeId?: AnimalArchetypeId
  anatomyBundleId?: string
}

export interface ResourceRef {
  assetPath: string
  assetSha256: string
  pngPath: string
  pngSha256: string
}

export interface AnatomyBundleDefinition {
  id: string
  archetypeId: AnimalArchetypeId
  rigId: RigId
  poseId: string
  rarity: Rarity
  baseWeight: number
  structural: ResourceRef
  alpha: ResourceRef
  clip: ResourceRef
  faceSafeZone: Rect
  featureSockets: Record<string, Point2D>
  mutationAnchors: Record<string, Rect>
  derivedSlots: Record<StructuralSlotId, string>
  allowedTraitPools: Record<LocalVisualSlotId, string[]>
  partPools?: Record<VisualSlotId, string[]>
}

export interface IndependentPartAnatomyBundleDefinition extends AnatomyBundleDefinition {
  partPools: Record<VisualSlotId, string[]>
}

export interface AnimalArchetypeDefinition {
  id: AnimalArchetypeId
  displayName: string
  rigIds: RigId[]
  defaultRigId: RigId
  requiredVisibleSlots: VisualSlotId[]
  integratedSlots: VisualSlotId[]
  specialFeatureSlots: VisualSlotId[]
}

export interface SupportedSpecVersions {
  schemaVersion: string
  rendererVersion: string
}

export interface ThemeDefinition {
  id: ThemeId
  palette: Palette
  displayName?: string
  flavorText?: string
}

export interface RigDefinition {
  id: RigId
  sockets: Record<string, { x: number; y: number }>
  sourceId?: string
  displayName?: string
}

export interface ApprovedTransform {
  scale: number
  mirrorX: boolean
}

export interface VisualPartDefinition {
  id: string
  slotId: VisualSlotId
  rarity: Rarity
  baseWeight: number
  themeIds: string[]
  themeWeights: Partial<Record<ThemeId, number>>
  compatibleRigs: RigId[]
  assetPath: string
  assetSha256?: string
  approvedTransforms?: ApprovedTransform[]
  maskPaths: { primary?: string; secondary?: string }
  maskSha256?: { primary?: string; secondary?: string }
  rigMaskPaths?: Partial<Record<RigId, {
    primary: string
    secondary: string
    accent: string
  }>>
  rigMaskSha256?: Partial<Record<RigId, {
    primary: string
    secondary: string
    accent: string
  }>>
  origin: { x: number; y: number }
  socket: string | null
  layer: RenderLayer
  semanticTraitId: string | null
  semanticPriority: number
  excludes: string[]
  boosts: Record<string, number>
  displayName?: string
  flavorText?: string
  description?: string
  pngPath?: string
  pngSha256?: string
  composition?: PartComposition
  archetypeIds?: AnimalArchetypeId[]
  featureTier?: FeatureTier
  specialFeatureAnchor?: SpecialFeatureAnchor
}

export interface SemanticTraitDefinition {
  id: string
  semanticSlotId: SemanticSlotId
  displayName?: string
  flavorText?: string
  rarity?: Rarity
  themeBoosts?: Partial<Record<ThemeId, number>>
  excludes?: string[]
  boosts?: Record<string, number>
  visualMapping?: Record<string, unknown>
}

export interface ModifierDefinition {
  id: string
  kind: 'mutation' | 'aberration'
  baseWeight: number
  requiresMutation: boolean
  overrides: ModifierOverrides
  displayName?: string
  flavorText?: string
  rarity?: Rarity
  themeBoosts?: Partial<Record<ThemeId, number>>
  excludes?: string[]
  boosts?: Record<string, number>
  visualMapping?: Record<string, unknown>
}

export interface Catalog {
  version: string
  themes: ThemeDefinition[]
  rigs: RigDefinition[]
  parts: VisualPartDefinition[]
  semanticTraits: SemanticTraitDefinition[]
  modifiers: ModifierDefinition[]
  dependencies: Partial<Record<VisualSlotId, VisualSlotId[]>>
  compositionPolicy?: CompositionPolicy
  transitionBridges?: TransitionBridgeDefinition[]
  archetypes?: AnimalArchetypeDefinition[]
  anatomyBundles?: AnatomyBundleDefinition[]
}

export interface IndependentPartCatalog extends Catalog {
  version: '0.7.0'
  anatomyBundles: IndependentPartAnatomyBundleDefinition[]
}

export function isIndependentPartCatalog(catalog: Catalog): catalog is IndependentPartCatalog {
  return catalog.version === '0.7.0'
}

export const COMPOSITION_PARENT_BY_SLOT: Record<VisualSlotId, VisualSlotId | null> = {
  bodyFrame: null,
  headShape: 'bodyFrame',
  eyes: 'headShape',
  mouthShape: 'headShape',
  oralDetail: 'mouthShape',
  headAppendage: 'headShape',
  arms: 'bodyFrame',
  legs: 'bodyFrame',
  tail: 'bodyFrame',
  extraAppendage: 'bodyFrame',
  surfaceMaterial: 'bodyFrame',
  pattern: 'bodyFrame',
  colorScheme: 'bodyFrame',
  effect: 'bodyFrame',
}

export interface GenerationRequest {
  seed: string
  themeId: ThemeId
  mode: GenerationMode
  slotRolls?: Partial<Record<VisualSlotId, number>>
  lockedSelections?: Partial<Record<VisualSlotId, string>>
  archetypeId?: AnimalArchetypeId
}

export interface DiagnosticRevalidationScopes {
  visualSlots?: VisualSlotId[]
  genomeGenes?: Partial<Record<GenomeLayer, VisualSlotId[]>>
  fullGenome?: boolean
}

export interface GenerationResult {
  spec: MonsterSpec
  diagnostics: Diagnostic[]
  blocked: boolean
  affectedSlots: VisualSlotId[]
  revalidatedDiagnosticScopes?: DiagnosticRevalidationScopes
}
