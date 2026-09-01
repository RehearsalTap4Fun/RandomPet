import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  parseCatalog,
  type Catalog,
  type MonsterSpec,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../../asset-catalog/catalog/v0.1.0/catalog.json'
import { toGenerationRequest, toIncubatorRecord } from './index.js'

function productionCatalog(): Catalog {
  const parsed = parseCatalog(productionCatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('Production catalog fixture must parse.')
  return parsed.value
}

function generatedSpec(catalog: Catalog): MonsterSpec {
  const generated = generateMonster({
    seed: 'adapter-output', themeId: 'fungal', mode: 'normal',
  }, catalog)
  expect(generated.blocked).toBe(false)
  return generated.spec
}

describe('incubator adapter', () => {
  it.each([
    [{ theme: 'unknown', seed: 'x', risk: 0, mutationBonus: 0 }, 'ADAPTER_THEME_INVALID'],
    [{ theme: 'fungal', seed: 'x'.repeat(129), risk: 0, mutationBonus: 0 }, 'ADAPTER_SEED_INVALID'],
    [{ theme: 'fungal', seed: 'x', risk: Number.NaN, mutationBonus: 0 }, 'ADAPTER_NUMBER_INVALID'],
  ])('rejects invalid egg input', (input, code) => {
    expect(toGenerationRequest(input)).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code })]),
    })
  })

  it('counts normalized seed length in code points', () => {
    const valid = toGenerationRequest({
      id: 'egg-emoji', theme: 'fungal', seed: '🥚'.repeat(128), risk: 0, mutationBonus: 0,
    })
    const invalid = toGenerationRequest({
      id: 'egg-emoji', theme: 'fungal', seed: '🥚'.repeat(129), risk: 0, mutationBonus: 0,
    })

    expect(valid.ok).toBe(true)
    expect(invalid).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_SEED_INVALID' }),
      ]),
    })
  })

  it('rejects unknown egg fields at the boundary', () => {
    expect(toGenerationRequest({
      id: 'egg-extra', theme: 'fungal', seed: 'x', risk: 0, mutationBonus: 0,
      privilegedMode: true,
    })).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_INPUT_INVALID' }),
      ]),
    })
  })

  it('maps deep_sea to the generator spelling after validation', () => {
    const input = {
      id: 'egg-1', theme: 'deep_sea', seed: 42, risk: 0, mutationBonus: 0,
    } as const
    const request = toGenerationRequest(input)

    expect(request).toMatchObject({
      ok: true,
      value: { seed: '42', themeId: 'deep-sea' },
    })
    expect(toGenerationRequest(input)).toEqual(request)
  })

  it('rolls an aberration before mutation when both chances apply', () => {
    const request = toGenerationRequest({
      id: 'egg-2', theme: 'fungal', seed: '0', risk: 1, mutationBonus: 1,
    })

    expect(request).toMatchObject({ ok: true, value: { mode: 'aberration' } })
  })

  it('caps finite risk and mutation chances at their business maxima', () => {
    const cappedRisk = toGenerationRequest({
      id: 'egg-3', theme: 'fungal', seed: 'fungal-egg', risk: 999, mutationBonus: 0,
    })
    const cappedMutation = toGenerationRequest({
      id: 'egg-3', theme: 'fungal', seed: 'fungal-egg', risk: 0, mutationBonus: 999,
    })

    expect(cappedRisk).toMatchObject({ ok: true, value: { mode: 'normal' } })
    expect(cappedMutation).toMatchObject({ ok: true, value: { mode: 'mutation' } })
  })

  it('returns a stable diagnostic instead of throwing for malformed monster input', () => {
    expect(toIncubatorRecord(null, productionCatalog())).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_SPEC_INVALID' }),
      ]),
    })
  })

  it('returns catalog diagnostics and no partial record for an unknown selected part', () => {
    const catalog = productionCatalog()
    const spec = generatedSpec(catalog)
    const invalid = {
      ...spec,
      visualSlots: {
        ...spec.visualSlots,
        eyes: { ...spec.visualSlots.eyes, partId: 'eyes_not_in_catalog' },
      },
    }

    expect(toIncubatorRecord(invalid, catalog)).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'SPEC_PART_MISSING' }),
      ]),
    })
  })

  it('returns semantic catalog diagnostics and no record for a forged trait', () => {
    const catalog = productionCatalog()
    const spec = generatedSpec(catalog)
    const invalid = {
      ...spec,
      semanticTraits: {
        ...spec.semanticTraits,
        personality: {
          ...spec.semanticTraits.personality,
          primaryTraitId: 'personality_not_in_catalog',
        },
      },
    }

    expect(toIncubatorRecord(invalid, catalog)).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'SPEC_SEMANTIC_TRAIT_MISSING',
          path: ['semanticTraits', 'personality', 'primaryTraitId'],
        }),
      ]),
    })
  })

  it('exports an isolated genome alongside the resolved phenotype', () => {
    const catalog = productionCatalog()
    const spec = generatedSpec(catalog)
    const result = toIncubatorRecord(spec, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.visualExtension.genome).toEqual(spec.genome)
    expect(result.value.visualExtension.genome).not.toBe(spec.genome)
    result.value.visualExtension.genome!.genes.eyes.H1 = 'mutated_adapter_copy'
    expect(spec.genome!.genes.eyes.H1).not.toBe('mutated_adapter_copy')
  })

  it('omits genome for a valid legacy phenotype', () => {
    const catalog = productionCatalog()
    const spec = generatedSpec(catalog)
    delete spec.genome
    const result = toIncubatorRecord(spec, catalog)

    expect(result.ok).toBe(true)
    if (result.ok) expect('genome' in result.value.visualExtension).toBe(false)
  })

  it('exports eight valid traits across themes, rigs, and modes', () => {
    const parsedCatalog = parseCatalog(productionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return
    const productionCatalog = parsedCatalog.value
    const themes = ['deep-sea', 'fungal', 'shadow'] as const
    const modes = ['normal', 'mutation', 'aberration'] as const
    const productionSpecMatrix: MonsterSpec[] = []
    for (const themeId of themes) {
      for (const mode of modes) {
        const results = Array.from({ length: 60 }, (_, index) => generateMonster({
          seed: `${themeId}-${mode}-${index}`, themeId, mode,
        }, productionCatalog))
        const unblockedSpecs = results.filter(result => !result.blocked).map(result => result.spec)
        expect(unblockedSpecs, `${themeId}/${mode} unblocked specs`).toHaveLength(60)
        productionSpecMatrix.push(...unblockedSpecs)
      }
    }
    expect(new Set(productionSpecMatrix.map(spec => spec.visualSlots.bodyFrame.rigId)))
      .toEqual(new Set(['blob', 'biped', 'floating']))
    for (const spec of productionSpecMatrix) {
      const result = toIncubatorRecord(spec, productionCatalog)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.traits).toHaveLength(8)
        expect(result.value.visualExtension.visualSlots).toEqual(spec.visualSlots)
      }
    }
  })
})
