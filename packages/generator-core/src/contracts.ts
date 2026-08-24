export const VISUAL_SLOT_IDS = [
  'bodyFrame', 'headShape', 'eyes', 'mouthShape', 'oralDetail',
  'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage',
  'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
] as const

export const SEMANTIC_SLOT_IDS = [
  'frame', 'appendage', 'headAndEyes', 'mouth',
  'surface', 'pattern', 'personality', 'quirk',
] as const

export type VisualSlotId = typeof VISUAL_SLOT_IDS[number]
export type SemanticSlotId = typeof SEMANTIC_SLOT_IDS[number]
export type ThemeId = 'deep-sea' | 'fungal' | 'shadow'
export type GenerationMode = 'normal' | 'mutation' | 'aberration'
export type RigId = 'blob' | 'biped' | 'floating'
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

export interface PartComposition {
  isNone: boolean
  motifTags: ThemeId[]
  visualIntensity: VisualIntensity
  renderNodes: RenderNodeDefinition[]
  geometryByRig: Partial<Record<RigId, CompositionGeometry>>
}

export interface CompositionPolicy {
  motifSlots: VisualSlotId[]
  surpriseRatio: 0.3
  maxStrongFeatures: 2
  optionalNoneRate: { min: 0.35; max: 0.5 }
  frameBounds: Rect
  faceInsideRatio: 0.8
  faceVisibleRatio: 0.85
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
  semanticTraits: Record<SemanticSlotId, SemanticTraitSelection>
  mutation: ModifierApplication | null
  aberrations: ModifierApplication[]
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
  rarity: 'N' | 'R' | 'L'
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
}

export interface SemanticTraitDefinition {
  id: string
  semanticSlotId: SemanticSlotId
  displayName?: string
  flavorText?: string
  rarity?: 'N' | 'R' | 'L'
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
  rarity?: 'N' | 'R' | 'L'
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
}

export interface GenerationResult {
  spec: MonsterSpec
  diagnostics: Diagnostic[]
  blocked: boolean
  affectedSlots: VisualSlotId[]
}
