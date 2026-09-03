import { z } from 'zod'
import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Diagnostic,
  type MonsterSpec,
  type ParseResult,
} from './contracts.js'

const RigIdSchema = z.enum(['blob', 'biped', 'floating', 'feline-sit'])
const ThemeIdSchema = z.enum(['deep-sea', 'fungal', 'shadow'])
const AnimalArchetypeIdSchema = z.enum(['feline', 'canine', 'lagomorph'])

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

const VisualSelectionSchema = z.object({
  partId: z.string().min(1),
  rigId: RigIdSchema,
  transform: z.object({
    scale: z.number().finite().positive(),
    mirrorX: z.boolean(),
  }).optional(),
})

const SlotGenesSchema = z.strictObject({
  P: z.string().min(1),
  H1: z.string().min(1),
  H2: z.string().min(1),
  H3: z.string().min(1),
})

const MonsterGenomeSchema = z.strictObject({
  genomeVersion: z.literal('0.1.0'),
  genes: z.record(z.enum(VISUAL_SLOT_IDS), SlotGenesSchema),
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
  genome: MonsterGenomeSchema.optional(),
  semanticTraits: z.record(z.enum(SEMANTIC_SLOT_IDS), SemanticTraitSelectionSchema),
  mutation: ModifierApplicationSchema.nullable(),
  aberrations: z.array(ModifierApplicationSchema),
  archetypeId: AnimalArchetypeIdSchema.optional(),
}).superRefine((spec, context) => {
  if (spec.catalogVersion === '0.6.0' && (
    spec.schemaVersion !== '0.2.0'
    || spec.rendererVersion !== '0.6.0'
    || spec.archetypeId !== 'feline'
  )) {
    context.addIssue({
      code: 'custom',
      path: ['archetypeId'],
      message: 'The v0.6 spec contract requires the feline archetype ID.',
    })
  }
})

function toDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  const path = issue.path.map(String)
  if (
    issue.code === 'invalid_value'
    && path.length === 2
    && path[0] === 'genome'
    && path[1] === 'genomeVersion'
  ) {
    return {
      severity: 'error',
      code: 'SPEC_GENOME_VERSION_UNSUPPORTED',
      path,
      message: 'Monster genome version is unsupported; expected 0.1.0.',
    }
  }

  return {
    severity: 'error',
    code: issue.code,
    path,
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
