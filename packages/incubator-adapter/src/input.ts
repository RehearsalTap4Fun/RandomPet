import { createRng, type GenerationRequest, type ThemeId } from '@qmonster/generator-core'
import type { AdapterResult, IncubatorEggInput } from './contracts.js'
import { parseIncubatorEggInput } from './schema.js'

const themeMap: Record<IncubatorEggInput['theme'], ThemeId> = {
  deep_sea: 'deep-sea',
  fungal: 'fungal',
  shadow: 'shadow',
}

function clampProbability(value: number, maximum: number): number {
  return Math.min(Math.max(value, 0), maximum)
}

export function toGenerationRequest(input: unknown): AdapterResult<GenerationRequest> {
  const parsed = parseIncubatorEggInput(input)
  if (!parsed.ok) return parsed

  const seed = parsed.value.seed
  const themeId = themeMap[parsed.value.theme]
  const aberrationRisk = clampProbability(parsed.value.risk, 0.85)
  const mutationChance = Math.min(
    0.05 + clampProbability(parsed.value.mutationBonus, 0.1),
    0.15,
  )

  const aberrationRoll = createRng([seed, themeId, 'aberration-roll']).nextFloat()
  if (aberrationRoll < aberrationRisk) {
    return { ok: true, value: { seed, themeId, mode: 'aberration' } }
  }

  const mutationRoll = createRng([seed, themeId, 'mutation-roll']).nextFloat()
  return {
    ok: true,
    value: { seed, themeId, mode: mutationRoll < mutationChance ? 'mutation' : 'normal' },
  }
}
