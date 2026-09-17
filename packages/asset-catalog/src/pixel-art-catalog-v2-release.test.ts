import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { phenotypeV2FromV1 } from '../../generator-core/src/feline-phenotype-v2.js'
import { composePixelArt } from '../../renderer-canvas/src/pixel-art-render.js'
import { requirePixelArtCatalog } from './pixel-art-catalog.js'
import { requirePixelArtCatalogV2, resolvePixelArtV2 } from './pixel-art-catalog-v2.js'

const v1Root = new URL('../pixel/v1/', import.meta.url)
const v2Root = new URL('../pixel/v2/', import.meta.url)
const sha = (bytes: Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex')

describe('pixel art v2 candidate release', () => {
  it('contains the exact reviewed candidate coverage and keeps pending art out of generation', async () => {
    const catalog = requirePixelArtCatalogV2(JSON.parse(await readFile(new URL('catalog.candidate.json', v2Root), 'utf8')))
    expect(catalog.schemaVersion).toBe('pixel-art-catalog-v2')
    expect(catalog.artVersion).toBe('1.2.0-candidate.1')
    expect(catalog.rendererVersion).toBe('pixel-rgba-v1')
    expect(catalog.coverage).toHaveLength(21)
    expect(catalog.generatable).toHaveLength(14)
    expect(catalog.coverage.filter(coverage => coverage.review === 'pending').map(coverage => coverage.id)).toEqual([
      'standard-sleepy-base',
      'shortleg-sleepy-base',
      'slender-round-base',
      'slender-sleepy-base',
      'standard-sleepy-ears-mane',
      'shortleg-sleepy-horns-flame',
      'slender-sleepy-stack',
    ])
    expect(catalog.generatable).toEqual(catalog.coverage.slice(0, 14).map(coverage => coverage.id))
  })

  it.each(['candidate', 'approved'])('ports every approved v1 appearance to %s round eyes without changing rendered RGBA bytes', async name => {
    const v1 = requirePixelArtCatalog(JSON.parse(await readFile(new URL('catalog.approved.json', v1Root), 'utf8')))
    const v2 = requirePixelArtCatalogV2(JSON.parse(await readFile(new URL(`catalog.${name}.json`, v2Root), 'utf8')))
    const layers: Record<string, Uint8ClampedArray> = {}
    for (const [id, resource] of Object.entries(v2.resources)) {
      layers[id] = new Uint8ClampedArray(await sharp(await readFile(new URL(resource.path, v2Root))).ensureAlpha().raw().toBuffer())
    }
    for (const [index, legacy] of v1.coverage.entries()) {
      const migrated = v2.coverage[index]!
      expect(migrated.id).toBe(legacy.id)
      expect(migrated.phenotype).toEqual(phenotypeV2FromV1(legacy.phenotype))
      expect(migrated.profileId).toBe(`${legacy.profileId}-round`)
      expect(migrated.review).toBe('approved')
      expect(migrated.rgbaSha256).toBe(legacy.rgbaSha256)
      expect(sha(composePixelArt(resolvePixelArtV2(migrated.phenotype, v2), layers)), migrated.id).toBe(legacy.rgbaSha256)
    }
  })
})
