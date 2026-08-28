import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HEAD_FACE_VERTICAL_GAP_PX = 120
export const HEAD_FACE_SAFE_ZONE_TOP_INSET_PX = 80

const TASK7_BASELINE_EYES_Y: Readonly<Record<string, number>> = {
  'head_mushroom_cap:biped': 1160,
  'head_mushroom_cap:blob': 1072,
  'head_mushroom_cap:floating': 1109,
  'head_round_dome:biped': 1096,
  'head_round_dome:blob': 1033,
  'head_round_dome:floating': 1098,
  'head_angler_bulb:biped': 1160,
  'head_angler_bulb:blob': 1144,
  'head_angler_bulb:floating': 1160,
  'head_shadow_hood:biped': 1106,
  'head_shadow_hood:blob': 1045,
  'head_shadow_hood:floating': 1078,
}

const TASK7_BASELINE_MOUTH_Y: Readonly<Record<string, number>> = {
  'head_mushroom_cap:biped': 1273,
  'head_mushroom_cap:blob': 1128,
  'head_mushroom_cap:floating': 1165,
  'head_round_dome:biped': 1152,
  'head_round_dome:blob': 1089,
  'head_round_dome:floating': 1154,
  'head_angler_bulb:biped': 1224,
  'head_angler_bulb:blob': 1200,
  'head_angler_bulb:floating': 1229,
  'head_shadow_hood:biped': 1162,
  'head_shadow_hood:blob': 1101,
  'head_shadow_hood:floating': 1134,
}

interface Point { x: number; y: number }
interface FaceSockets { eyes: Point; mouth: Point; headAppendage?: Point }
interface FaceSafeZone { x: number; y: number; width: number; height: number }
interface HeadVariant { rigId: string; featureSockets?: FaceSockets; faceSafeZones?: FaceSafeZone[] }
interface HeadAsset { id: string; slotId: string; variants: HeadVariant[] }
interface InterfaceManifest { assets: HeadAsset[]; [key: string]: unknown }

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function amendHeadFaceSockets<T extends InterfaceManifest>(source: T): T {
  const amended = structuredClone(source)
  const heads = amended.assets.filter(asset => asset.slotId === 'headShape')
  const variants = heads.flatMap(asset => asset.variants.map(variant => ({ asset, variant })))
  if (variants.length !== 12) {
    throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: expected 12 head variants, found ${variants.length}`)
  }
  for (const { asset, variant } of variants) {
    const sockets = variant.featureSockets
    if (sockets === undefined) {
      throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: ${asset.id}:${variant.rigId} has no feature sockets`)
    }
    const safeZone = variant.faceSafeZones?.[0]
    if (safeZone === undefined) {
      throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: ${asset.id}:${variant.rigId} has no face safe-zone`)
    }
    sockets.eyes.y = Math.max(
      sockets.eyes.y,
      safeZone.y + HEAD_FACE_SAFE_ZONE_TOP_INSET_PX,
    )
    sockets.mouth.y = Math.max(
      sockets.mouth.y,
      sockets.eyes.y + HEAD_FACE_VERTICAL_GAP_PX,
    )
  }
  return amended
}

export async function applyHeadFaceSocketAmendment(root = process.cwd()): Promise<void> {
  const manifestPath = resolve(root, 'asset-source/v0.3.0/interface-manifest.json')
  const coordinatePath = resolve(root, 'asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json')
  const reworkPath = resolve(root, 'asset-source/v0.3.0/generation/task7-body-head-occlusion-rework.json')
  const amendmentPath = resolve(root, 'packages/asset-catalog/review/v0.3.0/head-face-socket-amendment.json')
  const [manifestBytes, coordinateBytes, reworkBytes] = await Promise.all([
    readFile(manifestPath), readFile(coordinatePath), readFile(reworkPath),
  ])
  const source = JSON.parse(manifestBytes.toString('utf8')) as InterfaceManifest
  const amended = amendHeadFaceSockets(source)
  const coordinates = JSON.parse(coordinateBytes.toString('utf8')) as any
  const rework = JSON.parse(reworkBytes.toString('utf8')) as any
  const changes: Array<Record<string, unknown>> = []
  for (const asset of amended.assets.filter(item => item.slotId === 'headShape')) {
    const originalAsset = source.assets.find(item => item.id === asset.id)!
    for (const variant of asset.variants) {
      const original = originalAsset.variants.find(item => item.rigId === variant.rigId)!
      const sockets = variant.featureSockets!
      const variantKey = `${asset.id}:${variant.rigId}`
      const baselineEyesY = TASK7_BASELINE_EYES_Y[variantKey]
      const baselineMouthY = TASK7_BASELINE_MOUTH_Y[variantKey]
      if (baselineEyesY === undefined || baselineMouthY === undefined) {
        throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: Task 7 baseline missing for ${variantKey}`)
      }
      const safeZone = variant.faceSafeZones![0]!
      const expectedEyesY = Math.max(
        baselineEyesY,
        safeZone.y + HEAD_FACE_SAFE_ZONE_TOP_INSET_PX,
      )
      const priorExpectedMouthY = Math.max(
        baselineMouthY,
        baselineEyesY + HEAD_FACE_VERTICAL_GAP_PX,
      )
      const expectedMouthY = Math.max(baselineMouthY, expectedEyesY + HEAD_FACE_VERTICAL_GAP_PX)
      if (original.featureSockets!.eyes.y !== baselineEyesY && original.featureSockets!.eyes.y !== expectedEyesY) {
        throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: unexpected live eyes socket for ${variantKey}`)
      }
      if (![baselineMouthY, priorExpectedMouthY, expectedMouthY].includes(original.featureSockets!.mouth.y)) {
        throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: unexpected live mouth socket for ${variantKey}`)
      }
      const coordinate = coordinates.headFeatureSockets.find((item: any) => (
        item.partId === asset.id && item.rigId === variant.rigId
      ))
      const evidence = rework.masks[variantKey]
      if (coordinate === undefined || evidence === undefined) {
        throw new Error(`HEAD_FACE_SOCKET_AMENDMENT_INVALID: mirrored evidence missing for ${asset.id}:${variant.rigId}`)
      }
      coordinate.featureSockets = structuredClone(sockets)
      evidence.featureSockets = structuredClone(sockets)
      changes.push({
        partId: asset.id, rigId: variant.rigId,
        faceSafeZoneTopY: safeZone.y,
        eyesYBefore: baselineEyesY,
        eyesYAfter: sockets.eyes.y,
        safeZoneTopInsetPx: sockets.eyes.y - safeZone.y,
        mouthYBefore: baselineMouthY,
        mouthYAfter: sockets.mouth.y,
        verticalGapPx: sockets.mouth.y - sockets.eyes.y,
      })
    }
  }
  await Promise.all([
    writeJson(manifestPath, amended),
    writeJson(coordinatePath, coordinates),
    writeJson(reworkPath, rework),
  ])
  await writeJson(amendmentPath, {
    schemaVersion: 'task7-head-face-socket-amendment-v2',
    status: 'MACHINE_PASS_AWAITING_USER_REVIEW',
    decision: 'All v0.3 head variants place eyes at least 80px inside the face safe-zone top, then keep the mouth at least 120px below the eyes.',
    thresholds: {
      eyesSafeZoneTopInsetMinPx: HEAD_FACE_SAFE_ZONE_TOP_INSET_PX,
      eyesToMouthVerticalGapMinPx: HEAD_FACE_VERTICAL_GAP_PX,
    },
    rasterMutationCount: 0,
    baseline: 'Task 7 approved feature sockets before the Task 10 amendment',
    changes,
  })
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  await applyHeadFaceSocketAmendment()
}
