import type { Point2D } from '@qmonster/generator-core'
import type { ConnectorMetric } from './types.js'

export interface ConnectorAlphaInput {
  connectorId: string
  structure: Uint8ClampedArray
  width: number
  height: number
  receiverEnd: readonly Point2D[]
  plugEnd: readonly Point2D[]
  centerline: readonly Point2D[]
  body?: Uint8ClampedArray
  child?: Uint8ClampedArray
}

function alpha(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return 0
  return (pixels[(y * width + x) * 4 + 3] ?? 0) / 255
}

function coverage(input: ConnectorAlphaInput, points: readonly Point2D[]): number {
  if (points.length === 0) return 0
  return points.reduce((sum, point) => (
    sum + alpha(input.structure, input.width, point.x, point.y)
  ), 0) / points.length
}

const componentRatioCache = new WeakMap<Uint8ClampedArray, Map<string, number>>()

function largestComponentRatio(input: ConnectorAlphaInput): number {
  const dimensionKey = `${input.width}x${input.height}`
  const cached = componentRatioCache.get(input.structure)?.get(dimensionKey)
  if (cached !== undefined) return cached
  const occupied = new Set<number>()
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      if (alpha(input.structure, input.width, x, y) > 0) occupied.add(y * input.width + x)
    }
  }
  if (occupied.size === 0) return 0
  let largest = 0
  while (occupied.size > 0) {
    const first = occupied.values().next().value as number
    occupied.delete(first)
    const queue = [first]
    let count = 0
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!
      count += 1
      const x = current % input.width
      const y = Math.floor(current / input.width)
      for (const [nextX, nextY] of [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ] as const) {
        const index = nextY * input.width + nextX
        if (nextX < 0 || nextX >= input.width || nextY < 0 || nextY >= input.height) continue
        if (!occupied.delete(index)) continue
        queue.push(index)
      }
    }
    largest = Math.max(largest, count)
  }
  let total = 0
  for (let offset = 3; offset < input.structure.length; offset += 4) {
    if ((input.structure[offset] ?? 0) > 0) total += 1
  }
  const ratio = total === 0 ? 0 : largest / total
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
  if (
    !Number.isInteger(input.width)
    || !Number.isInteger(input.height)
    || input.width <= 0
    || input.height <= 0
    || input.structure.length !== input.width * input.height * 4
    || (input.body !== undefined && input.body.length !== input.structure.length)
    || (input.child !== undefined && input.child.length !== input.structure.length)
  ) {
    throw new Error('Connector alpha masks require matching positive RGBA dimensions.')
  }
  return {
    connectorId: input.connectorId,
    receiverCoverage: coverage(input, input.receiverEnd),
    plugCoverage: coverage(input, input.plugEnd),
    largestComponentRatio: largestComponentRatio(input),
    centerlineGapPixels: input.centerline.reduce((sum, point) => (
      sum + (alpha(input.structure, input.width, point.x, point.y) === 0 ? 1 : 0)
    ), 0),
    childOutsideBodyRatio: childOutsideBody(input),
  }
}
