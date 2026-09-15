import { z } from 'zod'
import {
  COMBINATION_OPTIONS,
  parseFelineCombinationSpec,
  type Diagnostic,
  type FelineCombinationSelections,
  type FelineCombinationSpec,
  type FelineMutationSelections,
  type ParseResult,
} from '@qmonster/generator-core'

export const FELINE_MUTATION_IDS = Object.freeze(['dragon-horns', 'antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip', 'halo', 'dragon-wings', 'feathered-wings', 'frill-neck', 'flame-tail'] as const)
export type FelineMutationId = typeof FELINE_MUTATION_IDS[number]

export interface FelineCombinationResource {
  id: string
  path: string
  sha256: string
  width: 1254
  height: 1254
  mediaType: 'image/png'
  hasAlpha: true
  review: 'pending' | 'approved'
  provenance: { reference: string; prompt: string }
}

export interface FelineCombinationCatalog {
  schemaVersion: 'feline-combination-catalog-v1'
  catalogVersion: '0.10.0-candidate.1'
  templateVersion: 'feline-sit-v1'
  canvas: { width: 1254; height: 1254 }
  resources: Record<string, FelineCombinationResource>
  bodies: Partial<Record<FelineCombinationSelections['coat'], Partial<Record<FelineCombinationSelections['expression'], string>>>>
  mutations: Partial<Record<FelineCombinationSelections['coat'], Partial<Record<FelineMutationId, string>>>>
}

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export type FelineCombinationOperation =
  | { readonly kind: 'draw'; readonly slot: 'body' | keyof FelineMutationSelections; readonly resource: DeepReadonly<FelineCombinationResource> }
  | { readonly kind: 'clear'; readonly region: 'ears' | 'tailTip' }

export interface FelineCombinationRenderPlan {
  readonly schemaVersion: 'feline-combination-render-plan-v1'
  readonly catalogVersion: '0.10.0-candidate.1'
  readonly templateVersion: 'feline-sit-v1'
  readonly canvas: Readonly<{ width: 1254; height: 1254 }>
  readonly spec: DeepReadonly<FelineCombinationSpec>
  readonly operations: readonly FelineCombinationOperation[]
}

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'Expected a lowercase resource ID.')
// Paths are repository-relative POSIX paths, never URLs or caller-defined clear coordinates.
const pathSchema = z.string().refine(path =>
  path.length > 0 && !/[\\:%?#\u0000-\u001f]/.test(path)
  && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && segment.trim() === segment),
'Expected a relative path without traversal, URL syntax, or empty segments.')
const resourceSchema = z.strictObject({
  id: idSchema,
  path: pathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.'),
  width: z.literal(1254), height: z.literal(1254),
  mediaType: z.literal('image/png'), hasAlpha: z.literal(true),
  review: z.enum(['pending', 'approved']),
  provenance: z.strictObject({ reference: pathSchema, prompt: pathSchema }),
})
const catalogSchema = z.strictObject({
  schemaVersion: z.literal('feline-combination-catalog-v1'),
  catalogVersion: z.literal('0.10.0-candidate.1'),
  templateVersion: z.literal('feline-sit-v1'),
  canvas: z.strictObject({ width: z.literal(1254), height: z.literal(1254) }),
  resources: z.record(idSchema, resourceSchema),
  bodies: z.partialRecord(z.enum(COMBINATION_OPTIONS.coat), z.partialRecord(z.enum(COMBINATION_OPTIONS.expression), idSchema)),
  mutations: z.partialRecord(z.enum(COMBINATION_OPTIONS.coat), z.partialRecord(z.enum(FELINE_MUTATION_IDS), idSchema)),
}).superRefine((catalog, context) => {
  for (const [id, resource] of Object.entries(catalog.resources)) {
    if (resource.id !== id) context.addIssue({ code: 'custom', path: ['resources', id, 'id'], message: 'Resource ID must match its map key.' })
  }
  for (const group of ['bodies', 'mutations'] as const) {
    for (const [coat, selections] of Object.entries(catalog[group])) {
      for (const [selection, id] of Object.entries(selections ?? {})) {
        if (typeof id !== 'string' || !Object.hasOwn(catalog.resources, id)) {
          context.addIssue({ code: 'custom', path: [group, coat, selection], message: `Missing resource record: ${id}` })
        }
      }
    }
  }
})

/** Metadata validation only; the resource loader must verify bytes, decoded PNG and digest. */
export function parseFelineCombinationCatalog(input: unknown): ParseResult<FelineCombinationCatalog> {
  const parsed = catalogSchema.safeParse(input)
  return parsed.success ? { ok: true, value: parsed.data } : {
    ok: false,
    diagnostics: parsed.error.issues.map(issue => ({
      severity: 'error', code: 'invalid-feline-combination-catalog', path: issue.path.map(String), message: issue.message,
    })),
  }
}

/** Partial feasibility inventories parse successfully; this audit requires every projection. */
export function auditFelineCombinationCatalog(input: unknown): Diagnostic[] {
  const result = parseFelineCombinationCatalog(input)
  if (!result.ok) return result.diagnostics
  const diagnostics: Diagnostic[] = []
  for (const coat of COMBINATION_OPTIONS.coat) {
    for (const expression of COMBINATION_OPTIONS.expression) {
      if (!result.value.bodies[coat]?.[expression]) diagnostics.push(missingProjection(['bodies', coat, expression]))
    }
    for (const mutation of FELINE_MUTATION_IDS) {
      if (!result.value.mutations[coat]?.[mutation]) diagnostics.push(missingProjection(['mutations', coat, mutation]))
    }
  }
  return diagnostics
}

function missingProjection(path: string[]): Diagnostic {
  return { severity: 'error', code: 'missing-feline-combination-projection', path, message: `Missing resource projection: ${path.join('.')}` }
}

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostics.map(item => `${item.path.join('.') || 'input'}: ${item.message}`).join('; '))
  return result.value
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

/** Resolves exact projections. Pending art is usable for review but never becomes approved here. */
export function resolveFelineCombination(inputSpec: FelineCombinationSpec, inputCatalog: FelineCombinationCatalog): FelineCombinationRenderPlan {
  const spec = unwrap(parseFelineCombinationSpec(inputSpec))
  const catalog = unwrap(parseFelineCombinationCatalog(inputCatalog))
  const { coat, expression } = spec.selections
  const operations: FelineCombinationOperation[] = []
  const getResource = (id: string | undefined, path: string[]): FelineCombinationResource => {
    if (id === undefined) throw new Error(missingProjection(path).message)
    const resource = catalog.resources[id]
    if (resource === undefined) throw new Error(`Missing resource record: ${id}`)
    return resource
  }
  // Validate the selected body first so errors identify the primary missing projection.
  const body = getResource(catalog.bodies[coat]?.[expression], ['bodies', coat, expression])
  const addMutation = (slot: keyof FelineMutationSelections): void => {
    const mutation = spec.selections[slot]
    if (mutation === 'none') return
    const resource = getResource(catalog.mutations[coat]?.[mutation], ['mutations', coat, mutation])
    if (slot === 'ears' || slot === 'tailTip') operations.push({ kind: 'clear', region: slot })
    operations.push({ kind: 'draw', slot, resource })
  }
  addMutation('back')
  addMutation('crown')
  operations.push({ kind: 'draw', slot: 'body', resource: body })
  // The renderer clears only its isolated subject surface, preserving back/crown layers.
  for (const slot of ['ears', 'tailTip', 'neck'] as const) addMutation(slot)
  return freezeDeep({
    schemaVersion: 'feline-combination-render-plan-v1', catalogVersion: catalog.catalogVersion,
    templateVersion: catalog.templateVersion, canvas: catalog.canvas, spec, operations,
  } as const)
}
