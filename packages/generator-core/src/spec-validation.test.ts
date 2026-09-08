import { describe, expect, it } from 'vitest'
import {
  generateMonster,
  parseCatalog,
  validateMonsterSpecAgainstCatalog,
  type Catalog,
} from './index.js'
import {
  makeCompositionCatalogFixture,
  makeInterfaceCatalogFixture,
  makeValidCompositionSpecFixture,
  makeValidCatalogFixture,
  makeValidCatalogFixtureWithThreeRigs,
  makeValidMonsterSpecFixture,
  makeV08SpeciesRigCatalogFixture,
} from './test-fixtures.js'
import v04ProductionCatalogDocument from '../../asset-catalog/catalog/v0.4.0/catalog.json'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'

const versions = {
  schemaVersion: '0.1.0',
  rendererVersion: '0.1.0',
} as const

describe('validateMonsterSpecAgainstCatalog', () => {
  it('accepts the exact generated v0.8 tuple and rejects a forged species rig', () => {
    const catalog = makeV08SpeciesRigCatalogFixture()
    const generated = generateMonster({
      seed: 'v08-spec-validation', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
    }, catalog)

    expect(validateMonsterSpecAgainstCatalog(generated.spec, catalog)
      .filter(diagnostic => diagnostic.severity === 'error')).toEqual([])

    const forged = { ...structuredClone(generated.spec), speciesRigId: 'other-rig' }
    expect(validateMonsterSpecAgainstCatalog(forged, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_SPECIES_RIG_MISMATCH', path: ['speciesRigId'],
    }))
  })

  it.each(['normal', 'mutation', 'aberration'] as const)(
    'accepts a generated exact-v0.6 feline anatomy bundle in %s mode',
    mode => {
      const parsed = parseCatalog(v06ProductionCatalogDocument)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const generated = generateMonster({
        seed: `feline-v06-${mode}`,
        themeId: 'fungal',
        mode,
        archetypeId: 'feline',
      }, parsed.value)

      expect(generated.blocked).toBe(false)
      expect(validateMonsterSpecAgainstCatalog(generated.spec, parsed.value)
        .filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    },
  )

  it('rejects forged structural and local selections outside an exact-v0.6 anatomy bundle', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = parsed.value
    const versions = { schemaVersion: '0.2.0', rendererVersion: '0.6.0' }
    const base = generateMonster({ seed: 'feline-forge', themeId: 'fungal', mode: 'normal', archetypeId: 'feline' }, catalog).spec
    const selectedBundle = catalog.anatomyBundles!.find(bundle => bundle.id === base.anatomyBundleId)!
    const otherBundle = catalog.anatomyBundles!.find(bundle => bundle.id !== selectedBundle.id)!

    const forgedArchetype = { ...structuredClone(base), archetypeId: 'canine' as const }
    const unknownBundle = structuredClone(base)
    unknownBundle.anatomyBundleId = 'unknown-feline-bundle'
    const structural = structuredClone(base)
    structural.visualSlots.tail.partId = otherBundle.derivedSlots.tail
    const local = structuredClone(base)
    local.visualSlots.eyes.partId = otherBundle.allowedTraitPools.eyes![0]!
    const doubleHead = structuredClone(base)
    doubleHead.mutation = { id: 'mutation_double_head', overrides: { duplicateLayerGroup: 'head', socket: 'headAlternate' } }
    const requiresMutation = structuredClone(base)
    requiresMutation.mutation = null
    requiresMutation.aberrations = [{ id: 'aberration_feline_crystal_glint', overrides: {} }]
    catalog.modifiers = catalog.modifiers.map(modifier => modifier.id === 'aberration_feline_crystal_glint'
      ? { ...modifier, requiresMutation: true } : modifier)

    expect(validateMonsterSpecAgainstCatalog(forgedArchetype, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_ARCHETYPE_INVALID' }))
    expect(validateMonsterSpecAgainstCatalog(forgedArchetype, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_ARCHETYPE_MISMATCH' }))
    expect(validateMonsterSpecAgainstCatalog(unknownBundle, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_UNKNOWN' }))
    expect(validateMonsterSpecAgainstCatalog(unknownBundle, catalog, versions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_UNKNOWN' }),
      expect.objectContaining({ code: 'SPEC_INTEGRATED_SLOT_INVALID' }),
    ]))
    expect(validateMonsterSpecAgainstCatalog(structural, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_SLOT_MISMATCH' }))
    expect(validateMonsterSpecAgainstCatalog(local, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_ANATOMY_BUNDLE_TRAIT_MISMATCH' }))
    expect(validateMonsterSpecAgainstCatalog(doubleHead, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_MODIFIER_INVALID' }))
    expect(validateMonsterSpecAgainstCatalog(requiresMutation, catalog, versions)).toContainEqual(expect.objectContaining({ code: 'SPEC_MODIFIER_INVALID' }))
  })

  it('keeps independent feline sentinels and eligible-special counts for non-Bundle specs', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = parsed.value
    catalog.archetypes = catalog.archetypes!.map(archetype => ({
      ...archetype,
      specialFeatureSlots: ['headAppendage'],
    }))
    const spec = generateMonster({ seed: 'feline-non-bundle', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline' }, catalog).spec
    delete spec.anatomyBundleId

    const codes = validateMonsterSpecAgainstCatalog(spec, catalog).map(diagnostic => diagnostic.code)

    expect(codes).toContain('SPEC_INTEGRATED_SLOT_INVALID')
    expect(codes).toContain('SPEC_SPECIAL_FEATURE_COUNT_INVALID')
  })

  it('rejects a v0.6 modifier state that combines mutation and aberration', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = parsed.value
    const spec = generateMonster({ seed: 'feline-stacked-modifiers', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline' }, catalog).spec
    spec.aberrations = [{ id: 'aberration_feline_crystal_glint', overrides: {} }]

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_MODIFIER_STATE_INVALID', path: ['aberrations'],
    }))
  })

  it('rejects a v0.6 modifier state with multiple aberrations', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = parsed.value
    const spec = generateMonster({ seed: 'feline-many-aberrations', themeId: 'fungal', mode: 'aberration', archetypeId: 'feline' }, catalog).spec
    spec.aberrations = [
      { id: 'aberration_feline_crystal_glint', overrides: {} },
      { id: 'aberration_feline_soft_glow', overrides: {} },
    ]

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_MODIFIER_STATE_INVALID', path: ['aberrations'],
    }))
  })

  it('appends genome diagnostics after the existing spec diagnostics', () => {
    const catalog = makeValidCatalogFixture()
    const spec = generateMonster({ seed: 'full-genome-validation', themeId: 'fungal', mode: 'normal' }, catalog).spec
    spec.genome!.genes.eyes.H1 = 'missing_hidden_eyes'

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(expect.objectContaining({
      code: 'SPEC_GENE_PART_MISSING',
      path: ['genome', 'genes', 'eyes', 'H1'],
    }))
  })

  it('keeps the exact legacy diagnostic sequence when genome is absent', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.visualSlots.effect.partId = 'missing_effect'
    spec.semanticTraits.frame.primaryTraitId = 'missing_frame_trait'
    spec.mutation = { id: 'missing_mutation', overrides: {} }
    const snapshot = structuredClone(spec)

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions).map(item => ({
      code: item.code,
      path: item.path,
    }))).toEqual([
      { code: 'SPEC_PART_MISSING', path: ['visualSlots', 'effect', 'partId'] },
      { code: 'SPEC_SEMANTIC_TRAIT_MISSING', path: ['semanticTraits', 'frame', 'primaryTraitId'] },
      { code: 'SPEC_MODIFIER_INVALID', path: ['mutation'] },
    ])
    expect(spec).toEqual(snapshot)
    expect(spec.genome).toBeUndefined()
  })

  it('reports a blocking connector diagnostic with literal pair measurements', () => {
    const catalog = makeInterfaceCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.3.0'
    spec.rendererVersion = '0.3.0'
    const head = catalog.parts.find(part => part.slotId === 'headShape')!
    if (head.composition?.mode !== 'interface') throw new Error('Expected interface head')
    head.composition.variantsByRig.blob!.connectors.find(connector => connector.id === 'neck')!.width = 300

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'CONNECTOR_WARP_EXCEEDED',
      path: ['visualSlots', 'headShape'],
      message: expect.stringContaining('Parts body_blob and head_round at neck measure widthRatio=3'),
    }))
  })

  it('derives the required renderer version from the catalog', () => {
    const legacyCatalog = makeValidCatalogFixture()
    const compositionCatalog = makeCompositionCatalogFixture()

    expect(validateMonsterSpecAgainstCatalog(
      makeValidMonsterSpecFixture(), legacyCatalog,
    )).not.toContainEqual(expect.objectContaining({
      code: 'SPEC_RENDERER_VERSION_UNSUPPORTED',
    }))
    expect(validateMonsterSpecAgainstCatalog(
      makeValidCompositionSpecFixture(compositionCatalog), compositionCatalog,
    )).not.toContainEqual(expect.objectContaining({
      code: 'SPEC_RENDERER_VERSION_UNSUPPORTED',
    }))
  })

  it('returns an unsupported-catalog diagnostic instead of throwing for an unknown version', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    catalog.version = '0.0.9'
    spec.catalogVersion = '0.0.9'

    expect(() => validateMonsterSpecAgainstCatalog(spec, catalog)).not.toThrow()
    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'SPEC_CATALOG_VERSION_UNSUPPORTED',
      path: ['catalogVersion'],
    }))
  })

  it('uses composition geometry rather than legacy rig sockets for composition modifiers', () => {
    const catalog = makeCompositionCatalogFixture()
    delete catalog.rigs.find(rig => rig.id === 'blob')!.sockets.headAlternate
    const spec = makeValidCompositionSpecFixture(catalog)
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).not.toContainEqual(
      expect.objectContaining({
        code: 'SPEC_SOCKET_MISSING', path: ['mutation', 'overrides', 'socket'],
      }),
    )
  })

  it('accepts the frozen v0.4 recovery input when its interface rig declares the modifier destination', () => {
    const parsedCatalog = parseCatalog(v04ProductionCatalogDocument)
    expect(parsedCatalog.ok).toBe(true)
    if (!parsedCatalog.ok) return

    const generated = generateMonster({
      seed: 'qmonster-v04-user-review-002',
      themeId: 'fungal',
      mode: 'mutation',
    }, parsedCatalog.value)

    expect(generated.spec.visualSlots.bodyFrame.partId).toBe('body_floating_drop')
    expect(generated.spec.mutation?.id).toBe('mutation_double_head')
    expect(validateMonsterSpecAgainstCatalog(generated.spec, parsedCatalog.value)
      .filter(item => item.severity === 'error')).toEqual([])
  })

  it('accepts exact-v0.4 interface modifier sockets but fails closed when the selected rig lacks one', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.version = '0.4.0'
    catalog.compositionPolicy!.maxStrongNonFacialFeatures = 1
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.catalogVersion = '0.4.0'
    spec.rendererVersion = '0.4.0'
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).not.toContainEqual(
      expect.objectContaining({
        code: 'SPEC_SOCKET_MISSING', path: ['mutation', 'overrides', 'socket'],
      }),
    )

    delete catalog.rigs.find(rig => rig.id === 'blob')!.sockets.headAlternate
    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(
      expect.objectContaining({
        severity: 'error', code: 'SPEC_SOCKET_MISSING',
        path: ['mutation', 'overrides', 'socket'],
      }),
    )
  })

  it('does not let attachment-mode modifiers fall back to rig sockets', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    if (body.composition?.mode === 'interface' || body.composition === undefined) {
      throw new Error('Expected attachment body')
    }
    delete body.composition.geometryByRig.blob!.sockets.headAlternate
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog)).toContainEqual(
      expect.objectContaining({
        severity: 'error', code: 'SPEC_SOCKET_MISSING',
        path: ['mutation', 'overrides', 'socket'],
      }),
    )
  })

  it('reports a warning when a composition-aware spec exceeds its strong feature budget', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    for (const slotId of ['headShape', 'eyes', 'effect'] as const) {
      const source = catalog.parts.find(part => part.slotId === slotId && !part.composition!.isNone)!
      const strong = {
        ...structuredClone(source),
        id: `${slotId}_validation_strong`,
        composition: {
          ...structuredClone(source.composition!),
          visualIntensity: 'strong' as const,
          renderNodes: source.composition!.renderNodes.map(node => ({
            ...node,
            id: `${slotId}_validation_strong_${node.id}`,
          })),
        },
      }
      catalog.parts.push(strong)
      spec.visualSlots[slotId] = { partId: strong.id, rigId: 'blob' }
    }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, {
      schemaVersion: '0.1.0', rendererVersion: '0.2.0',
    })).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'COMPOSITION_INTENSITY_EXCEEDED',
    }))
  })

  it('rejects selection transforms for composition-aware parts', () => {
    const catalog = makeCompositionCatalogFixture()
    const spec = makeValidCompositionSpecFixture(catalog)
    spec.visualSlots.eyes.transform = { scale: 1, mirrorX: false }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, {
      schemaVersion: '0.1.0', rendererVersion: '0.2.0',
    })).toContainEqual(expect.objectContaining({
      code: 'SPEC_TRANSFORM_INVALID', path: ['visualSlots', 'eyes', 'transform'],
    }))
  })

  it.each([
    ['schemaVersion', '9.0.0', 'SPEC_SCHEMA_VERSION_UNSUPPORTED'],
    ['rendererVersion', '9.0.0', 'SPEC_RENDERER_VERSION_UNSUPPORTED'],
    ['catalogVersion', '9.0.0', 'SPEC_CATALOG_VERSION_MISMATCH'],
  ] as const)('rejects unsupported %s', (field, value, code) => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec[field] = value

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toContainEqual(
      expect.objectContaining({ severity: 'error', code }),
    )
  })

  it('rejects rig, theme, exclusion, and transform violations', () => {
    const catalog = makeValidCatalogFixtureWithThreeRigs()
    const bipedLegs = catalog.parts.find(part => part.id === 'legs_webbed')!
    catalog.parts.push({ ...bipedLegs, id: 'legs_biped_only', compatibleRigs: ['biped'] })
    const spec = makeValidMonsterSpecFixture()
    spec.visualSlots.legs = { partId: 'legs_biped_only', rigId: 'blob' }
    spec.visualSlots.colorScheme.partId = 'color_fungal_amber'
    spec.themeId = 'shadow'
    spec.visualSlots.eyes.transform = { scale: 7, mirrorX: false }
    const codes = validateMonsterSpecAgainstCatalog(spec, catalog, versions).map(item => item.code)

    expect(codes).toEqual(expect.arrayContaining([
      'SPEC_RIG_INCOMPATIBLE', 'SPEC_THEME_INCOMPATIBLE', 'SPEC_TRANSFORM_INVALID',
    ]))
  })

  it('rejects a part assigned to the wrong slot', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.visualSlots.eyes.partId = 'mouth_wide'

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toContainEqual(
      expect.objectContaining({ code: 'SPEC_PART_SLOT_MISMATCH', path: ['visualSlots', 'eyes', 'partId'] }),
    )
  })

  it('rejects selected parts that exclude each other in either direction', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const eyes = catalog.parts.find(part => part.id === 'eyes_asymmetric')!
    const mouth = catalog.parts.find(part => part.id === 'mouth_wide')!
    eyes.excludes = [mouth.id]
    mouth.excludes = [eyes.id]

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toContainEqual(
      expect.objectContaining({ code: 'SPEC_PART_EXCLUDED' }),
    )
  })

  it('rejects a selected part whose socket is unavailable on its rig', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const eyes = catalog.parts.find(part => part.id === 'eyes_asymmetric')!
    eyes.socket = 'missingSocket'

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toContainEqual(
      expect.objectContaining({ code: 'SPEC_SOCKET_MISSING', path: ['visualSlots', 'eyes', 'rigId'] }),
    )
  })

  it('rejects missing and wrong-slot primary and detail semantic traits', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.semanticTraits.frame.primaryTraitId = 'missing_frame_trait'
    spec.semanticTraits.appendage.detailTraitIds = ['missing_detail_trait', 'mouth_wide']
    spec.semanticTraits.pattern.primaryTraitId = 'mouth_wide'

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toEqual([
      expect.objectContaining({
        code: 'SPEC_SEMANTIC_TRAIT_MISSING',
        path: ['semanticTraits', 'frame', 'primaryTraitId'],
      }),
      expect.objectContaining({
        code: 'SPEC_SEMANTIC_TRAIT_MISSING',
        path: ['semanticTraits', 'appendage', 'detailTraitIds', '0'],
      }),
      expect.objectContaining({
        code: 'SPEC_SEMANTIC_TRAIT_SLOT_MISMATCH',
        path: ['semanticTraits', 'appendage', 'detailTraitIds', '1'],
      }),
      expect.objectContaining({
        code: 'SPEC_SEMANTIC_TRAIT_SLOT_MISMATCH',
        path: ['semanticTraits', 'pattern', 'primaryTraitId'],
      }),
    ])
  })

  it('orders semantic-slot diagnostics before modifier diagnostics', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.semanticTraits.frame.primaryTraitId = 'missing_frame_trait'
    spec.semanticTraits.mouth.detailTraitIds = ['surface_gel']
    spec.mutation = { id: 'missing_mutation', overrides: {} }

    const diagnostics = validateMonsterSpecAgainstCatalog(spec, catalog, versions)

    expect(diagnostics.map(item => ({ code: item.code, path: item.path }))).toEqual([
      {
        code: 'SPEC_SEMANTIC_TRAIT_MISSING',
        path: ['semanticTraits', 'frame', 'primaryTraitId'],
      },
      {
        code: 'SPEC_SEMANTIC_TRAIT_SLOT_MISMATCH',
        path: ['semanticTraits', 'mouth', 'detailTraitIds', '0'],
      },
      { code: 'SPEC_MODIFIER_INVALID', path: ['mutation'] },
    ])
  })

  it('rejects modifier applications with the wrong kind or overrides', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    spec.mutation = { id: 'aberration_color_discord', overrides: {} }
    spec.aberrations = [{ id: 'aberration_misplaced_eye', overrides: {} }]

    const diagnostics = validateMonsterSpecAgainstCatalog(spec, catalog, versions)

    expect(diagnostics.filter(item => item.code === 'SPEC_MODIFIER_INVALID')).toHaveLength(2)
  })

  it('rejects a modifier destination socket missing from its selected rig', () => {
    const catalog = makeValidCatalogFixture()
    delete catalog.rigs.find(rig => rig.id === 'blob')!.sockets.headAlternate
    const spec = makeValidMonsterSpecFixture()
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    spec.mutation = { id: modifier.id, overrides: structuredClone(modifier.overrides) }

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toContainEqual(
      expect.objectContaining({
        code: 'SPEC_SOCKET_MISSING',
        path: ['mutation', 'overrides', 'socket'],
      }),
    )
  })

  it('orders visual-slot diagnostics before modifier diagnostics', () => {
    const catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const body = catalog.parts.find(part => part.id === 'body_blob')!
    body.excludes = ['eyes_asymmetric']
    spec.visualSlots.bodyFrame.transform = { scale: 2, mirrorX: false }
    spec.visualSlots.effect.partId = 'missing_effect'
    spec.mutation = { id: 'missing_mutation', overrides: {} }

    const codes = validateMonsterSpecAgainstCatalog(spec, catalog, versions).map(item => item.code)

    expect(codes).toEqual([
      'SPEC_TRANSFORM_INVALID',
      'SPEC_PART_EXCLUDED',
      'SPEC_PART_MISSING',
      'SPEC_MODIFIER_INVALID',
    ])
  })

  it('accepts a generated-compatible fixture with matching modifier overrides', () => {
    const catalog: Catalog = makeValidCatalogFixture()
    const spec = makeValidMonsterSpecFixture()
    const mutation = catalog.modifiers.find(item => item.id === 'mutation_albino')!
    const aberration = catalog.modifiers.find(item => item.id === 'aberration_misplaced_eye')!
    spec.mutation = { id: mutation.id, overrides: structuredClone(mutation.overrides) }
    spec.aberrations = [{ id: aberration.id, overrides: structuredClone(aberration.overrides) }]

    expect(validateMonsterSpecAgainstCatalog(spec, catalog, versions)).toEqual([])
  })
})
