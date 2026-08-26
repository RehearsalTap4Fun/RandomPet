import { resolve } from 'node:path'
import sharp from 'sharp'
import type { FlattenedInterfaceVariant } from './interface-source-schema.js'

export const MAX_VISIBLE_TONGUE_DEPTH_RATIO = 0.1
export const MAX_VISIBLE_TONGUE_AREA_RATIO = 0.1
export const MAX_CENTRAL_LOBE_DEPTH_RATIO = 0.2

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
  connector: FlattenedInterfaceVariant['connectors'][number]
}): Promise<number> {
  const alpha = await alphaPlane(input.imagePath)
  const { centralBottom, shoulderBaseline } = centralLobeEnvelope(alpha, input.connector)
  return Math.max(0, centralBottom - shoulderBaseline) / Math.max(1, input.connector.depth)
}

function centralLobeEnvelope(
  alpha: AlphaPlane,
  plug: FlattenedInterfaceVariant['connectors'][number],
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
    .filter(([tangent]) => Math.abs(tangent) <= plug.width * 0.4)
    .map(([, bottom]) => bottom)
  const shoulders = [...bottomByTangent]
    .filter(([tangent]) => Math.abs(tangent) >= plug.width * 0.65 && Math.abs(tangent) <= plug.width * 1.5)
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
  const { shoulderBaseline } = centralLobeEnvelope(headAlpha, plug)
  const depthBins = new Map<number, number>()
  let visibleHeadMass = 0
  for (let y = 0; y < headAlpha.height; y += 1) for (let x = 0; x < headAlpha.width; x += 1) {
    const head = alphaAt(headAlpha, x, y)
    if (head === 0) continue
    const deltaX = x + 0.5 - plug.origin.x
    const deltaY = y + 0.5 - plug.origin.y
    const tangentDistance = deltaX * plug.tangent.x + deltaY * plug.tangent.y
    const outwardDistance = deltaX * plug.outwardNormal.x + deltaY * plug.outwardNormal.y
    if (Math.abs(tangentDistance) > plug.width * 0.4) continue
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
  const significantBinMass = Math.max(2, plug.width * 0.02) * 255
  const lastVisibleDepth = Math.max(-1, ...[...depthBins]
    .filter(([, mass]) => mass >= significantBinMass)
    .map(([depth]) => depth))
  return {
    visibleTongueDepthRatio: lastVisibleDepth < 0
      ? 0
      : (lastVisibleDepth + 1) / Math.max(1, plug.depth),
    visibleTongueAreaRatio: visibleHeadMass / Math.max(1, plug.width * plug.depth * 255),
  }
}
