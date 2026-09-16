import { z } from 'zod'
import type { ParseResult } from './contracts.js'
import { felinePhenotypeSchema, phenotypeFromLegacy, traitIdSchema } from './feline-phenotype.js'

export const PHENOTYPE_TRAITS_V2 = [
  'body', 'coat', 'eyes', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip',
] as const

/** Semantic IDs only. Art coverage is validated independently by each style catalog. */
export const felinePhenotypeV2Schema = z.strictObject({
  schemaVersion: z.literal('feline-phenotype-v2'),
  body: traitIdSchema, coat: traitIdSchema, eyes: traitIdSchema, expression: traitIdSchema,
  crown: traitIdSchema, ears: traitIdSchema, neck: traitIdSchema, back: traitIdSchema, tailTip: traitIdSchema,
})
export type FelinePhenotypeV2 = z.infer<typeof felinePhenotypeV2Schema>

export function parseFelinePhenotypeV2(input: unknown): ParseResult<FelinePhenotypeV2> {
  const parsed = felinePhenotypeV2Schema.safeParse(input)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, diagnostics: parsed.error.issues.map(issue => ({
    severity: 'error', code: 'invalid-feline-phenotype-v2', path: issue.path.map(String), message: issue.message,
  })) }
}

/** Preserve resolved v1 traits and use the established round-eye default. */
export function phenotypeV2FromV1(input: unknown): FelinePhenotypeV2 {
  const phenotype = felinePhenotypeSchema.parse(input)
  return { schemaVersion: 'feline-phenotype-v2', body: phenotype.body, coat: phenotype.coat, eyes: 'round',
    expression: phenotype.expression, crown: phenotype.crown, ears: phenotype.ears, neck: phenotype.neck,
    back: phenotype.back, tailTip: phenotype.tailTip }
}

/** Preserve already-resolved legacy traits. Never re-run the legacy RNG during migration. */
export function phenotypeV2FromLegacy(input: unknown): FelinePhenotypeV2 {
  return phenotypeV2FromV1(phenotypeFromLegacy(input))
}

export function phenotypeKeyV2(input: FelinePhenotypeV2): string {
  const phenotype = felinePhenotypeV2Schema.parse(input)
  return JSON.stringify(PHENOTYPE_TRAITS_V2.map(key => phenotype[key]))
}
