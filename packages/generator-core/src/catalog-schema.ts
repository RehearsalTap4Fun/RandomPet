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

const PaletteSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
  accent: z.string().min(1),
})

const RigDefinitionSchema = z.object({
  id: RigIdSchema,
  sockets: z.record(z.string().min(1), z.object({ x: coordinate, y: coordinate })),
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
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  approvedTransforms: z.array(z.object({ scale: z.number().finite().positive(), mirrorX: z.boolean() })).optional(),
  maskPaths: z.object({ primary: z.string().min(1).optional(), secondary: z.string().min(1).optional() }),
  maskSha256: z.object({ primary: z.string().regex(/^[a-f0-9]{64}$/i).optional(), secondary: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).optional(),
  origin: z.object({ x: coordinate, y: coordinate }),
  socket: z.string().min(1).nullable(),
  layer: RenderLayerSchema,
  semanticTraitId: z.string().min(1).nullable(),
  semanticPriority: z.number().finite(),
  excludes: z.array(z.string().min(1)),
  boosts: z.record(z.string().min(1), weight),
})

export const CatalogSchema = z.object({
  version: z.string().min(1),
  themes: z.array(z.object({ id: ThemeIdSchema, palette: PaletteSchema })),
  rigs: z.array(RigDefinitionSchema),
  parts: z.array(VisualPartDefinitionSchema),
  semanticTraits: z.array(z.object({ id: z.string().min(1), semanticSlotId: SemanticSlotIdSchema })),
  modifiers: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['mutation', 'aberration']),
    baseWeight: weight,
    requiresMutation: z.boolean(),
    overrides: z.record(z.string(), z.unknown()),
  })),
  dependencies: z.partialRecord(VisualSlotIdSchema, z.array(VisualSlotIdSchema)),
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
