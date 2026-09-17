import { createHash } from 'node:crypto'
import { readFile, access } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { composePixelArt } from '../../renderer-canvas/src/pixel-art-render.js'
import { requirePixelArtCatalogV2, resolvePixelArtV2, generatablePixelPhenotypesV2 } from './pixel-art-catalog-v2.js'

const root = new URL('../pixel/v2/', import.meta.url)
const file = new URL('coverage-standard-small-fangs-round/catalog.candidate.json', root)
const sha = (bytes: string | Uint8Array | Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex')
const load = async () => requirePixelArtCatalogV2(JSON.parse(await readFile(file, 'utf8')))
const suffixes = ['horns', 'flame', 'horns-flame', 'horns-ears', 'horns-mane', 'ears-flame', 'mane-flame', 'horns-ears-mane', 'horns-ears-flame', 'horns-mane-flame', 'ears-mane-flame']
const combinations = ['1000', '0001', '1001', '1100', '1010', '0101', '0011', '1110', '1101', '1011', '0111']

describe('standard small-fangs coverage candidate', () => {
  it('publishes the separately identified coverage candidate', async () => {
    expect(await access(file).then(() => true, () => false)).toBe(true)
  })

  it('adds only the eleven ordered combinations and preserves all approved rows, profiles and resources', async () => {
    const base = requirePixelArtCatalogV2(JSON.parse(await readFile(new URL('catalog.approved.json', root), 'utf8')))
    const catalog = await load()
    expect(catalog.artVersion).toBe('1.2.1-candidate.1')
    expect(catalog.coverage).toHaveLength(32)
    expect(catalog.coverage.slice(0, 21)).toEqual(base.coverage)
    expect(catalog.profiles).toEqual(base.profiles)
    expect(catalog.resources).toEqual(base.resources)
    expect(Object.keys(catalog.resources)).toHaveLength(15)
    expect(catalog.generatable).toEqual(base.generatable)
    const added = catalog.coverage.slice(21)
    expect(added.map(row => row.id)).toEqual(suffixes.map(s => `standard-${s}`))
    expect(added.map(row => [row.phenotype.crown, row.phenotype.ears, row.phenotype.neck, row.phenotype.tailTip].map(v => v === 'none' ? '0' : '1').join(''))).toEqual(combinations)
    for (const row of added) {
      expect(row.review).toBe('pending')
      expect(row.profileId).toBe('standard-small-fangs-round')
      expect(row.phenotype).toMatchObject({ schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'round', expression: 'small-fangs', back: 'none' })
    }
    expect(catalog.coverage.filter(r => r.review === 'approved')).toHaveLength(21)
    expect(new Set(catalog.coverage.filter(r => r.profileId === 'standard-small-fangs-round').map(r => canonicalJson(r.phenotype))).size).toBe(16)
    const { revision, ...content } = catalog
    expect(revision).toBe(sha(canonicalJson(content)))
  })

  it('replays every RGBA and rejects pending generation and unlisted combinations', async () => {
    const catalog = await load()
    const layers: Record<string, Uint8ClampedArray> = {}
    for (const [id, resource] of Object.entries(catalog.resources)) {
      const bytes = await readFile(new URL(resource.path, file))
      expect(sha(bytes)).toBe(resource.sha256)
      layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
    }
    for (const row of catalog.coverage) {
      const plan = resolvePixelArtV2(row.phenotype, catalog)
      expect(sha(composePixelArt(plan, layers))).toBe(row.rgbaSha256)
      expect(sha(composePixelArt(plan, layers))).toBe(row.rgbaSha256)
    }
    expect(generatablePixelPhenotypesV2(catalog)).toHaveLength(21)
    for (const row of catalog.coverage.slice(21)) {
      expect(() => requirePixelArtCatalogV2({ ...catalog, generatable: [...catalog.generatable, row.id] })).toThrow(/Unapproved generatable/)
    }
    expect(() => resolvePixelArtV2({ ...catalog.coverage[21]!.phenotype, body: 'shortleg-round' }, catalog)).toThrow(/Unsupported pixel combination/)
    expect(() => resolvePixelArtV2({ ...catalog.coverage[21]!.phenotype, eyes: 'sleepy-almond' }, catalog)).toThrow(/Unsupported pixel combination/)
  })
})
