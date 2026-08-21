import { z } from 'zod'
import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type MonsterSpec,
  type ParseResult,
} from './contracts.js'

const RigIdSchema = z.enum(['blob', 'biped', 'floating'])
const ThemeIdSchema = z.enum(['deep-sea', 'fungal', 'shadow'])

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
}).strict()

const VisualSelectionSchema = z.object({
  partId: z.string().min(1),
  rigId: RigIdSchema,
})

const SemanticTraitSelectionSchema = z.object({
  primaryTraitId: z.string().min(1),
  detailTraitIds: z.array(z.string().min(1)),
})

const ModifierApplicationSchema = z.object({
  id: z.string().min(1),
  overrides: ModifierOverridesSchema,
})

export const MonsterSpecSchema = z.object({
  schemaVersion: z.string().min(1),
  catalogVersion: z.string().min(1),
  rendererVersion: z.string().min(1),
  seed: z.string().min(1),
  themeId: ThemeIdSchema,
  palette: PaletteSchema,
  slotRolls: z.record(z.enum(VISUAL_SLOT_IDS), z.number().int().min(0)),
  visualSlots: z.record(z.enum(VISUAL_SLOT_IDS), VisualSelectionSchema),
  semanticTraits: z.record(z.enum(SEMANTIC_SLOT_IDS), SemanticTraitSelectionSchema),
  mutation: ModifierApplicationSchema.nullable(),
  aberrations: z.array(ModifierApplicationSchema),
})

function toDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return {
    severity: 'error',
    code: issue.code,
    path: issue.path.map(String),
    message: issue.message,
  }
}

export function parseMonsterSpec(input: unknown): ParseResult<MonsterSpec> {
  const parsed = MonsterSpecSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map(toDiagnostic) }
  }

  return { ok: true, value: parsed.data as MonsterSpec }
}
