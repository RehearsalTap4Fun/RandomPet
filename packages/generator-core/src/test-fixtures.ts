import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  GENOME_VERSION,
  type Catalog,
  type IndependentPartCatalog,
  type MonsterGenome,
  type MonsterSpec,
  type Palette,
  type RenderLayer,
  type RigId,
  type SemanticSlotId,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
  type SlotGenes,
  type TransitionBridgeDefinition,
  type V08ExpressionKind,
  isAttachmentPartComposition,
} from './contracts.js'

const fixturePalette: Palette = {
  primary: '#237aa3',
  secondary: '#74c9bf',
  accent: '#f6d365',
}

const visualPartIds: Record<VisualSlotId, string> = {
  bodyFrame: 'body_blob',
  headShape: 'head_round',
  eyes: 'eyes_asymmetric',
  mouthShape: 'mouth_wide',
  oralDetail: 'oral_teeth',
  headAppendage: 'head_antennae',
  arms: 'arms_short',
  legs: 'legs_webbed',
  tail: 'tail_anchor',
  extraAppendage: 'extra_wings',
  surfaceMaterial: 'surface_gel',
  pattern: 'pattern_spots',
  colorScheme: 'color_scheme_ocean',
  effect: 'effect_glow',
}

const semanticTraitIds: Record<SemanticSlotId, string> = {
  frame: 'frame_blob',
  appendage: 'appendage_anchor_tail',
  headAndEyes: 'head_round',
  mouth: 'mouth_wide',
  surface: 'surface_gel',
  pattern: 'pattern_spots',
  personality: 'personality_curious',
  quirk: 'quirk_bioluminescent',
}

export function makeValidMonsterSpecFixture(): MonsterSpec {
  const visualSlots = Object.fromEntries(
    VISUAL_SLOT_IDS.map((slotId): [VisualSlotId, VisualSelection] => [
      slotId,
      { partId: visualPartIds[slotId], rigId: 'blob' },
    ]),
  ) as Record<VisualSlotId, VisualSelection>

  return {
    schemaVersion: '0.1.0',
    catalogVersion: '0.1.0',
    rendererVersion: '0.1.0',
    seed: '84721937',
    themeId: 'fungal',
    palette: { ...fixturePalette },
    slotRolls: Object.fromEntries(
      VISUAL_SLOT_IDS.map((slotId): [VisualSlotId, number] => [slotId, 0]),
    ) as Record<VisualSlotId, number>,
    visualSlots,
    semanticTraits: Object.fromEntries(
      SEMANTIC_SLOT_IDS.map((slotId): [SemanticSlotId, { primaryTraitId: string; detailTraitIds: string[] }] => [
        slotId,
        { primaryTraitId: semanticTraitIds[slotId], detailTraitIds: [] },
      ]),
    ) as MonsterSpec['semanticTraits'],
    mutation: null,
    aberrations: [],
  }
}

export function makeGenomeForSpecFixture(spec: MonsterSpec): MonsterGenome {
  return {
    genomeVersion: GENOME_VERSION,
    genes: Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => {
      const partId = spec.visualSlots[slotId].partId
      return [slotId, { P: partId, H1: partId, H2: partId, H3: partId }]
    })) as Record<VisualSlotId, SlotGenes>,
  }
}

const layerBySlot: Record<VisualSlotId, RenderLayer> = {
  bodyFrame: 'body',
  headShape: 'head',
  eyes: 'faceAndHeadwear',
  mouthShape: 'faceAndHeadwear',
  oralDetail: 'faceAndHeadwear',
  headAppendage: 'faceAndHeadwear',
  arms: 'frontAppendage',
  legs: 'frontAppendage',
  tail: 'rearAppendage',
  extraAppendage: 'rearAppendage',
  surfaceMaterial: 'surface',
  pattern: 'pattern',
  colorScheme: 'pattern',
  effect: 'foregroundEffect',
}

const semanticSlotByVisualSlot: Partial<Record<VisualSlotId, SemanticSlotId>> = {
  bodyFrame: 'frame',
  headShape: 'headAndEyes',
  eyes: 'headAndEyes',
  mouthShape: 'mouth',
  oralDetail: 'mouth',
  headAppendage: 'headAndEyes',
  arms: 'appendage',
  legs: 'appendage',
  tail: 'appendage',
  extraAppendage: 'appendage',
  surfaceMaterial: 'surface',
  pattern: 'pattern',
  colorScheme: 'pattern',
}

const socketBySlot: Record<VisualSlotId, string | null> = {
  bodyFrame: null,
  headShape: 'head',
  eyes: 'head',
  mouthShape: 'head',
  oralDetail: 'head',
  headAppendage: 'head',
  arms: 'armLeft',
  legs: 'legLeft',
  tail: 'tail',
  extraAppendage: 'wingLeft',
  surfaceMaterial: null,
  pattern: null,
  colorScheme: null,
  effect: null,
}

function createPart(slotId: VisualSlotId, id = visualPartIds[slotId]): VisualPartDefinition {
  const semanticSlotId = semanticSlotByVisualSlot[slotId]
  const semanticTraitId = slotId === 'legs'
    ? 'appendage_webbed_feet'
    : semanticSlotId === undefined ? null : semanticTraitIds[semanticSlotId]
  return {
    id,
    slotId,
    rarity: 'N',
    baseWeight: 1,
    themeIds: slotId === 'eyes' ? ['deep-sea', 'fungal'] : ['deep-sea', 'fungal', 'shadow'],
    themeWeights: slotId === 'eyes' ? { 'deep-sea': 1, fungal: 1 } : { 'deep-sea': 1, fungal: 1, shadow: 1 },
    compatibleRigs: ['blob', 'biped', 'floating'],
    assetPath: `parts/${id}.webp`,
    maskPaths: {},
    origin: { x: 1024, y: 1024 },
    socket: socketBySlot[slotId],
    layer: layerBySlot[slotId],
    semanticTraitId,
    semanticPriority: slotId === 'tail' ? 2 : 1,
    excludes: [],
    boosts: {},
  }
}

export function makeValidCatalogFixture(): Catalog {
  const requiredParts = VISUAL_SLOT_IDS.map(slotId => createPart(slotId))
  const optionalNoneParts = [
    ['headAppendage', 'head_appendage_none'],
    ['tail', 'tail_none'],
    ['extraAppendage', 'extra_appendage_none'],
    ['effect', 'effect_none'],
  ] as const satisfies ReadonlyArray<readonly [VisualSlotId, string]>

  return {
    version: '0.1.0',
    themes: [
      { id: 'deep-sea', palette: { primary: '#237aa3', secondary: '#74c9bf', accent: '#f6d365' } },
      { id: 'fungal', palette: { primary: '#6b7d33', secondary: '#a7c957', accent: '#f4a261' } },
      { id: 'shadow', palette: { primary: '#463c78', secondary: '#8377d1', accent: '#f9c74f' } },
    ],
    rigs: (['blob', 'biped', 'floating'] as const).map((id: RigId) => ({
      id,
      sockets: {
        head: { x: 1024, y: 720 },
        headAlternate: { x: 1320, y: 760 },
        armLeft: { x: 700, y: 1100 },
        armRight: { x: 1348, y: 1100 },
        legLeft: { x: 820, y: 1450 },
        legRight: { x: 1228, y: 1450 },
        tail: { x: 1500, y: 1280 },
        wingLeft: { x: 650, y: 920 },
        wingRight: { x: 1398, y: 920 },
      },
    })),
    parts: [
      ...requiredParts,
      ...optionalNoneParts.map(([slotId, id]) => ({
        ...createPart(slotId, id),
        semanticTraitId: null,
        semanticPriority: 0,
      })),
    ],
    semanticTraits: SEMANTIC_SLOT_IDS.map(slotId => ({
      id: semanticTraitIds[slotId],
      semanticSlotId: slotId,
    })).concat([{ id: 'appendage_webbed_feet', semanticSlotId: 'appendage' }]),
    modifiers: [
      {
        id: 'mutation_albino', kind: 'mutation', baseWeight: 1, requiresMutation: false,
        overrides: { palette: { primary: '#f4f0e8', secondary: '#ddd4c8', accent: '#d98e9b' } },
      },
      {
        id: 'mutation_double_head', kind: 'mutation', baseWeight: 1, requiresMutation: false,
        overrides: { duplicateLayerGroup: 'head', socket: 'headAlternate' },
      },
      {
        id: 'aberration_color_discord', kind: 'aberration', baseWeight: 1, requiresMutation: false,
        overrides: { palette: { primary: '#ff3b81', secondary: '#36e0ff', accent: '#f4f06a' } },
      },
      {
        id: 'aberration_misplaced_eye', kind: 'aberration', baseWeight: 1, requiresMutation: false,
        overrides: { relocateSlot: 'eyes', socket: 'headAlternate' },
      },
    ],
    dependencies: {},
  }
}

export function makeLegacyCatalogFixture(): Catalog {
  return makeValidCatalogFixture()
}

export function makeCompositionCatalogFixture(): Catalog {
  const catalog = makeValidCatalogFixture()
  catalog.version = '0.2.0'
  catalog.compositionPolicy = {
    motifSlots: ['headShape', 'eyes', 'mouthShape', 'headAppendage', 'tail', 'extraAppendage', 'effect'],
    surpriseRatio: 0.3,
    maxStrongFeatures: 2,
    optionalNoneRate: { min: 0.35, max: 0.5 },
    frameBounds: { x: 128, y: 128, width: 1792, height: 1792 },
    faceInsideRatio: 0.8,
    faceVisibleRatio: 0.85,
  }

  const parentBySlot: Record<VisualSlotId, VisualSlotId | null> = {
    bodyFrame: null, headShape: 'bodyFrame', eyes: 'headShape', mouthShape: 'headShape',
    oralDetail: 'mouthShape', headAppendage: 'headShape', arms: 'bodyFrame', legs: 'bodyFrame',
    tail: 'bodyFrame', extraAppendage: 'bodyFrame', surfaceMaterial: 'bodyFrame',
    pattern: 'bodyFrame', colorScheme: 'bodyFrame', effect: 'bodyFrame',
  }
  const providerSockets: Partial<Record<VisualSlotId, string[]>> = {
    bodyFrame: ['head', 'headAlternate', 'armLeft', 'armRight', 'legLeft', 'legRight', 'tail', 'wingLeft', 'wingRight', 'overlay', 'effect'],
    headShape: ['eyes', 'mouth', 'headAppendage'],
    mouthShape: ['oralDetail'],
  }
  const nodeSockets: Record<VisualSlotId, Array<string | null>> = {
    bodyFrame: [null], headShape: ['head'], eyes: ['eyes'], mouthShape: ['mouth'], oralDetail: ['oralDetail'],
    headAppendage: ['headAppendage'], arms: ['armLeft', 'armRight'], legs: ['legLeft', 'legRight'],
    tail: ['tail'], extraAppendage: ['wingLeft', 'wingRight'], surfaceMaterial: ['overlay'],
    pattern: ['overlay'], colorScheme: ['overlay'], effect: ['effect'],
  }
  catalog.parts = catalog.parts.map(part => {
    const { approvedTransforms: _approvedTransforms, ...partWithoutApprovedTransforms } = part
    const isNone = part.id.endsWith('_none')
    const sockets = providerSockets[part.slotId] ?? []
    const geometryByRig = Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, {
      sockets: Object.fromEntries(sockets.map((socket, index) => [socket, { x: 500 + index * 80, y: 700 + index * 60 }])),
      ...(part.slotId === 'headShape' ? { faceSafeZone: { x: 500, y: 400, width: 1048, height: 900 } } : {}),
    }]))
    return {
      ...partWithoutApprovedTransforms,
      composition: {
        isNone,
        motifTags: isNone ? [] : ['deep-sea', 'fungal', 'shadow'],
        visualIntensity: 'quiet',
        renderNodes: isNone ? [] : nodeSockets[part.slotId].map((socket, index) => ({
          id: `${part.id}_${index}`,
          assetPath: `nodes/${part.id}_${index}.webp`,
          parentSlot: parentBySlot[part.slotId],
          socket: parentBySlot[part.slotId] === null ? null : socket,
          origin: { x: 1024, y: 1024 },
          transform: { scale: 1, mirrorX: false },
          layer: part.layer,
          compatibleRigs: part.compatibleRigs,
          clipPolicy: 'none',
        })),
        geometryByRig: isNone ? {} : geometryByRig,
      },
    }
  })
  const strongEyes = structuredClone(catalog.parts.find(part => part.slotId === 'eyes')!)
  const strongEyesComposition = strongEyes.composition!
  if (!isAttachmentPartComposition(strongEyesComposition)) {
    throw new Error('Expected attachment composition fixture')
  }
  strongEyes.id = 'eyes_strong'
  strongEyesComposition.visualIntensity = 'strong'
  strongEyesComposition.renderNodes[0]!.id = 'eyes_strong_0'
  catalog.parts.push(strongEyes)
  return catalog
}

const fixtureHash = 'a'.repeat(64)

function fixtureResource(name: string) {
  return {
    assetPath: `assets/v0.7.0/bundles/${name}.webp`,
    assetSha256: fixtureHash,
    pngPath: `assets/v0.7.0/bundles/${name}.png`,
    pngSha256: fixtureHash,
  }
}

function fixtureV08Resource(name: string) {
  const resource = fixtureResource(name)
  return {
    ...resource,
    assetPath: resource.assetPath.replace('assets/v0.7.0/', 'assets/v0.8.0/'),
    pngPath: resource.pngPath.replace('assets/v0.7.0/', 'assets/v0.8.0/'),
  }
}

function interfaceConnector(
  id: string,
  role: 'receiver' | 'plug',
  connectorClass: 'neck' | 'shoulder' | 'hip' | 'tail' | 'extra',
  rigId: RigId,
) {
  return {
    id,
    role,
    connectorClass,
    rigId,
    origin: { x: 1024, y: 1024 },
    tangent: { x: 1, y: 0 },
    outwardNormal: { x: 0, y: 1 },
    width: 100,
    depth: 60,
    contourMaskPath: `assets/v0.3.0/connectors/${rigId}/${id}-contour.png`,
    contourMaskSha256: fixtureHash,
    foregroundMaskPath: `assets/v0.3.0/connectors/${rigId}/${id}-foreground.png`,
    foregroundMaskSha256: fixtureHash,
    backgroundMaskPath: `assets/v0.3.0/connectors/${rigId}/${id}-background.png`,
    backgroundMaskSha256: fixtureHash,
    materialSampleRegion: { x: 900, y: 900, width: 100, height: 100 },
    warpLimits: {
      widthRatio: { min: 0.8, max: 1.2 },
      depthRatio: { min: 0.8, max: 1.2 },
      rotationDegrees: { min: -15, max: 15 },
    },
  }
}

const interfaceConnectorsBySlot: Partial<Record<VisualSlotId, Array<[
  string,
  'receiver' | 'plug',
  'neck' | 'shoulder' | 'hip' | 'tail' | 'extra',
]>>> = {
  bodyFrame: [
    ['neck', 'receiver', 'neck'],
    ['shoulderLeft', 'receiver', 'shoulder'], ['shoulderRight', 'receiver', 'shoulder'],
    ['hipLeft', 'receiver', 'hip'], ['hipRight', 'receiver', 'hip'],
    ['tailRoot', 'receiver', 'tail'],
    ['extraLeft', 'receiver', 'extra'], ['extraRight', 'receiver', 'extra'],
  ],
  headShape: [['neck', 'plug', 'neck']],
  arms: [['shoulderLeft', 'plug', 'shoulder'], ['shoulderRight', 'plug', 'shoulder']],
  legs: [['hipLeft', 'plug', 'hip'], ['hipRight', 'plug', 'hip']],
  tail: [['tailRoot', 'plug', 'tail']],
  extraAppendage: [['extraLeft', 'plug', 'extra'], ['extraRight', 'plug', 'extra']],
}

export function makeInterfaceCatalogFixture(): Catalog {
  const catalog = makeCompositionCatalogFixture() as unknown as Record<string, any>
  catalog.version = '0.3.0'
  const structuralSlots = new Set<VisualSlotId>([
    'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',
  ])
  catalog.parts = catalog.parts.map((part: any) => {
    if (part.slotId === 'colorScheme') {
      const rigMaskPaths = Object.fromEntries((['blob', 'biped', 'floating'] as const).map(rigId => [rigId, {
        primary: `masks/${part.id}-${rigId}-primary.png`,
        secondary: `masks/${part.id}-${rigId}-secondary.png`,
        accent: `masks/${part.id}-${rigId}-accent.png`,
      }]))
      const rigMaskSha256 = Object.fromEntries((['blob', 'biped', 'floating'] as const).map(rigId => [rigId, {
        primary: fixtureHash, secondary: fixtureHash, accent: fixtureHash,
      }]))
      return { ...part, rigMaskPaths, rigMaskSha256 }
    }
    if (!structuralSlots.has(part.slotId) || part.composition.isNone) return part
    const attachment = part.composition
    return {
      ...part,
      composition: {
        mode: 'interface',
        isNone: false,
        motifTags: attachment.motifTags,
        visualIntensity: attachment.visualIntensity,
        variantsByRig: Object.fromEntries(part.compatibleRigs.map((rigId: RigId) => [rigId, {
          rigId,
          materialFamily: 'soft-skin',
          renderNodes: attachment.renderNodes.map((node: any, nodeIndex: number) => ({
            ...node,
            id: `${node.id}_${rigId}`,
            compatibleRigs: [rigId],
            ...((interfaceConnectorsBySlot[part.slotId as VisualSlotId]?.[nodeIndex]?.[1] === 'plug')
              ? { connectorId: interfaceConnectorsBySlot[part.slotId as VisualSlotId]![nodeIndex]![0] }
              : {}),
          })),
          connectors: (interfaceConnectorsBySlot[part.slotId as VisualSlotId] ?? []).map(([id, role, connectorClass]) => (
            interfaceConnector(id, role, connectorClass, rigId)
          )),
          ...(part.slotId === 'headShape' ? { faceSafeZones: [{ x: 500, y: 400, width: 1048, height: 900 }] } : {}),
        }])),
      },
    }
  })
  catalog.transitionBridges = (['blob', 'biped', 'floating'] as const).flatMap(rigId => (
    (['neck', 'shoulder', 'hip', 'tail', 'extra'] as const).map(connectorClass => ({
      id: `${rigId}_${connectorClass}_bridge`,
      rigId,
      connectorClass,
      materialFamilies: ['short-fur', 'mushroom-velvet', 'soft-skin'],
      neutralAssetPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.webp`,
      neutralPngPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.png`,
      neutralAssetSha256: fixtureHash,
      neutralPngSha256: fixtureHash,
      frontMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-front.png`,
      frontMaskSha256: fixtureHash,
      backMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-back.png`,
      backMaskSha256: fixtureHash,
    }))
  ))
  return catalog as Catalog
}

export function makeV07FelinePartLibraryFixture(): IndependentPartCatalog {
  const sourceCatalog = makeInterfaceCatalogFixture()
  const blobRig = sourceCatalog.rigs.find(rig => rig.id === 'blob')
  if (blobRig === undefined) throw new Error('Expected blob fixture rig')
  const archetypes: IndependentPartCatalog['archetypes'] = [{
    id: 'feline',
    displayName: 'Feline sit',
    rigIds: ['feline-sit'],
    defaultRigId: 'feline-sit',
    requiredVisibleSlots: [...VISUAL_SLOT_IDS],
    integratedSlots: [],
    specialFeatureSlots: [],
  }]
  const partGroups = VISUAL_SLOT_IDS.map(slotId => {
    const source = sourceCatalog.parts.find(part => (
      part.slotId === slotId && part.composition?.isNone !== true
    ))
    const sourceComposition = source?.composition
    if (source === undefined || sourceComposition === undefined) {
      throw new Error(`Expected visible ${slotId} fixture part`)
    }
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => ['N', index + 1] as const),
      ...Array.from({ length: 4 }, (_, index) => ['R', index + 1] as const),
      ['L', 1] as const,
    ].map<VisualPartDefinition>(([rarity, index]) => {
      const id = `${slotId}_${rarity.toLowerCase()}_${index}`
      const { composition: _sourceComposition, ...partBase } = source
      const part = {
        ...partBase,
        id,
        rarity,
        compatibleRigs: ['feline-sit'] as RigId[],
        archetypeIds: ['feline'] as Array<'feline'>,
        assetPath: `assets/v0.7.0/parts/${id}.webp`,
        pngPath: `assets/v0.7.0/parts/${id}.png`,
        assetSha256: fixtureHash,
        pngSha256: fixtureHash,
      }
      if (sourceComposition.mode === 'interface') {
        const variant = sourceComposition.variantsByRig.blob
        if (variant === undefined) throw new Error(`Expected blob ${slotId} interface variant`)
        return {
          ...part,
          composition: {
            ...sourceComposition,
            variantsByRig: {
          'feline-sit': {
            ...variant,
            rigId: 'feline-sit' as RigId,
            renderNodes: variant.renderNodes.map(node => ({
              ...node,
              compatibleRigs: ['feline-sit'] as RigId[],
            })),
            connectors: variant.connectors.map(connector => ({
              ...connector,
              rigId: 'feline-sit' as RigId,
              contourMaskPath: connector.contourMaskPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
              foregroundMaskPath: connector.foregroundMaskPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
              backgroundMaskPath: connector.backgroundMaskPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
            })),
            },
          },
        }
        }
      }
      if (!isAttachmentPartComposition(sourceComposition)) {
        throw new Error(`Expected ${slotId} attachment composition`)
      }
      const geometry = sourceComposition.geometryByRig.blob
      if (geometry === undefined) throw new Error(`Expected blob ${slotId} attachment geometry`)
      return {
        ...part,
        composition: {
          ...sourceComposition,
          renderNodes: sourceComposition.renderNodes.map(node => ({
          ...node,
          compatibleRigs: ['feline-sit'] as RigId[],
          })),
          geometryByRig: {
          'feline-sit': structuredClone(geometry),
          },
        },
      }
    })
    return [slotId, candidates] as const
  })
  const parts = partGroups.flatMap(([, candidates]) => candidates)
  const partPools = Object.fromEntries(partGroups.map(([slotId, candidates]) => [
    slotId,
    candidates.map(part => part.id),
  ])) as Record<VisualSlotId, string[]>
  const transitionBridges = (sourceCatalog.transitionBridges ?? [])
    .filter(bridge => bridge.rigId === 'blob')
    .map<TransitionBridgeDefinition>(bridge => ({
      ...bridge,
      rigId: 'feline-sit',
      neutralAssetPath: bridge.neutralAssetPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
      neutralPngPath: bridge.neutralPngPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
      frontMaskPath: bridge.frontMaskPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
      backMaskPath: bridge.backMaskPath.replaceAll('v0.3.0', 'v0.7.0').replaceAll('/blob/', '/feline-sit/'),
    }))
  return {
    version: '0.7.0',
    themes: sourceCatalog.themes,
    rigs: [{ ...blobRig, id: 'feline-sit' }],
    parts,
    semanticTraits: sourceCatalog.semanticTraits,
    modifiers: sourceCatalog.modifiers,
    dependencies: sourceCatalog.dependencies,
    ...(sourceCatalog.compositionPolicy === undefined ? {} : { compositionPolicy: sourceCatalog.compositionPolicy }),
    transitionBridges,
    archetypes,
    anatomyBundles: [{
    id: 'feline-sit',
    archetypeId: 'feline',
    rigId: 'feline-sit',
    poseId: 'sit',
    rarity: 'N',
    baseWeight: 1,
    structural: fixtureResource('feline-sit-structural'),
    alpha: fixtureResource('feline-sit-alpha'),
    clip: fixtureResource('feline-sit-clip'),
    faceSafeZone: { x: 500, y: 400, width: 1048, height: 900 },
    featureSockets: {},
    mutationAnchors: {},
    derivedSlots: {
      bodyFrame: partPools.bodyFrame[0]!,
      headShape: partPools.headShape[0]!,
      arms: partPools.arms[0]!,
      legs: partPools.legs[0]!,
      tail: partPools.tail[0]!,
      extraAppendage: partPools.extraAppendage[0]!,
    },
    allowedTraitPools: {
      eyes: partPools.eyes,
      mouthShape: partPools.mouthShape,
      oralDetail: partPools.oralDetail,
      headAppendage: partPools.headAppendage,
      surfaceMaterial: partPools.surfaceMaterial,
      pattern: partPools.pattern,
      colorScheme: partPools.colorScheme,
      effect: partPools.effect,
    },
    partPools,
    }],
  }
}

export function makeV08SpeciesRigCatalogFixture(): Catalog {
  const catalog = structuredClone(makeV07FelinePartLibraryFixture()) as Catalog & Record<string, any>
  const sourceMasterSha256 = 'b'.repeat(64)
  const speciesRigId = 'feline-sit-v1'
  const rigVersion = '1.0.0'
  const regionIds = [
    'bodySurface', 'headSurface', 'faceSafeZone', 'eyesRegion', 'mouthRegion',
    'oralRegion', 'tailSurface', 'frontPawDetail', 'hindPawDetail', 'headAccessory',
    'mutationEar', 'mutationBack', 'mutationTailTip', 'effectField', 'faceProtection',
  ] as const
  const expressionBySlot: Record<VisualSlotId, V08ExpressionKind> = {
    bodyFrame: 'body-clipped',
    headShape: 'head-clipped',
    eyes: 'face-clipped',
    mouthShape: 'face-clipped',
    oralDetail: 'face-clipped',
    headAppendage: 'anchor-clipped',
    arms: 'anchor-clipped',
    legs: 'anchor-clipped',
    tail: 'body-clipped',
    extraAppendage: 'anchor-clipped',
    surfaceMaterial: 'body-clipped',
    pattern: 'body-clipped',
    colorScheme: 'body-clipped',
    effect: 'protected-effect',
  }
  const ownerBySlot: Record<VisualSlotId, string> = {
    bodyFrame: 'bodySurface',
    headShape: 'headSurface',
    eyes: 'eyesRegion',
    mouthShape: 'mouthRegion',
    oralDetail: 'oralRegion',
    headAppendage: 'headAccessory',
    arms: 'frontPawDetail',
    legs: 'hindPawDetail',
    tail: 'tailSurface',
    extraAppendage: 'mutationBack',
    surfaceMaterial: 'bodySurface',
    pattern: 'bodySurface',
    colorScheme: 'bodySurface',
    effect: 'effectField',
  }

  catalog.version = '0.8.0'
  delete catalog.transitionBridges
  catalog.parts = catalog.parts.map(part => ({
    ...part,
    assetPath: `assets/v0.8.0/parts/${part.id}.webp`,
    pngPath: `assets/v0.8.0/parts/${part.id}.png`,
    approvedTransforms: [{ scale: 1, mirrorX: false }],
    composition: {
      mode: 'species-rig',
      isNone: false,
      motifTags: [],
      visualIntensity: 'quiet',
      speciesRigId,
      rigVersion,
      sourceMasterSha256,
      expressionKind: expressionBySlot[part.slotId],
      ownerRegionId: ownerBySlot[part.slotId],
      blendMode: 'source-over',
      opacity: 1,
    },
  } as any))
  catalog.anatomyBundles = (catalog.anatomyBundles ?? []).map(bundle => ({
    ...bundle,
    id: 'feline-sit-canonical-v1',
    speciesRigId,
    sourceMasterSha256,
    structural: fixtureV08Resource('v08-feline-structural'),
    alpha: fixtureV08Resource('v08-feline-alpha'),
    clip: fixtureV08Resource('v08-feline-clip'),
  } as any))
  catalog.speciesRigs = [{
    schemaVersion: 'qmonster-species-rig-v1',
    id: speciesRigId,
    rigVersion,
    archetypeId: 'feline',
    rigId: 'feline-sit',
    poseId: 'sit',
    canvas: { width: 2048, height: 2048 },
    coordinatePolicy: 'fixed-canvas-no-trim',
    sourceMasterSha256,
    regions: Object.fromEntries(regionIds.map(regionId => [
      regionId,
      fixtureV08Resource(`v08-${regionId}`),
    ])) as any,
    layerOrder: [
      'colorScheme', 'surfaceMaterial', 'pattern', 'bodyFrame', 'tail', 'arms',
      'legs', 'headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage',
      'extraAppendage', 'effect',
    ],
    allowedSlotExpressions: expressionBySlot,
  }]
  return catalog
}

export function makeV08MonsterSpecFixture(): MonsterSpec {
  const catalog = makeV08SpeciesRigCatalogFixture() as Catalog & Record<string, any>
  const bundle = catalog.anatomyBundles?.[0] as any
  if (bundle === undefined) throw new Error('Expected v0.8 anatomy bundle fixture')
  const spec = makeValidMonsterSpecFixture()
  spec.schemaVersion = '0.3.0'
  spec.catalogVersion = '0.8.0'
  spec.rendererVersion = '0.8.0'
  spec.archetypeId = 'feline'
  spec.anatomyBundleId = 'feline-sit-canonical-v1'
  Object.assign(spec, { speciesRigId: 'feline-sit-v1' })
  spec.visualSlots = Object.fromEntries(VISUAL_SLOT_IDS.map(slotId => [
    slotId,
    {
      partId: bundle.partPools[slotId][0],
      rigId: 'feline-sit',
      transform: { scale: 1, mirrorX: false },
    },
  ])) as MonsterSpec['visualSlots']
  return spec
}

export function makeValidCompositionSpecFixture(
  catalog: Catalog = makeCompositionCatalogFixture(),
): MonsterSpec {
  const spec = makeValidMonsterSpecFixture()
  spec.catalogVersion = '0.2.0'
  spec.rendererVersion = '0.2.0'
  for (const slotId of VISUAL_SLOT_IDS) {
    const part = catalog.parts.find(candidate => candidate.slotId === slotId)!
    spec.visualSlots[slotId] = { partId: part.id, rigId: 'blob' }
  }
  return spec
}

export function makeValidCatalogFixtureWithThreeRigs(): Catalog {
  const catalog = makeValidCatalogFixture()
  const bodyFrame = catalog.parts.find(part => part.slotId === 'bodyFrame')!
  const colorScheme = catalog.parts.find(part => part.slotId === 'colorScheme')!

  catalog.parts = [
    ...catalog.parts.filter(part => part.slotId !== 'bodyFrame' && part.slotId !== 'colorScheme'),
    ...(['blob', 'biped', 'floating'] as const).map(rigId => ({
      ...bodyFrame,
      id: `body_${rigId}`,
      compatibleRigs: [rigId],
    })),
    { ...colorScheme, id: 'color_deep_sea_coral', themeIds: ['deep-sea'] },
    { ...colorScheme, id: 'color_fungal_amber', themeIds: ['fungal'] },
    { ...colorScheme, id: 'color_shadow_violet', themeIds: ['shadow'] },
  ]
  return catalog
}
