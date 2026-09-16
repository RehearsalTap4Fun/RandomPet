import { z } from 'zod'
import type { ParseResult } from './contracts.js'
import { parseFelineCombinationSpec } from './feline-combination.js'

export const traitIdSchema = z.string().max(100).regex(/^[a-z0-9][a-z0-9._-]*$/)
export const PHENOTYPE_TRAITS = ['body', 'coat', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip'] as const
/** Semantic IDs only. Art coverage is validated independently by each style catalog. */
export const felinePhenotypeSchema = z.strictObject({
  schemaVersion: z.literal('feline-phenotype-v1'),
  body: traitIdSchema, coat: traitIdSchema, expression: traitIdSchema,
  crown: traitIdSchema, ears: traitIdSchema, neck: traitIdSchema, back: traitIdSchema, tailTip: traitIdSchema,
})
export type FelinePhenotype = z.infer<typeof felinePhenotypeSchema>

export function parseFelinePhenotype(input: unknown): ParseResult<FelinePhenotype> {
  const parsed = felinePhenotypeSchema.safeParse(input)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, diagnostics: parsed.error.issues.map(issue => ({
    severity: 'error', code: 'invalid-feline-phenotype', path: issue.path.map(String), message: issue.message,
  })) }
}

/** Preserve already-resolved traits. Never re-run the legacy RNG during migration. */
export function phenotypeFromLegacy(input: unknown): FelinePhenotype {
  const parsed = parseFelineCombinationSpec(input)
  if (!parsed.ok) throw new Error('Invalid legacy feline save.')
  return { schemaVersion: 'feline-phenotype-v1', body: 'standard', ...parsed.value.selections }
}

export function phenotypeKey(input: FelinePhenotype): string {
  const value = felinePhenotypeSchema.parse(input)
  return JSON.stringify(PHENOTYPE_TRAITS.map(key => value[key]))
}
