import { z } from 'zod'
import { mutationSelectionsFromList } from '@qmonster/generator-core'
import { FELINE_MUTATION_IDS, parseFelineCombinationCatalog, type FelineCombinationResource } from '@qmonster/asset-catalog'
import { composeFelineLayers, type FelineCanvasLayer, type FelineCombinationCanvas,
  type FelineCombinationRenderOptions, type FelineCombinationResourceResolver } from './feline-canvas-compositor.js'

// This is a bounded art study, not a new legacy genotype or a production save format.
const phenotypeSchema = z.strictObject({ body: z.literal('shortleg-round'), coat: z.literal('orange-white'), expression: z.literal('small-fangs') })
const specSchema = z.strictObject({ schemaVersion: z.literal('feline-body-study-v1'),
  profileId: z.literal('shortleg-round-v1'), phenotype: phenotypeSchema,
  mutations: z.array(z.enum(FELINE_MUTATION_IDS)).max(5),
})
const transformSchema = z.strictObject({ scaleX: z.number().positive().max(4), scaleY: z.number().positive().max(4),
  translateX: z.number().min(-1254).max(1254), translateY: z.number().min(-1254).max(1254) })
const coordinate = z.number().min(0).max(1254)
const polygons = z.array(z.array(z.tuple([coordinate, coordinate])).min(3).max(32)).min(1).max(4)
const resourceSchema = z.unknown().transform((input, context): FelineCombinationResource => {
  // Reuse the resource/path/hash validation already owned by the asset catalog.
  const id = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).id : undefined
  const result = parseFelineCombinationCatalog({ schemaVersion: 'feline-combination-catalog-v1', catalogVersion: '0.10.0-candidate.1',
    templateVersion: 'feline-sit-v1', canvas: { width: 1254, height: 1254 }, resources: { [String(id)]: input }, bodies: {}, mutations: {} })
  if (!result.ok) { context.addIssue({ code: 'custom', message: 'Invalid study PNG resource metadata.' }); return z.NEVER }
  return result.value.resources[String(id)]!
})
const profileSchema = z.strictObject({ schemaVersion: z.literal('feline-body-art-profile-v1'), id: z.literal('shortleg-round-v1'),
  phenotype: phenotypeSchema, canvas: z.strictObject({ width: z.literal(1254), height: z.literal(1254) }), body: resourceSchema,
  mutations: z.partialRecord(z.enum(FELINE_MUTATION_IDS), z.strictObject({ resource: resourceSchema, transform: transformSchema,
    occlusion: z.strictObject({ polygons, feather: z.number().min(0).max(32) }).optional() })),
  removal: z.strictObject({ ears: polygons, tailTip: polygons }),
})
export type FelineBodyStudySpec = z.infer<typeof specSchema>
export type FelineBodyArtProfile = z.infer<typeof profileSchema>

/** Resolve phenotype into art; no random rolls, path guessing or legacy schema changes. */
export function resolveFelineBodyStudy(inputSpec: unknown, inputProfile: unknown): readonly FelineCanvasLayer[] {
  const spec = specSchema.parse(inputSpec), profile = profileSchema.parse(inputProfile)
  if (spec.profileId !== profile.id) throw new Error('Body art profile mismatch.')
  if (new Set(spec.mutations).size !== spec.mutations.length) throw new Error('Duplicate study mutation.')
  const selections = mutationSelectionsFromList(spec.mutations)
  const layers: FelineCanvasLayer[] = []
  for (const slot of ['back', 'crown', 'body', 'ears', 'tailTip', 'neck'] as const) {
    if (slot === 'body') { layers.push({ kind: 'draw', surface: 'subject', resource: profile.body }); continue }
    const id = selections[slot]
    if (id === 'none') continue
    const art = profile.mutations[id]
    if (!art) throw new Error(`Missing study art mapping: ${id}.`)
    if (id === 'small-lion-mane' && !art.occlusion) throw new Error('The foreground mane requires a face occlusion mask.')
    if (slot === 'ears' || slot === 'tailTip') layers.push({ kind: 'clear', feather: slot === 'tailTip', polygons: profile.removal[slot] })
    layers.push({ kind: 'draw', surface: slot === 'ears' || id === 'small-lion-mane' ? 'subject' : 'frame', resource: art.resource,
      transform: art.transform, ...(art.occlusion ? { occlusion: art.occlusion } : {}) })
  }
  return layers
}

/** Study and production use the same two-surface renderer, including failure cleanup. */
export async function renderFelineBodyStudy(canvas: FelineCombinationCanvas, spec: unknown, profile: unknown,
  resolver: FelineCombinationResourceResolver, options: FelineCombinationRenderOptions = {}): Promise<void> {
  return composeFelineLayers(canvas, () => resolveFelineBodyStudy(spec, profile), resolver, options)
}
