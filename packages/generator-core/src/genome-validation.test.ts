import { describe, expect, it } from 'vitest'
import {
  GENOME_LAYERS,
  generateMonster,
  materializeGenomeLayer,
  validateMonsterGenome,
} from './index.js'
import {
  makeValidCatalogFixture,
  makeValidCatalogFixtureWithThreeRigs,
  makeValidMonsterSpecFixture,
} from './test-fixtures.js'

describe('genome catalog validation', () => {
  it('does not materialize or synthesize a genome for a legacy spec', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const snapshot = structuredClone(spec)

    expect(materializeGenomeLayer(spec, 'P', catalog)).toBeNull()
    expect(validateMonsterGenome(spec, catalog)).toEqual([])
    expect(spec).toEqual(snapshot)
    expect(spec.genome).toBeUndefined()
  })

  it('accepts all four generated layers and materializes each under one common rig', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const spec = generateMonster({ seed: 'valid-genome', themeId: 'fungal', mode: 'normal' }, catalog).spec

    expect(validateMonsterGenome(spec, catalog)).toEqual([])
    for (const layer of GENOME_LAYERS) {
      const materialized = materializeGenomeLayer(spec, layer, catalog)
      expect(materialized?.ok).toBe(true)
      if (materialized?.ok) {
        expect(new Set(Object.values(materialized.value).map(item => item.rigId))).toHaveLength(1)
      }
    }
  })

  it('rejects an unsupported genome version without changing schemaVersion', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'bad-genome-version', themeId: 'fungal', mode: 'normal' }, catalog).spec
    ;(spec.genome as { genomeVersion: string }).genomeVersion = '9.9.9'

    const materialized = materializeGenomeLayer(spec, 'P', catalog)
    expect(materialized).toEqual(expect.objectContaining({ ok: false }))
    if (materialized && !materialized.ok) expect(materialized.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENOME_VERSION_UNSUPPORTED',
      path: ['genome', 'genomeVersion'],
    }))
    expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENOME_VERSION_UNSUPPORTED', path: ['genome', 'genomeVersion'],
    }))
    expect(spec.schemaVersion).toBe('0.1.0')
  })

  it('rejects a dominant gene that differs from the phenotype', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'p-mismatch', themeId: 'fungal', mode: 'normal' }, catalog).spec
    spec.genome!.genes.eyes.P = 'eyes_other'

    expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENOME_P_MISMATCH',
      path: ['genome', 'genes', 'eyes', 'P'],
    }))
  })

  it('reports missing and wrong-slot hidden parts at exact gene paths', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'bad-ids', themeId: 'fungal', mode: 'normal' }, catalog).spec
    spec.genome!.genes.eyes.H1 = 'missing_eyes'
    spec.genome!.genes.tail.H2 = spec.visualSlots.eyes.partId

    expect(validateMonsterGenome(spec, catalog)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SPEC_GENE_PART_MISSING', path: ['genome', 'genes', 'eyes', 'H1'],
      }),
      expect.objectContaining({
        code: 'SPEC_GENE_PART_SLOT_MISMATCH', path: ['genome', 'genes', 'tail', 'H2'],
      }),
    ]))
  })

  it('rejects a hidden layer that has no common compatible rig', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'cross-rig', themeId: 'fungal', mode: 'normal' }, catalog).spec
    catalog.parts.find(part => part.id === 'body_blob')!.compatibleRigs = ['blob']
    const legs = catalog.parts.find(part => part.id === 'legs_webbed')!
    catalog.parts.push({ ...legs, id: 'legs_biped_only', compatibleRigs: ['biped'] })
    spec.genome!.genes.legs.H3 = 'legs_biped_only'

    expect(validateMonsterGenome(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENOME_LAYER_INCOMPATIBLE',
      path: ['genome', 'genes', expect.any(String), 'H3'],
    }))
  })
})
