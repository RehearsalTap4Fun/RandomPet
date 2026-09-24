// Additive browser adapter: released renderer/catalog sources remain unchanged.
import { z } from 'zod'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { felinePhenotypeV2Schema, phenotypeKeyV2, type FelinePhenotypeV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { traitIdSchema } from '../../generator-core/src/feline-phenotype.js'
import { pixelArtSha256Schema, type PixelResource } from '../../asset-catalog/src/pixel-art-catalog.js'
import { requirePixelArtCatalogV3, resolvePixelArtV3, pixelArtKeyV3 } from '../../asset-catalog/src/pixel-art-catalog-v3.js'
import { composePixelArt, verifyPixelPng } from '../../renderer-canvas/src/pixel-art-render.js'

const appearanceSchema = z.strictObject({
  schemaVersion: z.literal('feline-appearance-v2'), phenotype: felinePhenotypeV2Schema,
  art: z.strictObject({ styleId: z.literal('pixel-flat'), artVersion: traitIdSchema, revision: pixelArtSha256Schema }),
})

/** Validate once; retain private indices so interactions don't revalidate the full grid. */
export async function createPixelArtV3Session(input: unknown) {
  // The released validator scans coverage for every generatable ID (quadratic).
  // Reuse all its structural checks and perform the identical whitelist check via a map.
  const { generatable } = z.object({ generatable: z.array(traitIdSchema) }).parse(input)
  const catalog = requirePixelArtCatalogV3({ ...input as object, generatable: [] })
  const byId = new Map(catalog.coverage.map(row => [row.id, row]))
  if (new Set(generatable).size !== generatable.length) throw new Error('Duplicate generatable ID.')
  for (const id of generatable) if (byId.get(id)?.review !== 'approved') throw new Error(`Unapproved generatable coverage: ${id}`)
  catalog.generatable = generatable
  const { revision, ...content } = catalog
  const bytes = new TextEncoder().encode(canonicalJson(content))
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  if (actual !== revision) throw new Error('Pixel catalog revision mismatch.')
  const byPhenotype = new Map(catalog.coverage.map(row => [phenotypeKeyV2(row.phenotype), row]))
  const profiles = new Map(catalog.profiles.map(profile => [profile.id, profile]))
  const generatableIds = new Set(catalog.generatable)
  function resolve(phenotype: FelinePhenotypeV2) {
    const row = byPhenotype.get(phenotypeKeyV2(phenotype))
    if (!row) throw new Error('当前像素包未覆盖此组合。')
    // Project only the verified row into the existing resolver. Never infer coverage.
    return resolvePixelArtV3(phenotype, { ...catalog, profiles: [profiles.get(row.profileId)!], coverage: [row],
      generatable: generatableIds.has(row.id) ? [row.id] : [] })
  }
  function save(phenotype: FelinePhenotypeV2) {
    resolve(phenotype)
    return appearanceSchema.parse({ schemaVersion: 'feline-appearance-v2', phenotype,
      art: { styleId: catalog.styleId, artVersion: catalog.artVersion, revision } })
  }
  function restore(input: unknown) {
    const saved = appearanceSchema.parse(input)
    if (saved.art.styleId !== catalog.styleId || saved.art.artVersion !== catalog.artVersion || saved.art.revision !== revision) {
      throw new Error('Art version / revision mismatch，请载入该存档指定的美术包。')
    }
    resolve(saved.phenotype)
    return saved.phenotype
  }
  async function load(resourceUrl: (resource: PixelResource) => string) {
    const layers: Record<string, Uint8ClampedArray> = {}
    await Promise.all(Object.entries(catalog.resources).map(async ([id, resource]) => {
      const response = await fetch(resourceUrl(resource))
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${resource.path}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      await verifyPixelPng(bytes, resource)
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      try {
        if (bitmap.width !== 64 || bitmap.height !== 64) throw new Error(`Decoded dimensions mismatch: ${id}`)
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Canvas unavailable.')
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, 64, 64).data
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0 && pixels[i] !== 255) throw new Error(`Invalid binary alpha: ${id}`)
        layers[id] = pixels
      } finally { bitmap.close() }
    }))
    return { render: (phenotype: FelinePhenotypeV2) => composePixelArt(resolve(phenotype), layers) }
  }
  return { catalog: structuredClone(catalog), resolve, save, restore, load,
    key: (phenotype: FelinePhenotypeV2) => pixelArtKeyV3(phenotype, catalog) }
}
