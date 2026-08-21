import {
  SEMANTIC_SLOT_IDS,
  VISUAL_SLOT_IDS,
  type Catalog,
  type MonsterSpec,
  type Palette,
  type RenderLayer,
  type RigId,
  type SemanticSlotId,
  type VisualPartDefinition,
  type VisualSelection,
  type VisualSlotId,
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
  headAppendage: 'head_appendage_none',
  arms: 'arms_short',
  legs: 'legs_webbed',
  tail: 'tail_anchor',
  extraAppendage: 'extra_appendage_none',
  surfaceMaterial: 'surface_gel',
  pattern: 'pattern_spots',
  colorScheme: 'color_scheme_ocean',
  effect: 'effect_none',
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
    semanticTraitId: semanticSlotId === undefined ? null : semanticTraitIds[semanticSlotId],
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
    })),
    modifiers: [
      { id: 'mutation_albino', kind: 'mutation', baseWeight: 1, requiresMutation: false, overrides: { palette: 'albino' } },
      { id: 'mutation_double_head', kind: 'mutation', baseWeight: 1, requiresMutation: false, overrides: { duplicateLayerGroup: 'head' } },
      { id: 'aberration_color_discord', kind: 'aberration', baseWeight: 1, requiresMutation: false, overrides: { palette: 'discord' } },
      { id: 'aberration_misplaced_eye', kind: 'aberration', baseWeight: 1, requiresMutation: false, overrides: { socket: 'headAlternate' } },
    ],
    dependencies: {},
  }
}
