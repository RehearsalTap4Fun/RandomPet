import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import type { Catalog, RenderLayer, VisualSlotId } from '@qmonster/generator-core'
import { buildProductionEvidenceManifest } from '../packages/asset-catalog/src/evidence-root.js'
import { PRODUCTION_CHROMA_GATE_PROFILE, PRODUCTION_CHROMA_GATE_VERSION } from '../packages/asset-catalog/src/chroma-quality-gate.js'
import {
  prepareV06FelineAssets,
  V06_SOURCE_FILENAMES,
  type V06FelineAssetProvenance,
  type V06SourceFilename,
} from './prepare-v06-feline-assets.js'

export const V06_FELINE_RIG_ID = 'feline-sit' as const
export const V06_INTEGRATED_PART_IDS = {
  arms: 'arms_feline_integrated',
  legs: 'legs_feline_integrated',
  extraAppendage: 'extra_feline_none',
} as const

const VERSION = '0.6.0'
const ASSET_PREFIX = `assets/v${VERSION}/`
const PROMPT_PATH = 'asset-source/v0.6.0/prompts/feline-prompts.json'
const REVIEW_PATH = 'packages/asset-catalog/review/v0.6.0/review-record.json'
const COMMON_PROMPT = `Use case: stylized-concept
Asset type: modular 2048×2048 game character source layer
Style/medium: original tactile 3D plush rendering; friendly strange-creature polish; do not copy any existing character.
Composition/framing: square 2048×2048 registration for a front-facing centered seated cat; isolate only the named source layer with generous transparent margin.
Constraints: genuinely transparent background with preserved alpha; no text, props, background, floor, cast shadow, copied characters, extra limbs, wings, duplicate heads, detached objects, watermark, checkerboard or fake transparency; preserve the named connector guide and source layer boundary.`

const REQUESTS: Record<V06SourceFilename, string> = {
  'body_feline_sit_round-source.png': 'Create the complete continuous rounded seated-cat body-frame layer: one torso, exactly two integrated front paws and exactly two integrated rear paws, no head and no visible tail. Preserve the occupied neck receiver at upper center and tailRoot receiver on the side-rear boundary. Exactly one connected alpha component.',
  'body_feline_sit_plush-source.png': 'Create the same complete continuous seated-cat anatomy with a longer fluffy fur silhouette: one torso, four integrated paws, no head and no visible tail. Preserve the occupied neck receiver and tailRoot receiver. Exactly one connected alpha component.',
  'head_feline_round-source.png': 'Create one complete round cat head with exactly two triangular ears and no body. Preserve one occupied neck plug at lower center and a broad face-safe zone. Exactly one connected alpha component.',
  'head_feline_tufted-source.png': 'Create one complete slightly tufted cat head with exactly two triangular ears and no body. Preserve one occupied neck plug at lower center and a broad face-safe zone. Exactly one connected alpha component with connected tufts.',
  'tail_feline_long-source.png': 'Create one long continuous plush cat tail only, gently curved, with one occupied tailRoot plug at the lower-left end. Exactly one connected alpha component; no body or detached tip.',
  'tail_feline_curl-source.png': 'Create one long continuous plush cat tail only, curling naturally into a loose C curve, with one occupied tailRoot plug at the lower-left end. Exactly one connected alpha component; no body or detached tip.',
  'tail_feline_star_tip-source.png': 'Create one continuous plush cat tail only with one occupied tailRoot plug and one small integrated star-like luminous tuft at the tailTip anchor. Exactly one connected alpha component; glow stays attached.',
  'eyes_feline_round-source.png': 'Create one matched pair of round glossy plush-toy cat eyes only, aligned to the eyes socket guide, with a coherent friendly gaze and no head.',
  'eyes_feline_sleepy-source.png': 'Create one matched pair of sleepy half-closed embroidered cat eyes only, aligned to the eyes socket guide, with no head.',
  'eyes_feline_wide-source.png': 'Create one matched pair of wide curious glossy cat eyes only, aligned to the eyes socket guide, with a coherent gaze and no head.',
  'mouth_feline_smile-source.png': 'Create one small plush cat muzzle-and-smile layer only, aligned to the mouth socket guide, with no head, eyes, or detached teeth.',
  'mouth_feline_pout-source.png': 'Create one small plush cat muzzle-and-pout layer only, aligned to the mouth socket guide, with no head, eyes, or detached teeth.',
  'oral_feline_none-source.png': 'Create an intentionally empty oral-detail registration layer for the oralDetail socket guide: a fully transparent canvas with no visible mark.',
  'ear_crystal_rim-source.png': 'Create one subtle paired crystal-fleck ear-rim trim layer only at the ear anchor, protecting the face-safe zone, with no head fill, body, third ear, or free-floating crystals.',
  'surface_feline_short_fur-source.png': 'Create a short-fur tactile surface layer only, shaped to the continuous torso, four-paw and head-safe feline mask, with no independent creature outside that mask.',
  'surface_feline_moss_back-source.png': 'Create a small controlled mossy plush growth layer only at the back anchor, attached to and within the feline body mask, with no face coverage or free-floating moss.',
  'pattern_feline_tabby-source.png': 'Create a soft tabby stripe pattern layer only within the feline head-and-body mask, leaving the face-safe zone readable.',
  'pattern_feline_spots-source.png': 'Create a restrained rounded spot pattern layer only within the feline head-and-body mask, leaving the face-safe zone readable.',
  'color_feline_deep_sea-source.png': 'Create a deep-sea palette wash layer only within the feline mask: midnight blue primary, teal secondary, and small coral accent.',
  'color_feline_fungal-source.png': 'Create a fungal palette wash layer only within the feline mask: moss green primary, warm amber secondary, and soft cream accent.',
  'color_feline_shadow-source.png': 'Create a shadow palette wash layer only within the feline mask: deep violet primary, smoky plum secondary, and pale gold accent.',
  'effect_feline_none-source.png': 'Create an intentionally empty effect registration layer for the effect socket guide: a fully transparent canvas with no visible mark.',
}

const GENERATED_CANDIDATE_IDS: Record<V06SourceFilename, string> = {
  'body_feline_sit_round-source.png': 'exec-915e9b6f-f26b-43d9-81c0-7b1d7f7be576.png',
  'body_feline_sit_plush-source.png': 'exec-cc57cafe-0d12-4b5b-93da-fd2f33ff7163.png',
  'head_feline_round-source.png': 'exec-d0e58921-98da-41c4-91e6-9e3f7cd2abc9.png',
  'head_feline_tufted-source.png': 'exec-6c62a8dc-24c7-490c-aead-7deb23e72f2e.png',
  'tail_feline_long-source.png': 'exec-34dcf343-6e54-49fa-8839-7efa0067c69e.png',
  'tail_feline_curl-source.png': 'exec-7dd23d01-0e10-4709-b2be-6cc19172b17d.png',
  'tail_feline_star_tip-source.png': 'exec-2c58bf27-878d-4526-92b9-fe231b3e50cb.png',
  'eyes_feline_round-source.png': 'exec-007b64d0-eab6-4994-8811-a01d32774e02.png',
  'eyes_feline_sleepy-source.png': 'exec-19ec4585-007b-43e0-be8d-89316d53bc51.png',
  'eyes_feline_wide-source.png': 'exec-85bd8ea8-b934-47ef-abd5-42724eb80250.png',
  'mouth_feline_smile-source.png': 'exec-22d4a2b6-0356-417f-a702-0cb5686d470b.png',
  'mouth_feline_pout-source.png': 'exec-c89975b3-094e-4842-be34-5a1f8ace8e58.png',
  'oral_feline_none-source.png': 'exec-487518e2-290f-47a4-88dc-87c99cddcd39.png',
  'ear_crystal_rim-source.png': 'exec-9c7ed4ff-9772-47df-84bc-10ae319b1014.png',
  'surface_feline_short_fur-source.png': 'exec-2ca9ded4-649e-4ac3-9922-89c8f7cf6b8d.png',
  'surface_feline_moss_back-source.png': 'exec-0810d952-eca6-4a1f-beff-cde5731c83ae.png',
  'pattern_feline_tabby-source.png': 'exec-b30f483d-70f5-4a6f-8d42-cc92f45969be.png',
  'pattern_feline_spots-source.png': 'exec-e594dcdb-daa2-4da0-9400-5981fa8a2e2d.png',
  'color_feline_deep_sea-source.png': 'exec-158f88f7-fa39-4d99-bb20-584ea62c2b34.png',
  'color_feline_fungal-source.png': 'exec-4509e8b4-c905-44c7-87a2-be982e4d3b6c.png',
  'color_feline_shadow-source.png': 'exec-87b94c62-0b26-4dfd-bff1-2a43e0dee213.png',
  'effect_feline_none-source.png': 'exec-354fe6e2-01ac-4ba9-b70d-78574fcc2ebd.png',
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function prettyJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

async function writeNew(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function portable(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

function runtimePortable(assetRoot: string, path: string): string {
  return `${ASSET_PREFIX}${portable(assetRoot, path)}`
}

function assetById(assets: V06FelineAssetProvenance[]): Map<string, V06FelineAssetProvenance> {
  return new Map(assets.map(asset => [asset.partId, asset]))
}

function commonPart(id: string, slotId: VisualSlotId, asset: V06FelineAssetProvenance, assetRoot: string): any {
  const displayName = id.replaceAll('_', ' ')
  return {
    id,
    slotId,
    rarity: id.includes('moss') || id.includes('crystal') || id.includes('star_tip') ? 'R' : 'N',
    baseWeight: 1,
    themeIds: ['deep-sea', 'fungal', 'shadow'],
    themeWeights: { 'deep-sea': 1, fungal: 1, shadow: 1 },
    compatibleRigs: [V06_FELINE_RIG_ID],
    assetPath: runtimePortable(assetRoot, asset.runtimeWebpPath),
    assetSha256: asset.runtimeWebpSha256,
    pngPath: runtimePortable(assetRoot, asset.runtimePngPath),
    pngSha256: asset.runtimePngSha256,
    maskPaths: {},
    origin: { x: 1024, y: 1024 },
    socket: null,
    layer: 'body',
    semanticTraitId: null,
    semanticPriority: 1,
    excludes: [],
    boosts: {},
    displayName,
    flavorText: `${displayName}稳稳贴合坐姿猫的完整轮廓。`,
    description: `original feline-sit production layer for ${id}`,
    archetypeIds: ['feline'],
    featureTier: 'base',
  }
}

function connectorProfile(asset: V06FelineAssetProvenance, connectorId: 'neck' | 'tailRoot', role: 'receiver' | 'plug', assetRoot: string): any {
  const mask = asset.connectorMasks.find(candidate => candidate.id === connectorId)
  if (mask === undefined) throw new Error(`V06_CONNECTOR_MASK_MISSING:${asset.partId}:${connectorId}`)
  return {
    id: connectorId,
    role,
    connectorClass: connectorId === 'neck' ? 'neck' : 'tail',
    rigId: V06_FELINE_RIG_ID,
    origin: mask.origin,
    tangent: { x: 1, y: 0 },
    outwardNormal: mask.outwardNormal,
    width: mask.width,
    depth: mask.depth,
    contourMaskPath: runtimePortable(assetRoot, mask.contourPath),
    contourMaskSha256: mask.contourSha256,
    foregroundMaskPath: runtimePortable(assetRoot, mask.foregroundPath),
    foregroundMaskSha256: mask.foregroundSha256,
    backgroundMaskPath: runtimePortable(assetRoot, mask.backgroundPath),
    backgroundMaskSha256: mask.backgroundSha256,
    materialSampleRegion: { x: Math.max(0, mask.origin.x - 24), y: Math.max(0, mask.origin.y - 24), width: 48, height: 48 },
    warpLimits: {
      widthRatio: { min: 0.9, max: 1.1 },
      depthRatio: { min: 0.9, max: 1.1 },
      rotationDegrees: { min: -8, max: 8 },
    },
  }
}

function structuralPart(asset: V06FelineAssetProvenance, assetRoot: string): any {
  const isBody = asset.partId.startsWith('body_')
  const isHead = asset.partId.startsWith('head_')
  const slotId = isBody ? 'bodyFrame' : isHead ? 'headShape' : 'tail'
  const part = commonPart(asset.partId, slotId, asset, assetRoot)
  part.socket = isBody ? null : isHead ? 'head' : 'tail'
  part.layer = isBody ? 'body' : isHead ? 'head' : 'rearAppendage'
  part.semanticTraitId = isBody ? 'frame_feline_sit' : isHead ? 'head_feline_complete' : 'appendage_feline_tail'
  if (asset.partId === 'tail_feline_star_tip') {
    part.featureTier = 'special'
    part.specialFeatureAnchor = 'tailTip'
  }
  const node = {
    id: `${asset.partId}-feline-sit-node`,
    ...(isBody ? {} : { connectorId: isHead ? 'neck' : 'tailRoot' }),
    assetPath: part.assetPath,
    pngPath: part.pngPath,
    assetSha256: part.assetSha256,
    pngSha256: part.pngSha256,
    parentSlot: isBody ? null : 'bodyFrame',
    socket: isBody ? null : isHead ? 'head' : 'tail',
    origin: { x: 1024, y: 1024 },
    transform: { scale: 1, mirrorX: false },
    layer: part.layer,
    compatibleRigs: [V06_FELINE_RIG_ID],
    clipPolicy: 'none',
  }
  part.composition = {
    mode: 'interface',
    isNone: false,
    motifTags: ['deep-sea', 'fungal', 'shadow'],
    visualIntensity: 'quiet',
    variantsByRig: {
      [V06_FELINE_RIG_ID]: {
        rigId: V06_FELINE_RIG_ID,
        materialFamily: asset.partId.includes('plush') ? 'mushroom-velvet' : 'short-fur',
        renderNodes: [node],
        connectors: isBody
          ? [connectorProfile(asset, 'neck', 'receiver', assetRoot), connectorProfile(asset, 'tailRoot', 'receiver', assetRoot)]
          : [connectorProfile(asset, isHead ? 'neck' : 'tailRoot', 'plug', assetRoot)],
        ...(isHead ? {
          faceSafeZones: [{ x: 600, y: 420, width: 848, height: 780 }],
          featureSockets: { eyes: { x: 1024, y: 760 }, mouth: { x: 1024, y: 960 }, headAppendage: { x: 1024, y: 420 } },
        } : {}),
      },
    },
  }
  return part
}

const ATTACHMENT: Record<string, { slotId: VisualSlotId, parentSlot: VisualSlotId, socket: string, layer: RenderLayer, clipPolicy: 'none' | 'body' | 'protect-face', semantic: string | null }> = {
  eyes_feline_round: { slotId: 'eyes', parentSlot: 'headShape', socket: 'eyes', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'head_feline_complete' },
  eyes_feline_sleepy: { slotId: 'eyes', parentSlot: 'headShape', socket: 'eyes', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'head_feline_complete' },
  eyes_feline_wide: { slotId: 'eyes', parentSlot: 'headShape', socket: 'eyes', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'head_feline_complete' },
  mouth_feline_smile: { slotId: 'mouthShape', parentSlot: 'headShape', socket: 'mouth', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'mouth_feline_soft' },
  mouth_feline_pout: { slotId: 'mouthShape', parentSlot: 'headShape', socket: 'mouth', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'mouth_feline_soft' },
  oral_feline_none: { slotId: 'oralDetail', parentSlot: 'mouthShape', socket: 'oralDetail', layer: 'faceAndHeadwear', clipPolicy: 'none', semantic: 'mouth_feline_soft' },
  ear_crystal_rim: { slotId: 'headAppendage', parentSlot: 'headShape', socket: 'headAppendage', layer: 'faceAndHeadwear', clipPolicy: 'protect-face', semantic: 'head_feline_complete' },
  surface_feline_short_fur: { slotId: 'surfaceMaterial', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'surface', clipPolicy: 'body', semantic: 'surface_feline_tactile' },
  surface_feline_moss_back: { slotId: 'surfaceMaterial', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'surface', clipPolicy: 'body', semantic: 'surface_feline_tactile' },
  pattern_feline_tabby: { slotId: 'pattern', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'pattern', clipPolicy: 'body', semantic: 'pattern_feline_markings' },
  pattern_feline_spots: { slotId: 'pattern', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'pattern', clipPolicy: 'body', semantic: 'pattern_feline_markings' },
  color_feline_deep_sea: { slotId: 'colorScheme', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'pattern', clipPolicy: 'body', semantic: 'pattern_feline_markings' },
  color_feline_fungal: { slotId: 'colorScheme', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'pattern', clipPolicy: 'body', semantic: 'pattern_feline_markings' },
  color_feline_shadow: { slotId: 'colorScheme', parentSlot: 'bodyFrame', socket: 'overlay', layer: 'pattern', clipPolicy: 'body', semantic: 'pattern_feline_markings' },
  effect_feline_none: { slotId: 'effect', parentSlot: 'bodyFrame', socket: 'effect', layer: 'foregroundEffect', clipPolicy: 'protect-face', semantic: null },
}

function attachmentPart(asset: V06FelineAssetProvenance, assetRoot: string): any {
  const definition = ATTACHMENT[asset.partId]
  if (definition === undefined) throw new Error(`V06_ATTACHMENT_DEFINITION_MISSING:${asset.partId}`)
  const part = commonPart(asset.partId, definition.slotId, asset, assetRoot)
  part.assetPath = portable(assetRoot, asset.runtimeWebpPath)
  part.pngPath = portable(assetRoot, asset.runtimePngPath)
  Object.assign(part, { socket: definition.socket, layer: definition.layer, semanticTraitId: definition.semantic })
  part.composition = {
    mode: 'attachment',
    isNone: asset.partId.endsWith('_none'),
    motifTags: asset.partId.endsWith('_none') ? [] : ['deep-sea', 'fungal', 'shadow'],
    visualIntensity: asset.partId.includes('moss') || asset.partId.includes('crystal') ? 'strong' : 'quiet',
    renderNodes: [{
      id: `${asset.partId}-node`,
      assetPath: part.assetPath,
      pngPath: part.pngPath,
      assetSha256: part.assetSha256,
      pngSha256: part.pngSha256,
      parentSlot: definition.parentSlot,
      socket: definition.socket,
      origin: { x: 1024, y: 1024 },
      transform: { scale: 1, mirrorX: false },
      layer: definition.layer,
      compatibleRigs: [V06_FELINE_RIG_ID],
      clipPolicy: definition.clipPolicy,
    }],
    geometryByRig: {},
  }
  if (asset.partId === 'ear_crystal_rim') {
    part.featureTier = 'special'
    part.specialFeatureAnchor = 'ear'
  }
  if (asset.partId === 'surface_feline_moss_back') {
    part.featureTier = 'special'
    part.specialFeatureAnchor = 'back'
  }
  if (definition.slotId === 'colorScheme') {
    const masks = Object.fromEntries(asset.paletteMasks.map(mask => [mask.role, runtimePortable(assetRoot, mask.path)]))
    const hashes = Object.fromEntries(asset.paletteMasks.map(mask => [mask.role, mask.sha256]))
    part.rigMaskPaths = { [V06_FELINE_RIG_ID]: masks }
    part.rigMaskSha256 = { [V06_FELINE_RIG_ID]: hashes }
  }
  return part
}

function integratedPart(slotId: keyof typeof V06_INTEGRATED_PART_IDS): any {
  const id = V06_INTEGRATED_PART_IDS[slotId]
  return {
    id, slotId, rarity: 'N', baseWeight: 1,
    themeIds: ['deep-sea', 'fungal', 'shadow'], themeWeights: { 'deep-sea': 1, fungal: 1, shadow: 1 },
    compatibleRigs: [V06_FELINE_RIG_ID], assetPath: '', maskPaths: {}, origin: { x: 1024, y: 1024 }, socket: null,
    layer: 'frontAppendage', semanticTraitId: null, semanticPriority: 0, excludes: [], boosts: {},
    displayName: id.replaceAll('_', ' '), flavorText: '四肢已经完整地长在猫的身体轮廓里。',
    description: `resource-empty integrated ${slotId} placeholder`, archetypeIds: ['feline'], featureTier: 'base',
    composition: { mode: 'attachment', isNone: true, motifTags: [], visualIntensity: 'quiet', renderNodes: [], geometryByRig: {} },
  }
}

function richSemantic(id: string, semanticSlotId: string, displayName: string): any {
  return { id, semanticSlotId, displayName, flavorText: `${displayName}让这只猫保持熟悉又微妙的性格。`, rarity: 'N', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: {} }
}

function richModifier(id: string, kind: 'mutation' | 'aberration', displayName: string): any {
  return { id, kind, baseWeight: 1, requiresMutation: false, overrides: {}, displayName, flavorText: `${displayName}只允许一个受控锚点变化。`, rarity: 'R', themeBoosts: {}, excludes: [], boosts: {}, visualMapping: {} }
}

async function createBridgeAssets(assetRoot: string): Promise<Record<'neck' | 'tail', any>> {
  const result = {} as Record<'neck' | 'tail', any>
  for (const connectorClass of ['neck', 'tail'] as const) {
    const rgba = Buffer.alloc(512 * 256 * 4)
    const front = Buffer.alloc(rgba.length)
    const back = Buffer.alloc(rgba.length)
    for (let y = 80; y < 176; y += 1) for (let x = 80; x < 432; x += 1) {
      const pixel = y * 512 + x
      const offset = pixel * 4
      rgba[offset] = connectorClass === 'neck' ? 176 : 128
      rgba[offset + 1] = 132
      rgba[offset + 2] = 196
      rgba[offset + 3] = 255
      const target = y < 128 ? front : back
      target[offset] = target[offset + 1] = target[offset + 2] = target[offset + 3] = 255
    }
    const png = await sharp(rgba, { raw: { width: 512, height: 256, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
    const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer()
    const frontPng = await sharp(front, { raw: { width: 512, height: 256, channels: 4 } }).png().toBuffer()
    const backPng = await sharp(back, { raw: { width: 512, height: 256, channels: 4 } }).png().toBuffer()
    const root = join(assetRoot, 'bridges', V06_FELINE_RIG_ID)
    const paths = {
      png: join(root, `${connectorClass}.png`), webp: join(root, `${connectorClass}.webp`),
      front: join(root, `${connectorClass}-front.png`), back: join(root, `${connectorClass}-back.png`),
    }
    await writeNew(paths.png, png); await writeNew(paths.webp, webp); await writeNew(paths.front, frontPng); await writeNew(paths.back, backPng)
    result[connectorClass] = {
      id: `feline-sit-${connectorClass}-bridge`, rigId: V06_FELINE_RIG_ID, connectorClass,
      materialFamilies: ['short-fur', 'mushroom-velvet', 'soft-skin'],
      neutralPngPath: runtimePortable(assetRoot, paths.png), neutralPngSha256: digest(png),
      neutralAssetPath: runtimePortable(assetRoot, paths.webp), neutralAssetSha256: digest(webp),
      frontMaskPath: runtimePortable(assetRoot, paths.front), frontMaskSha256: digest(frontPng),
      backMaskPath: runtimePortable(assetRoot, paths.back), backMaskSha256: digest(backPng),
    }
  }
  return result
}

function buildCatalog(themes: any[], assets: V06FelineAssetProvenance[], assetRoot: string, bridges: Record<'neck' | 'tail', any>): Catalog {
  const structural = assets.filter(asset => asset.category === 'structural').map(asset => structuralPart(asset, assetRoot))
  const attachments = assets.filter(asset => asset.category !== 'structural').map(asset => attachmentPart(asset, assetRoot))
  const baseSemantics = [
    richSemantic('frame_feline_sit', 'frame', '完整坐姿猫'), richSemantic('appendage_feline_tail', 'appendage', '连续猫尾'),
    richSemantic('head_feline_complete', 'headAndEyes', '完整猫头'), richSemantic('mouth_feline_soft', 'mouth', '柔软猫嘴'),
    richSemantic('surface_feline_tactile', 'surface', '触感猫毛'), richSemantic('pattern_feline_markings', 'pattern', '猫科纹样'),
  ]
  const personality = Array.from({ length: 6 }, (_, index) => richSemantic(`personality_feline_${index + 1}`, 'personality', `猫性格${index + 1}`))
  const quirks = Array.from({ length: 6 }, (_, index) => richSemantic(`quirk_feline_${index + 1}`, 'quirk', `猫趣味${index + 1}`))
  return {
    version: VERSION,
    themes,
    rigs: [{
      id: V06_FELINE_RIG_ID,
      sourceId: 'body_feline_sit_round',
      displayName: '正面居中坐姿猫',
      sockets: {
        head: { x: 1024, y: 720 }, tail: { x: 1510, y: 1340 }, eyes: { x: 1024, y: 760 }, mouth: { x: 1024, y: 960 },
        oralDetail: { x: 1024, y: 1010 }, headAppendage: { x: 1024, y: 420 }, overlay: { x: 1024, y: 1120 }, effect: { x: 1024, y: 1120 },
      },
    }],
    parts: [...structural, ...attachments, integratedPart('arms'), integratedPart('legs'), integratedPart('extraAppendage')],
    semanticTraits: [...baseSemantics, ...personality, ...quirks],
    modifiers: [
      richModifier('mutation_feline_heterochromia', 'mutation', '异色瞳'),
      richModifier('mutation_feline_local_curl', 'mutation', '局部卷毛'),
      richModifier('aberration_feline_crystal_glint', 'aberration', '晶点微光'),
      richModifier('aberration_feline_soft_glow', 'aberration', '柔和亮斑'),
    ],
    dependencies: { headShape: ['bodyFrame'], eyes: ['headShape'], mouthShape: ['headShape'], oralDetail: ['mouthShape'], headAppendage: ['headShape'], tail: ['bodyFrame'], surfaceMaterial: ['bodyFrame'], pattern: ['bodyFrame'], colorScheme: ['bodyFrame'], effect: ['bodyFrame'] },
    compositionPolicy: { motifSlots: ['eyes', 'mouthShape', 'headAppendage', 'surfaceMaterial', 'pattern', 'colorScheme', 'tail'], surpriseRatio: 0.3, maxStrongFeatures: 2, maxStrongNonFacialFeatures: 1, optionalNoneRate: { min: 0.35, max: 0.5 }, frameBounds: { x: 128, y: 128, width: 1792, height: 1792 }, faceInsideRatio: 0.84, faceVisibleRatio: 0.84 },
    transitionBridges: [bridges.neck, bridges.tail],
    archetypes: [{ id: 'feline', displayName: '坐姿猫', rigIds: [V06_FELINE_RIG_ID], defaultRigId: V06_FELINE_RIG_ID, requiredVisibleSlots: ['bodyFrame', 'headShape', 'tail'], integratedSlots: ['arms', 'legs', 'extraAppendage'], specialFeatureSlots: ['headAppendage', 'surfaceMaterial', 'tail'] }],
  } as Catalog
}

function promptCatalog(assets: V06FelineAssetProvenance[]): any {
  const indexed = assetById(assets)
  return {
    schemaVersion: 'qmonster-v06-feline-prompts-v1', catalogVersion: VERSION,
    generationTool: 'Codex built-in image_gen', canvasSize: 2048,
    transparencyRecovery: 'built-in transparency request followed by deterministic border-connected neutral-matte removal and alpha-component cleanup',
    prompts: V06_SOURCE_FILENAMES.map((sourceFilename, index) => {
      const asset = indexed.get(sourceFilename.replace(/-source\.png$/u, ''))!
      const prompt = `${COMMON_PROMPT}\nPrimary request: ${REQUESTS[sourceFilename]}`
      const selected = { index: sourceFilename === 'body_feline_sit_round-source.png' ? 2 : 1, candidateId: GENERATED_CANDIDATE_IDS[sourceFilename], selected: true, machineApproved: true, sourceSha256: asset.sourceSha256, rejectionReason: null }
      const candidates = sourceFilename === 'body_feline_sit_round-source.png'
        ? [{ index: 1, candidateId: 'exec-cc996a68-47e3-4296-8846-1268c9a3e50e.png', selected: false, machineApproved: false, sourceSha256: null, rejectionReason: 'Generator returned baked checkerboard RGB with no alpha channel; targeted transparency correction still lacked alpha.' }, selected]
        : [selected]
      return { promptId: `v06-feline-${index + 1}`, sourceFilename, prompt, selectedCandidate: selected.index, sourceSha256: asset.sourceSha256, candidates }
    }),
  }
}

function promptEvidence(promptData: any, filename: V06SourceFilename, promptSha256: string): any {
  const entry = promptData.prompts.find((candidate: any) => candidate.sourceFilename === filename)
  return { promptId: entry.promptId, promptPath: PROMPT_PATH, promptSha256, reviewRecordPath: REVIEW_PATH }
}

function buildManifest(catalog: Catalog, assets: V06FelineAssetProvenance[], assetRoot: string, promptData: any, promptSha256: string): any {
  const byId = assetById(assets)
  return {
    schemaVersion: 'interface-source-v3', catalogVersion: VERSION, rigIds: [V06_FELINE_RIG_ID], canvasSize: 2048,
    assets: catalog.parts.filter(part => part.composition?.mode === 'interface').map(part => {
      const asset = byId.get(part.id)!
      const variant = part.composition!.mode === 'interface' ? part.composition.variantsByRig[V06_FELINE_RIG_ID]! : undefined
      return {
        id: part.id, slotId: part.slotId, rigId: V06_FELINE_RIG_ID, materialFamily: variant!.materialFamily,
        sourcePngPath: `asset-source/v0.6.0/generation/feline/${asset.sourceFilename}`,
        promptEvidence: promptEvidence(promptData, asset.sourceFilename, promptSha256),
        connectors: variant!.connectors.map(connector => ({ id: connector.id, role: connector.role, connectorClass: connector.connectorClass, origin: connector.origin, tangent: connector.tangent, outwardNormal: connector.outwardNormal, width: connector.width, depth: connector.depth, contourMaskPath: connector.contourMaskPath, foregroundMaskPath: connector.foregroundMaskPath, backgroundMaskPath: connector.backgroundMaskPath, materialSampleRegion: connector.materialSampleRegion, warpLimits: connector.warpLimits })),
        renderNodes: variant!.renderNodes.map(node => ({ id: node.id, ...(node.connectorId === undefined ? {} : { connectorId: node.connectorId }), sourcePngPath: `asset-source/v0.6.0/generation/feline/${asset.sourceFilename}`, transform: node.transform })),
        ...(variant!.faceSafeZones === undefined ? {} : { faceSafeZones: variant!.faceSafeZones }),
        ...(variant!.featureSockets === undefined ? {} : { featureSockets: variant!.featureSockets }),
      }
    }),
    bridges: (catalog.transitionBridges ?? []).map(bridge => ({ id: bridge.id, rigId: bridge.rigId, connectorClass: bridge.connectorClass, materialFamilies: bridge.materialFamilies, sourcePngPath: 'asset-source/v0.6.0/generation/feline/body_feline_sit_round-source.png', neutralPngPath: bridge.neutralPngPath, neutralWebpPath: bridge.neutralAssetPath, frontMaskPath: bridge.frontMaskPath, backMaskPath: bridge.backMaskPath, promptEvidence: promptEvidence(promptData, 'body_feline_sit_round-source.png', promptSha256) })),
  }
}

function buildSourceIndex(catalog: Catalog, assets: V06FelineAssetProvenance[], assetRoot: string, promptData: any, promptSha256: string, reviewSha256: string): any {
  const byId = assetById(assets)
  const sources: any[] = []
  for (const part of catalog.parts) {
    if (part.assetPath === '') continue
    const asset = byId.get(part.id)!
    const sourcePath = `asset-source/v0.6.0/generation/feline/${asset.sourceFilename}`
    const runtimeResources = [
      { path: part.assetPath, sha256: part.assetSha256 }, { path: part.pngPath, sha256: part.pngSha256 },
      ...asset.paletteMasks.map(mask => ({ path: runtimePortable(assetRoot, mask.path), sha256: mask.sha256 })),
    ]
    if (part.composition?.mode === 'interface') {
      const variant = part.composition.variantsByRig[V06_FELINE_RIG_ID]!
      runtimeResources.push(...variant.connectors.flatMap(connector => [
        { path: connector.contourMaskPath, sha256: connector.contourMaskSha256 },
        { path: connector.foregroundMaskPath, sha256: connector.foregroundMaskSha256 },
        { path: connector.backgroundMaskPath, sha256: connector.backgroundMaskSha256 },
      ]))
      sources.push({ sourceId: `${part.id}:${V06_FELINE_RIG_ID}`, kind: 'interface-structural', promptId: promptEvidence(promptData, asset.sourceFilename, promptSha256).promptId, promptPath: PROMPT_PATH, promptSha256, reviewRecordPath: REVIEW_PATH, reviewRecordSha256: reviewSha256, sourceResources: [{ path: sourcePath, sha256: asset.sourceSha256 }], runtimeResources })
    } else {
      sources.push({ sourceId: part.id, kind: 'generated-transparent-layer', promptId: promptEvidence(promptData, asset.sourceFilename, promptSha256).promptId, promptCatalogPath: PROMPT_PATH, promptCatalogSha256: promptSha256, selectedCandidate: promptData.prompts.find((entry: any) => entry.sourceFilename === asset.sourceFilename).selectedCandidate, sourceResources: [{ path: sourcePath, sha256: asset.sourceSha256 }], runtimePngPath: part.pngPath, runtimePngSha256: part.pngSha256, runtimeWebpPath: part.assetPath, runtimeWebpSha256: part.assetSha256, runtimeResources })
    }
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    const runtimeResources = [
      { path: bridge.neutralAssetPath, sha256: bridge.neutralAssetSha256 }, { path: bridge.neutralPngPath, sha256: bridge.neutralPngSha256 },
      { path: bridge.frontMaskPath, sha256: bridge.frontMaskSha256 }, { path: bridge.backMaskPath, sha256: bridge.backMaskSha256 },
    ]
    sources.push({ sourceId: bridge.id, kind: 'interface-bridge', promptId: promptData.prompts[0].promptId, promptPath: PROMPT_PATH, promptSha256, reviewRecordPath: REVIEW_PATH, reviewRecordSha256: reviewSha256, sourceResources: [{ path: 'asset-source/v0.6.0/generation/feline/body_feline_sit_round-source.png', sha256: byId.get('body_feline_sit_round')!.sourceSha256 }], runtimeResources })
  }
  return { catalogVersion: VERSION, extractionGate: { gateVersion: PRODUCTION_CHROMA_GATE_VERSION, profile: PRODUCTION_CHROMA_GATE_PROFILE }, sources, qualityGateSummary: { rigCandidatesEvaluated: 0, rigCandidatesPassed: 0, partCandidatesEvaluated: 0, partCandidatesPassed: 0, approvedRigSelectionsPassing: 0, approvedPartSelectionsPassing: 0 }, review: { generatedSourceCount: V06_SOURCE_FILENAMES.length, invalidCandidateCount: 1 } }
}

export async function assembleV06Catalog(options: { repositoryRoot?: string, stagedRoot: string }): Promise<Catalog> {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const stagedRoot = resolve(options.stagedRoot)
  const catalogRoot = join(stagedRoot, 'packages', 'asset-catalog', 'catalog', 'v0.6.0')
  const assetRoot = join(stagedRoot, 'packages', 'asset-catalog', 'assets', 'v0.6.0')
  for (const target of [catalogRoot, assetRoot]) {
    try {
      await lstat(target)
      throw new Error(`V06_RELEASE_TARGET_EXISTS_NO_OVERWRITE:${target}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const sourceDirectory = join(repositoryRoot, 'asset-source', 'v0.6.0', 'generation', 'feline')
  const assets = await prepareV06FelineAssets({ sourceDirectory, outputDirectory: assetRoot })
  const bridges = await createBridgeAssets(assetRoot)
  const themes = JSON.parse(await readFile(join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.5.0', 'themes.json'), 'utf8'))
  const catalog = buildCatalog(themes, assets, assetRoot, bridges)
  const prompts = promptCatalog(assets)
  const promptBytes = prettyJson(prompts)
  const promptSha256 = digest(promptBytes)
  const review = { schemaVersion: 'qmonster-v06-feline-release-review-v1', catalogVersion: VERSION, decision: 'technical-validation-ready', visualReview: 'All 22 built-in image_gen outputs inspected; transparent final source layers retained with deterministic alpha recovery.', sourceLayerCount: assets.length, rigIds: [V06_FELINE_RIG_ID], archetypeIds: ['feline'], invalidCandidateCount: 1, promptCatalogPath: PROMPT_PATH, promptCatalogSha256: promptSha256 }
  const reviewBytes = prettyJson(review)
  const sourceIndex = buildSourceIndex(catalog, assets, assetRoot, prompts, promptSha256, digest(reviewBytes))
  const manifest = buildManifest(catalog, assets, assetRoot, prompts, promptSha256)
  const evidence = buildProductionEvidenceManifest(sourceIndex)

  await writeNew(join(stagedRoot, PROMPT_PATH), promptBytes)
  await writeNew(join(stagedRoot, REVIEW_PATH), reviewBytes)
  await writeNew(join(stagedRoot, 'asset-source', 'v0.6.0', 'interface-manifest.json'), prettyJson(manifest))
  await writeNew(join(stagedRoot, 'packages', 'asset-catalog', 'source-index-v0.6.0.json'), prettyJson(sourceIndex))
  await writeNew(join(stagedRoot, 'packages', 'asset-catalog', 'audit', 'v0.6.0', 'evidence-manifest.json'), prettyJson(evidence))
  for (const [name, value] of [
    ['catalog.json', catalog], ['themes.json', catalog.themes], ['rigs.json', catalog.rigs], ['parts.json', catalog.parts],
    ['semantic-traits.json', catalog.semanticTraits], ['modifiers.json', catalog.modifiers],
  ] as const) await writeNew(join(catalogRoot, name), prettyJson(value))
  return catalog
}
