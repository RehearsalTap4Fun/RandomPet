import { z } from 'zod'
import type { Diagnostic } from '@qmonster/generator-core'
import type { AdapterResult } from './contracts.js'

const SeedSchema = z.union([
  z.string().min(1).refine(seed => Array.from(seed).length <= 128, {
    message: 'Normalized seed must contain at most 128 code points.',
  }),
  z.number().finite(),
])

export const IncubatorEggInputSchema = z.strictObject({
  id: z.string().min(1),
  theme: z.enum(['deep_sea', 'fungal', 'shadow']),
  seed: SeedSchema,
  risk: z.number().finite(),
  mutationBonus: z.number().finite(),
})

export interface ParsedIncubatorEggInput {
  id: string
  theme: 'deep_sea' | 'fungal' | 'shadow'
  seed: string
  risk: number
  mutationBonus: number
}

function issueCode(issue: z.core.$ZodIssue): string {
  switch (String(issue.path[0] ?? '')) {
    case 'theme':
      return 'ADAPTER_THEME_INVALID'
    case 'seed':
      return 'ADAPTER_SEED_INVALID'
    case 'risk':
    case 'mutationBonus':
      return 'ADAPTER_NUMBER_INVALID'
    default:
      return 'ADAPTER_INPUT_INVALID'
  }
}

function issueDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return {
    severity: 'error',
    code: issueCode(issue),
    path: issue.path.map(String),
    message: issue.message,
  }
}

export function parseIncubatorEggInput(
  input: unknown,
): AdapterResult<ParsedIncubatorEggInput> {
  const parsed = IncubatorEggInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, diagnostics: parsed.error.issues.map(issueDiagnostic) }
  }

  const seed = String(parsed.data.seed)
  if (Array.from(seed).length > 128) {
    return {
      ok: false,
      diagnostics: [{
        severity: 'error',
        code: 'ADAPTER_SEED_INVALID',
        path: ['seed'],
        message: 'Normalized seed must contain at most 128 code points.',
      }],
    }
  }

  return {
    ok: true,
    value: {
      id: parsed.data.id,
      theme: parsed.data.theme,
      seed,
      risk: parsed.data.risk,
      mutationBonus: parsed.data.mutationBonus,
    },
  }
}
