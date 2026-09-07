import { describe, expect, it } from 'vitest'
import {
  makeCompositionCatalogFixture,
  makeInterfaceCatalogFixture,
  makeV07FelinePartLibraryFixture,
  makeValidCatalogFixture,
} from './test-fixtures.js'
import { parseCatalog } from './catalog-schema.js'
import { validateCatalogStructure } from './catalog-validation.js'
import v06ProductionCatalogDocument from '../../asset-catalog/catalog/v0.6.0/catalog.json'

describe('catalog validation', () => {
  it('rejects non-feline archetypes, bundles, and dual-archetype parts from v0.7', () => {
    const extraArchetype = makeV07FelinePartLibraryFixture()
    extraArchetype.archetypes!.push({
      id: 'canine', displayName: 'Canine', rigIds: ['feline-sit'], defaultRigId: 'feline-sit',
      requiredVisibleSlots: [], integratedSlots: [], specialFeatureSlots: [],
    })
    const canineBundle = makeV07FelinePartLibraryFixture()
    canineBundle.anatomyBundles![0]!.archetypeId = 'canine'
    const dualArchetypePart = makeV07FelinePartLibraryFixture()
    dualArchetypePart.parts[0]!.archetypeIds = ['feline', 'lagomorph']

    expect(parseCatalog(extraArchetype).ok).toBe(false)
    expect(validateCatalogStructure(extraArchetype)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_ARCHETYPE_INVALID',
    }))
    expect(parseCatalog(canineBundle).ok).toBe(false)
    expect(validateCatalogStructure(canineBundle)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_BUNDLE_ARCHETYPE_INVALID',
    }))
    expect(parseCatalog(dualArchetypePart).ok).toBe(false)
    expect(validateCatalogStructure(dualArchetypePart)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_PART_ARCHETYPE_INVALID',
    }))
  })

  it('rejects a partPools-only v0.6 bundle without throwing during validation', () => {
    const catalog = structuredClone(makeV07FelinePartLibraryFixture()) as unknown as import('./contracts.js').Catalog
    catalog.version = '0.6.0'

    expect(parseCatalog(catalog).ok).toBe(false)
    expect(() => validateCatalogStructure(catalog)).not.toThrow()
  })

  it('requires renderable v0.7 structural and local pool candidates for the bundle rig', () => {
    const structural = makeV07FelinePartLibraryFixture()
    const body = structural.parts.find(part => part.slotId === 'bodyFrame')!
    body.composition!.variantsByRig['feline-sit']!.renderNodes = []
    const local = makeV07FelinePartLibraryFixture()
    const eyes = local.parts.find(part => part.slotId === 'eyes')!
    eyes.composition!.renderNodes[0]!.compatibleRigs = ['blob']

    expect(validateCatalogStructure(structural)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_POOL_STRUCTURAL_RENDER_NODES_MISSING',
    }))
    expect(validateCatalogStructure(local)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_POOL_LOCAL_RENDER_NODE_RIG_MISMATCH',
    }))
  })

  it('requires every v0.7 feline part pool to contain 8 N, 4 R, and 1 L candidates', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    catalog.anatomyBundles![0]!.partPools!.eyes.pop()

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_POOL_RARITY_COUNT_INVALID',
      path: ['anatomyBundles', '0', 'partPools', 'eyes'],
    }))
  })

  it('rejects a v0.7 pool that references an interface-incompatible structural part', () => {
    const catalog = makeV07FelinePartLibraryFixture()
    const tail = catalog.parts.find(part => part.slotId === 'tail')!
    tail.compatibleRigs = ['blob']

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_INDEPENDENT_PART_POOL_PART_RIG_MISMATCH',
    }))
  })

  it('reports stable anatomy-bundle diagnostics for malformed v0.6 bundles', () => {
    const catalog = makeValidCatalogFixture() as any
    catalog.version = '0.6.0'
    catalog.anatomyBundles = []

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_ANATOMY_BUNDLE_MISSING', path: ['anatomyBundles'],
    }))

    catalog.anatomyBundles = [{
      id: 'round', archetypeId: 'feline', rigId: 'feline-sit', poseId: 'sit',
      structural: { assetPath: 'assets/v0.6.0/bundles/body.webp', assetSha256: 'a'.repeat(64), pngPath: 'assets/v0.6.0/bundles/body.png', pngSha256: 'a'.repeat(64) },
      alpha: { assetPath: 'assets/v0.6.0/bundles/alpha.webp', assetSha256: 'a'.repeat(64), pngPath: 'assets/v0.6.0/bundles/alpha.png', pngSha256: 'a'.repeat(64) },
      clip: { assetPath: 'assets/v0.6.0/bundles/clip.webp', assetSha256: 'a'.repeat(64), pngPath: 'assets/v0.6.0/bundles/clip.png', pngSha256: 'a'.repeat(64) },
      faceSafeZone: { x: 0, y: 0, width: 2049, height: 1 }, featureSockets: {}, mutationAnchors: {},
      derivedSlots: { bodyFrame: 'missing-body', headShape: 'missing-head', arms: 'missing-arms', legs: 'missing-legs', tail: 'missing-tail', extraAppendage: 'missing-extra' },
      allowedTraitPools: { eyes: ['missing-eyes'] },
    }]

    const codes = validateCatalogStructure(catalog).map(item => item.code)
    expect(codes).toContain('CATALOG_ANATOMY_BUNDLE_PART_MISSING')
    expect(codes).toContain('CATALOG_ANATOMY_BUNDLE_RECT_INVALID')
    expect(codes).toContain('CATALOG_ANATOMY_BUNDLE_TRAIT_POOL_PART_MISSING')
  })

  it('accepts the production v0.6 catalog without legacy rig coverage', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(validateCatalogStructure(parsed.value)).toEqual([])
    expect(parsed.value.modifiers).toHaveLength(4)
  })

  it('rejects a v0.6 bundle that omits a required local trait pool', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = structuredClone(parsed.value)
    delete (catalog.anatomyBundles![0]!.allowedTraitPools as Partial<Record<string, string[]>>).eyes

    expect(parseCatalog(catalog).ok).toBe(false)
    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_ANATOMY_BUNDLE_TRAIT_POOL_REQUIRED',
      path: ['anatomyBundles', '0', 'allowedTraitPools', 'eyes'],
    }))
  })

  it('rejects an empty v0.6 local trait pool before it can select a foreign part', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const catalog = structuredClone(parsed.value)
    ;(catalog.anatomyBundles![0]!.allowedTraitPools as Partial<Record<string, string[]>>).eyes = []

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_ANATOMY_BUNDLE_TRAIT_POOL_REQUIRED',
      path: ['anatomyBundles', '0', 'allowedTraitPools', 'eyes'],
    }))
  })

  it('rejects v0.6 modifiers that can require or create structural stacking', () => {
    const parsed = parseCatalog(v06ProductionCatalogDocument)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const requiresMutation = structuredClone(parsed.value)
    requiresMutation.modifiers[0]!.requiresMutation = true
    const structuralOverride = structuredClone(parsed.value)
    structuralOverride.modifiers[0]!.overrides = { duplicateLayerGroup: 'head', socket: 'headAlternate' }

    expect(validateCatalogStructure(requiresMutation)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_MODIFIER_V06_INVALID', path: ['modifiers', '0'],
    }))
    expect(validateCatalogStructure(structuralOverride)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_MODIFIER_V06_INVALID', path: ['modifiers', '0'],
    }))
  })

  it('rejects legacy interface composition in a v0.6 anatomy bundle catalog', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.version = '0.6.0'
    ;(catalog as any).archetypes = [{
      id: 'feline',
      displayName: '坐姿猫',
      rigIds: ['feline-sit'],
      defaultRigId: 'feline-sit',
      requiredVisibleSlots: ['bodyFrame', 'headShape', 'tail'],
      integratedSlots: ['arms', 'legs', 'extraAppendage'],
      specialFeatureSlots: ['headAppendage', 'surfaceMaterial', 'tail'],
    }]
    catalog.rigs = [{ id: 'feline-sit' as any, sockets: {} }]
    for (const part of catalog.parts) (part as any).archetypeIds = ['feline']

    expect(parseCatalog(catalog)).toMatchObject({ ok: false })
    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_ANATOMY_BUNDLE_INTERFACE_FORBIDDEN',
    }))
  })

  it('requires the non-facial budget in catalog 0.4.0', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.version = '0.4.0'
    expect(parseCatalog(catalog).ok).toBe(false)

    catalog.compositionPolicy = {
      ...catalog.compositionPolicy!,
      maxStrongNonFacialFeatures: 1,
    }
    expect(parseCatalog(catalog).ok).toBe(true)
  })

  it('accepts v0.5 interface composition metadata with the inherited non-facial budget', () => {
    const catalog = makeInterfaceCatalogFixture()
    catalog.version = '0.5.0'
    catalog.compositionPolicy = {
      ...catalog.compositionPolicy!,
      maxStrongNonFacialFeatures: 1,
    }

    expect(parseCatalog(catalog)).toMatchObject({ ok: true })
    expect(validateCatalogStructure(catalog)).not.toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_INTERFACE_MODE_REQUIRED',
    }))
  })

  it('accepts canonical v0.4 connector and bridge resource paths', () => {
    const catalog = JSON.parse(
      JSON.stringify(makeInterfaceCatalogFixture()).replaceAll('assets/v0.3.0/', 'assets/v0.4.0/'),
    )
    catalog.version = '0.4.0'
    catalog.compositionPolicy.maxStrongNonFacialFeatures = 1

    const codes = validateCatalogStructure(catalog).map(item => item.code)

    expect(codes).not.toContain('CONNECTOR_RESOURCE_INVALID')
    expect(codes).not.toContain('CONNECTOR_BRIDGE_RESOURCE_INVALID')
  })

  it('rejects whitespace-only asset paths for visible parts', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    const visible = catalog.parts.find((part: { composition?: { isNone?: boolean } }) => (
      part.composition?.isNone !== true
    ))
    visible.assetPath = '   '

    expect(parseCatalog(catalog)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: expect.arrayContaining(['assetPath']) }),
      ]),
    })
  })

  it('requires a one-to-one connector ID association for v0.3 plug render nodes', () => {
    const missing = makeInterfaceCatalogFixture() as any
    const missingArms = missing.parts.find((part: { slotId: string }) => part.slotId === 'arms')
    delete missingArms.composition.variantsByRig.blob.renderNodes[0].connectorId

    const duplicate = makeInterfaceCatalogFixture() as any
    const duplicateArms = duplicate.parts.find((part: { slotId: string }) => part.slotId === 'arms')
    duplicateArms.composition.variantsByRig.blob.renderNodes[1].connectorId = 'shoulderLeft'

    expect(parseCatalog(missing)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('one render node') }),
      ]),
    })
    expect(parseCatalog(duplicate)).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('one render node') }),
      ]),
    })
  })

  it('reports interface composition metadata as incompatible with v0.2', () => {
    const catalog = makeCompositionCatalogFixture() as any
    const interfaceCatalog = makeInterfaceCatalogFixture() as any
    catalog.parts.find((part: { id: string }) => part.id === 'head_round')!.composition = interfaceCatalog.parts
      .find((part: { id: string }) => part.id === 'head_round')!.composition

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_INTERFACE_MODE_FORBIDDEN',
    }))
  })

  it('reports composition policy metadata as incompatible with v0.1', () => {
    const catalog = makeValidCatalogFixture() as any
    catalog.compositionPolicy = makeCompositionCatalogFixture().compositionPolicy

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CATALOG_COMPOSITION_POLICY_FORBIDDEN',
    }))
  })

  it('rejects non-interface structural parts in a v0.3 catalog', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    const head = catalog.parts.find((part: { slotId: string; composition: { isNone: boolean } }) => (
      part.slotId === 'headShape' && !part.composition.isNone
    ))
    head.composition = makeCompositionCatalogFixture().parts.find(part => part.id === head.id)!.composition

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_INTERFACE_MODE_REQUIRED',
    }))
  })

  it('rejects connector profiles that do not match their exact-rig variant', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    catalog.parts.find((part: { id: string }) => part.id === 'head_round')!
      .composition.variantsByRig.blob.connectors[0].rigId = 'biped'

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_RIG_MISMATCH',
    }))
  })

  it('rejects a structural connector without a matching bridge', () => {
    const catalog = makeInterfaceCatalogFixture() as any
    catalog.transitionBridges = catalog.transitionBridges.filter((bridge: { rigId: string; connectorClass: string }) => (
      bridge.rigId !== 'blob' || bridge.connectorClass !== 'neck'
    ))

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_BRIDGE_MISSING',
    }))
  })

  it('rejects duplicate transition bridge IDs and noncanonical bridge paths', () => {
    const duplicate = makeInterfaceCatalogFixture() as any
    duplicate.transitionBridges[1].id = duplicate.transitionBridges[0].id
    expect(parseCatalog(duplicate)).toMatchObject({ ok: false })
    expect(validateCatalogStructure(duplicate)).toContainEqual(expect.objectContaining({ code: 'CATALOG_ID_DUPLICATE' }))

    const invalidPath = makeInterfaceCatalogFixture() as any
    invalidPath.transitionBridges[0].neutralPngPath = 'assets/v0.3.0/bridges/blob/../neck.png'
    expect(validateCatalogStructure(invalidPath)).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_BRIDGE_RESOURCE_INVALID' }))
  })

  it('derives body receivers from compatible non-none child capabilities rather than body IDs', () => {
    const full = makeInterfaceCatalogFixture() as any
    const fullBody = full.parts.find((part: any) => part.slotId === 'bodyFrame')
    fullBody.id = 'renamed_body_without_special_case'
    fullBody.composition.variantsByRig.blob.connectors = fullBody.composition.variantsByRig.blob.connectors
      .filter((connector: any) => connector.id !== 'tailRoot')
    expect(validateCatalogStructure(full)).toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_PROFILE_INVALID',
      message: expect.stringContaining('tailRoot'),
    }))

    const slice = makeInterfaceCatalogFixture() as any
    const sliceBody = slice.parts.find((part: any) => part.slotId === 'bodyFrame')
    sliceBody.id = 'renamed_slice_body'
    slice.parts = slice.parts.filter((part: any) => !(['tail', 'extraAppendage'].includes(part.slotId) && !part.composition?.isNone))
    sliceBody.composition.variantsByRig.blob.connectors = sliceBody.composition.variantsByRig.blob.connectors
      .filter((connector: any) => !['tailRoot', 'extraLeft', 'extraRight'].includes(connector.id))
    expect(validateCatalogStructure(slice)).not.toContainEqual(expect.objectContaining({
      code: 'CONNECTOR_PROFILE_INVALID',
      message: expect.stringMatching(/tailRoot|extraLeft|extraRight/u),
    }))
  })

  it('rejects multiple provider nodes for a socket-providing composition part', () => {
    const catalog = makeCompositionCatalogFixture()
    const body = catalog.parts.find(part => part.slotId === 'bodyFrame')!
    const duplicate = structuredClone(body.composition!.renderNodes[0]!)
    duplicate.id = `${duplicate.id}_ambiguous_provider`
    body.composition!.renderNodes.push(duplicate)

    expect(validateCatalogStructure(catalog)).toContainEqual(expect.objectContaining({
      code: 'COMPOSITION_PROVIDER_AMBIGUOUS',
      path: expect.arrayContaining(['composition', 'renderNodes']),
    }))
  })

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
