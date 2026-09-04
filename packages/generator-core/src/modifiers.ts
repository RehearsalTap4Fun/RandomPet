import type {
  Catalog,
  GenerationMode,
  ModifierApplication,
  ModifierDefinition,
  MonsterSpec,
} from './contracts.js'
import { pickWeighted, type Rng } from './prng.js'

export interface ModifierRolls {
  mutation: Rng
  aberration: Rng
}

export type ModifierState = Pick<MonsterSpec, 'mutation' | 'aberrations'>

function toApplication(modifier: ModifierDefinition): ModifierApplication {
  return {
    id: modifier.id,
    overrides: structuredClone(modifier.overrides),
  }
}

function selectModifier(
  catalog: Catalog,
  kind: ModifierDefinition['kind'],
  rng: Rng,
): ModifierDefinition | null {
  const candidates = catalog.modifiers.filter(
    modifier => modifier.kind === kind && modifier.baseWeight > 0,
  )
  return candidates.length === 0
    ? null
    : pickWeighted(candidates, modifier => modifier.baseWeight, rng)
}

/**
 * Selects modifier overlays without changing the base visual selections. The
 * renderer consumes an application's overrides when expanding visual layers.
 */
export function applyModifiers(
  mode: GenerationMode,
  catalog: Catalog,
  rolls: ModifierRolls,
): ModifierState {
  if (catalog.version === '0.6.0') {
    if (mode === 'normal') return { mutation: null, aberrations: [] }
    const modifier = selectModifier(catalog, mode, mode === 'mutation' ? rolls.mutation : rolls.aberration)
    return mode === 'mutation'
      ? { mutation: modifier === null ? null : toApplication(modifier), aberrations: [] }
      : { mutation: null, aberrations: modifier === null ? [] : [toApplication(modifier)] }
  }
  if (mode === 'normal') {
    return { mutation: null, aberrations: [] }
  }

  if (mode === 'mutation') {
    const mutation = selectModifier(catalog, 'mutation', rolls.mutation)
    return { mutation: mutation === null ? null : toApplication(mutation), aberrations: [] }
  }

  const aberration = selectModifier(catalog, 'aberration', rolls.aberration)
  if (aberration === null) {
    return { mutation: null, aberrations: [] }
  }
  const mutation = aberration.requiresMutation
    ? selectModifier(catalog, 'mutation', rolls.mutation)
    : null
  return {
    mutation: mutation === null ? null : toApplication(mutation),
    aberrations: [toApplication(aberration)],
  }
}
