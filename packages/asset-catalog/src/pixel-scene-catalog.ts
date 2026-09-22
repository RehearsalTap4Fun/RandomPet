import { z } from 'zod'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import {
  backdropIdSchema,
  requirePixelSceneStateV1,
  type BackdropId,
  type PixelSceneStateV1,
} from '../../generator-core/src/pixel-scene-state.js'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/)
const resourceSchema = z.strictObject({
  path: z.string().min(1),
  sha256: sha256Schema,
  width: z.literal(96),
  height: z.literal(64),
})
const backdropEntrySchema = z.strictObject({
  resourceId: idSchema,
  rarity: z.enum(['N', 'R', 'L']),
  growthRank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  review: z.enum(['pending', 'approved']),
})
const selectableBackdropIdSchema = z.enum(['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail'])

export const pixelSceneCatalogV1Schema = z.strictObject({
  schemaVersion: z.literal('pixel-scene-catalog-v1'),
  sceneVersion: z.string().min(1),
  revision: sha256Schema,
  rendererVersion: z.literal('pixel-scene-rgba-v1'),
  canvas: z.strictObject({ width: z.literal(96), height: z.literal(64) }),
  subject: z.strictObject({
    schemaVersion: z.literal('feline-phenotype-v2'),
    catalogSchemaVersion: z.literal('pixel-art-catalog-v3'),
    rendererVersion: z.literal('pixel-rgba-v1'),
    width: z.literal(64),
    height: z.literal(64),
    anchor: z.strictObject({ x: z.literal(16), y: z.literal(0) }),
  }),
  outline: z.strictObject({
    owner: z.literal('scene-renderer'),
    neighborhood: z.literal('four'),
    width: z.literal(1),
    color: z.literal('adjacent-mean-darken'),
    factor: z.literal(0.36),
  }),
  resources: z.record(idSchema, resourceSchema),
  backdrops: z.strictObject({
    'doodle-horizon': backdropEntrySchema,
    'doodle-leaf-shadow': backdropEntrySchema,
    'doodle-rainbow-trail': backdropEntrySchema,
  }),
  growth: z.strictObject({
    slot: z.literal('backdrop'),
    order: z.tuple([
      z.literal('doodle-horizon'),
      z.literal('doodle-leaf-shadow'),
      z.literal('doodle-rainbow-trail'),
    ]),
  }),
  validatedSubject: z.strictObject({ artVersion: z.string().min(1), revision: sha256Schema }),
  generatable: z.array(selectableBackdropIdSchema),
  evidence: z.record(z.string().min(1), sha256Schema),
})

export type PixelSceneCatalogV1 = z.infer<typeof pixelSceneCatalogV1Schema>
export type PixelSceneResource = z.infer<typeof resourceSchema>
export type PixelSceneBackdropEntry = z.infer<typeof backdropEntrySchema>
export type PixelSceneSubjectCatalog = {
  schemaVersion: string
  rendererVersion: string
  size: number
  artVersion?: string
  revision?: string
}

const expectedBackdropMetadata = {
  'doodle-horizon': { rarity: 'N', growthRank: 1 },
  'doodle-leaf-shadow': { rarity: 'R', growthRank: 2 },
  'doodle-rainbow-trail': { rarity: 'L', growthRank: 3 },
} as const

export function requirePixelSceneCatalogV1(input: unknown): PixelSceneCatalogV1 {
  const catalog = pixelSceneCatalogV1Schema.parse(input)
  const resourceIds = Object.keys(catalog.resources)
  const resourcePaths = Object.values(catalog.resources).map(resource => resource.path)
  if (new Set(resourcePaths).size !== resourcePaths.length) throw new Error('Duplicate scene resource path.')

  const mappedResources: string[] = []
  for (const [id, entry] of Object.entries(catalog.backdrops) as [Exclude<BackdropId, 'none'>, PixelSceneBackdropEntry][]) {
    if (!Object.hasOwn(catalog.resources, entry.resourceId)) throw new Error(`Missing scene resource: ${entry.resourceId}`)
    mappedResources.push(entry.resourceId)
    const expected = expectedBackdropMetadata[id]
    if (entry.rarity !== expected.rarity || entry.growthRank !== expected.growthRank) {
      throw new Error(`Invalid growth metadata: ${id}`)
    }
  }
  if (new Set(mappedResources).size !== mappedResources.length) throw new Error('Duplicate backdrop resource mapping.')
  if (mappedResources.length !== resourceIds.length || resourceIds.some(id => !mappedResources.includes(id))) {
    throw new Error('Unreferenced scene resource.')
  }
  if (new Set(catalog.generatable).size !== catalog.generatable.length) throw new Error('Duplicate generatable backdrop.')
  for (const id of catalog.generatable) {
    if (catalog.backdrops[id].review !== 'approved') throw new Error(`Unapproved generatable backdrop: ${id}`)
  }
  if (catalog.sceneVersion.includes('-candidate.')) {
    const pending = Object.values(catalog.backdrops).filter(entry => entry.review === 'pending')
    if (!pending.length || catalog.generatable.length) {
      throw new Error('Candidate scene must keep pending backdrops out of generatable.')
    }
  }
  return catalog
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), value => value.toString(16).padStart(2, '0')).join('')
}

export async function verifyPixelSceneCatalogV1(input: unknown): Promise<PixelSceneCatalogV1> {
  const catalog = requirePixelSceneCatalogV1(input)
  const { revision, ...content } = catalog
  const actual = await digest(new TextEncoder().encode(canonicalJson(content)))
  if (actual !== revision) throw new Error('Pixel scene catalog revision mismatch.')
  return catalog
}

export function requireSceneSubjectCompatibility(
  scene: PixelSceneCatalogV1,
  subject: PixelSceneSubjectCatalog,
): void {
  const catalog = requirePixelSceneCatalogV1(scene)
  if (subject.schemaVersion !== catalog.subject.catalogSchemaVersion ||
    subject.rendererVersion !== catalog.subject.rendererVersion ||
    subject.size !== catalog.subject.width || subject.size !== catalog.subject.height) {
    throw new Error('Incompatible scene subject contract.')
  }
}

export function resolveBackdrop(stateInput: PixelSceneStateV1, catalogInput: PixelSceneCatalogV1) {
  const state = requirePixelSceneStateV1(stateInput)
  const catalog = requirePixelSceneCatalogV1(catalogInput)
  if (state.backdrop === 'none') return null
  const entry = catalog.backdrops[state.backdrop]
  return { id: state.backdrop, ...entry, resource: catalog.resources[entry.resourceId]! }
}
