import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import * as browser from './pixel-art-browser-v3.js'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { composePixelArt } from '../../renderer-canvas/src/pixel-art-render.js'

const root = 'packages/asset-catalog/pixel/v3/approved-1.6.1/'
const source = JSON.parse(readFileSync(root + 'catalog.approved.json', 'utf8'))
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const row = source.coverage.find((c: any) => c.phenotype.neck === 'sunburst-ruff' && c.phenotype.body === 'shortleg-round')
  const catalog = structuredClone({ ...source, profiles: source.profiles.filter((p: any) => p.id === row.profileId), coverage: [row], generatable: [row.id] })
  const { revision: _, ...content } = catalog
  catalog.revision = sha(canonicalJson(content))
  return catalog
}

describe('browser v3 session', () => {
  it('restores the exact saved identity and rejects altered revisions and unsupported traits', async () => {
    const input = fixture()
    const session = await browser.createPixelArtV3Session(input)
    const phenotype = input.coverage[0].phenotype
    const saved = session.save(phenotype)
    expect(saved.schemaVersion).toBe('feline-appearance-v2')
    expect(session.restore(JSON.parse(JSON.stringify(saved)))).toEqual(phenotype)
    expect(() => session.restore({ ...saved, art: { ...saved.art, revision: '0'.repeat(64) } })).toThrow(/revision/)
    expect(() => session.save({ ...phenotype, coat: 'not-covered' })).toThrow(/未覆盖/)
    expect(() => session.restore({ ...saved, extra: true })).toThrow()
  })

  it('rejects a modified catalog before trusting its resource identity', async () => {
    const input = fixture(); input.coverage[0].label = 'changed'
    await expect(browser.createPixelArtV3Session(input)).rejects.toThrow(/revision/)
  })

  it('rejects duplicate, missing and pending generation entries', async () => {
    const duplicate = fixture(); duplicate.generatable.push(duplicate.generatable[0])
    await expect(browser.createPixelArtV3Session(duplicate)).rejects.toThrow(/Duplicate/)
    const missing = fixture(); missing.generatable = ['missing']
    await expect(browser.createPixelArtV3Session(missing)).rejects.toThrow(/Unapproved/)
    const pending = fixture(); pending.coverage[0].review = 'pending'
    await expect(browser.createPixelArtV3Session(pending)).rejects.toThrow(/Unapproved/)
  })

  it('keeps private validated metadata and reproduces an approved body-specific variant', async () => {
    const input = fixture()
    const session = await browser.createPixelArtV3Session(input)
    const phenotype = structuredClone(input.coverage[0].phenotype)
    const expected = input.coverage[0].rgbaSha256
    input.profiles[0].steps = []
    session.catalog.profiles[0]!.steps = []
    const layers: Record<string, Uint8ClampedArray> = {}
    for (const [id, resource] of Object.entries(source.resources) as [string, { path: string }][]) {
      layers[id] = new Uint8ClampedArray(await sharp(readFileSync(root + resource.path)).ensureAlpha().raw().toBuffer())
    }
    expect(sha(Buffer.from(composePixelArt(session.resolve(phenotype), layers)))).toBe(expected)
  })
})
