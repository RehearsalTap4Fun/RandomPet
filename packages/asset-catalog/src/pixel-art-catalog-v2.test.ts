import { describe, expect, it } from 'vitest'
import * as api from './pixel-art-catalog-v2.js'
import type { FelinePhenotypeV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import * as sdk from '../../incubator-adapter/src/pixel-art-sdk.js'

const phenotype = (): FelinePhenotypeV2 => ({
  schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'sleepy-almond', expression: 'small-fangs',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
})
const fixture = () => ({
  schemaVersion: 'pixel-art-catalog-v2', styleId: 'pixel-flat', artVersion: '1.2.0-candidate.1', revision: 'a'.repeat(64),
  rendererVersion: 'pixel-rgba-v1', size: 64,
  resources: { body: { path: 'assets/body.png', sha256: 'b'.repeat(64), width: 64, height: 64 } },
  profiles: [{ id: 'standard-sleepy', body: 'standard', coat: 'orange-white', eyes: 'sleepy-almond', expression: 'small-fangs',
    steps: ['back', 'crown', 'body', 'ears', 'tailTip', 'neck'].map(slot => ({
      slot, target: slot === 'body' ? 'subject' : 'frame', resources: slot === 'body' ? { 'small-fangs': 'body' } : {}, clear: [], occlusion: [],
    })) }],
  coverage: [{ id: 'standard-sleepy-base', label: '标准半眯基础', phenotype: phenotype(), profileId: 'standard-sleepy', review: 'approved', rgbaSha256: 'c'.repeat(64) }],
  generatable: ['standard-sleepy-base'], evidence: {},
})

describe('eye-aware pixel art catalog v2', () => {
  it('resolves the exact eye-aware coverage with the existing plan contract', () => {
    const catalog = api.requirePixelArtCatalogV2(fixture())
    expect(api.resolvePixelArtV2(phenotype(), catalog).operations).toEqual([
      { kind: 'draw', resource: 'body', target: 'subject', occlusion: [] },
    ])
    expect(() => api.resolvePixelArtV2({ ...phenotype(), eyes: 'round' }, catalog)).toThrow(/unsupported/i)
    expect(api.generatablePixelPhenotypesV2(catalog)).toEqual([phenotype()])
    expect(sdk.resolvePixelArtV2(phenotype(), catalog)).toEqual(api.resolvePixelArtV2(phenotype(), catalog))
  })

  it('rejects duplicate eye-aware selectors', () => {
    const catalog = fixture()
    catalog.profiles.push({ ...catalog.profiles[0]!, id: 'duplicate' })
    expect(() => api.requirePixelArtCatalogV2(catalog)).toThrow(/duplicate profile selector/i)
  })

  it('saves and restores only v2 appearances with the pinned art identity', () => {
    const catalog = api.requirePixelArtCatalogV2(fixture())
    const saved = api.savePixelAppearanceV2(phenotype(), catalog)
    expect(saved.schemaVersion).toBe('feline-appearance-v2')
    expect(api.restorePixelAppearanceV2(saved, catalog)).toEqual(phenotype())
    const v1Appearance = {
      schemaVersion: 'feline-appearance-v1',
      phenotype: {
        schemaVersion: 'feline-phenotype-v1', body: 'standard', coat: 'orange-white', expression: 'small-fangs',
        crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
      },
      art: { styleId: 'pixel-flat', artVersion: '1.0.0', revision: 'a'.repeat(64) },
    }
    expect(() => api.restorePixelAppearanceV2(v1Appearance, catalog)).toThrow()
    expect(() => api.restorePixelAppearanceV2(saved, { ...catalog, revision: 'd'.repeat(64) })).toThrow(/revision|version/i)
  })
})
