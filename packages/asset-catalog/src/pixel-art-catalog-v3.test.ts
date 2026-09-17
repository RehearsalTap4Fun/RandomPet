import { describe, expect, it } from 'vitest'
import type { FelinePhenotypeV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import * as api from './pixel-art-catalog-v3.js'

const phenotype = (): FelinePhenotypeV2 => ({
  schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'round', expression: 'small-fangs',
  crown: 'none', ears: 'none', neck: 'frill-neck', back: 'none', tailTip: 'none',
})

describe('pixel art catalog v3', () => {
  it('lets one trait variant override its slot rendering layer', () => {
    const steps = ['back', 'crown', 'body', 'ears', 'tailTip', 'neck'].map(slot => ({
      slot, target: slot === 'body' ? 'subject' : 'frame', resources: slot === 'body' ? { 'small-fangs': 'body' } : {}, clear: [], occlusion: [],
    })) as any[]
    Object.assign(steps[5], {
      target: 'subject', resources: { 'frill-neck': 'frill' },
      variants: { 'frill-neck': { target: 'frame', clear: [], occlusion: [] } },
    })
    const input = {
      schemaVersion: 'pixel-art-catalog-v3', styleId: 'pixel-flat', artVersion: '1.3.0-candidate.1', revision: 'a'.repeat(64),
      rendererVersion: 'pixel-rgba-v1', size: 64,
      resources: {
        body: { path: 'assets/body.png', sha256: 'b'.repeat(64), width: 64, height: 64 },
        frill: { path: 'assets/frill.png', sha256: 'c'.repeat(64), width: 64, height: 64 },
      },
      profiles: [{ id: 'standard-round-small-fangs', body: 'standard', coat: 'orange-white', eyes: 'round', expression: 'small-fangs', steps }],
      coverage: [{ id: 'frill', label: '颈膜', phenotype: phenotype(), profileId: 'standard-round-small-fangs', review: 'pending', rgbaSha256: 'd'.repeat(64) }],
      generatable: [], evidence: {},
    }

    const catalog = api.requirePixelArtCatalogV3(input)
    expect(api.resolvePixelArtV3(phenotype(), catalog).operations).toEqual([
      { kind: 'draw', resource: 'body', target: 'subject', occlusion: [] },
      { kind: 'draw', resource: 'frill', target: 'frame', occlusion: [] },
    ])
  })
})
