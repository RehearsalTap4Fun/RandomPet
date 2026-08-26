import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { FlattenedInterfaceVariant, InterfaceRigId } from './interface-source-schema.js'

export const MAX_VISIBLE_TONGUE_DEPTH_RATIO = 0.1
export const MAX_VISIBLE_TONGUE_AREA_RATIO = 0.1
export const MAX_CENTRAL_LOBE_DEPTH_RATIO = 0.2

const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

type ApprovedHeadId = 'head_round_dome' | 'head_mushroom_cap' | 'head_angler_bulb' | 'head_shadow_hood'

// Approval-frozen exact rig/head grammar, independent from mutable live connector declarations.
// The biped mushroom keeps its Task 6 guide envelope (310x160); the other biped heads were newly
// approved in Task 7 at 310x180. Missing identities are errors rather than silently borrowing a scale.
const APPROVED_NECK_METRIC_GRAMMAR: Record<InterfaceRigId, Record<ApprovedHeadId, { width: number, depth: number }>> = {
  blob: {
    head_round_dome: { width: 400, depth: 200 },
    head_mushroom_cap: { width: 400, depth: 200 },
    head_angler_bulb: { width: 400, depth: 200 },
    head_shadow_hood: { width: 400, depth: 200 },
  },
  biped: {
    head_round_dome: { width: 310, depth: 180 },
    head_mushroom_cap: { width: 310, depth: 160 },
    head_angler_bulb: { width: 310, depth: 180 },
    head_shadow_hood: { width: 310, depth: 180 },
  },
  floating: {
    head_round_dome: { width: 300, depth: 180 },
    head_mushroom_cap: { width: 300, depth: 180 },
    head_angler_bulb: { width: 300, depth: 180 },
    head_shadow_hood: { width: 300, depth: 180 },
  },
}

export function approvedNeckMetricBaseline(rigId: InterfaceRigId, headId: string): { width: number, depth: number } {
  const baseline = APPROVED_NECK_METRIC_GRAMMAR[rigId][headId as ApprovedHeadId]
  if (baseline === undefined) throw new Error(`No immutable neck metric grammar for ${headId}:${rigId}.`)
  return baseline
}

export function naturalNeckSeamLiftRatio(normalizedTangentDistance: number): number {
  const tangent = Math.min(1, Math.max(0, Math.abs(normalizedTangentDistance)))
  return 0.55 * (1 - tangent * tangent)
}

interface AlphaPlane {
  data: Buffer
  width: number
  height: number
}

export async function measureCentralLobeDepthRatio(input: {
  imagePath: string
  rigId: InterfaceRigId
  headId: string
  connector: FlattenedInterfaceVariant['connectors'][number]
}): Promise<number> {
  const alpha = await alphaPlane(input.imagePath)
  const baseline = approvedNeckMetricBaseline(input.rigId, input.headId)
  const { centralBottom, shoulderBaseline } = centralLobeEnvelope(alpha, input.connector, baseline.width)
  return Math.max(0, centralBottom - shoulderBaseline) / baseline.depth
}

function centralLobeEnvelope(
  alpha: AlphaPlane,
  plug: FlattenedInterfaceVariant['connectors'][number],
  metricWidth: number,
): { centralBottom: number, shoulderBaseline: number } {
  const bottomByTangent = new Map<number, number>()
  for (let y = 0; y < alpha.height; y += 1) for (let x = 0; x < alpha.width; x += 1) {
    if (alphaAt(alpha, x, y) === 0) continue
    const deltaX = x + 0.5 - plug.origin.x
    const deltaY = y + 0.5 - plug.origin.y
    const tangent = Math.round(deltaX * plug.tangent.x + deltaY * plug.tangent.y)
    const outward = deltaX * plug.outwardNormal.x + deltaY * plug.outwardNormal.y
    bottomByTangent.set(tangent, Math.max(bottomByTangent.get(tangent) ?? -Infinity, outward))
  }
  const central = [...bottomByTangent]
    .filter(([tangent]) => Math.abs(tangent) <= metricWidth * 0.4)
    .map(([, bottom]) => bottom)
  const shoulders = [...bottomByTangent]
    .filter(([tangent]) => Math.abs(tangent) >= metricWidth * 0.65 && Math.abs(tangent) <= metricWidth * 1.5)
    .map(([, bottom]) => bottom)
    .sort((left, right) => left - right)
  if (central.length === 0 || shoulders.length === 0) throw new Error('Head silhouette lacks central or shoulder alpha for lobe measurement.')
  const shoulderBaseline = shoulders[Math.floor((shoulders.length - 1) * 0.75)]!
  const centralBottom = Math.max(...central)
  return { centralBottom, shoulderBaseline }
}

async function alphaPlane(path: string): Promise<AlphaPlane> {
  const decoded = await sharp(path).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height }
}

function alphaAt(plane: AlphaPlane, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= plane.width || y >= plane.height) return 0
  return plane.data[y * plane.width + x] ?? 0
}

export async function measureVisibleConnectorTongue(input: {
  root: string
  body: FlattenedInterfaceVariant
  head: FlattenedInterfaceVariant
}): Promise<{
  visibleTongueDepthRatio: number
  visibleTongueAreaRatio: number
}> {
  const receiver = input.body.connectors.find(item => item.id === 'neck')
  const plug = input.head.connectors.find(item => item.id === 'neck')
  const bodyNode = input.body.renderNodes[0]
  const headNode = input.head.renderNodes.find(item => item.connectorId === 'neck')
  if (receiver === undefined || plug === undefined || bodyNode === undefined || headNode === undefined) {
    throw new Error('A body/head pair must declare neck receiver, neck plug, body node, and head node.')
  }

  const [bodyAlpha, headAlpha, foregroundAlpha, backgroundAlpha] = await Promise.all([
    alphaPlane(resolve(input.root, bodyNode.sourcePngPath)),
    alphaPlane(resolve(input.root, headNode.sourcePngPath)),
    alphaPlane(resolve(input.root, 'packages/asset-catalog', plug.foregroundMaskPath)),
    alphaPlane(resolve(input.root, 'packages/asset-catalog', plug.backgroundMaskPath)),
  ])
  const dx = Math.round(receiver.origin.x - plug.origin.x)
  const dy = Math.round(receiver.origin.y - plug.origin.y)
  const baseline = approvedNeckMetricBaseline(input.head.rigId, input.head.partId)
  const { shoulderBaseline } = centralLobeEnvelope(headAlpha, plug, baseline.width)
  const depthBins = new Map<number, number>()
  let visibleHeadMass = 0
  for (let y = 0; y < headAlpha.height; y += 1) for (let x = 0; x < headAlpha.width; x += 1) {
    const head = alphaAt(headAlpha, x, y)
    if (head === 0) continue
    const deltaX = x + 0.5 - plug.origin.x
    const deltaY = y + 0.5 - plug.origin.y
    const tangentDistance = deltaX * plug.tangent.x + deltaY * plug.tangent.y
    const outwardDistance = deltaX * plug.outwardNormal.x + deltaY * plug.outwardNormal.y
    if (Math.abs(tangentDistance) > baseline.width * 0.4) continue
    const tongueDepth = outwardDistance - shoulderBaseline
    if (tongueDepth <= 0) continue
    const foreground = alphaAt(foregroundAlpha, x, y)
    const background = alphaAt(backgroundAlpha, x, y)
    const body = alphaAt(bodyAlpha, x + dx, y + dy)
    const foregroundContribution = head * foreground / 255
    const backgroundContribution = head * background / 255 * (255 - body) / 255
    const visible = Math.max(foregroundContribution, backgroundContribution)
    visibleHeadMass += visible
    const binIndex = Math.floor(tongueDepth)
    depthBins.set(binIndex, (depthBins.get(binIndex) ?? 0) + visible)
  }
  const significantBinMass = Math.max(2, baseline.width * 0.02) * 255
  const lastVisibleDepth = Math.max(-1, ...[...depthBins]
    .filter(([, mass]) => mass >= significantBinMass)
    .map(([depth]) => depth))
  return {
    visibleTongueDepthRatio: lastVisibleDepth < 0
      ? 0
      : (lastVisibleDepth + 1) / baseline.depth,
    visibleTongueAreaRatio: visibleHeadMass / (baseline.width * baseline.depth * 255),
  }
}

export interface BodyHeadCausalMetrics {
  largestComponentRatio: number
  centerlineGapPx: number
  visibleTongueDepthRatio: number
  visibleTongueAreaRatio: number
  centralLobeDepthRatio: number
}

async function maskedSource(root: string, sourcePath: string, maskPath: string): Promise<Buffer> {
  const [source, mask] = await Promise.all([
    sharp(resolve(root, sourcePath)).ensureAlpha().png(PNG).toBuffer(),
    sharp(resolve(root, 'packages/asset-catalog', maskPath)).ensureAlpha().extractChannel('alpha').png(PNG).toBuffer(),
  ])
  return sharp(source).composite([{ input: mask, blend: 'dest-in' }]).png(PNG).toBuffer()
}

async function translated(source: Buffer, dx: number, dy: number): Promise<Buffer> {
  const sourceLeft = Math.max(0, -dx)
  const sourceTop = Math.max(0, -dy)
  const targetLeft = Math.max(0, dx)
  const targetTop = Math.max(0, dy)
  const width = Math.min(2048 - sourceLeft, 2048 - targetLeft)
  const height = Math.min(2048 - sourceTop, 2048 - targetTop)
  const cropped = await sharp(source).extract({ left: sourceLeft, top: sourceTop, width, height }).png(PNG).toBuffer()
  return sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: cropped, left: targetLeft, top: targetTop }])
    .png(PNG)
    .toBuffer()
}

function largestAlphaComponentRatio(alpha: Buffer, width: number, height: number): number {
  const labels = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  const masses = [0]
  let label = 0
  let total = 0
  for (const value of alpha) total += value
  for (let first = 0; first < labels.length; first += 1) {
    if (labels[first] !== 0 || alpha[first] === 0) continue
    label += 1
    labels[first] = label
    queue[0] = first
    let queued = 1
    let mass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!
      mass += alpha[current]!
      const x = current % width
      const y = Math.floor(current / width)
      for (const next of [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]) {
        if (next < 0 || labels[next] !== 0 || alpha[next] === 0) continue
        labels[next] = label
        queue[queued++] = next
      }
    }
    masses[label] = mass
  }
  return total === 0 ? 0 : Math.max(...masses) / total
}

async function compositionContinuityMetrics(
  image: Buffer,
  centerX: number,
  centerY: number,
  depth: number,
): Promise<Pick<BodyHeadCausalMetrics, 'largestComponentRatio' | 'centerlineGapPx'>> {
  const alpha = await sharp(image).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  let maxGap = 0
  let gap = 0
  for (let y = Math.max(0, Math.round(centerY - depth)); y <= Math.min(2047, Math.round(centerY + depth)); y += 1) {
    let opaque = false
    for (let x = centerX - 2; x <= centerX + 2; x += 1) {
      if (alpha.data[y * alpha.info.width + x]! > 0) opaque = true
    }
    if (opaque) gap = 0
    else {
      gap += 1
      maxGap = Math.max(maxGap, gap)
    }
  }
  return {
    largestComponentRatio: largestAlphaComponentRatio(alpha.data, alpha.info.width, alpha.info.height),
    centerlineGapPx: maxGap,
  }
}

/**
 * Rebuilds the exact approved body/head alpha composition in memory. It is shared by the renderer
 * and the acceptance validator so stored summaries cannot remain green after composition logic or
 * metric algorithms drift. This function never writes review artifacts.
 */
export async function composeBodyHeadMetricEvidence(input: {
  root: string
  body: FlattenedInterfaceVariant
  head: FlattenedInterfaceVariant
}): Promise<{ result: Buffer, metrics: BodyHeadCausalMetrics }> {
  const receiver = input.body.connectors.find(item => item.id === 'neck')
  const headNode = input.head.renderNodes.find(item => item.connectorId === 'neck')
  const plug = input.head.connectors.find(item => item.id === 'neck')
  const bodyNode = input.body.renderNodes[0]
  if (receiver === undefined || headNode === undefined || plug === undefined || bodyNode === undefined) {
    throw new Error('A body/head pair must declare neck receiver, neck plug, body node, and head node.')
  }
  const dx = Math.round(receiver.origin.x - plug.origin.x)
  const dy = Math.round(receiver.origin.y - plug.origin.y)
  const [back, front, bodyPng] = await Promise.all([
    maskedSource(input.root, headNode.sourcePngPath, plug.backgroundMaskPath),
    maskedSource(input.root, headNode.sourcePngPath, plug.foregroundMaskPath),
    readFile(resolve(input.root, bodyNode.sourcePngPath)),
  ])
  const [placedBack, placedFront] = await Promise.all([translated(back, dx, dy), translated(front, dx, dy)])
  const result = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: placedBack }, { input: bodyPng }, { input: placedFront }])
    .png(PNG)
    .toBuffer()
  return {
    result,
    metrics: {
      ...(await compositionContinuityMetrics(result, receiver.origin.x, receiver.origin.y, Math.max(receiver.depth, plug.depth))),
      ...(await measureVisibleConnectorTongue(input)),
      centralLobeDepthRatio: await measureCentralLobeDepthRatio({
      imagePath: resolve(input.root, headNode.sourcePngPath),
      rigId: input.head.rigId,
      headId: input.head.partId,
      connector: plug,
      }),
    },
  }
}

export async function measureBodyHeadCausalMetrics(input: {
  root: string
  body: FlattenedInterfaceVariant
  head: FlattenedInterfaceVariant
}): Promise<BodyHeadCausalMetrics> {
  return (await composeBodyHeadMetricEvidence(input)).metrics
}
