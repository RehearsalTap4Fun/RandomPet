import { describe, expect, it } from 'vitest'
import {
  SEMANTIC_SLOT_IDS,
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  deriveCollectionRarity,
  generateMonster,
  parseCatalog,
  parseContentResourceId,
  type Catalog,
  type JsonResourceRef,
  type MonsterSpec,
  type MonsterSpecV09,
  type PngResourceRef,
  type ResolvedV09Catalog,
  type SealedTraitArtifactV1,
  type V09TraitSlotId,
} from '@qmonster/generator-core'
import productionCatalogDocument from '../../asset-catalog/catalog/v0.1.0/catalog.json'
import v06CatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'
import v08CatalogDocument from '../../asset-catalog/catalog/v0.8.0/catalog.json'
import fungalEgg from '../fixtures/fungal-egg.json'
import {
  toGenerationRequest,
  toIncubatorRecord,
  toIncubatorRecordV09,
  toV09GenerationRequest,
} from './index.js'

const V09_HASH = 'a'.repeat(64)

function v09PngRef(): PngResourceRef {
  const resourceId = parseContentResourceId(`sha256:${V09_HASH}`)
  if (resourceId === undefined) throw new Error('Test PNG resource ID must parse.')
  return { resourceId, sha256: V09_HASH, mediaType: 'image/png', width: 2048, height: 2048 }
}

function v09JsonRef(): JsonResourceRef {
  const resourceId = parseContentResourceId(`sha256:${V09_HASH}`)
  if (resourceId === undefined) throw new Error('Test JSON resource ID must parse.')
  return { resourceId, sha256: V09_HASH, mediaType: 'application/qmonster-manifest-v1+json' }
}

function v09Trait(slotId: V09TraitSlotId): SealedTraitArtifactV1 {
  const base = {
    schemaVersion: 'qmonster-sealed-trait-v1' as const,
    traitId: `trait-${slotId}`,
    rarity: 'common' as const,
    skeletonFamilyId: 'feline-sit-v2-core',
    assemblyTemplateId: 'feline-sit-v2-core-template',
    assemblyTemplateSha256: V09_HASH,
    neutralMasterSha256: V09_HASH,
    authoringInputs: [v09PngRef()],
    fullContextPreview: v09PngRef(),
    sealerVersion: 'test-sealer',
  }
  switch (slotId) {
    case 'eyes':
      return { ...base, kind: 'eyePair', slotId, runtimeResources: { underlay: v09PngRef(), content: v09PngRef() } }
    case 'mouthShape':
      return { ...base, kind: 'mouth', slotId, oralSocketClass: 'open', runtimeResources: { mouthBack: v09PngRef(), mouthFront: v09PngRef() } }
    case 'oralDetail':
      return { ...base, kind: 'oralDetail', slotId, runtimeResources: { oralProjections: { open: v09PngRef() } } }
    case 'headAppendage':
    case 'extraAppendage':
      return { ...base, kind: 'attachment', slotId, interfaceId: 'feline-head-interface', shapeClass: 'ear-ornament', runtimeResources: { attachmentBehind: v09PngRef() } }
    case 'effect':
      return { ...base, kind: 'ambientEffect', slotId, zoneId: 'background', runtimeResources: { effectLayer: v09PngRef() } }
    default:
      return { ...base, kind: 'surface', slotId, runtimeResources: { materialOperation: v09JsonRef() } }
  }
}

function v09Spec(): MonsterSpecV09 {
  return {
    ...V09_VERSION_TUPLE,
    seed: 'adapter-v09-output',
    speciesRigId: 'feline-sit-v2',
    skeletonFamilyId: 'feline-sit-v2-core',
    assemblyTemplateId: 'feline-sit-v2-core-template',
    skeletonSelection: { class: 'base', candidateId: 'feline-sit-v2-core', roll: 3 },
    visualSlots: Object.fromEntries(V09_TRAIT_SLOT_IDS.map((slotId, roll) => [
      slotId,
      { traitId: `trait-${slotId}`, rarity: 'common', roll },
    ])) as MonsterSpecV09['visualSlots'],
  }
}

function v09Catalog(): ResolvedV09Catalog {
  const manifestRef = v09JsonRef()
  const skeletonFamily = {
    schemaVersion: 'qmonster-skeleton-family-v1' as const,
    skeletonFamilyId: 'feline-sit-v2-core',
    skeletonClass: 'base' as const,
    structuralShapeClasses: ['feline-standard'] as const,
    archetypeId: 'feline',
    poseId: 'sit',
    speciesRigId: 'feline-sit-v2',
    canvas: { width: 2048 as const, height: 2048 as const },
    neutralMaster: v09PngRef(),
    materialMap: v09PngRef(),
    fixedOccluderMasks: {},
    assemblyTemplateId: 'feline-sit-v2-core-template',
  }
  const legendaryFamily = {
    ...skeletonFamily,
    skeletonFamilyId: 'feline-sit-v2-legendary-01',
    skeletonClass: 'legendary' as const,
    assemblyTemplateId: 'feline-sit-v2-legendary-template',
  }
  const template = {
    schemaVersion: 'qmonster-assembly-template-v1' as const,
    assemblyTemplateId: 'feline-sit-v2-core-template',
    skeletonFamilyId: 'feline-sit-v2-core',
    canvas: { width: 2048 as const, height: 2048 as const },
    neutralMasterSha256: V09_HASH,
    materialRegistry: {},
    slots: { surface: [], embedded: [], attachment: [], effect: [] },
    compositionGraph: {
      schemaVersion: 'qmonster-composition-graph-v1' as const,
      orderedNodes: [],
      blendMode: 'source-over-premultiplied-srgb' as const,
      transformPolicy: 'identity-only' as const,
    },
  }
  const releaseManifest = {
    schemaVersion: 'qmonster-release-v1' as const,
    versionTuple: { ...V09_VERSION_TUPLE },
    speciesRig: manifestRef,
    skeletonPool: manifestRef,
    skeletonFamilies: [manifestRef, manifestRef],
    assemblyTemplates: [manifestRef, manifestRef],
    approvals: [manifestRef, manifestRef],
    traitApprovals: V09_TRAIT_SLOT_IDS.map(() => manifestRef),
    traitInventory: manifestRef,
    sealedTraits: V09_TRAIT_SLOT_IDS.map(() => manifestRef),
    compositionGraph: manifestRef,
    rendererBuildSha256: V09_HASH,
  }
  return {
    releaseManifestSha256: 'b'.repeat(64),
    releaseManifest,
    speciesRig: manifestRef,
    skeletonPool: {
      schemaVersion: 'qmonster-skeleton-pool-v1',
      skeletonPoolId: 'feline-sit-v2-pool',
      candidates: [
        { skeletonFamilyId: 'feline-sit-v2-core', skeletonClass: 'base', weight: 8 },
        { skeletonFamilyId: 'feline-sit-v2-legendary-01', skeletonClass: 'legendary', weight: 1 },
      ],
    },
    skeletonFamilies: [skeletonFamily, legendaryFamily],
    assemblyTemplates: [
      template,
      { ...template, assemblyTemplateId: 'feline-sit-v2-legendary-template', skeletonFamilyId: 'feline-sit-v2-legendary-01' },
    ],
    sealedTraits: V09_TRAIT_SLOT_IDS.map(v09Trait),
    compositionGraph: template.compositionGraph,
  }
}

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

function v06Catalog(): Catalog {
  const parsed = parseCatalog(v06CatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('v0.6 catalog fixture must parse.')
  return parsed.value
}

function v06Spec(catalog: Catalog): MonsterSpec {
  const generated = generateMonster({
    seed: 'adapter-v06-output', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
  }, catalog)
  expect(generated.blocked).toBe(false)
  return generated.spec
}

function v08Catalog(): Catalog {
  const parsed = parseCatalog(v08CatalogDocument)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('v0.8 catalog fixture must parse.')
  return parsed.value
}

describe('incubator adapter', () => {
  it('normalizes a v0.9 egg request without translating legacy mutation inputs', () => {
    expect(toV09GenerationRequest({
      id: 'egg-v09', theme: 'deep_sea', seed: 42, risk: 1, mutationBonus: 1,
      archetype: 'feline',
    })).toEqual({
      ok: true,
      value: {
        seed: '42',
        themeId: 'deep-sea',
        speciesRigId: 'feline-sit-v2',
      },
    })
  })

  it('uses the existing fail-closed egg boundary for v0.9 requests', () => {
    expect(toV09GenerationRequest({
      id: 'egg-v09-invalid', theme: 'fungal', seed: 'seed', risk: 0, mutationBonus: 0,
      archetype: 'canine',
    })).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_ARCHETYPE_UNSUPPORTED', path: ['archetype'] }),
      ]),
    })
  })

  it('exports the exact v0.9 release and structure identity with all twelve selections', () => {
    const spec = v09Spec()
    const catalog = v09Catalog()

    expect(toIncubatorRecordV09(spec, catalog)).toEqual({
      ok: true,
      value: {
        seed: 'adapter-v09-output',
        visualExtension: {
          schemaVersion: '0.4.0',
          catalogVersion: '0.9.0',
          generatorVersion: '0.9.0',
          releaseManifestSha256: 'b'.repeat(64),
          speciesRigId: 'feline-sit-v2',
          skeletonFamilyId: 'feline-sit-v2-core',
          assemblyTemplateId: 'feline-sit-v2-core-template',
          skeletonSelection: { class: 'base', candidateId: 'feline-sit-v2-core', roll: 3 },
          visualSlots: Object.fromEntries(V09_TRAIT_SLOT_IDS.map((slotId, roll) => [
            slotId,
            { traitId: `trait-${slotId}`, rarity: 'common', roll },
          ])),
        },
      },
    })
  })

  it('rejects mixed and legacy-shaped v0.9 tuples without returning a partial record', () => {
    const mixed = { ...v09Spec(), generatorVersion: '0.8.0' }
    const legacyField = { ...v09Spec(), rendererVersion: '0.9.0' }

    for (const input of [mixed, legacyField]) {
      const result = toIncubatorRecordV09(input, v09Catalog())
      expect(result.ok).toBe(false)
      expect(result).not.toHaveProperty('value')
      expect(result).toEqual({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: input === mixed ? 'VERSION_TUPLE_MISMATCH' : 'ADAPTER_SPEC_INVALID' }),
        ]),
      })
    }
  })

  it('rejects a missing v0.9 structure identity without returning a partial record', () => {
    const input = { ...v09Spec() } as Partial<MonsterSpecV09>
    delete input.assemblyTemplateId

    const result = toIncubatorRecordV09(input, v09Catalog())
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('value')
    expect(result).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_SPEC_INVALID', path: ['assemblyTemplateId'] }),
      ]),
    })
  })

  it('rejects a resolved catalog whose release tuple does not match v0.9', () => {
    const catalog = v09Catalog()
    ;(catalog.releaseManifest.versionTuple as { catalogVersion: string }).catalogVersion = '0.8.0'

    const result = toIncubatorRecordV09(v09Spec(), catalog)
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('value')
    expect(result).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'VERSION_TUPLE_MISMATCH', path: ['releaseManifest', 'versionTuple'] }),
      ]),
    })
  })

  it('rejects a trait selection that is not sealed for the selected skeleton and template', () => {
    const spec = v09Spec()
    spec.visualSlots.eyes.traitId = 'forged-eyes'

    const result = toIncubatorRecordV09(spec, v09Catalog())
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('value')
    expect(result).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'TRAIT_SLOT_INCOMPATIBLE', path: ['visualSlots', 'eyes'] }),
      ]),
    })
  })

  it('deep-copies v0.9 skeleton and trait selection objects', () => {
    const spec = v09Spec()
    const result = toIncubatorRecordV09(spec, v09Catalog())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.value.visualExtension.skeletonSelection.candidateId = 'mutated-output'
    result.value.visualExtension.visualSlots.bodyColor.traitId = 'mutated-output'
    expect(spec.skeletonSelection.candidateId).toBe('feline-sit-v2-core')
    expect(spec.visualSlots.bodyColor.traitId).toBe('trait-bodyColor')

    spec.skeletonSelection.candidateId = 'mutated-input'
    spec.visualSlots.eyes.traitId = 'mutated-input'
    expect(result.value.visualExtension.skeletonSelection.candidateId).toBe('mutated-output')
    expect(result.value.visualExtension.visualSlots.eyes.traitId).toBe('trait-eyes')
  })

  it('preserves the v0.8 species rig identity in incubator output', () => {
    const catalog = v08Catalog()
    const generated = generateMonster({
      seed: 'adapter-v08-output', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(generated.blocked).toBe(false)
    expect(toIncubatorRecord(generated.spec, catalog)).toMatchObject({
      ok: true,
      value: {
        visualExtension: {
          catalogVersion: '0.8.0',
          rendererVersion: '0.8.0',
          anatomyBundleId: 'feline-sit-canonical-v1',
          speciesRigId: 'feline-sit-v1',
        },
      },
    })
  })

  it('keeps the complete v0.8 record shape byte-for-byte compatible', () => {
    const catalog = v08Catalog()
    const generated = generateMonster({
      seed: 'adapter-v08-shape', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)
    expect(generated.blocked).toBe(false)
    const spec = generated.spec

    expect(toIncubatorRecord(spec, catalog)).toEqual({
      ok: true,
      value: {
        theme: 'fungal',
        seed: spec.seed,
        traits: SEMANTIC_SLOT_IDS.map(slotId => spec.semanticTraits[slotId].primaryTraitId),
        mutation: spec.mutation?.id ?? null,
        aberrations: spec.aberrations.map(application => application.id),
        palette: [spec.palette.primary, spec.palette.secondary, spec.palette.accent],
        visualExtension: {
          schemaVersion: spec.schemaVersion,
          catalogVersion: spec.catalogVersion,
          rendererVersion: spec.rendererVersion,
          archetypeId: spec.archetypeId,
          anatomyBundleId: spec.anatomyBundleId,
          speciesRigId: spec.speciesRigId,
          collectionRarity: deriveCollectionRarity(spec, catalog),
          visualSlots: spec.visualSlots,
          genome: spec.genome,
        },
      },
    })
  })

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

  it('maps an explicit v0.6 feline egg archetype to feline', () => {
    const request = toGenerationRequest({
      id: 'v06-default-archetype', theme: 'fungal', seed: 'v06-default', risk: 0, mutationBonus: 0,
      archetype: 'feline',
    })
    expect(request).toMatchObject({
      ok: true,
      value: { archetypeId: 'feline' },
    })
    if (!request.ok) return
    const generated = generateMonster(request.value, v06Catalog())
    expect(generated.blocked).toBe(false)
  })

  it('keeps the legacy egg fixture seed and theme mapping intact', () => {
    const request = toGenerationRequest(fungalEgg)
    expect(request).toMatchObject({
      ok: true,
      value: {
        seed: fungalEgg.seed,
        themeId: 'fungal',
      },
    })
    if (!request.ok) return
    expect(request.value).not.toHaveProperty('archetypeId')

    const generated = generateMonster(request.value, productionCatalog())
    expect(generated.blocked).toBe(false)
  })

  it('rejects a v0.6 egg request with an unsupported archetype', () => {
    expect(toGenerationRequest({
      id: 'v06-unsupported-archetype', theme: 'fungal', seed: 'v06-unsupported', risk: 0,
      mutationBonus: 0, archetype: 'canine',
    })).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'ADAPTER_ARCHETYPE_UNSUPPORTED' }),
      ]),
    })
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

  it('exports the exact v0.6 anatomy identity tuple in visualExtension', () => {
    const catalog = v06Catalog()
    const spec = v06Spec(catalog)
    const result = toIncubatorRecord(spec, catalog)

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        visualExtension: expect.objectContaining({
          schemaVersion: spec.schemaVersion,
          catalogVersion: spec.catalogVersion,
          rendererVersion: spec.rendererVersion,
          archetypeId: 'feline',
          anatomyBundleId: spec.anatomyBundleId,
          visualSlots: spec.visualSlots,
        }),
      }),
    })
  })

  it('exports the derived collection rarity with the v0.6 anatomy identity', () => {
    const catalog = v06Catalog()
    const legendary = catalog.anatomyBundles!.find(bundle => bundle.rarity === 'L')!
    const generated = generateMonster({
      seed: 'adapter-v06-legendary', themeId: 'shadow', mode: 'normal', archetypeId: 'feline',
      lockedSelections: Object.fromEntries([
        ['bodyFrame', legendary.derivedSlots.bodyFrame],
        ['headShape', legendary.derivedSlots.headShape],
        ['arms', legendary.derivedSlots.arms],
        ['legs', legendary.derivedSlots.legs],
        ['tail', legendary.derivedSlots.tail],
        ['extraAppendage', legendary.derivedSlots.extraAppendage],
      ]),
    }, catalog)
    expect(generated.blocked).toBe(false)
    const result = toIncubatorRecord(generated.spec, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.value.visualExtension as { collectionRarity?: string }).collectionRarity).toBe('L')
  })

  it('rejects a forged v0.6 anatomy bundle without a partial record', () => {
    const catalog = v06Catalog()
    const spec = v06Spec(catalog)
    const invalid = { ...spec, anatomyBundleId: 'forged-feline-bundle' }

    expect(toIncubatorRecord(invalid, catalog)).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_UNKNOWN' }),
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
