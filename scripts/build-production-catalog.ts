import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import sharp from 'sharp'
import type {
  Catalog,
  CompositionPolicy,
  ModifierDefinition,
  PartComposition,
  RigDefinition,
  RigId,
  SemanticSlotId,
  SemanticTraitDefinition,
  ThemeDefinition,
  ThemeId,
  VisualPartDefinition,
  VisualSlotId,
} from '@qmonster/generator-core'
import { COMPOSITION_PARENT_BY_SLOT } from '@qmonster/generator-core'
import {
  PRODUCTION_CHROMA_GATE_PROFILE,
  PRODUCTION_CHROMA_GATE_VERSION,
  evaluateChromaQuality,
  type ChromaQualityMetrics,
  type ChromaQualityThresholds,
} from '../packages/asset-catalog/src/chroma-quality-gate.js'
import { buildProductionEvidenceManifest } from '../packages/asset-catalog/src/evidence-root.js'
import {
  calibrateBodySocket,
  calibrateChildOrigin,
  cropAlphaMask,
  loadAlphaMask,
  type CalibrationPoint,
} from './alpha-junction-calibration.js'
import { PRODUCTION_PARTS, buildPartPrompt } from './qmonster-part-production.js'
import { productionPaths } from './production-paths.js'
import { buildInterfaceCatalog, validateInterfaceSourceIndex, type ProcessedInterfaceAsset, type ProcessedInterfaceBridge } from './build-interface-catalog.js'
import { parseInterfaceSourceManifest } from './interface-source-schema.js'
import type { RigSheetAudit } from './process-rig-sheets.js'
import { splitPairedPart } from './split-paired-part.js'

interface ProductionExtractionAudit {
  approved: boolean
  diagnostics: unknown[]
  metrics: ChromaQualityMetrics
  thresholds?: ChromaQualityThresholds
  sourceSha256: string
  processedSha256: string
}

interface CanonicalExtractionAudit extends ProductionExtractionAudit {
  gateVersion: string
  imageSize: { width: number; height: number }
  sourcePath: string
  processedPath: string
  thresholds: ChromaQualityThresholds
}

interface ProductionIndexEntry {
  id: string
  visible: boolean
  file?: string
  selected: number | 'none'
  attempt?: string
  rejectionSummary?: string
  sourceSheet?: string
  sheetPath?: string
  sheetSha256?: string
  candidates?: Array<{
    index: number
    sourcePath: string
    rgbaPath: string
    extraction: ProductionExtractionAudit
  }>
  master?: { masterPath: string; sha256: string; width: number; height: number; hasAlpha: boolean; boundaryAlphaPixels: number }
  masterPath?: string
  masterSha256?: string
  pngPath: string
  pngSha256: string
  webpPath: string
  webpSha256: string
  evaluatedVariants?: string[]
  postProcess?: string
  composition?: Record<string, unknown>
  candidateCompositions?: Array<Record<string, unknown> & { index: number }>
  componentEvaluations?: Record<string, unknown>
  paletteMaskAudit?: {
    version: string
    sourceId: string
    sourcePath: string
    sourceSha256: string
    runtimePngPath: string
    runtimePngSha256: string
    runtimeWebpPath: string
    runtimeWebpSha256: string
    rigMasks: Record<string, {
      rigAssetPath: string
      rigAssetSha256: string
      paths: Record<'primary' | 'secondary' | 'accent', string>
      sha256: Record<'primary' | 'secondary' | 'accent', string>
      metrics: Record<string, number>
    }>
  }
  generationMode?: string
  referenceEvidence?: unknown
}

interface CompositionManifest {
  catalogVersion: '0.2.0'
  rendererVersion: '0.2.0'
  policy: CompositionPolicy
}

export interface RichPart extends VisualPartDefinition {
  displayName: string
  flavorText: string
  description: string
  pngPath: string
  pngSha256: string
}

export interface RichSemanticTrait extends SemanticTraitDefinition {
  displayName: string
  flavorText: string
  rarity: 'N' | 'R'
  themeBoosts: Partial<Record<ThemeId, number>>
  excludes: string[]
  boosts: Record<string, number>
  visualMapping: Record<string, unknown>
}

export interface RichModifier extends ModifierDefinition {
  displayName: string
  flavorText: string
  rarity: 'N' | 'R'
  themeBoosts: Partial<Record<ThemeId, number>>
  excludes: string[]
  boosts: Record<string, number>
  visualMapping: Record<string, unknown>
}

interface RichTheme extends ThemeDefinition {
  displayName: string
  flavorText: string
}

interface RichRig extends RigDefinition {
  sourceId: string
  displayName: string
}

export interface ProductionCatalogBundle {
  catalog: Catalog
  themes: RichTheme[]
  rigs: RichRig[]
  parts: RichPart[]
  semanticTraits: RichSemanticTrait[]
  modifiers: RichModifier[]
  sourceIndex: Record<string, unknown>
}

const themes: RichTheme[] = [
  { id: 'deep-sea', displayName: '深海', flavorText: '潮光从柔软的深渊皮膜中缓慢呼吸。', palette: { primary: '#237aa3', secondary: '#74c9bf', accent: '#f6d365' } },
  { id: 'fungal', displayName: '菌沼', flavorText: '孢子与湿润苔色长成一团好奇的生命。', palette: { primary: '#6b7d33', secondary: '#a7c957', accent: '#f4a261' } },
  { id: 'shadow', displayName: '幽影', flavorText: '温柔的暗色轮廓把微光悄悄藏在身后。', palette: { primary: '#463c78', secondary: '#8377d1', accent: '#f9c74f' } },
]

const rigs: RichRig[] = [
  {
    id: 'blob', sourceId: 'base_blob_v1', displayName: '团絮矮墩',
    sockets: { canvasCenter: { x: 1024, y: 1024 }, head: { x: 1024, y: 700 }, headAlternate: { x: 1320, y: 735 }, armLeft: { x: 700, y: 1120 }, armRight: { x: 1348, y: 1120 }, legLeft: { x: 830, y: 1450 }, legRight: { x: 1218, y: 1450 }, tail: { x: 1510, y: 1260 }, wingLeft: { x: 650, y: 930 }, wingRight: { x: 1398, y: 930 } },
  },
  {
    id: 'biped', sourceId: 'base_biped_v1', displayName: '圆身双足',
    sockets: { canvasCenter: { x: 1024, y: 1024 }, head: { x: 1024, y: 620 }, headAlternate: { x: 1300, y: 670 }, armLeft: { x: 710, y: 1030 }, armRight: { x: 1338, y: 1030 }, legLeft: { x: 850, y: 1530 }, legRight: { x: 1198, y: 1530 }, tail: { x: 1460, y: 1240 }, wingLeft: { x: 675, y: 900 }, wingRight: { x: 1373, y: 900 } },
  },
  {
    id: 'floating', sourceId: 'base_floating_v1', displayName: '悬浮软团',
    sockets: { canvasCenter: { x: 1024, y: 1024 }, head: { x: 1024, y: 690 }, headAlternate: { x: 1300, y: 730 }, armLeft: { x: 720, y: 1080 }, armRight: { x: 1328, y: 1080 }, legLeft: { x: 870, y: 1460 }, legRight: { x: 1178, y: 1460 }, tail: { x: 1480, y: 1240 }, wingLeft: { x: 680, y: 920 }, wingRight: { x: 1368, y: 920 } },
  },
]

const semanticSlotByVisual: Record<VisualSlotId, SemanticSlotId | null> = {
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
  effect: null,
}

const semanticOnlyTraits: RichSemanticTrait[] = [
  { id: 'personality_gentle', semanticSlotId: 'personality', displayName: '软心慢慢', flavorText: '遇到陌生声响时，它先递出一只软绒绒的手。', rarity: 'N', themeBoosts: { 'deep-sea': 1.05, fungal: 1.1 }, excludes: ['personality_mischievous'], boosts: { surface_short_fur: 1.15 }, visualMapping: { mood: 'relaxed', suggestedParts: ['eyes_sleepy_crescent', 'mouth_soft_pout'] } },
  { id: 'personality_curious', semanticSlotId: 'personality', displayName: '亮眼好奇', flavorText: '每一扇门缝后面，都可能藏着值得认识的新朋友。', rarity: 'N', themeBoosts: { 'deep-sea': 1.1 }, excludes: [], boosts: { eyes_glossy_pair: 1.15 }, visualMapping: { mood: 'curious', suggestedParts: ['eyes_glossy_pair', 'eyes_stalk_pair'] } },
  { id: 'personality_brave', semanticSlotId: 'personality', displayName: '软胆勇士', flavorText: '腿会抖，但仍会往前挪半步。', rarity: 'N', themeBoosts: { fungal: 1.05 }, excludes: ['personality_shy_shadow'], boosts: { arms_short_plush: 1.1 }, visualMapping: { mood: 'upright', suggestedParts: ['body_biped_tall', 'legs_stub_feet'] } },
  { id: 'personality_dreamy', semanticSlotId: 'personality', displayName: '走神云朵', flavorText: '它常常盯着空气里不存在的泡泡发呆。', rarity: 'N', themeBoosts: { shadow: 1.15 }, excludes: [], boosts: { body_floating_drop: 1.12 }, visualMapping: { mood: 'dreamy', suggestedParts: ['body_floating_drop', 'eyes_sleepy_crescent'] } },
  { id: 'personality_mischievous', semanticSlotId: 'personality', displayName: '淘气弹簧', flavorText: '藏好尾巴之前，它已经把恶作剧笑出了声。', rarity: 'R', themeBoosts: { fungal: 1.2 }, excludes: ['personality_gentle'], boosts: { oral_lolling_tongue: 1.18 }, visualMapping: { mood: 'mischievous', suggestedParts: ['mouth_wide_grin', 'oral_lolling_tongue'] } },
  { id: 'personality_shy_shadow', semanticSlotId: 'personality', displayName: '藏光腼腆', flavorText: '被看见时，它会把自己的微光调暗一点。', rarity: 'R', themeBoosts: { shadow: 1.3 }, excludes: ['personality_brave'], boosts: { head_shadow_hood: 1.2 }, visualMapping: { mood: 'shy', suggestedParts: ['head_shadow_hood', 'eyes_sleepy_crescent'] } },
  { id: 'quirk_light_chaser', semanticSlotId: 'quirk', displayName: '追光癖', flavorText: '只要有一点亮，它就忍不住跟着走。', rarity: 'N', themeBoosts: { 'deep-sea': 1.2, shadow: 1.15 }, excludes: [], boosts: { effect_bioluminescent_orbs: 1.3 }, visualMapping: { effectPartIds: ['effect_bioluminescent_orbs'], suggestedParts: ['head_antennae_glow', 'pattern_constellation'] } },
  { id: 'quirk_spore_sneeze', semanticSlotId: 'quirk', displayName: '孢子喷嚏', flavorText: '一紧张，就会打出一串暖呼呼的小孢子。', rarity: 'N', themeBoosts: { fungal: 1.35 }, excludes: ['quirk_tide_hum'], boosts: { effect_spore_glow: 1.3 }, visualMapping: { effectPartIds: ['effect_spore_glow'], suggestedParts: ['surface_mushroom_velvet'] } },
  { id: 'quirk_tide_hum', semanticSlotId: 'quirk', displayName: '潮汐哼唱', flavorText: '安静时，肚子里会传出很小的海浪声。', rarity: 'N', themeBoosts: { 'deep-sea': 1.3 }, excludes: ['quirk_spore_sneeze'], boosts: { tail_fish_fan: 1.15 }, visualMapping: { effectPartIds: [], suggestedParts: ['tail_fish_fan', 'arms_paddle'] } },
  { id: 'quirk_collects_echoes', semanticSlotId: 'quirk', displayName: '回声收藏家', flavorText: '它把喜欢的声音叠好，藏在柔软肚皮里。', rarity: 'N', themeBoosts: { 'deep-sea': 1.05, shadow: 1.1 }, excludes: [], boosts: { head_ears_floppy_fins: 1.05 }, visualMapping: { effectPartIds: [], suggestedParts: ['head_ears_floppy_fins'] } },
  { id: 'quirk_shadow_skip', semanticSlotId: 'quirk', displayName: '影子慢半拍', flavorText: '本体停下以后，影子还会多走一小步。', rarity: 'R', themeBoosts: { shadow: 1.4 }, excludes: [], boosts: { legs_shadow_tiptoe: 1.25 }, visualMapping: { effectPartIds: [], suggestedParts: ['legs_shadow_tiptoe', 'color_shadow_violet'] } },
  { id: 'quirk_dream_bubbles', semanticSlotId: 'quirk', displayName: '梦泡逸出', flavorText: '睡着以后，未做完的梦会变成小泡泡飘出去。', rarity: 'R', themeBoosts: { 'deep-sea': 1.15, fungal: 1.1 }, excludes: [], boosts: { surface_gel_bubbles: 1.2 }, visualMapping: { effectPartIds: ['effect_bioluminescent_orbs'], suggestedParts: ['surface_gel_bubbles', 'body_floating_drop'] } },
]

const modifiers: RichModifier[] = [
  { id: 'mutation_albino', kind: 'mutation', displayName: '月白变异', flavorText: '色素退成月光般的奶白，暖色仍藏在耳尖与软边里。', rarity: 'R', baseWeight: 1, requiresMutation: false, overrides: { palette: { primary: '#f4f0ea', secondary: '#dce9ef', accent: '#f4c7b8' } }, themeBoosts: { shadow: 1.2 }, excludes: ['aberration_color_discord'], boosts: {}, visualMapping: { type: 'paletteOverride', targetSlot: null, assetIds: [] } },
  { id: 'mutation_double_head', kind: 'mutation', displayName: '双头萌芽', flavorText: '第二颗脑袋从旁边探出，和第一颗共享同一份好奇。', rarity: 'R', baseWeight: 1, requiresMutation: false, overrides: { duplicateLayerGroup: 'head', socket: 'headAlternate' }, themeBoosts: { fungal: 1.15 }, excludes: ['aberration_misplaced_eye'], boosts: {}, visualMapping: { type: 'duplicateLayerGroup', targetSlot: 'headShape', socket: 'headAlternate', assetIds: [] } },
  { id: 'aberration_color_discord', kind: 'aberration', displayName: '错彩乐章', flavorText: '本不该相遇的颜色挤到一起，却意外唱得很响亮。', rarity: 'R', baseWeight: 1, requiresMutation: false, overrides: { palette: { primary: '#ff5d8f', secondary: '#4cc9f0', accent: '#ffd166' } }, themeBoosts: { 'deep-sea': 1.05, fungal: 1.05, shadow: 1.05 }, excludes: ['mutation_albino'], boosts: {}, visualMapping: { type: 'paletteOverride', targetSlot: 'colorScheme', assetIds: [] } },
  { id: 'aberration_misplaced_eye', kind: 'aberration', displayName: '迷路之眼', flavorText: '有一组眼睛走错了位置，仍然认真地看着同一个方向。', rarity: 'R', baseWeight: 1, requiresMutation: false, overrides: { relocateSlot: 'eyes', socket: 'headAlternate' }, themeBoosts: { shadow: 1.25 }, excludes: ['mutation_double_head'], boosts: {}, visualMapping: { type: 'relocateSlot', targetSlot: 'eyes', socket: 'headAlternate', assetIds: [] } },
]

const rigSheetProvenance = {
  base_blob_v1: { file: 'exec-3637fa25-94c1-4ff2-8867-dbfdbc54445c.png', selected: 1, rejected: 'Candidates 2-4 had weaker neutral silhouette or future socket clarity.' },
  base_biped_v1: { file: 'exec-4d96db4e-e09d-4c04-a410-cc4dfc79b829.png', selected: 2, rejected: 'Candidates 1,3,4 had stance, proportion, or attachment-zone drift.' },
  base_floating_v1: { file: 'exec-eae82714-441a-41e0-9998-b7e8303e5681.png', selected: 4, rejected: 'Candidates 1-3 failed the independent edge-colour gate after full local comparison; candidate 4 preserved the hovering silhouette and passed at p95 11.92.' },
} as const

const STRONG_PART_IDS = new Set([
  'head_mushroom_cap',
  'eyes_triple_pearl',
  'mouth_wide_grin',
  'oral_lolling_tongue',
  'extra_moth_wings',
  'extra_soft_tentacles',
  'extra_side_fins',
  'surface_gel_bubbles',
  'effect_bioluminescent_orbs',
  'effect_spore_glow',
])

const PAIRED_PART_IDS = new Set([
  ...PRODUCTION_PARTS.filter(part => part.slotId === 'arms' || part.slotId === 'legs').map(part => part.id),
  'extra_moth_wings',
])
const ARM_NODE_SCALE = 0.65
const LEG_NODE_SCALE = 0.34
const HEAD_NODE_SCALE = 0.78

interface PairedJunctionCalibration {
  anchors: readonly [CalibrationPoint, CalibrationPoint]
  origins: readonly [CalibrationPoint, CalibrationPoint]
}

interface CatalogJunctionCalibration {
  bodySockets: ReadonlyMap<string, Record<string, CalibrationPoint>>
  childOrigins: ReadonlyMap<string, CalibrationPoint>
  paired: ReadonlyMap<string, PairedJunctionCalibration>
}

async function calibrateCatalogJunctions(
  sourceRoot: string,
  assetDirectory: string,
): Promise<CatalogJunctionCalibration> {
  const childOrigins = new Map<string, CalibrationPoint>()
  for (const part of PRODUCTION_PARTS.filter(candidate => candidate.visible && candidate.slotId === 'headShape')) {
    const mask = await loadAlphaMask(join(assetDirectory, 'parts', `${part.id}.png`))
    childOrigins.set(part.id, calibrateChildOrigin(mask, { junction: 'head', insetPx: 24 }))
  }

  const paired = new Map<string, PairedJunctionCalibration>()
  for (const part of PRODUCTION_PARTS.filter(candidate => candidate.visible && PAIRED_PART_IDS.has(candidate.id))) {
    const mask = await loadAlphaMask(join(sourceRoot, 'parts', `${part.id}.png`))
    const rects = [
      { left: 0, top: 0, width: 1024, height: 2048 },
      { left: 1024, top: 0, width: 1024, height: 2048 },
    ] as const
    const junctions = part.slotId === 'legs'
      ? ['legLeft', 'legRight'] as const
      : part.slotId === 'arms' || part.slotId === 'extraAppendage'
      ? ['armLeft', 'armRight'] as const
      : (() => { throw new Error(`Unsupported paired junction slot ${part.slotId}`) })()
    const cropMasks = rects.map(rect => cropAlphaMask(mask, rect))
    const localPoints = rects.map((_, index) => calibrateChildOrigin(cropMasks[index]!, {
      junction: junctions[index]!,
      insetPx: part.slotId === 'legs' ? 16 : part.slotId === 'arms' ? 30 : 39,
    })) as unknown as readonly [CalibrationPoint, CalibrationPoint]
    paired.set(part.id, {
      anchors: localPoints.map((point, index) => ({
        x: point.x + rects[index]!.left,
        y: point.y + rects[index]!.top,
      })) as unknown as readonly [CalibrationPoint, CalibrationPoint],
      origins: localPoints.map((point, index) => ({
        x: point.x - cropMasks[index]!.bounds.x,
        y: point.y - cropMasks[index]!.bounds.y,
      })) as unknown as readonly [CalibrationPoint, CalibrationPoint],
    })
  }

  const armCalibrationByRig = new Map<RigId, PairedJunctionCalibration>()
  for (const part of PRODUCTION_PARTS.filter(candidate => candidate.visible && candidate.slotId === 'arms')) {
    armCalibrationByRig.set(part.rigId!, paired.get(part.id)!)
  }

  const bodySockets = new Map<string, Record<string, CalibrationPoint>>()
  for (const part of PRODUCTION_PARTS.filter(candidate => candidate.visible && candidate.slotId === 'bodyFrame')) {
    const rigId = part.compatibleRigs[0]!
    const mask = await loadAlphaMask(join(assetDirectory, 'parts', `${part.id}.png`))
    const arms = armCalibrationByRig.get(rigId)
    if (arms === undefined) throw new Error(`Missing arm calibration for ${rigId}`)
    const armTargetY = (origin: CalibrationPoint) => Math.round(mask.bounds.y - 12 + origin.y * ARM_NODE_SCALE)
    bodySockets.set(part.id, {
      head: calibrateBodySocket(mask, { socket: 'head', insetPx: 19 }),
      headAlternate: calibrateBodySocket(mask, { socket: 'headAlternate', insetPx: 19 }),
      armLeft: calibrateBodySocket(mask, { socket: 'armLeft', insetPx: -8, targetY: armTargetY(arms.origins[0]) }),
      armRight: calibrateBodySocket(mask, { socket: 'armRight', insetPx: -8, targetY: armTargetY(arms.origins[1]) }),
      legLeft: calibrateBodySocket(mask, { socket: 'legLeft', insetPx: 8 }),
      legRight: calibrateBodySocket(mask, { socket: 'legRight', insetPx: 8 }),
    })
  }
  return { bodySockets, childOrigins, paired }
}

function bodyGeometry(
  partId: string,
  rigId: RigId,
  calibration: CatalogJunctionCalibration,
): PartComposition['geometryByRig'][RigId] {
  const rig = rigs.find(candidate => candidate.id === rigId)!
  const calibrated = calibration.bodySockets.get(partId)
  if (calibrated === undefined) throw new Error(`Missing body junction calibration for ${partId}`)
  const scaled = (socket: string) => {
    const point = rig.sockets[socket]!
    return { x: point.x / 2, y: point.y / 2 }
  }
  return {
    sockets: {
      head: calibrated.head!,
      headAlternate: calibrated.headAlternate!,
      armLeft: calibrated.armLeft!,
      armRight: calibrated.armRight!,
      legLeft: calibrated.legLeft!,
      legRight: calibrated.legRight!,
      tail: scaled('tail'),
      wingLeft: scaled('wingLeft'),
      wingRight: scaled('wingRight'),
      overlay: { x: 512, y: 512 },
      effect: { x: 512, y: 512 },
    },
  }
}

function geometryForPart(
  part: (typeof PRODUCTION_PARTS)[number],
  calibration: CatalogJunctionCalibration,
): PartComposition['geometryByRig'] {
  if (!part.visible) return {}
  if (part.slotId === 'bodyFrame') {
    return Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, bodyGeometry(part.id, rigId, calibration)]))
  }
  if (part.slotId === 'headShape') {
    return Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, {
      sockets: {
        eyes: { x: 512, y: 430 },
        mouth: { x: 512, y: 590 },
        headAppendage: { x: 512, y: 245 },
      },
      faceSafeZone: { x: 120, y: 160, width: 784, height: 720 },
    }]))
  }
  if (part.slotId === 'mouthShape') {
    return Object.fromEntries(part.compatibleRigs.map(rigId => [rigId, {
      sockets: { oralDetail: { x: 512, y: 512 } },
    }]))
  }
  return {}
}

function singleNodeSocket(part: (typeof PRODUCTION_PARTS)[number]): string | null {
  switch (part.slotId) {
    case 'bodyFrame': return null
    case 'headShape': return 'head'
    case 'eyes': return 'eyes'
    case 'mouthShape': return 'mouth'
    case 'oralDetail': return 'oralDetail'
    case 'headAppendage': return 'headAppendage'
    case 'tail': return 'tail'
    case 'extraAppendage': return 'overlay'
    case 'surfaceMaterial':
    case 'pattern':
    case 'colorScheme': return 'overlay'
    case 'effect': return 'effect'
    case 'arms': return 'armLeft'
    case 'legs': return 'legLeft'
  }
}

function clipPolicy(part: (typeof PRODUCTION_PARTS)[number]): 'none' | 'body' | 'protect-face' {
  if (part.slotId === 'surfaceMaterial' || part.slotId === 'pattern' || part.slotId === 'colorScheme') return 'body'
  if (part.slotId === 'effect') return 'protect-face'
  return 'none'
}

function singleNodeScale(part: (typeof PRODUCTION_PARTS)[number]): number {
  if (part.slotId === 'headShape') return HEAD_NODE_SCALE
  switch (part.slotId) {
    case 'eyes': return 0.45 * HEAD_NODE_SCALE
    case 'mouthShape': return 0.35 * HEAD_NODE_SCALE
    case 'oralDetail': return 0.11 * HEAD_NODE_SCALE
    case 'headAppendage': return 0.3 * HEAD_NODE_SCALE
    case 'tail': return 0.5
    case 'extraAppendage': return 0.5
    default: return 1
  }
}

async function compositionForPart(input: {
  part: (typeof PRODUCTION_PARTS)[number]
  compatibleRigs: RigId[]
  sourceRoot: string
  assetDirectory: string
  pngSha256: string
  webpSha256: string
  calibration: CatalogJunctionCalibration
}): Promise<PartComposition> {
  const { part } = input
  if (!part.visible) {
    return { isNone: true, motifTags: [], visualIntensity: 'quiet', renderNodes: [], geometryByRig: {} }
  }
  const parentSlot = COMPOSITION_PARENT_BY_SLOT[part.slotId]
  let renderNodes: PartComposition['renderNodes']
  if (PAIRED_PART_IDS.has(part.id)) {
    const isWings = part.id === 'extra_moth_wings'
    const sockets = isWings ? ['wingLeft', 'wingRight'] as const
      : part.slotId === 'arms' ? ['armLeft', 'armRight'] as const
        : ['legLeft', 'legRight'] as const
    const calibrated = input.calibration.paired.get(part.id)
    const rig = rigs.find(candidate => candidate.id === part.rigId)!
    const split = await splitPairedPart(
      join(input.sourceRoot, 'parts', `${part.id}.png`),
      join(input.assetDirectory, 'nodes', part.id),
      [
        { id: 'left', rect: { left: 0, top: 0, width: 1024, height: 2048 }, anchor: calibrated?.anchors[0] ?? rig.sockets[sockets[0]]!, mirrorX: false },
        { id: 'right', rect: { left: 1024, top: 0, width: 1024, height: 2048 }, anchor: calibrated?.anchors[1] ?? rig.sockets[sockets[1]]!, mirrorX: false },
      ],
    )
    renderNodes = split.map((node, index) => ({
      id: `${part.id}_${node.id}`,
      assetPath: `nodes/${part.id}/${node.id}.webp`,
      pngPath: `nodes/${part.id}/${node.id}.png`,
      assetSha256: node.webpSha256,
      pngSha256: node.pngSha256,
      parentSlot,
      socket: sockets[index]!,
      origin: node.origin,
      transform: {
        scale: part.slotId === 'arms' ? ARM_NODE_SCALE : part.slotId === 'legs' ? LEG_NODE_SCALE : 0.5,
        mirrorX: node.mirrorX,
      },
      layer: part.layer,
      compatibleRigs: input.compatibleRigs,
      clipPolicy: clipPolicy(part),
    }))
  } else {
    renderNodes = [{
      id: `${part.id}_0`,
      assetPath: `parts/${part.id}.webp`,
      pngPath: `parts/${part.id}.png`,
      assetSha256: input.webpSha256,
      pngSha256: input.pngSha256,
      parentSlot,
      socket: singleNodeSocket(part),
      origin: part.slotId === 'headShape' ? input.calibration.childOrigins.get(part.id)! : part.origin,
      transform: { scale: singleNodeScale(part), mirrorX: false },
      layer: part.layer,
      compatibleRigs: input.compatibleRigs,
      clipPolicy: clipPolicy(part),
    }]
  }
  return {
    isNone: false,
    motifTags: STRONG_PART_IDS.has(part.id) ? part.themeIds : themes.map(theme => theme.id),
    visualIntensity: STRONG_PART_IDS.has(part.id) ? 'strong' : 'quiet',
    renderNodes,
    geometryByRig: geometryForPart(part, input.calibration),
  }
}

function normalizePath(path: string): string {
  const portable = isAbsolute(path) ? relative(process.cwd(), path) : path
  return portable.replaceAll('\\', '/')
}

function runtimeAssetPath(path: string, assetDirectory: string): string {
  const normalized = normalizePath(path)
  const prefix = `${assetDirectory}/`
  if (!normalized.startsWith(prefix)) throw new Error(`Runtime asset path is outside ${assetDirectory}: ${path}`)
  return normalized.slice(prefix.length)
}

function normalizeAuditPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAuditPaths)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === 'string' && key.toLowerCase().endsWith('path') ? normalizePath(item) : normalizeAuditPaths(item),
  ]))
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalExtractionAudit(
  extraction: ProductionExtractionAudit,
  imageSize: { width: number; height: number },
  sourcePath: string,
  processedPath: string,
): CanonicalExtractionAudit {
  const gate = evaluateChromaQuality({
    gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
    profile: PRODUCTION_CHROMA_GATE_PROFILE,
    imageSize,
    metrics: extraction.metrics,
  })
  return {
    gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
    imageSize,
    sourcePath: normalizePath(sourcePath),
    processedPath: normalizePath(processedPath),
    approved: gate.approved,
    diagnostics: gate.diagnostics,
    metrics: extraction.metrics,
    thresholds: gate.thresholds,
    sourceSha256: extraction.sourceSha256,
    processedSha256: extraction.processedSha256,
  }
}

export async function resolveProductionPrompt(
  root: string,
  part: (typeof PRODUCTION_PARTS)[number],
): Promise<{ promptPath: string; prompt: string; source: 'recorded' | 'template-fallback' }> {
  const promptPath = join(root, 'prompts', `${part.id}.txt`)
  try {
    const prompt = (await readFile(promptPath, 'utf8')).trimEnd()
    if (prompt === '') throw new Error(`Recorded production prompt is empty: ${promptPath}`)
    return { promptPath, prompt, source: 'recorded' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return {
      promptPath,
      prompt: part.visible
        ? buildPartPrompt(part)
        : `Explicit optional-slot none candidate for ${part.id}: deterministic fully transparent RGBA layer; no generated pixels.`,
      source: 'template-fallback',
    }
  }
}

function rigPrompt(rig: RichRig): string {
  return `ROLE LABELS — Image 1 is STYLE REFERENCE ONLY: use only bright rounded tactile friendly 3D-cartoon language; do not copy its creature identity, palette, markings, face or silhouette.\nCreate one 2048x2048 unlabelled 2x2 candidate sheet for locked rig base ${rig.sourceId} (${rig.displayName}), exactly four featureless low-detail body bases. Preserve 3/4 front view, creature-eye-level 50mm-equivalent camera, upper-left soft key, broad front fill and generous safe margins. No eyes, mouth, limbs, tail, appendages, markings, props, text, logo, watermark, shadow, gore or photoreal anatomy. Every background pixel and gap must be perfectly uniform opaque chroma key #00FF00 with no gradient, texture, checkerboard or green subject detail.`
}

function visualSemanticTraits(): RichSemanticTrait[] {
  const grouped = new Map<string, typeof PRODUCTION_PARTS>()
  for (const part of PRODUCTION_PARTS) {
    if (part.semanticTraitId === null) continue
    const values = grouped.get(part.semanticTraitId) ?? []
    values.push(part)
    grouped.set(part.semanticTraitId, values)
  }
  return [...grouped.entries()].map(([id, sourceParts]) => {
    const first = sourceParts[0]!
    const semanticSlotId = semanticSlotByVisual[first.slotId]
    if (semanticSlotId === null) throw new Error(`No semantic slot mapping for ${first.id}`)
    return {
      id,
      semanticSlotId,
      displayName: first.displayName,
      flavorText: first.flavorText,
      rarity: sourceParts.some(part => part.rarity === 'R') ? 'R' : 'N',
      themeBoosts: Object.fromEntries([...new Set(sourceParts.flatMap(part => part.themeIds))].map(themeId => [themeId, 1.1])),
      excludes: [...new Set(sourceParts.flatMap(part => part.excludes))],
      boosts: {},
      visualMapping: { sourcePartIds: sourceParts.map(part => part.id), sourceSlots: [...new Set(sourceParts.map(part => part.slotId))] },
    }
  })
}

async function optionalJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

/** Loads only committed runtime catalog data; it never reads ignored source-production files. */
export async function loadCommittedProductionCatalog(
  options: { repositoryRoot?: string, version: string },
): Promise<ProductionCatalogBundle> {
  const root = options.repositoryRoot ?? '.'
  const paths = productionPaths(options.version)
  const directory = join(root, paths.catalogDirectory)
  const [catalog, themes, rigs, parts, semanticTraits, modifiers, sourceIndex] = await Promise.all([
    readJson<Catalog>(join(directory, 'catalog.json')),
    readJson<RichTheme[]>(join(directory, 'themes.json')),
    readJson<RichRig[]>(join(directory, 'rigs.json')),
    readJson<RichPart[]>(join(directory, 'parts.json')),
    readJson<RichSemanticTrait[]>(join(directory, 'semantic-traits.json')),
    readJson<RichModifier[]>(join(directory, 'modifiers.json')),
    readJson<Record<string, unknown>>(join(root, paths.sourceIndexPath)),
  ])
  return { catalog, themes, rigs, parts, semanticTraits, modifiers, sourceIndex }
}

export async function buildProductionCatalog(options: { write: boolean, version: string }): Promise<ProductionCatalogBundle> {
  if (options.version === '0.3.0') {
    const paths = productionPaths(options.version)
    let manifestInput: unknown
    try {
      manifestInput = await readJson(join(paths.sourceRoot, 'interface-manifest.json'))
    } catch {
      throw new Error('INTERFACE_SOURCE_MANIFEST_MISSING: asset-source/v0.3.0/interface-manifest.json is required')
    }
    const manifest = parseInterfaceSourceManifest(manifestInput)
    if (!manifest.ok) throw new Error(`INTERFACE_SOURCE_MANIFEST_INVALID: ${JSON.stringify(manifest.diagnostics)}`)
    let processed: {
      processedAssets: Record<string, ProcessedInterfaceAsset>
      processedBridges: Record<string, ProcessedInterfaceBridge>
      sourceIndex: Record<string, unknown>
    }
    try {
      processed = await readJson(join(paths.sourceRoot, 'production', 'processed-index.json'))
    } catch {
      throw new Error('INTERFACE_PRODUCTION_ASSET_MISSING: asset-source/v0.3.0/production/processed-index.json is required after production art processing')
    }
    validateInterfaceSourceIndex(manifest.value, processed.sourceIndex)
    const base = await loadCommittedProductionCatalog({ version: '0.2.0' })
    const catalog = buildInterfaceCatalog({
      baseCatalog: base.catalog,
      manifest: manifest.value,
      processedAssets: processed.processedAssets,
      processedBridges: processed.processedBridges,
    })
    const bundle: ProductionCatalogBundle = {
      catalog,
      themes: catalog.themes,
      rigs: catalog.rigs,
      parts: catalog.parts,
      semanticTraits: catalog.semanticTraits,
      modifiers: catalog.modifiers,
      sourceIndex: processed.sourceIndex,
    }
    if (options.write) {
      await writeJson(join(paths.catalogDirectory, 'themes.json'), bundle.themes)
      await writeJson(join(paths.catalogDirectory, 'rigs.json'), bundle.rigs)
      await writeJson(join(paths.catalogDirectory, 'parts.json'), bundle.parts)
      await writeJson(join(paths.catalogDirectory, 'semantic-traits.json'), bundle.semanticTraits)
      await writeJson(join(paths.catalogDirectory, 'modifiers.json'), bundle.modifiers)
      await writeJson(join(paths.catalogDirectory, 'catalog.json'), bundle.catalog)
      await writeJson(paths.sourceIndexPath, bundle.sourceIndex)
      await writeJson(join(paths.auditDirectory, 'evidence-manifest.json'), buildProductionEvidenceManifest(bundle.sourceIndex))
    }
    return bundle
  }
  const paths = productionPaths(options.version)
  const { catalogDirectory, assetDirectory, sourceRoot } = paths
  const productionIndexPath = join(sourceRoot, 'generation', 'production-index.json')
  const reviewRecordPath = join(paths.reviewDirectory, options.version === '0.2.0' ? 'rework-record.json' : 'review-record.json')
  const rigAuditPath = join(sourceRoot, 'generation', 'rig-audit.json')
  const productionIndex = JSON.parse(await readFile(productionIndexPath, 'utf8')) as ProductionIndexEntry[]
  const rigAudits = await readJson<RigSheetAudit[]>(rigAuditPath)
  const compositionManifest = options.version === '0.2.0'
    ? await readJson<CompositionManifest>(join(sourceRoot, 'composition-manifest.json'))
    : null
  const junctionCalibration = compositionManifest === null
    ? null
    : await calibrateCatalogJunctions(sourceRoot, assetDirectory)
  if (productionIndex.length !== 55) throw new Error(`Expected 55 production entries, received ${productionIndex.length}`)
  if (rigAudits.length !== 3) throw new Error(`Expected 3 rig audit entries, received ${rigAudits.length}`)
  const indexed = new Map(productionIndex.map(entry => [entry.id, entry]))

  const parts: RichPart[] = await Promise.all(PRODUCTION_PARTS.map(async part => {
    const source = indexed.get(part.id)
    if (source === undefined) throw new Error(`Missing production source for ${part.id}`)
    const assetPath = `parts/${part.id}.webp`
    const pngPath = `parts/${part.id}.png`
    if (await sha256File(join(assetDirectory, assetPath)) !== source.webpSha256) throw new Error(`WebP hash drift for ${part.id}`)
    if (await sha256File(join(assetDirectory, pngPath)) !== source.pngSha256) throw new Error(`PNG hash drift for ${part.id}`)
    const paletteMaskAudit = source.paletteMaskAudit
    if (part.slotId === 'colorScheme' && paletteMaskAudit === undefined) throw new Error(`Missing rig-aware palette-mask audit for ${part.id}`)
    const rigMaskPaths = paletteMaskAudit === undefined ? undefined : Object.fromEntries(
      Object.entries(paletteMaskAudit.rigMasks).map(([rigId, value]) => [rigId, {
        primary: runtimeAssetPath(value.paths.primary, assetDirectory),
        secondary: runtimeAssetPath(value.paths.secondary, assetDirectory),
        accent: runtimeAssetPath(value.paths.accent, assetDirectory),
      }]),
    )
    const rigMaskSha256 = paletteMaskAudit === undefined ? undefined : Object.fromEntries(
      Object.entries(paletteMaskAudit.rigMasks).map(([rigId, value]) => [rigId, value.sha256]),
    )
    const compatibleRigs = options.version === '0.2.0' && part.id === 'surface_short_fur'
      ? rigs.map(rig => rig.id)
      : part.compatibleRigs
    const composition = compositionManifest === null ? undefined : await compositionForPart({
      part,
      compatibleRigs,
      sourceRoot,
      assetDirectory,
      pngSha256: source.pngSha256,
      webpSha256: source.webpSha256,
      calibration: junctionCalibration!,
    })
    return {
      id: part.id,
      displayName: part.displayName,
      flavorText: part.flavorText,
      description: part.description,
      slotId: part.slotId,
      rarity: part.rarity,
      baseWeight: part.baseWeight,
      themeIds: part.themeIds,
      themeWeights: Object.fromEntries(part.themeIds.map(themeId => [themeId, 1.15])),
      compatibleRigs,
      assetPath,
      assetSha256: source.webpSha256,
      pngPath,
      pngSha256: source.pngSha256,
      ...(composition === undefined ? { approvedTransforms: [{ scale: 1, mirrorX: false }] } : { composition }),
      maskPaths: {},
      ...(rigMaskPaths === undefined ? {} : { rigMaskPaths, rigMaskSha256 }),
      origin: part.origin,
      socket: part.socket,
      layer: part.layer,
      semanticTraitId: part.semanticTraitId,
      semanticPriority: part.semanticPriority,
      excludes: part.excludes,
      boosts: part.boosts,
    }
  }))

  const semanticTraits = [...visualSemanticTraits(), ...semanticOnlyTraits]
  const catalog = {
    version: options.version,
    themes,
    rigs,
    parts,
    semanticTraits,
    modifiers,
    dependencies: {
      bodyFrame: ['headShape', 'eyes', 'mouthShape', 'oralDetail', 'headAppendage', 'arms', 'legs', 'tail', 'extraAppendage', 'surfaceMaterial', 'pattern', 'colorScheme', 'effect'],
      headShape: ['eyes', 'mouthShape', 'oralDetail', 'headAppendage'],
      mouthShape: ['oralDetail'],
    },
    ...(compositionManifest === null ? {} : { compositionPolicy: compositionManifest.policy }),
  } satisfies Catalog

  const review = await optionalJson(reviewRecordPath) ?? {
    status: 'pending-contact-sheet-review',
    reviewedAt: null,
    reviewer: null,
    contactSheets: [],
  }
  const reworkRecordSha256 = options.version === '0.2.0' && review.status === 'approved'
    ? await sha256File(reviewRecordPath)
    : null
  const partSources = await Promise.all(PRODUCTION_PARTS.map(async part => {
    const source = indexed.get(part.id)!
    const resolvedPrompt = await resolveProductionPrompt(sourceRoot, part)
    const prompt = resolvedPrompt.prompt
    const selectedCandidate = source.candidates?.find(candidate => candidate.index === source.selected)
    const candidateEvaluations = source.candidates === undefined
      ? source.evaluatedVariants?.map((variant, index) => ({ index: index + 1, selected: index === 0, machineApproved: true, value: variant }))
      : await Promise.all(source.candidates.map(async candidate => {
        const metadata = await sharp(candidate.sourcePath).metadata()
        if (metadata.width === undefined || metadata.height === undefined) throw new Error(`Cannot audit candidate dimensions: ${candidate.sourcePath}`)
        const extraction = canonicalExtractionAudit(
          candidate.extraction,
          { width: metadata.width, height: metadata.height },
          candidate.sourcePath,
          candidate.rgbaPath,
        )
        const { approved, ...extractionEvidence } = extraction
        return {
          index: candidate.index,
          selected: candidate.index === source.selected,
          machineApproved: approved,
          reviewDecision: candidate.index === source.selected
            ? `approved: selected after four-way visual and machine comparison; ${source.rejectionSummary ?? 'best compatible candidate.'}`
            : `rejected: ${source.rejectionSummary ?? 'not selected after four-way visual and machine comparison.'}`,
          ...extractionEvidence,
          composition: normalizeAuditPaths(source.candidateCompositions?.find(composition => composition.index === candidate.index) ?? null),
        }
      }))
    const selectedEvaluation = candidateEvaluations?.find(candidate => candidate.selected)
    let componentEvaluations: unknown = null
    if (source.postProcess === 'head-shell-lure-composite-v1' && source.componentEvaluations !== undefined) {
      const raw = source.componentEvaluations as Record<'shell' | 'lure', Array<{ index: number; extraction: ProductionExtractionAudit }>>
      componentEvaluations = Object.fromEntries(await Promise.all((['shell', 'lure'] as const).map(async role => {
        const samplePath = join(sourceRoot, 'generation', 'part-components', 'head_angler_bulb', role, `head_angler_bulb-${role}-candidate-1-source.png`)
        const metadata = await sharp(samplePath).metadata()
        if (metadata.width === undefined || metadata.height === undefined) throw new Error(`Cannot audit angler ${role} dimensions.`)
        return [role, raw[role].map(value => ({
          ...value,
          extraction: canonicalExtractionAudit(
            value.extraction,
            { width: metadata.width!, height: metadata.height! },
            join(sourceRoot, 'generation', 'part-components', 'head_angler_bulb', role, `head_angler_bulb-${role}-candidate-${value.index}-source.png`),
            join(sourceRoot, 'generation', 'part-components', 'head_angler_bulb', role, `head_angler_bulb-${role}-candidate-${value.index}-rgba.png`),
          ),
        }))]
      })))
    }
    return {
      sourceId: part.id,
      kind: part.visible ? 'generated-slot-layer' : 'explicit-none-layer',
      slotId: part.slotId,
      lockedBaseId: `base_${part.rigId}_v1`,
      compatibleRigs: part.compatibleRigs,
      generationTool: part.visible
        ? source.generationMode ?? 'Codex built-in image_gen on uniform chroma key + deterministic local extraction'
        : 'Sharp deterministic transparent RGBA',
      generationMode: source.generationMode ?? null,
      referenceEvidence: normalizeAuditPaths(source.referenceEvidence ?? null),
      generationPath: source.sourceSheet === undefined ? null : normalizePath(source.sourceSheet),
      sheetPath: source.sheetPath === undefined ? null : normalizePath(source.sheetPath),
      sheetSha256: source.sheetSha256 ?? null,
      promptPath: normalizePath(resolvedPrompt.promptPath),
      promptSha256: sha256Text(prompt),
      prompt,
      slotMaskPath: `${sourceRoot}/guides/${part.rigId}-${part.slotId}.png`,
      chosenVariant: source.selected,
      attempt: source.attempt ?? 'deterministic-none',
      rejectionSummary: source.rejectionSummary ?? 'Four explicit none variants are identical by definition.',
      postProcess: source.postProcess ?? 'deterministic-transparent-none-v1',
      composition: normalizeAuditPaths(source.composition ?? null),
      componentEvaluations: normalizeAuditPaths(componentEvaluations),
      paletteMaskAudit: normalizeAuditPaths(source.paletteMaskAudit ?? null),
      candidateEvaluations,
      selectedExtraction: selectedCandidate === undefined || selectedEvaluation === undefined ? null : {
        gateVersion: selectedEvaluation.gateVersion,
        imageSize: selectedEvaluation.imageSize,
        sourcePath: selectedEvaluation.sourcePath,
        processedPath: selectedEvaluation.processedPath,
        approved: selectedEvaluation.machineApproved,
        diagnostics: selectedEvaluation.diagnostics,
        metrics: selectedEvaluation.metrics,
        thresholds: selectedEvaluation.thresholds,
        sourceSha256: selectedEvaluation.sourceSha256,
        processedSha256: selectedEvaluation.processedSha256,
      },
      masterPath: normalizePath(source.master?.masterPath ?? source.masterPath!),
      masterSha256: source.master?.sha256 ?? source.masterSha256,
      runtimePngPath: normalizePath(source.pngPath),
      runtimePngSha256: source.pngSha256,
      runtimeWebpPath: normalizePath(source.webpPath),
      runtimeWebpSha256: source.webpSha256,
      reworkRecordPath: reworkRecordSha256 === null ? null : normalizePath(reviewRecordPath),
      reworkRecordSha256,
    }
  }))

  const rigSources = await Promise.all(rigs.map(async rig => {
    const provenance = rigSheetProvenance[rig.sourceId]
    const audit = rigAudits.find(candidate => candidate.sourceId === rig.sourceId)
    if (audit === undefined) throw new Error(`Missing rig audit for ${rig.sourceId}`)
    const sheetPath = `${sourceRoot}/${audit.sheetPath}`
    const masterPath = `${sourceRoot}/${audit.master.masterPath}`
    const runtimePngPath = `${assetDirectory}/${audit.runtimePngPath}`
    const runtimeWebpPath = `${assetDirectory}/${audit.runtimeWebpPath}`
    const prompt = rigPrompt(rig)
    const sheetMetadata = await sharp(sheetPath).metadata()
    if (sheetMetadata.width === undefined || sheetMetadata.height === undefined) throw new Error(`Cannot audit rig sheet dimensions: ${sheetPath}`)
    const candidateWidth = Math.floor(sheetMetadata.width / 2)
    const candidateHeight = Math.floor(sheetMetadata.height / 2)
    const candidateEvaluations = audit.candidateEvaluations.map(candidate => {
      const extraction = canonicalExtractionAudit(
        candidate.extraction,
        { width: candidateWidth, height: candidateHeight },
        join(sourceRoot, 'generation', 'rig-candidates', rig.sourceId, `${rig.sourceId}-candidate-${candidate.index}-source.png`),
        join(sourceRoot, 'generation', 'rig-candidates', rig.sourceId, `${rig.sourceId}-candidate-${candidate.index}-rgba.png`),
      )
      const { approved, ...extractionEvidence } = extraction
      return {
        index: candidate.index,
        selected: candidate.selected,
        machineApproved: approved,
        reviewDecision: candidate.selected ? 'approved: selected after four-way visual and machine comparison.' : `rejected: ${provenance.rejected}`,
        ...extractionEvidence,
      }
    })
    const selectedEvaluation = candidateEvaluations.find(candidate => candidate.selected)!
    return {
      sourceId: rig.sourceId,
      kind: 'rig-base',
      rigId: rig.id,
      generationTool: 'Codex built-in image_gen on uniform chroma key + deterministic local extraction',
      generationPath: sheetPath,
      sheetPath,
      sheetSha256: audit.sheetSha256,
      promptPath: `${sourceRoot}/prompts/${rig.sourceId}.txt`,
      promptSha256: sha256Text(prompt),
      prompt,
      chosenVariant: provenance.selected,
      rejectedVariants: provenance.rejected,
      candidateEvaluations,
      selectedExtraction: {
        gateVersion: selectedEvaluation.gateVersion,
        imageSize: selectedEvaluation.imageSize,
        sourcePath: selectedEvaluation.sourcePath,
        processedPath: selectedEvaluation.processedPath,
        approved: selectedEvaluation.machineApproved,
        diagnostics: selectedEvaluation.diagnostics,
        metrics: selectedEvaluation.metrics,
        thresholds: selectedEvaluation.thresholds,
        sourceSha256: selectedEvaluation.sourceSha256,
        processedSha256: selectedEvaluation.processedSha256,
      },
      masterPath,
      masterSha256: audit.master.sha256,
      runtimePngPath,
      runtimePngSha256: audit.runtimePngSha256,
      runtimeWebpPath,
      runtimeWebpSha256: audit.runtimeWebpSha256,
    }
  }))

  const partCandidateEvaluations = productionIndex.flatMap(entry => entry.candidates ?? [])
  const rigCandidateEvaluations = rigAudits.flatMap(audit => audit.candidateEvaluations)

  const sourceIndex: Record<string, unknown> = {
    catalogVersion: options.version,
    pipelineVersion: 'chroma-extraction-v2-independent-edge',
    extractionGate: {
      gateVersion: PRODUCTION_CHROMA_GATE_VERSION,
      profile: PRODUCTION_CHROMA_GATE_PROFILE,
    },
    immutablePromptTemplateSha256: sha256Text(buildPartPrompt(PRODUCTION_PARTS[0]!).replace(PRODUCTION_PARTS[0]!.slotId, '{slotId}').replace(PRODUCTION_PARTS[0]!.description, '{partDescription}')),
    generationSummary: {
      traceableRigSheets: 3,
      traceableRigVariants: 12,
      approvedRigBases: 3,
      traceableVisiblePartSheets: 51,
      traceableVisiblePartVariants: 204,
      approvedVisiblePartVariants: 51,
      machineRejectedTraceableVisiblePartVariants: partCandidateEvaluations.filter(candidate => !candidate.extraction.approved).length,
      explicitNoneCandidates: 4,
      explicitNoneEvaluations: 16,
      catalogVisualCandidates: 55,
      traceableCompositeComponentVariants: 8,
    },
    qualityGateSummary: {
      rigCandidatesEvaluated: rigCandidateEvaluations.length,
      rigCandidatesPassed: rigCandidateEvaluations.filter(candidate => candidate.machineApproved).length,
      partCandidatesEvaluated: partCandidateEvaluations.length,
      partCandidatesPassed: partCandidateEvaluations.filter(candidate => candidate.extraction.approved).length,
      approvedRigSelectionsPassing: rigAudits.filter(audit => audit.selectedExtraction.approved).length,
      approvedPartSelectionsPassing: productionIndex.filter(entry => {
        if (!entry.visible) return false
        return entry.candidates?.find(candidate => candidate.index === entry.selected)?.extraction.approved === true
      }).length,
    },
    review,
    sources: [...rigSources, ...partSources],
  }

  if (options.write) {
    await writeJson(join(catalogDirectory, 'themes.json'), themes)
    await writeJson(join(catalogDirectory, 'rigs.json'), rigs)
    await writeJson(join(catalogDirectory, 'parts.json'), parts)
    await writeJson(join(catalogDirectory, 'semantic-traits.json'), semanticTraits)
    await writeJson(join(catalogDirectory, 'modifiers.json'), modifiers)
    await writeJson(join(catalogDirectory, 'catalog.json'), catalog)
    await writeJson(paths.sourceIndexPath, sourceIndex)
    await writeJson(
      join(paths.auditDirectory, 'evidence-manifest.json'),
      buildProductionEvidenceManifest(sourceIndex),
    )
    await mkdir(join(sourceRoot, 'prompts'), { recursive: true })
    for (const part of PRODUCTION_PARTS) {
      const resolvedPrompt = await resolveProductionPrompt(sourceRoot, part)
      if (resolvedPrompt.source === 'template-fallback') {
        await writeFile(resolvedPrompt.promptPath, `${resolvedPrompt.prompt}\n`)
      }
    }
    for (const rig of rigs) await writeFile(join(sourceRoot, 'prompts', `${rig.sourceId}.txt`), `${rigPrompt(rig)}\n`)
  }

  return { catalog, themes, rigs, parts, semanticTraits, modifiers, sourceIndex }
}

if (process.argv[1]?.endsWith('build-production-catalog.ts')) {
  const versionFlag = process.argv.indexOf('--version')
  const version = versionFlag === -1 ? undefined : process.argv[versionFlag + 1]
  if (versionFlag === -1 || version === undefined || version.startsWith('--') || process.argv.length !== 4) {
    throw new Error('Usage: tsx scripts/build-production-catalog.ts --version <release-version>')
  }
  const bundle = await buildProductionCatalog({ write: true, version })
  console.log(JSON.stringify({
    parts: bundle.parts.length,
    semanticOnly: bundle.semanticTraits.filter(trait => trait.semanticSlotId === 'personality' || trait.semanticSlotId === 'quirk').length,
    modifiers: bundle.modifiers.length,
  }))
}
