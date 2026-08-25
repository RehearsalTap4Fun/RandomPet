import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS } from './contracts.js'
import { parseCatalog } from './catalog-schema.js'
import { parseMonsterSpec } from './schema.js'
import {
  makeCompositionCatalogFixture,
  makeInterfaceCatalogFixture,
  makeValidCatalogFixture,
  makeValidMonsterSpecFixture,
} from './test-fixtures.js'

describe('MonsterSpecSchema', () => {
  it('keeps the installed 0.1.0 catalog parseable without composition metadata', () => {
    expect(parseCatalog(makeValidCatalogFixture()).ok).toBe(true)
  })

  it('parses the exact 0.2.0 composition policy and render-node contract', () => {
    const catalog = makeCompositionCatalogFixture()

    expect(parseCatalog(catalog)).toEqual({ ok: true, value: catalog })
  })

  it('parses a complete v0.3 interface catalog and preserves v0.2 behavior', () => {
    expect(parseCatalog(makeInterfaceCatalogFixture()).ok).toBe(true)
    expect(parseCatalog(makeCompositionCatalogFixture()).ok).toBe(true)
  })

  it('requires exact-rig structural variants and bridge resources in v0.3', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    delete catalog.parts.find((part: { id: string }) => part.id === 'head_round')!
      .composition.variantsByRig.biped

    expect(parseCatalog(catalog)).toEqual(expect.objectContaining({ ok: false }))
  })

  it('requires composition metadata for a 0.2.0 catalog', () => {
    const catalog = makeCompositionCatalogFixture() as any
    delete catalog.compositionPolicy
    delete catalog.parts[0].composition

    expect(parseCatalog(catalog).ok).toBe(false)
  })

  it('keeps legacy approved transforms parseable when they contain extension fields', () => {
    const catalog = makeValidCatalogFixture() as any
    catalog.parts[0].approvedTransforms = [{ scale: 1, mirrorX: false, legacyExtension: true }]

    expect(parseCatalog(catalog).ok).toBe(true)
  })

  it('rejects non-positive render-node transforms and face rectangles', () => {
    const catalog = makeCompositionCatalogFixture() as any
    catalog.parts[0].composition.renderNodes[0].transform.scale = 0
    catalog.parts[1].composition.geometryByRig.blob.faceSafeZone.width = -1

    expect(parseCatalog(catalog).ok).toBe(false)
  })

  it('rejects a render node with an unknown parent slot', () => {
    const catalog = makeCompositionCatalogFixture() as any
    catalog.parts[1].composition.renderNodes[0].parentSlot = 'unknown-slot'

    expect(parseCatalog(catalog).ok).toBe(false)
  })

  it('accepts exactly fourteen visual slots and eight semantic slots', () => {
    const input = makeValidMonsterSpecFixture()
    expect(Object.keys(input.visualSlots)).toHaveLength(14)
    expect(VISUAL_SLOT_IDS).toHaveLength(14)
    expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
  })

  it('rejects a missing mandatory slot without mutating input', () => {
    const input = makeValidMonsterSpecFixture()
    const snapshot = structuredClone(input)
    delete input.visualSlots.eyes
    const result = parseMonsterSpec(input)
    expect(result.ok).toBe(false)
    expect(snapshot.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  })

  it('returns a clone isolated from successful parse input', () => {
    const input = makeValidMonsterSpecFixture()
    const result = parseMonsterSpec(input)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected the valid fixture to parse')
    }

    expect(result.value).not.toBe(input)
    expect(result.value.visualSlots).not.toBe(input.visualSlots)
    result.value.visualSlots.eyes.partId = 'eyes_round'
    expect(input.visualSlots.eyes.partId).toBe('eyes_asymmetric')
  })

  it('preserves an exact transform requested for a selected visual part', () => {
    const input = makeValidMonsterSpecFixture()
    const transform = { scale: 1, mirrorX: true }
    Object.assign(input.visualSlots.extraAppendage, { transform })

    expect(parseMonsterSpec(input)).toMatchObject({
      ok: true,
      value: {
        visualSlots: {
          extraAppendage: { transform },
        },
      },
    })
  })

  it('builds a catalog fixture with unique part IDs', () => {
    const partIds = makeValidCatalogFixture().parts.map(part => part.id)
    expect(new Set(partIds).size).toBe(partIds.length)
  })

  it('rejects symbolic modifier palettes instead of typed colors', () => {
    const input = makeValidMonsterSpecFixture() as unknown as {
      mutation: { id: string; overrides: { palette: string } }
    }
    input.mutation = { id: 'mutation_albino', overrides: { palette: 'albino' } }

    expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
  })

  it('rejects unknown modifier override fields', () => {
    const input = makeValidMonsterSpecFixture() as unknown as {
      mutation: { id: string; overrides: { arbitraryTransform: number } }
    }
    input.mutation = { id: 'mutation_double_head', overrides: { arbitraryTransform: 17 } }

    expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
  })

  it('rejects a double-head application without a destination socket', () => {
    const input = makeValidMonsterSpecFixture()
    input.mutation = {
      id: 'mutation_double_head',
      overrides: { duplicateLayerGroup: 'head' },
    }

    expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
  })

  it('rejects a misplaced-eye application without a destination socket', () => {
    const input = makeValidMonsterSpecFixture()
    input.aberrations = [{
      id: 'aberration_misplaced_eye',
      overrides: { relocateSlot: 'eyes' },
    }]

    expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
  })
})
