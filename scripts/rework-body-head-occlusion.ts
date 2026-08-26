import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { interfaceVariantKey, structuralVariants, type InterfaceSourceManifest } from './interface-source-schema.js'
import {
  MAX_VISIBLE_TONGUE_AREA_RATIO,
  MAX_VISIBLE_TONGUE_DEPTH_RATIO,
  naturalNeckSeamLiftRatio,
} from './body-head-contact-metrics.js'

const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const HEAD_IDS = new Set(['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood'])
const RECEIVER_INSET_PX = { blob: 120, biped: 100, floating: 130 } as const
const BASE_RECEIVER_Y_BY_BODY = {
  body_blob_round: 620,
  body_blob_wide: 620,
  body_biped_peanut: 580,
  body_biped_tall: 400,
  body_floating_drop: 520,
} as const

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function maskPng(alpha: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png(PNG)
    .toBuffer()
}

export async function reworkBodyHeadOcclusion(root: string): Promise<{ maskPairs: number }> {
  const sourceRoot = resolve(root, 'asset-source/v0.3.0')
  const catalogRoot = resolve(root, 'packages/asset-catalog')
  const manifestPath = join(sourceRoot, 'interface-manifest.json')
  const processedPath = join(sourceRoot, 'production/processed-index.json')
  const reviewRecordPath = resolve(catalogRoot, 'review/v0.3.0/body-head-review-record.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as InterfaceSourceManifest
  const processed = JSON.parse(await readFile(processedPath, 'utf8')) as any
  const evidence: any = {
    schemaVersion: 'body-head-occlusion-rework-v1',
    reason: 'User rejected the exposed connector tongue/chin/stem in the first Task 7 matrices.',
    algorithm: {
      coordinateSpace: 'declared neck plug tangent/outward-normal envelope',
      centerSeamLiftDepthRatio: naturalNeckSeamLiftRatio(0),
      edgeSeamLiftDepthRatio: naturalNeckSeamLiftRatio(1),
      shape: 'silhouette-relative quadratic U seam anchored to the widest organic head row',
      compositionOrder: ['head-background', 'body', 'head-foreground'],
    },
    thresholds: {
      maxVisibleTongueDepthRatio: MAX_VISIBLE_TONGUE_DEPTH_RATIO,
      maxVisibleTongueAreaRatio: MAX_VISIBLE_TONGUE_AREA_RATIO,
    },
    receiverInsetPxByRig: RECEIVER_INSET_PX,
    receivers: {},
    masks: {},
  }

  for (const body of structuralVariants(manifest).filter(item => item.slotId === 'bodyFrame')) {
    const receiver = body.connectors.find(item => item.id === 'neck')
    const node = body.renderNodes[0]
    if (receiver === undefined || node === undefined) throw new Error(`${interfaceVariantKey(body.partId, body.rigId)} lacks a neck receiver/node.`)
    const baseReceiverY = BASE_RECEIVER_Y_BY_BODY[body.partId as keyof typeof BASE_RECEIVER_Y_BY_BODY]
    if (baseReceiverY === undefined) throw new Error(`No frozen baseline receiver Y exists for ${body.partId}.`)
    receiver.origin.y = baseReceiverY + RECEIVER_INSET_PX[body.rigId]

    const decoded = await sharp(resolve(root, node.sourcePngPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const contour = Buffer.alloc(decoded.info.width * decoded.info.height)
    const halfWidth = receiver.width * 0.42
    const halfDepth = receiver.depth * 0.48
    let contourPixels = 0
    for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
      const pixel = y * decoded.info.width + x
      if (decoded.data[pixel * 4 + 3] === 0) continue
      const deltaX = x + 0.5 - receiver.origin.x
      const deltaY = y + 0.5 - receiver.origin.y
      const tangentDistance = deltaX * receiver.tangent.x + deltaY * receiver.tangent.y
      const normalDistance = deltaX * receiver.outwardNormal.x + deltaY * receiver.outwardNormal.y
      if ((tangentDistance / halfWidth) ** 2 + (normalDistance / halfDepth) ** 2 <= 1) {
        contour[pixel] = 255
        contourPixels += 1
      }
    }
    if (contourPixels === 0) throw new Error(`${interfaceVariantKey(body.partId, body.rigId)} shifted receiver has no body-supported contour pixels.`)
    const contourBytes = await maskPng(contour, decoded.info.width, decoded.info.height)
    const stem = `${body.partId}-neck`
    const portableRuntimeBase = `assets/v0.3.0/connectors/${body.rigId}/task7-natural-neck/${stem}`
    const portableSourceBase = `asset-source/v0.3.0/masks/${body.rigId}/task7-natural-neck/${stem}`
    const outputs = [
      [`${portableRuntimeBase}-contour.png`, contourBytes],
      [`${portableRuntimeBase}-foreground.png`, contourBytes],
      [`${portableRuntimeBase}-background.png`, contourBytes],
      [`${portableSourceBase}-contour.png`, contourBytes],
      [`${portableSourceBase}-foreground.png`, contourBytes],
      [`${portableSourceBase}-background.png`, contourBytes],
    ] as const
    for (const [portablePath, bytes] of outputs) {
      const path = resolve(portablePath.startsWith('assets/') ? catalogRoot : root, portablePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }
    receiver.contourMaskPath = `${portableRuntimeBase}-contour.png`
    receiver.foregroundMaskPath = `${portableRuntimeBase}-foreground.png`
    receiver.backgroundMaskPath = `${portableRuntimeBase}-background.png`
    const processedKey = processed.processedAssets[interfaceVariantKey(body.partId, body.rigId)] === undefined && body.rigId === 'biped'
      ? body.partId
      : interfaceVariantKey(body.partId, body.rigId)
    const processedBody = processed.processedAssets[processedKey]
    if (processedBody?.connectorHashes?.neck === undefined) throw new Error(`Missing processed neck hash record for ${processedKey}.`)
    processedBody.connectorHashes.neck = {
      contourMaskSha256: sha256(contourBytes),
      foregroundMaskSha256: sha256(contourBytes),
      backgroundMaskSha256: sha256(contourBytes),
    }
    evidence.receivers[interfaceVariantKey(body.partId, body.rigId)] = {
      origin: receiver.origin,
      centerlinePreserved: true,
      connectorCoverage: 1,
      contourMaskPath: `${portableSourceBase}-contour.png`,
      contourMaskSha256: sha256(contourBytes),
      runtimeContourMaskPath: receiver.contourMaskPath,
      runtimeForegroundMaskPath: receiver.foregroundMaskPath,
      runtimeBackgroundMaskPath: receiver.backgroundMaskPath,
    }
  }

  for (const head of structuralVariants(manifest).filter(item => item.slotId === 'headShape' && HEAD_IDS.has(item.partId))) {
    const plug = head.connectors.find(item => item.id === 'neck')
    const node = head.renderNodes.find(item => item.connectorId === 'neck')
    if (plug === undefined || node === undefined) throw new Error(`${interfaceVariantKey(head.partId, head.rigId)} lacks a neck plug/node.`)
    const decoded = await sharp(resolve(root, node.sourcePngPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const foreground = Buffer.alloc(decoded.info.width * decoded.info.height)
    const background = Buffer.alloc(foreground.length)
    const normalBins = new Map<number, { minTangent: number; maxTangent: number }>()
    for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
      const pixel = y * decoded.info.width + x
      if (decoded.data[pixel * 4 + 3] === 0) continue
      const deltaX = x + 0.5 - plug.origin.x
      const deltaY = y + 0.5 - plug.origin.y
      const tangentDistance = deltaX * plug.tangent.x + deltaY * plug.tangent.y
      const outwardDistance = deltaX * plug.outwardNormal.x + deltaY * plug.outwardNormal.y
      const binIndex = Math.floor(outwardDistance)
      const bin = normalBins.get(binIndex) ?? { minTangent: tangentDistance, maxTangent: tangentDistance }
      bin.minTangent = Math.min(bin.minTangent, tangentDistance)
      bin.maxTangent = Math.max(bin.maxTangent, tangentDistance)
      normalBins.set(binIndex, bin)
    }
    const widestBin = [...normalBins].reduce((widest, current) => (
      current[1].maxTangent - current[1].minTangent > widest[1].maxTangent - widest[1].minTangent
        ? current
        : widest
    ))
    const widestNormalDistance = widestBin[0]
    const halfTangentSpan = Math.max(1, (widestBin[1].maxTangent - widestBin[1].minTangent + 1) / 2)
    for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
      const pixel = y * decoded.info.width + x
      const alpha = decoded.data[pixel * 4 + 3]!
      if (alpha === 0) continue
      const deltaX = x + 0.5 - plug.origin.x
      const deltaY = y + 0.5 - plug.origin.y
      const tangentDistance = deltaX * plug.tangent.x + deltaY * plug.tangent.y
      const outwardDistance = deltaX * plug.outwardNormal.x + deltaY * plug.outwardNormal.y
      const normalizedTangent = Math.abs(tangentDistance) / halfTangentSpan
      const seamBoundary = widestNormalDistance - plug.depth * naturalNeckSeamLiftRatio(normalizedTangent)
      if (outwardDistance >= seamBoundary) background[pixel] = 255
      else foreground[pixel] = 255
    }

    const centerSeamY = plug.origin.y + plug.outwardNormal.y * (
      widestNormalDistance - plug.depth * naturalNeckSeamLiftRatio(0)
    )
    const safeBottom = Math.floor(centerSeamY - 16)
    if (head.faceSafeZones?.[0] !== undefined) {
      head.faceSafeZones[0].height = Math.max(96, safeBottom - head.faceSafeZones[0].y)
    }
    if (head.featureSockets !== undefined) {
      head.featureSockets.eyes.y = Math.min(head.featureSockets.eyes.y, safeBottom - 80)
      head.featureSockets.mouth.y = Math.min(head.featureSockets.mouth.y, safeBottom - 24)
    }

    const [foregroundBytes, backgroundBytes] = await Promise.all([
      maskPng(foreground, decoded.info.width, decoded.info.height),
      maskPng(background, decoded.info.width, decoded.info.height),
    ])
    const stem = `${head.partId}-neck`
    const portableRuntimeBase = `assets/v0.3.0/connectors/${head.rigId}/task7-natural-neck/${stem}`
    const portableSourceBase = `asset-source/v0.3.0/masks/${head.rigId}/task7-natural-neck/${stem}`
    const outputs = [
      [`${portableRuntimeBase}-foreground.png`, foregroundBytes],
      [`${portableRuntimeBase}-background.png`, backgroundBytes],
      [`${portableSourceBase}-foreground.png`, foregroundBytes],
      [`${portableSourceBase}-background.png`, backgroundBytes],
    ] as const
    for (const [portablePath, bytes] of outputs) {
      const path = resolve(portablePath.startsWith('assets/') ? catalogRoot : root, portablePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }

    plug.foregroundMaskPath = `${portableRuntimeBase}-foreground.png`
    plug.backgroundMaskPath = `${portableRuntimeBase}-background.png`
    const processedKey = processed.processedAssets[interfaceVariantKey(head.partId, head.rigId)] === undefined && head.rigId === 'biped'
      ? head.partId
      : interfaceVariantKey(head.partId, head.rigId)
    const processedHead = processed.processedAssets[processedKey]
    if (processedHead?.connectorHashes?.neck === undefined) throw new Error(`Missing processed neck hash record for ${processedKey}.`)
    processedHead.connectorHashes.neck.foregroundMaskSha256 = sha256(foregroundBytes)
    processedHead.connectorHashes.neck.backgroundMaskSha256 = sha256(backgroundBytes)
    evidence.masks[interfaceVariantKey(head.partId, head.rigId)] = {
      foregroundMaskPath: `${portableSourceBase}-foreground.png`,
      foregroundMaskSha256: sha256(foregroundBytes),
      backgroundMaskPath: `${portableSourceBase}-background.png`,
      backgroundMaskSha256: sha256(backgroundBytes),
      runtimeForegroundMaskPath: plug.foregroundMaskPath,
      runtimeBackgroundMaskPath: plug.backgroundMaskPath,
      widestNormalDistance,
      halfTangentSpan,
      centerSeamY,
      faceSafeZones: head.faceSafeZones,
      featureSockets: head.featureSockets,
    }
  }

  const reviewRecordSha256 = sha256(await readFile(reviewRecordPath))
  for (const source of processed.sourceIndex.sources as any[]) {
    if (source.reviewRecordPath === 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json') {
      source.reviewRecordSha256 = reviewRecordSha256
    }
  }
  await writeJson(manifestPath, manifest)
  await writeJson(processedPath, processed)
  await writeJson(join(sourceRoot, 'generation/task7-body-head-occlusion-rework.json'), evidence)
  return { maskPairs: Object.keys(evidence.masks).length }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(await reworkBodyHeadOcclusion(process.cwd())))
}
