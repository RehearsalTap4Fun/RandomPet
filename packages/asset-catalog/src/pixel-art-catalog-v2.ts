import { z } from 'zod'
import { felinePhenotypeV2Schema, phenotypeKeyV2, type FelinePhenotypeV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { traitIdSchema as id } from '../../generator-core/src/feline-phenotype.js'
import type { PixelArtPlan, PixelOperation, PixelPolygon, PixelResource } from './pixel-art-catalog.js'

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
const profileV2 = z.strictObject({ id, body: id, coat: id, eyes: id, expression: id, steps: z.array(step).length(6) })
const coverageV2 = z.strictObject({
  id, label: z.string().min(1).max(200), phenotype: felinePhenotypeV2Schema, profileId: id,
  review: z.enum(['approved', 'pending']), rgbaSha256: sha,
})
const pixelArtCatalogV2Schema = z.strictObject({
  schemaVersion: z.literal('pixel-art-catalog-v2'), styleId: z.literal('pixel-flat'), artVersion: id, revision: sha,
  rendererVersion: z.literal('pixel-rgba-v1'), size: z.literal(64), resources: z.record(id, resource),
  profiles: z.array(profileV2).min(1), coverage: z.array(coverageV2).min(1), generatable: z.array(id), evidence: z.record(z.string(), sha),
})
export type PixelArtCatalogV2 = z.infer<typeof pixelArtCatalogV2Schema>

export function requirePixelArtCatalogV2(input: unknown): PixelArtCatalogV2 {
  const catalog = pixelArtCatalogV2Schema.parse(input)
  const requireUnique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`)
  }
  requireUnique(catalog.profiles.map(profile => profile.id), 'profile ID')
  requireUnique(catalog.profiles.map(profile => JSON.stringify([profile.body, profile.coat, profile.eyes, profile.expression])), 'profile selector')
  requireUnique(catalog.coverage.map(coverage => coverage.id), 'coverage ID')
  requireUnique(catalog.coverage.map(coverage => phenotypeKeyV2(coverage.phenotype)), 'phenotype coverage')
  requireUnique(catalog.generatable, 'generatable ID')
  for (const profile of catalog.profiles) {
    requireUnique(profile.steps.map(step => step.slot), 'profile slot')
    const bodyIndex = profile.steps.findIndex(step => step.slot === 'body')
    if (profile.steps[bodyIndex]!.target !== 'subject' || profile.steps[bodyIndex]!.clear.length) throw new Error('Body must draw on subject without clearing.')
    for (const [index, step] of profile.steps.entries()) {
      if (step.clear.length && index < bodyIndex) throw new Error('Clear must follow the body.')
      for (const resourceId of Object.values(step.resources)) {
        if (!Object.hasOwn(catalog.resources, resourceId)) throw new Error(`Missing resource: ${resourceId}`)
      }
    }
  }
  for (const coverage of catalog.coverage) {
    const profile = catalog.profiles.find(profile => profile.id === coverage.profileId)
    if (!profile || profile.body !== coverage.phenotype.body || profile.coat !== coverage.phenotype.coat ||
      profile.eyes !== coverage.phenotype.eyes || profile.expression !== coverage.phenotype.expression) {
      throw new Error(`Invalid profile for ${coverage.id}.`)
    }
    for (const step of profile.steps) {
      const selected = step.slot === 'body' ? coverage.phenotype.expression : coverage.phenotype[step.slot]
      if (selected !== 'none' && !Object.hasOwn(step.resources, selected)) throw new Error(`Missing ${step.slot} mapping for ${coverage.id}.`)
    }
  }
  for (const id of catalog.generatable) {
    if (catalog.coverage.find(coverage => coverage.id === id)?.review !== 'approved') throw new Error(`Unapproved generatable coverage: ${id}`)
  }
  return catalog
}

export function pixelArtKeyV2(phenotype: FelinePhenotypeV2, catalog: Pick<PixelArtCatalogV2, 'styleId' | 'artVersion' | 'revision'>): string {
  return JSON.stringify([catalog.styleId, catalog.artVersion, catalog.revision, phenotypeKeyV2(phenotype)])
}

export function resolvePixelArtV2(input: FelinePhenotypeV2, inputCatalog: PixelArtCatalogV2): PixelArtPlan {
  const phenotype = felinePhenotypeV2Schema.parse(input)
  const catalog = requirePixelArtCatalogV2(inputCatalog)
  const covered = catalog.coverage.find(coverage => phenotypeKeyV2(coverage.phenotype) === phenotypeKeyV2(phenotype))
  if (!covered) throw new Error(`Unsupported pixel combination / 当前像素包未覆盖此组合：${phenotypeKeyV2(phenotype)}`)
  const profile = catalog.profiles.find(profile => profile.id === covered.profileId)!
  const operations: PixelOperation[] = []
  const resources: Record<string, PixelResource> = {}
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]!
    if (step.clear.length) operations.push({ kind: 'clear', polygons: step.clear as PixelPolygon[] })
    operations.push({ kind: 'draw', resource: resourceId, target: step.target, occlusion: step.occlusion as PixelPolygon[] })
    resources[resourceId] = catalog.resources[resourceId]!
  }
  return { size: 64, operations, resources, key: pixelArtKeyV2(phenotype, catalog), review: covered.review }
}

export function generatablePixelPhenotypesV2(input: PixelArtCatalogV2): FelinePhenotypeV2[] {
  const catalog = requirePixelArtCatalogV2(input)
  return catalog.generatable.map(id => catalog.coverage.find(coverage => coverage.id === id)!.phenotype)
}

const appearanceV2Schema = z.strictObject({
  schemaVersion: z.literal('feline-appearance-v2'), phenotype: felinePhenotypeV2Schema,
  art: z.strictObject({ styleId: z.literal('pixel-flat'), artVersion: id, revision: sha }),
})
export type PixelAppearanceV2 = z.infer<typeof appearanceV2Schema>

export function savePixelAppearanceV2(phenotype: FelinePhenotypeV2, catalog: PixelArtCatalogV2): PixelAppearanceV2 {
  resolvePixelArtV2(phenotype, catalog)
  return appearanceV2Schema.parse({ schemaVersion: 'feline-appearance-v2', phenotype,
    art: { styleId: catalog.styleId, artVersion: catalog.artVersion, revision: catalog.revision } })
}

export function restorePixelAppearanceV2(input: unknown, catalog: PixelArtCatalogV2): FelinePhenotypeV2 {
  const saved = appearanceV2Schema.parse(input)
  if (saved.art.styleId !== catalog.styleId || saved.art.artVersion !== catalog.artVersion || saved.art.revision !== catalog.revision) {
    throw new Error('Art version / revision mismatch，请载入该存档指定的美术包。')
  }
  resolvePixelArtV2(saved.phenotype, catalog)
  return saved.phenotype
}
