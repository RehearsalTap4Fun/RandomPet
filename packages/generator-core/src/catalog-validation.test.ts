import { describe, expect, it } from 'vitest'
import { makeCompositionCatalogFixture, makeValidCatalogFixture } from './test-fixtures.js'
import { parseCatalog } from './catalog-schema.js'
import { validateCatalogStructure } from './catalog-validation.js'

describe('catalog validation', () => {
  it('rejects a visible non-root node without an explicit parent socket', () => {
    const catalog = makeCompositionCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    eyes.composition!.renderNodes[0]!.socket = null

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_SOCKET_MISSING',
    }))
  })

  it('requires composition metadata for every 0.2.0 catalog part', () => {
    const catalog = makeCompositionCatalogFixture()
    delete catalog.compositionPolicy
    delete catalog.parts[0].composition

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).toContain('COMPOSITION_POLICY_MISSING')
    expect(codes).toContain('COMPOSITION_PART_METADATA_MISSING')
  })

  it('requires quiet fallbacks and face geometry for every compatible rig', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.parts = catalog.parts.filter(part => (
      part.slotId !== 'eyes' || part.composition?.visualIntensity === 'strong'
    ))
    delete catalog.parts.find(part => part.slotId === 'headShape')!
      .composition!.geometryByRig.blob!.faceSafeZone

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).toContain('COMPOSITION_QUIET_FALLBACK_MISSING')
    expect(codes).toContain('COMPOSITION_FACE_ZONE_MISSING')
  })

  it('rejects duplicate composition node IDs', () => {
    const catalog = makeCompositionCatalogFixture()
    const arms = catalog.parts.find(part => part.slotId === 'arms')!
    arms.composition!.renderNodes[1]!.id = arms.composition!.renderNodes[0]!.id

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_NODE_ID_DUPLICATE',
    }))
  })

  it('rejects a node targeting a parent slot outside the composition hierarchy', () => {
    const catalog = makeCompositionCatalogFixture()
    const eyes = catalog.parts.find(part => part.slotId === 'eyes')!
    eyes.composition!.renderNodes[0]!.parentSlot = 'bodyFrame'

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_PARENT_SLOT_INVALID',
    }))
  })

  it('requires parent sockets on every compatible parent candidate', () => {
    const catalog = makeCompositionCatalogFixture()
    const alternateHead = structuredClone(catalog.parts.find(part => part.slotId === 'headShape')!)
    alternateHead.id = 'head_without_eyes_socket'
    delete alternateHead.composition!.geometryByRig.blob!.sockets.eyes
    catalog.parts.push(alternateHead)

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_SOCKET_MISSING',
    }))
  })

  it('requires nodes for visible parts and forbids them for explicit none parts', () => {
    const catalog = makeCompositionCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    const tailNone = catalog.parts.find(part => part.slotId === 'tail' && part.composition!.isNone)!
    body.composition!.renderNodes = []
    tailNone.composition!.renderNodes = [structuredClone(
      catalog.parts.find(part => part.slotId === 'tail' && !part.composition!.isNone)!
        .composition!.renderNodes[0]!,
    )]

    const codes = validateCatalogStructure(catalog).map(item => item.code)
    expect(codes).toContain('COMPOSITION_NODES_MISSING')
    expect(codes).toContain('COMPOSITION_NONE_HAS_NODES')
  })

  it('rejects duplicate motif slots and legacy part transforms in a composition catalog', () => {
    const catalog = makeCompositionCatalogFixture()
    catalog.compositionPolicy!.motifSlots.push('eyes')
    catalog.parts[0]!.approvedTransforms = [{ scale: 1, mirrorX: false }]

    const codes = validateCatalogStructure(catalog).map(item => item.code)
    expect(codes).toContain('COMPOSITION_MOTIF_SLOT_DUPLICATE')
    expect(codes).toContain('COMPOSITION_APPROVED_TRANSFORM_FORBIDDEN')
  })

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
