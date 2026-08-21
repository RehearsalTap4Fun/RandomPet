import { createRng, type GenerationRequest, type ThemeId } from '@qmonster/generator-core'
import type { IncubatorEggInput } from './contracts.js'

const themeMap: Record<IncubatorEggInput['theme'], ThemeId> = {
  deep_sea: 'deep-sea',
  fungal: 'fungal',
  shadow: 'shadow',
}

function clampProbability(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), maximum)
}

export function toGenerationRequest(input: IncubatorEggInput): GenerationRequest {
  const seed = String(input.seed)
  const themeId = themeMap[input.theme]
  const aberrationRisk = clampProbability(input.risk, 0.85)
  const mutationChance = Math.min(0.05 + clampProbability(input.mutationBonus, 0.1), 0.15)

  const aberrationRoll = createRng([seed, themeId, 'aberration-roll']).nextFloat()
  if (aberrationRoll < aberrationRisk) {
    return { seed, themeId, mode: 'aberration' }
  }

  const mutationRoll = createRng([seed, themeId, 'mutation-roll']).nextFloat()
  return { seed, themeId, mode: mutationRoll < mutationChance ? 'mutation' : 'normal' }
}
