import { describe, expect, it } from 'vitest'
import { makeValidCatalogFixture } from './test-fixtures.js'
import { parseCatalog } from './catalog-schema.js'
import { validateCatalogStructure } from './catalog-validation.js'

describe('catalog validation', () => {
  it('reports dangling excludes and missing mandatory coverage', () => {
    const catalog = makeValidCatalogFixture()
    catalog.parts[0]!.excludes = ['missing_part']
    catalog.parts = catalog.parts.filter(part => part.slotId !== 'eyes')

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).toContain('CATALOG_DANGLING_EXCLUDE')
    expect(codes).toContain('CATALOG_SLOT_UNCOVERED')
  })

  it('reports dangling semantic excludes and part boosts', () => {
    const catalog = makeValidCatalogFixture()
    catalog.semanticTraits[0]!.excludes = ['missing_semantic_trait']
    catalog.semanticTraits[0]!.boosts = { missing_part: 1.2 }

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).toContain('CATALOG_DANGLING_SEMANTIC_EXCLUDE')
    expect(codes).toContain('CATALOG_DANGLING_SEMANTIC_BOOST')
  })

  it('reports dangling modifier excludes and part boosts', () => {
    const catalog = makeValidCatalogFixture()
    catalog.modifiers[0]!.excludes = ['missing_modifier']
    catalog.modifiers[0]!.boosts = { missing_part: 1.2 }

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).toContain('CATALOG_DANGLING_MODIFIER_EXCLUDE')
    expect(codes).toContain('CATALOG_DANGLING_MODIFIER_BOOST')
  })

  it('requires explicit none candidates for optional slots', () => {
    const catalog = makeValidCatalogFixture()
    catalog.parts = catalog.parts.filter(part => part.id !== 'tail_none')

    expect(validateCatalogStructure(catalog)).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_OPTIONAL_NONE_MISSING' }),
    )
  })

  it('rejects coordinates outside the 2048 master canvas', () => {
    const catalog = makeValidCatalogFixture()
    catalog.rigs[0]!.sockets.head!.x = 2049

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
  })

  it('reports parts whose requested socket is absent on a compatible rig', () => {
    const catalog = makeValidCatalogFixture()
    delete catalog.rigs[0]!.sockets.head

    expect(validateCatalogStructure(catalog)).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_SOCKET_MISSING' }),
    )
  })

  it('reports dependency cycles', () => {
    const catalog = makeValidCatalogFixture()
    catalog.dependencies = { eyes: ['mouthShape'], mouthShape: ['eyes'] }

    expect(validateCatalogStructure(catalog)).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_DEPENDENCY_CYCLE' }),
    )
  })

  it('reports unapproved transform presets', () => {
    const catalog = makeValidCatalogFixture()
    catalog.parts[0]!.approvedTransforms = [{ scale: -1, mirrorX: false }]

    expect(validateCatalogStructure(catalog)).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_TRANSFORM_INVALID' }),
    )
  })

  it('rejects symbolic catalog modifier palettes', () => {
    const catalog = makeValidCatalogFixture() as unknown as {
      modifiers: Array<{ overrides: { palette: string } }>
    }
    catalog.modifiers[0]!.overrides = { palette: 'albino' }

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
  })

  it('rejects a double-head catalog definition without a destination socket', () => {
    const catalog = makeValidCatalogFixture()
    const modifier = catalog.modifiers.find(item => item.id === 'mutation_double_head')!
    delete modifier.overrides.socket

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
  })

  it('rejects a misplaced-eye catalog definition without a destination socket', () => {
    const catalog = makeValidCatalogFixture()
    const modifier = catalog.modifiers.find(item => item.id === 'aberration_misplaced_eye')!
    delete modifier.overrides.socket

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
  })
})
