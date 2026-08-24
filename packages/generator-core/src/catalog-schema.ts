import { z } from 'zod'
import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type Diagnostic,
  type ParseResult,
} from './contracts.js'

const ThemeIdSchema = z.enum(['deep-sea', 'fungal', 'shadow'])
const RigIdSchema = z.enum(['blob', 'biped', 'floating'])
const VisualSlotIdSchema = z.enum(VISUAL_SLOT_IDS)
const SemanticSlotIdSchema = z.enum(SEMANTIC_SLOT_IDS)
const RenderLayerSchema = z.enum([
  'groundShadow', 'rearAppendage', 'body', 'surface', 'pattern',
  'frontAppendage', 'head', 'faceAndHeadwear', 'foregroundEffect',
])
const coordinate = z.number().finite().min(0).max(2048)
const weight = z.number().finite().min(0)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i)
const LegacyApprovedTransformSchema = z.object({
  scale: z.number().finite().positive(),
  mirrorX: z.boolean(),
})
const CompositionTransformSchema = z.object({
  scale: z.number().finite().positive(),
  mirrorX: z.boolean(),
}).strict()
const Point2DSchema = z.object({ x: coordinate, y: coordinate }).strict()
const RectSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().positive().max(2048),
  height: z.number().finite().positive().max(2048),
}).strict().refine(rect => rect.x + rect.width <= 2048 && rect.y + rect.height <= 2048, {
  message: 'Rectangle must fit inside the 2048px local canvas.',
})
const RenderNodeDefinitionSchema = z.object({
  id: z.string().min(1),
  assetPath: z.string().min(1),
  pngPath: z.string().min(1).optional(),
  assetSha256: sha256.optional(),
  pngSha256: sha256.optional(),
  parentSlot: VisualSlotIdSchema.nullable(),
  socket: z.string().min(1).nullable(),
  origin: Point2DSchema,
  transform: CompositionTransformSchema,
  layer: RenderLayerSchema,
  compatibleRigs: z.array(RigIdSchema).min(1),
  clipPolicy: z.enum(['none', 'body', 'protect-face']),
}).strict()
const CompositionGeometrySchema = z.object({
  sockets: z.record(z.string().min(1), Point2DSchema),
  faceSafeZone: RectSchema.optional(),
}).strict()
const PartCompositionSchema = z.object({
  isNone: z.boolean(),
  motifTags: z.array(ThemeIdSchema),
  visualIntensity: z.enum(['quiet', 'strong']),
  renderNodes: z.array(RenderNodeDefinitionSchema),
  geometryByRig: z.partialRecord(RigIdSchema, CompositionGeometrySchema),
}).strict()
const CompositionPolicySchema = z.object({
  motifSlots: z.array(VisualSlotIdSchema),
  surpriseRatio: z.literal(0.3),
  maxStrongFeatures: z.literal(2),
  optionalNoneRate: z.object({ min: z.literal(0.35), max: z.literal(0.5) }).strict(),
  frameBounds: RectSchema,
  faceInsideRatio: z.literal(0.8),
  faceVisibleRatio: z.literal(0.85),
}).strict()
const displayMetadata = {
  displayName: z.string().min(1).optional(),
  flavorText: z.string().min(1).optional(),
}
const productionMetadata = {
  ...displayMetadata,
  rarity: z.enum(['N', 'R', 'L']).optional(),
  themeBoosts: z.partialRecord(ThemeIdSchema, weight).optional(),
  excludes: z.array(z.string().min(1)).optional(),
  boosts: z.record(z.string().min(1), weight).optional(),
  visualMapping: z.record(z.string().min(1), z.unknown()).optional(),
}

const PaletteSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
  accent: z.string().min(1),
})

const ModifierOverridesSchema = z.object({
  palette: PaletteSchema.optional(),
  duplicateLayerGroup: z.literal('head').optional(),
  relocateSlot: z.literal('eyes').optional(),
  socket: z.string().min(1).optional(),
}).strict().superRefine((overrides, context) => {
  if (
    (overrides.duplicateLayerGroup !== undefined || overrides.relocateSlot !== undefined)
    && overrides.socket === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['socket'],
      message: 'Behavioral modifier overrides require a destination socket.',
    })
  }
})

const RigDefinitionSchema = z.object({
  id: RigIdSchema,
  sockets: z.record(z.string().min(1), z.object({ x: coordinate, y: coordinate })),
  sourceId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
})

const VisualPartDefinitionSchema = z.object({
  id: z.string().min(1),
  slotId: VisualSlotIdSchema,
  rarity: z.enum(['N', 'R', 'L']),
  baseWeight: weight,
  themeIds: z.array(ThemeIdSchema).min(1),
  themeWeights: z.partialRecord(ThemeIdSchema, weight),
  compatibleRigs: z.array(RigIdSchema).min(1),
  assetPath: z.string().min(1),
  assetSha256: sha256.optional(),
  pngPath: z.string().min(1).optional(),
  pngSha256: sha256.optional(),
  approvedTransforms: z.array(LegacyApprovedTransformSchema).optional(),
  maskPaths: z.object({ primary: z.string().min(1).optional(), secondary: z.string().min(1).optional() }),
  maskSha256: z.object({ primary: z.string().regex(/^[a-f0-9]{64}$/i).optional(), secondary: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).optional(),
  rigMaskPaths: z.partialRecord(RigIdSchema, z.object({
    primary: z.string().min(1),
    secondary: z.string().min(1),
    accent: z.string().min(1),
  })).optional(),
  rigMaskSha256: z.partialRecord(RigIdSchema, z.object({
    primary: sha256,
    secondary: sha256,
    accent: sha256,
  })).optional(),
  origin: z.object({ x: coordinate, y: coordinate }),
  socket: z.string().min(1).nullable(),
  layer: RenderLayerSchema,
  semanticTraitId: z.string().min(1).nullable(),
  semanticPriority: z.number().finite(),
  excludes: z.array(z.string().min(1)),
  boosts: z.record(z.string().min(1), weight),
  ...displayMetadata,
  description: z.string().min(1).optional(),
  composition: PartCompositionSchema.optional(),
})

export const CatalogSchema = z.object({
  version: z.string().min(1),
  themes: z.array(z.object({ id: ThemeIdSchema, palette: PaletteSchema, ...displayMetadata })),
  rigs: z.array(RigDefinitionSchema),
  parts: z.array(VisualPartDefinitionSchema),
  semanticTraits: z.array(z.object({
    id: z.string().min(1),
    semanticSlotId: SemanticSlotIdSchema,
    ...productionMetadata,
  })),
  modifiers: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['mutation', 'aberration']),
    baseWeight: weight,
    requiresMutation: z.boolean(),
    overrides: ModifierOverridesSchema,
    ...productionMetadata,
  })),
  dependencies: z.partialRecord(VisualSlotIdSchema, z.array(VisualSlotIdSchema)),
  compositionPolicy: CompositionPolicySchema.optional(),
}).superRefine((catalog, context) => {
  if (catalog.version !== '0.2.0') return
  if (catalog.compositionPolicy === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['compositionPolicy'],
      message: 'Catalog 0.2.0 requires composition metadata.',
    })
  }
  for (const [index, part] of catalog.parts.entries()) {
    if (part.composition === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['parts', index, 'composition'],
        message: 'Catalog 0.2.0 requires composition metadata for every part.',
      })
    }
  }
})

function toDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return {
    severity: 'error',
    code: `CATALOG_SCHEMA_${issue.code.toUpperCase()}`,
    path: issue.path.map(String),
    message: issue.message,
  }
}

export function parseCatalog(input: unknown): ParseResult<Catalog> {
  const parsed = CatalogSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map(toDiagnostic) }
  }

  return { ok: true, value: parsed.data as Catalog }
}
