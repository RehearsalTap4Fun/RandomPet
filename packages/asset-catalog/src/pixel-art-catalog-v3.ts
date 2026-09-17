import { z } from 'zod'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { felinePhenotypeV2Schema, phenotypeKeyV2, type FelinePhenotypeV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { traitIdSchema as id } from '../../generator-core/src/feline-phenotype.js'
import { pixelArtPolygonSchema, pixelArtResourceSchema, pixelArtSha256Schema, pixelArtStepSchema, type PixelArtPlan, type PixelOperation, type PixelResource } from './pixel-art-catalog.js'

const variantRendering = z.strictObject({
  target: z.enum(['frame', 'subject']), clear: z.array(pixelArtPolygonSchema), occlusion: z.array(pixelArtPolygonSchema),
})
const stepV3 = pixelArtStepSchema.extend({ variants: z.record(id, variantRendering).optional() })
const profileV3 = z.strictObject({ id, body: id, coat: id, eyes: id, expression: id, steps: z.array(stepV3).length(6) })
const coverageV3 = z.strictObject({
  id, label: z.string().min(1).max(200), phenotype: felinePhenotypeV2Schema, profileId: id,
  review: z.enum(['approved', 'pending']), rgbaSha256: pixelArtSha256Schema,
})
const pixelArtCatalogV3Schema = z.strictObject({
  schemaVersion: z.literal('pixel-art-catalog-v3'), styleId: z.literal('pixel-flat'), artVersion: id, revision: pixelArtSha256Schema,
  rendererVersion: z.literal('pixel-rgba-v1'), size: z.literal(64), resources: z.record(id, pixelArtResourceSchema),
  profiles: z.array(profileV3).min(1), coverage: z.array(coverageV3).min(1), generatable: z.array(id), evidence: z.record(z.string(), pixelArtSha256Schema),
})
export type PixelArtCatalogV3 = z.infer<typeof pixelArtCatalogV3Schema>

export function requirePixelArtCatalogV3(input: unknown): PixelArtCatalogV3 {
  const catalog = pixelArtCatalogV3Schema.parse(input)
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
      for (const [trait, rendering] of Object.entries(step.variants ?? {})) {
        if (!Object.hasOwn(step.resources, trait)) throw new Error(`Variant rendering without resource: ${trait}`)
        if (rendering.clear.length && index < bodyIndex) throw new Error('Clear must follow the body.')
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
  for (const coverageId of catalog.generatable) {
    if (catalog.coverage.find(coverage => coverage.id === coverageId)?.review !== 'approved') throw new Error(`Unapproved generatable coverage: ${coverageId}`)
  }
  return catalog
}

export function pixelArtKeyV3(phenotype: FelinePhenotypeV2, catalog: Pick<PixelArtCatalogV3, 'styleId' | 'artVersion' | 'revision'>): string {
  return canonicalJson([catalog.styleId, catalog.artVersion, catalog.revision, phenotypeKeyV2(phenotype)])
}

export function resolvePixelArtV3(input: FelinePhenotypeV2, inputCatalog: PixelArtCatalogV3): PixelArtPlan {
  const phenotype = felinePhenotypeV2Schema.parse(input)
  const catalog = requirePixelArtCatalogV3(inputCatalog)
  const covered = catalog.coverage.find(coverage => phenotypeKeyV2(coverage.phenotype) === phenotypeKeyV2(phenotype))
  if (!covered) throw new Error(`Unsupported pixel combination / 当前像素包未覆盖此组合：${phenotypeKeyV2(phenotype)}`)
  const profile = catalog.profiles.find(profile => profile.id === covered.profileId)!
  const operations: PixelOperation[] = []
  const resources: Record<string, PixelResource> = {}
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]!
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = catalog.resources[resourceId]!
  }
  return { size: 64, operations, resources, key: pixelArtKeyV3(phenotype, catalog), review: covered.review }
}

export function generatablePixelPhenotypesV3(input: PixelArtCatalogV3): FelinePhenotypeV2[] {
  const catalog = requirePixelArtCatalogV3(input)
  return catalog.generatable.map(coverageId => catalog.coverage.find(coverage => coverage.id === coverageId)!.phenotype)
}
