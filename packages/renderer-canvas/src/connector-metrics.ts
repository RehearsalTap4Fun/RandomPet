import type { Point2D } from '@qmonster/generator-core'
import type { ConnectorMetric } from './types.js'

export interface ConnectorAlphaInput {
  connectorId: string
  bridge: Uint8ClampedArray
  receiverContour: Uint8ClampedArray
  plugContour: Uint8ClampedArray
  structure: Uint8ClampedArray
  width: number
  height: number
  centerline: readonly Point2D[]
  body?: Uint8ClampedArray
  child?: Uint8ClampedArray
}

export const CONNECTOR_COVERAGE_MIN = 0.9
export const CONNECTOR_GAP_MAX_1024 = 2
export const STRUCTURE_ALPHA_MASS_MIN = 0.99
export const EXTERNAL_LIMB_ALPHA_MIN = 0.614

export function connectorMetricMeetsThresholds(
  metric: ConnectorMetric,
  requireExternalLimbAlpha: boolean,
): boolean {
  return metric.receiverCoverage >= CONNECTOR_COVERAGE_MIN
    && metric.plugCoverage >= CONNECTOR_COVERAGE_MIN
    && metric.centerlineGapPixels <= CONNECTOR_GAP_MAX_1024
    && (!requireExternalLimbAlpha
      || (metric.childOutsideBodyRatio ?? 0) >= EXTERNAL_LIMB_ALPHA_MIN)
}

export function structureMetricMeetsThreshold(metric: ConnectorMetric): boolean {
  return metric.largestComponentRatio >= STRUCTURE_ALPHA_MASS_MIN
}

function alphaByte(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return 0
  return pixels[(y * width + x) * 4 + 3] ?? 0
}

function alpha(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return alphaByte(pixels, width, x, y) / 255
}

function contourCoverage(bridge: Uint8ClampedArray, contour: Uint8ClampedArray): number {
  let contourMass = 0
  let overlapMass = 0
  for (let offset = 3; offset < contour.length; offset += 4) {
    const contourAlpha = contour[offset] ?? 0
    contourMass += contourAlpha
    overlapMass += Math.min(contourAlpha, bridge[offset] ?? 0)
  }
  return contourMass === 0 ? 0 : overlapMass / contourMass
}

const componentRatioCache = new WeakMap<Uint8ClampedArray, Map<string, number>>()

function largestComponentRatio(input: ConnectorAlphaInput): number {
  const dimensionKey = `${input.width}x${input.height}`
  const cached = componentRatioCache.get(input.structure)?.get(dimensionKey)
  if (cached !== undefined) return cached
  const pixelCount = input.width * input.height
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let totalMass = 0
  for (let index = 0; index < pixelCount; index += 1) {
    totalMass += input.structure[index * 4 + 3] ?? 0
  }
  let largestMass = 0
  for (let first = 0; first < pixelCount; first += 1) {
    if (visited[first] === 1 || (input.structure[first * 4 + 3] ?? 0) === 0) continue
    visited[first] = 1
    queue[0] = first
    let queued = 1
    let componentMass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!
      const x = current % input.width
      const y = Math.floor(current / input.width)
      componentMass += alphaByte(input.structure, input.width, x, y)
      for (const [nextX, nextY] of [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ] as const) {
        if (nextX < 0 || nextX >= input.width || nextY < 0 || nextY >= input.height) continue
        const index = nextY * input.width + nextX
        if (visited[index] === 1 || (input.structure[index * 4 + 3] ?? 0) === 0) continue
        visited[index] = 1
        queue[queued] = index
        queued += 1
      }
    }
    largestMass = Math.max(largestMass, componentMass)
  }
  const ratio = totalMass === 0 ? 0 : largestMass / totalMass
  let dimensions = componentRatioCache.get(input.structure)
  if (dimensions === undefined) {
    dimensions = new Map()
    componentRatioCache.set(input.structure, dimensions)
  }
  dimensions.set(dimensionKey, ratio)
  return ratio
}

function childOutsideBody(input: ConnectorAlphaInput): number | null {
  if (input.child === undefined || input.body === undefined) return null
  let childAlpha = 0
  let outsideAlpha = 0
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const child = alpha(input.child, input.width, x, y)
      childAlpha += child
      outsideAlpha += child * (1 - alpha(input.body, input.width, x, y))
    }
  }
  return childAlpha === 0 ? 0 : outsideAlpha / childAlpha
}

export function measureConnectorAlpha(input: ConnectorAlphaInput): ConnectorMetric {
  const expectedLength = input.width * input.height * 4
  const requiredMasks = [
    input.bridge, input.receiverContour, input.plugContour, input.structure,
  ]
  if (
    !Number.isInteger(input.width)
    || !Number.isInteger(input.height)
    || input.width <= 0
    || input.height <= 0
    || requiredMasks.some(mask => mask.length !== expectedLength)
    || (input.body !== undefined && input.body.length !== expectedLength)
    || (input.child !== undefined && input.child.length !== expectedLength)
  ) {
    throw new Error('Connector alpha masks require matching positive RGBA dimensions.')
  }
  const gapAtRenderResolution = input.centerline.reduce((sum, point) => (
    sum + 1 - alpha(input.bridge, input.width, point.x, point.y)
  ), 0)
  return {
    connectorId: input.connectorId,
    receiverCoverage: contourCoverage(input.bridge, input.receiverContour),
    plugCoverage: contourCoverage(input.bridge, input.plugContour),
    largestComponentRatio: largestComponentRatio(input),
    centerlineGapPixels: gapAtRenderResolution * 1024 / input.width,
    childOutsideBodyRatio: childOutsideBody(input),
  }
}
