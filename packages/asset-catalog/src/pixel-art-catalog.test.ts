import { describe, expect, it } from 'vitest'
import * as api from './pixel-art-catalog.js'
import { phenotypeFromLegacy } from '../../generator-core/src/feline-phenotype.js'
import { generateFelineCombination } from '../../generator-core/src/feline-combination.js'

const phenotype = () => phenotypeFromLegacy(generateFelineCombination('fixture', {
  coat: 'orange-white', expression: 'parted-mouth', crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
}))
const fixture = () => ({
  schemaVersion: 'pixel-art-catalog-v1', styleId: 'pixel-flat', artVersion: '1.0.0', revision: 'a'.repeat(64),
  rendererVersion: 'pixel-rgba-v1', size: 64,
  resources: { cat: { path: 'assets/cat.png', sha256: 'b'.repeat(64), width: 64, height: 64 } },
  profiles: [{ id: 'standard', body: 'standard', coat: 'orange-white', expression: 'parted-mouth',
    steps: ['back','crown','body','ears','tailTip','neck'].map(slot => ({ slot, target: slot === 'body' ? 'subject' : 'frame', resources: slot === 'body' ? { 'parted-mouth': 'cat' } : {}, clear: [], occlusion: [] })) }],
  coverage: [{ id: 'base', label: '基础', phenotype: phenotype(), profileId: 'standard', review: 'approved', rgbaSha256: 'c'.repeat(64) }],
  generatable: ['base'], evidence: {},
})

describe('pixel art contract', () => {
  it('resolves exactly declared coverage and never supplies fallback artwork', () => {
    const catalog = api.requirePixelArtCatalog(fixture())
    const plan = api.resolvePixelArt(phenotype(), catalog)
    expect(plan.operations).toEqual([{ kind: 'draw', resource: 'cat', target: 'subject', occlusion: [] }])
    expect(() => api.resolvePixelArt({ ...phenotype(), body: 'shortleg-round' }, catalog)).toThrow(/unsupported/i)
    expect(api.generatablePixelPhenotypes(catalog)).toEqual([phenotype()])
  })
  it('rejects dangling resources, duplicate coverage, unapproved generation and path traversal', () => {
    const missing = fixture(); missing.profiles[0]!.steps[2]!.resources['parted-mouth'] = 'missing'
    expect(() => api.requirePixelArtCatalog(missing)).toThrow()
    const duplicate = fixture(); duplicate.coverage.push({ ...duplicate.coverage[0]!, id: 'other' })
    expect(() => api.requirePixelArtCatalog(duplicate)).toThrow()
    const pending = fixture(); pending.coverage[0]!.review = 'pending'
    expect(() => api.requirePixelArtCatalog(pending)).toThrow()
    const path = fixture(); path.resources.cat.path = '../secret.png'
    expect(() => api.requirePixelArtCatalog(path)).toThrow()
  })
  it('pins body, all traits, version and revision in saved appearance and cache identity', () => {
    const catalog = api.requirePixelArtCatalog(fixture()), p = phenotype()
    const key = api.pixelArtKey(p, catalog)
    for (const field of ['body', 'coat', 'expression', 'crown', 'ears', 'neck', 'back', 'tailTip'] as const) {
      expect(api.pixelArtKey({ ...p, [field]: 'different' }, catalog)).not.toBe(key)
    }
    expect(api.pixelArtKey(p, { ...catalog, artVersion: '2.0.0' })).not.toBe(key)
    expect(api.pixelArtKey(p, { ...catalog, revision: 'd'.repeat(64) })).not.toBe(key)
    const save = api.savePixelAppearance(p, catalog)
    expect(api.restorePixelAppearance(save, catalog)).toEqual(p)
    expect(() => api.restorePixelAppearance(save, { ...catalog, revision: 'd'.repeat(64) })).toThrow(/revision|version/i)
  })
})
