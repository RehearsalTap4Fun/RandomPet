import { describe, expect, it } from 'vitest'
import {
  validateMonsterSpecAgainstCatalog,
  type Catalog,
} from './index.js'
import {
  makeValidCatalogFixture,
  makeValidCatalogFixtureWithThreeRigs,
  makeValidMonsterSpecFixture,
} from './test-fixtures.js'

const versions = {
  schemaVersion: '0.1.0',
  rendererVersion: '0.1.0',
} as const

describe('validateMonsterSpecAgainstCatalog', () => {
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
