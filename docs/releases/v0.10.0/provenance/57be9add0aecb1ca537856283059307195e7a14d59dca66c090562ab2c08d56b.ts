import { z } from 'zod'
import type { ParseResult } from './contracts.js'
import { createRng } from './prng.js'

export const COMBINATION_SLOTS = Object.freeze(['coat', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip'] as const)
export const COMBINATION_OPTIONS = Object.freeze({
  coat: Object.freeze(['brown-tabby', 'orange-white', 'tuxedo', 'calico', 'colorpoint', 'rosetted'] as const),
  expression: Object.freeze(['parted-mouth', 'small-fangs', 'tongue-tip'] as const),
  crown: Object.freeze(['none', 'dragon-horns', 'antlers'] as const),
  ears: Object.freeze(['none', 'fin-ears'] as const),
  neck: Object.freeze(['none', 'small-lion-mane'] as const),
  back: Object.freeze(['none', 'small-wings'] as const),
  tailTip: Object.freeze(['none', 'forked-tail-tip'] as const),
})

export type FelineCombinationSlot = typeof COMBINATION_SLOTS[number]
export type FelineCombinationSelections = {
  [S in FelineCombinationSlot]: typeof COMBINATION_OPTIONS[S][number]
}
export type FelineMutationSelections = Pick<FelineCombinationSelections, 'crown' | 'ears' | 'neck' | 'back' | 'tailTip'>

export interface FelineCombinationSpec {
  schemaVersion: 'feline-combination-v1'
  catalogVersion: '0.10.0-candidate.1'
  seed: string
  selections: FelineCombinationSelections
  rolls: Record<FelineCombinationSlot, number>
  locks: FelineCombinationSlot[]
}

const selectionsSchema = z.strictObject({
  coat: z.enum(COMBINATION_OPTIONS.coat),
  expression: z.enum(COMBINATION_OPTIONS.expression),
  crown: z.enum(COMBINATION_OPTIONS.crown),
  ears: z.enum(COMBINATION_OPTIONS.ears),
  neck: z.enum(COMBINATION_OPTIONS.neck),
  back: z.enum(COMBINATION_OPTIONS.back),
  tailTip: z.enum(COMBINATION_OPTIONS.tailTip),
})
const seedSchema = z.string().refine(seed => seed.trim().length > 0, 'Expected a non-blank seed.')
const rollSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const specSchema = z.strictObject({
  schemaVersion: z.literal('feline-combination-v1'),
  catalogVersion: z.literal('0.10.0-candidate.1'),
  seed: seedSchema,
  selections: selectionsSchema,
  rolls: z.strictObject({
    coat: rollSchema, expression: rollSchema, crown: rollSchema, ears: rollSchema,
    neck: rollSchema, back: rollSchema, tailTip: rollSchema,
  }),
  locks: z.array(z.enum(COMBINATION_SLOTS)).refine(locks => new Set(locks).size === locks.length, 'Duplicate locked slot.'),
})

/** Parse decoded JSON. Zod returns detached nested state and rejects unknown keys. */
export function parseFelineCombinationSpec(input: unknown): ParseResult<FelineCombinationSpec> {
  const parsed = specSchema.safeParse(input)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
      ok: false,
      diagnostics: parsed.error.issues.map(issue => ({
        severity: 'error', code: 'invalid-feline-combination',
        path: issue.path.map(String), message: issue.message,
      })),
    }
}

function validatedCopy(input: FelineCombinationSpec): FelineCombinationSpec {
  const result = parseFelineCombinationSpec(input)
  if (!result.ok) {
    throw new Error(`Invalid feline combination: ${result.diagnostics.map(item => `${item.path.join('.') || 'spec'}: ${item.message}`).join('; ')}`)
  }
  return result.value
}

function validateSlot(slot: FelineCombinationSlot): void {
  if (!COMBINATION_SLOTS.includes(slot)) throw new Error(`Unknown feline combination slot: ${String(slot)}`)
}

/** Uniform candidate preview sampling only; these are not production rarity weights. */
function sampleSlot<S extends FelineCombinationSlot>(spec: FelineCombinationSpec, slot: S): FelineCombinationSelections[S] {
  const options = COMBINATION_OPTIONS[slot]
  const rng = createRng([spec.seed, spec.schemaVersion, spec.catalogVersion, slot, String(spec.rolls[slot])])
  return options[Math.floor(rng.nextFloat() * options.length)] as FelineCombinationSelections[S]
}

function sampleInto<S extends FelineCombinationSlot>(spec: FelineCombinationSpec, slot: S): void {
  spec.selections[slot] = sampleSlot(spec, slot)
}

/** Generate independent uniform candidate choices, optionally overridden by exact selections. */
export function generateFelineCombination(seed: string, initialSelections: Partial<FelineCombinationSelections> = {}): FelineCombinationSpec {
  if (!seedSchema.safeParse(seed).success) throw new Error('Invalid seed: expected a non-blank string.')
  const initial = selectionsSchema.partial().safeParse(initialSelections)
  if (!initial.success) throw new Error(`Invalid initial selections: ${initial.error.message}`)
  const spec: FelineCombinationSpec = {
    schemaVersion: 'feline-combination-v1', catalogVersion: '0.10.0-candidate.1', seed,
    selections: { coat: 'brown-tabby', expression: 'parted-mouth', crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none' },
    rolls: { coat: 0, expression: 0, crown: 0, ears: 0, neck: 0, back: 0, tailTip: 0 },
    locks: [],
  }
  for (const slot of COMBINATION_SLOTS) sampleInto(spec, slot)
  Object.assign(spec.selections, initial.data)
  return validatedCopy(spec)
}

/** Explicit choices may replace a locked slot; its reroll counter is preserved. */
export function setFelineCombinationSelection<S extends FelineCombinationSlot>(
  input: FelineCombinationSpec, slot: S, value: FelineCombinationSelections[S],
): FelineCombinationSpec {
  validateSlot(slot)
  const spec = validatedCopy(input)
  spec.selections[slot] = value
  return validatedCopy(spec)
}

function rerollInto(spec: FelineCombinationSpec, slot: FelineCombinationSlot): void {
  if (spec.locks.includes(slot)) return
  if (spec.rolls[slot] === Number.MAX_SAFE_INTEGER) throw new Error(`Reroll counter exhausted for slot ${slot}.`)
  spec.rolls[slot] += 1
  sampleInto(spec, slot)
}

/** Rerolls may repeat the prior option. Locked slots retain selection and counter. */
export function rerollFelineCombinationSlot(input: FelineCombinationSpec, slot: FelineCombinationSlot): FelineCombinationSpec {
  validateSlot(slot)
  const spec = validatedCopy(input)
  rerollInto(spec, slot)
  return spec
}

export function rerollFelineCombination(input: FelineCombinationSpec): FelineCombinationSpec {
  const spec = validatedCopy(input)
  for (const slot of COMBINATION_SLOTS) rerollInto(spec, slot)
  return spec
}

/** Enumerates exact specifications for coverage, not random sampling or approved artwork. */
export function enumerateFelineCombinations(seed = 'feline-combination-enumeration'): FelineCombinationSpec[] {
  let specs = [generateFelineCombination(seed)]
  for (const slot of COMBINATION_SLOTS) {
    specs = specs.flatMap(spec => COMBINATION_OPTIONS[slot].map(value => setFelineCombinationSelection(spec, slot, value)))
  }
  return specs
}

const mutationSlots = ['crown', 'ears', 'neck', 'back', 'tailTip'] as const

/** External lists must contain concrete mutations; omission represents no mutation. */
export function mutationSelectionsFromList(mutations: readonly string[]): FelineMutationSelections {
  if (!Array.isArray(mutations)) throw new Error('Expected a mutation list.')
  const selections: FelineMutationSelections = { crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none' }
  for (const mutation of mutations) {
    const slot = mutationSlots.find(candidate => mutation !== 'none' && (COMBINATION_OPTIONS[candidate] as readonly unknown[]).includes(mutation))
    if (slot === undefined) throw new Error(`Unknown mutation: ${String(mutation)}`)
    if (selections[slot] !== 'none') throw new Error(`Conflicting mutations at position ${slot}: ${selections[slot]} and ${mutation}`)
    // The option lookup above proves this value belongs to this position.
    Object.assign(selections, { [slot]: mutation })
  }
  return selections
}
