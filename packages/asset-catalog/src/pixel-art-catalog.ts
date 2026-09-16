import { z } from 'zod'
import { felinePhenotypeSchema, phenotypeKey, traitIdSchema as id, type FelinePhenotype } from '../../generator-core/src/feline-phenotype.js'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const point = z.tuple([z.number().finite().min(0).max(64), z.number().finite().min(0).max(64)])
const polygon = z.array(point).min(3).max(64)
const slots = ['back', 'crown', 'body', 'ears', 'tailTip', 'neck'] as const
const resource = z.strictObject({
  path: z.string().regex(/^assets\/[a-z0-9._-]+\.png$/), sha256: sha, width: z.literal(64), height: z.literal(64),
})
const step = z.strictObject({
  slot: z.enum(slots), target: z.enum(['frame', 'subject']), resources: z.record(id, id),
  clear: z.array(polygon), occlusion: z.array(polygon),
})
const profile = z.strictObject({ id, body: id, coat: id, expression: id, steps: z.array(step).length(6) })
const coverage = z.strictObject({
  id, label: z.string().min(1).max(200), phenotype: felinePhenotypeSchema, profileId: id,
  review: z.enum(['approved', 'pending']), rgbaSha256: sha,
})
const catalogSchema = z.strictObject({
  schemaVersion: z.literal('pixel-art-catalog-v1'), styleId: z.literal('pixel-flat'), artVersion: id, revision: sha,
  rendererVersion: z.literal('pixel-rgba-v1'), size: z.literal(64), resources: z.record(id, resource),
  profiles: z.array(profile).min(1), coverage: z.array(coverage).min(1), generatable: z.array(id), evidence: z.record(z.string(), sha),
})
export type PixelArtCatalog = z.infer<typeof catalogSchema>
export type PixelResource = z.infer<typeof resource>
export type PixelPolygon = z.infer<typeof polygon>
export type PixelOperation =
  | { kind: 'clear'; polygons: PixelPolygon[] }
  | { kind: 'draw'; resource: string; target: 'frame' | 'subject'; occlusion: PixelPolygon[] }
export interface PixelArtPlan {
  size: 64
  operations: PixelOperation[]
  resources: Record<string, PixelResource>
  key: string
  review: 'approved' | 'pending'
}

export function requirePixelArtCatalog(input: unknown): PixelArtCatalog {
  const catalog = catalogSchema.parse(input)
  const requireUnique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`)
  }
  requireUnique(catalog.profiles.map(p => p.id), 'profile ID')
  requireUnique(catalog.profiles.map(p => JSON.stringify([p.body, p.coat, p.expression])), 'profile selector')
  requireUnique(catalog.coverage.map(c => c.id), 'coverage ID')
  requireUnique(catalog.coverage.map(c => phenotypeKey(c.phenotype)), 'phenotype coverage')
  requireUnique(catalog.generatable, 'generatable ID')
  for (const p of catalog.profiles) {
    requireUnique(p.steps.map(s => s.slot), 'profile slot')
    const bodyIndex = p.steps.findIndex(s => s.slot === 'body')
    if (p.steps[bodyIndex]!.target !== 'subject' || p.steps[bodyIndex]!.clear.length) throw new Error('Body must draw on subject without clearing.')
    for (const [index, s] of p.steps.entries()) {
      if (s.clear.length && index < bodyIndex) throw new Error('Clear must follow the body.')
      for (const resourceId of Object.values(s.resources)) {
        if (!Object.hasOwn(catalog.resources, resourceId)) throw new Error(`Missing resource: ${resourceId}`)
      }
    }
  }
  for (const c of catalog.coverage) {
    const p = catalog.profiles.find(p => p.id === c.profileId)
    if (!p || p.body !== c.phenotype.body || p.coat !== c.phenotype.coat || p.expression !== c.phenotype.expression) throw new Error(`Invalid profile for ${c.id}.`)
    for (const s of p.steps) {
      const selected = s.slot === 'body' ? c.phenotype.expression : c.phenotype[s.slot]
      if (selected !== 'none' && !Object.hasOwn(s.resources, selected)) throw new Error(`Missing ${s.slot} mapping for ${c.id}.`)
    }
  }
  for (const id of catalog.generatable) {
    if (catalog.coverage.find(c => c.id === id)?.review !== 'approved') throw new Error(`Unapproved generatable coverage: ${id}`)
  }
  return catalog
}

/** Canonical JSON is also used by the build tool to derive a content revision. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function pixelArtKey(p: FelinePhenotype, catalog: Pick<PixelArtCatalog, 'styleId' | 'artVersion' | 'revision'>): string {
  return JSON.stringify([catalog.styleId, catalog.artVersion, catalog.revision, phenotypeKey(p)])
}

export function resolvePixelArt(input: FelinePhenotype, inputCatalog: PixelArtCatalog): PixelArtPlan {
  const phenotype = felinePhenotypeSchema.parse(input), catalog = requirePixelArtCatalog(inputCatalog)
  const covered = catalog.coverage.find(c => phenotypeKey(c.phenotype) === phenotypeKey(phenotype))
  if (!covered) throw new Error(`Unsupported pixel combination / 当前像素包未覆盖此组合：${phenotypeKey(phenotype)}`)
  const profile = catalog.profiles.find(p => p.id === covered.profileId)!
  const operations: PixelOperation[] = [], resources: Record<string, PixelResource> = {}
  for (const s of profile.steps) {
    const selected = s.slot === 'body' ? phenotype.expression : phenotype[s.slot]
    if (selected === 'none') continue
    const id = s.resources[selected]!
    if (s.clear.length) operations.push({ kind: 'clear', polygons: s.clear })
    operations.push({ kind: 'draw', resource: id, target: s.target, occlusion: s.occlusion })
    resources[id] = catalog.resources[id]!
  }
  return { size: 64, operations, resources, key: pixelArtKey(phenotype, catalog), review: covered.review }
}

export function generatablePixelPhenotypes(input: PixelArtCatalog): FelinePhenotype[] {
  const catalog = requirePixelArtCatalog(input)
  return catalog.generatable.map(id => catalog.coverage.find(c => c.id === id)!.phenotype)
}

const appearanceSchema = z.strictObject({
  schemaVersion: z.literal('feline-appearance-v1'), phenotype: felinePhenotypeSchema,
  art: z.strictObject({ styleId: z.literal('pixel-flat'), artVersion: id, revision: sha }),
})
export function savePixelAppearance(phenotype: FelinePhenotype, catalog: PixelArtCatalog): z.infer<typeof appearanceSchema> {
  resolvePixelArt(phenotype, catalog)
  return appearanceSchema.parse({ schemaVersion: 'feline-appearance-v1', phenotype,
    art: { styleId: catalog.styleId, artVersion: catalog.artVersion, revision: catalog.revision } })
}

export function restorePixelAppearance(input: unknown, catalog: PixelArtCatalog): FelinePhenotype {
  const saved = appearanceSchema.parse(input)
  if (saved.art.styleId !== catalog.styleId || saved.art.artVersion !== catalog.artVersion || saved.art.revision !== catalog.revision) throw new Error('Art version / revision mismatch，请载入该存档指定的美术包。')
  resolvePixelArt(saved.phenotype, catalog)
  return saved.phenotype
}
