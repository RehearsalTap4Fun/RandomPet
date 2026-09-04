import { describe, expect, it } from 'vitest'
import { VISUAL_SLOT_IDS, type MonsterSpec, type SlotGenes } from './contracts.js'
import { parseCatalog } from './catalog-schema.js'
import { parseMonsterSpec } from './schema.js'
import {
  makeCompositionCatalogFixture,
  makeInterfaceCatalogFixture,
  makeValidCatalogFixture,
  makeValidMonsterSpecFixture,
  makeGenomeForSpecFixture,
} from './test-fixtures.js'

describe('MonsterSpecSchema', () => {
  it('requires an archetype only for the exact v0.6 spec contract', () => {
    const v06 = makeValidMonsterSpecFixture()
    v06.schemaVersion = '0.2.0'
    v06.catalogVersion = '0.6.0'
    v06.rendererVersion = '0.6.0'

    expect(parseMonsterSpec(v06).ok).toBe(false)

    v06.archetypeId = 'canine'
    expect(parseMonsterSpec(v06).ok).toBe(false)

    v06.archetypeId = 'feline'
    const missingBundle = parseMonsterSpec(v06)
    expect(missingBundle.ok).toBe(false)
    if (!missingBundle.ok) {
      expect(missingBundle.diagnostics).toContainEqual(expect.objectContaining({
        path: ['anatomyBundleId'],
      }))
    }

    v06.anatomyBundleId = 'feline-sit-round'
    expect(parseMonsterSpec(v06)).toEqual(expect.objectContaining({ ok: true }))

    expect(parseMonsterSpec({ ...v06, anatomyBundleId: '   ' }).ok).toBe(false)

    expect(parseMonsterSpec({ ...v06, schemaVersion: '0.1.0' }).ok).toBe(false)
    expect(parseMonsterSpec({ ...v06, rendererVersion: '0.5.0' }).ok).toBe(false)

    const v05 = makeValidMonsterSpecFixture()
    v05.catalogVersion = '0.5.0'
    v05.rendererVersion = '0.5.0'
    expect(parseMonsterSpec(v05)).toEqual(expect.objectContaining({ ok: true }))
  })

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

  it('requires a complete archetype contract for catalog 0.6.0', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    catalog.version = '0.6.0'
    catalog.archetypes = []
    expect(parseCatalog(catalog).ok).toBe(false)

    catalog.archetypes = [{
      id: 'feline',
      displayName: '坐姿猫',
      rigIds: ['feline-sit'],
      defaultRigId: 'feline-sit',
      requiredVisibleSlots: ['bodyFrame', 'headShape', 'tail'],
      integratedSlots: ['arms', 'legs', 'extraAppendage'],
      specialFeatureSlots: ['headAppendage', 'surfaceMaterial', 'tail'],
    }]
    catalog.rigs = []
    for (const part of catalog.parts) part.archetypeIds = ['feline']

    expect(parseCatalog(catalog).ok).toBe(false)

    catalog.rigs = [{ id: 'feline-sit', sockets: {} }]
    catalog.transitionBridges = undefined
    for (const part of catalog.parts) {
      if (['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'].includes(part.slotId)) {
        part.composition = {
          mode: 'bundle', bundleId: 'feline-sit-round', isNone: false,
          motifTags: [], visualIntensity: 'quiet', renderNodes: [], geometryByRig: {},
        }
      }
    }
    const resource = {
      assetPath: 'assets/v0.6.0/bundles/round.webp', assetSha256: 'a'.repeat(64),
      pngPath: 'assets/v0.6.0/bundles/round.png', pngSha256: 'a'.repeat(64),
    }
    catalog.anatomyBundles = [{
      id: 'feline-sit-round', archetypeId: 'feline', rigId: 'feline-sit', poseId: 'sit',
      structural: resource, alpha: resource, clip: resource,
      faceSafeZone: { x: 400, y: 300, width: 800, height: 700 }, featureSockets: {}, mutationAnchors: {},
      derivedSlots: {
        bodyFrame: 'body_blob', headShape: 'head_round', arms: 'arms_short', legs: 'legs_webbed',
        tail: 'tail_anchor', extraAppendage: 'extra_wings',
      },
      allowedTraitPools: {},
    }]

    expect(parseCatalog(catalog)).toMatchObject({ ok: true })

    catalog.rigs.push({ id: 'blob', sockets: {} })
    expect(parseCatalog(catalog).ok).toBe(false)
  })

  it('limits v0.6 catalog archetypes to the feline sitting rig', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    catalog.version = '0.6.0'
    catalog.archetypes = [{
      id: 'canine',
      displayName: '坐姿犬',
      rigIds: ['blob'],
      defaultRigId: 'blob',
      requiredVisibleSlots: ['bodyFrame', 'headShape', 'tail'],
      integratedSlots: ['arms', 'legs', 'extraAppendage'],
      specialFeatureSlots: ['headAppendage', 'surfaceMaterial', 'tail'],
    }]
    for (const part of catalog.parts) part.archetypeIds = ['canine']

    expect(parseCatalog(catalog).ok).toBe(false)
  })

  it('accepts a resource-empty explicit none part and rejects empty visible resources', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    const none = catalog.parts.find((part: { id: string }) => part.id === 'tail_none')!
    none.assetPath = ''
    delete none.assetSha256
    delete none.pngPath
    delete none.pngSha256
    expect(parseCatalog(catalog).ok).toBe(true)

    none.composition.isNone = false
    expect(parseCatalog(catalog)).toEqual(expect.objectContaining({ ok: false }))
  })

  it('requires every non-none render node to name a runtime asset', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    const visible = catalog.parts.find((part: any) => part.composition?.mode === 'interface')!
    visible.composition.variantsByRig.blob.renderNodes[0].assetPath = ''
    expect(parseCatalog(catalog)).toMatchObject({ ok: false })

    const noneCatalog = makeInterfaceCatalogFixture() as any
    const none = noneCatalog.parts.find((part: any) => part.composition?.isNone === true)!
    none.assetPath = ''
    delete none.assetSha256
    delete none.pngPath
    delete none.pngSha256
    expect(parseCatalog(noneCatalog).ok).toBe(true)
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

  it('rejects interface composition metadata in a 0.2.0 catalog', () => {
    const catalog = makeCompositionCatalogFixture() as any
    const interfaceCatalog = makeInterfaceCatalogFixture() as any
    catalog.parts.find((part: { id: string }) => part.id === 'head_round')!.composition = interfaceCatalog.parts
      .find((part: { id: string }) => part.id === 'head_round')!.composition

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
  })

  it('rejects composition policy metadata in a 0.1.0 catalog', () => {
    const catalog = makeValidCatalogFixture() as any
    catalog.compositionPolicy = makeCompositionCatalogFixture().compositionPolicy

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
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

  it('round-trips a strict four-layer genome without changing schemaVersion', () => {
    const input = makeValidMonsterSpecFixture()
    input.genome = makeGenomeForSpecFixture(input)

    expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
    expect(input.schemaVersion).toBe('0.1.0')
    expect(Object.keys(input.genome.genes)).toEqual([...VISUAL_SLOT_IDS])
  })

  it('keeps a legacy genome-free spec parseable', () => {
    const input = makeValidMonsterSpecFixture()
    expect(input.genome).toBeUndefined()
    expect(parseMonsterSpec(input)).toEqual({ ok: true, value: input })
  })

  it('rejects a missing hidden gene at its exact path', () => {
    const input = makeValidMonsterSpecFixture()
    input.genome = makeGenomeForSpecFixture(input)
    delete (input.genome.genes.eyes as Partial<SlotGenes>).H2

    const parsed = parseMonsterSpec(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      path: ['genome', 'genes', 'eyes', 'H2'],
    }))
  })

  it('rejects unknown genome slots and layers', () => {
    const input = makeValidMonsterSpecFixture() as MonsterSpec & Record<string, unknown>
    input.genome = makeGenomeForSpecFixture(input)
    Object.assign(input.genome.genes.eyes, { H4: 'eyes_asymmetric' })
    Object.assign(input.genome.genes, { unknownSlot: input.genome.genes.eyes })

    expect(parseMonsterSpec(input)).toMatchObject({ ok: false })
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
