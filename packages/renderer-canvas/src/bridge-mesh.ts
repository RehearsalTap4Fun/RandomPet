import type { Point2D } from '@qmonster/generator-core'
import type { SolvedConnector } from './connector-solver.js'

export interface BridgeTriangle {
  source: readonly [Point2D, Point2D, Point2D]
  destination: readonly [Point2D, Point2D, Point2D]
}

export interface BridgeMesh {
  rows: Point2D[][]
  triangles: BridgeTriangle[]
}

export interface BridgeContourRaster {
  pixels: Uint8ClampedArray
  width: number
  height: number
}

export interface BridgeContours {
  receiver: BridgeContourRaster
  plug: BridgeContourRaster
}

const SIZE = 4

function interpolate(left: number, right: number, amount: number): number {
  return left + (right - left) * amount
}

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function endRow(origin: Point2D, tangent: Point2D, width: number): Point2D[] {
  return Array.from({ length: SIZE }, (_, column) => {
    const offset = interpolate(-width / 2, width / 2, column / (SIZE - 1))
    return { x: origin.x + tangent.x * offset, y: origin.y + tangent.y * offset }
  })
}

function contourEndRow(
  contour: BridgeContourRaster,
  tangent: Point2D,
  normal: Point2D,
): Point2D[] {
  if (
    !Number.isInteger(contour.width) || !Number.isInteger(contour.height)
    || contour.width <= 0 || contour.height <= 0
    || contour.pixels.length !== contour.width * contour.height * 4
  ) throw new Error('Bridge contour requires matching positive RGBA dimensions.')
  let frontierNormal = Number.NEGATIVE_INFINITY
  for (let y = 0; y < contour.height; y += 1) {
    for (let x = 0; x < contour.width; x += 1) {
      if ((contour.pixels[(y * contour.width + x) * 4 + 3] ?? 0) === 0) continue
      frontierNormal = Math.max(
        frontierNormal,
        (x + 0.5) * normal.x + (y + 0.5) * normal.y,
      )
    }
  }
  if (!Number.isFinite(frontierNormal)) throw new Error('Bridge contour requires visible alpha.')
  let tangentMin = Number.POSITIVE_INFINITY
  let tangentMax = Number.NEGATIVE_INFINITY
  let normalSum = 0
  let frontierCount = 0
  for (let y = 0; y < contour.height; y += 1) {
    for (let x = 0; x < contour.width; x += 1) {
      if ((contour.pixels[(y * contour.width + x) * 4 + 3] ?? 0) === 0) continue
      const point = { x: x + 0.5, y: y + 0.5 }
      const normalProjection = point.x * normal.x + point.y * normal.y
      if (frontierNormal - normalProjection >= 0.75) continue
      const tangentProjection = point.x * tangent.x + point.y * tangent.y
      tangentMin = Math.min(tangentMin, tangentProjection)
      tangentMax = Math.max(tangentMax, tangentProjection)
      normalSum += normalProjection
      frontierCount += 1
    }
  }
  if (frontierCount === 0) throw new Error('Bridge contour requires a visible frontier.')
  const meanNormal = normalSum / frontierCount
  return Array.from({ length: SIZE }, (_, column) => {
    const along = interpolate(tangentMin, tangentMax, column / (SIZE - 1))
    return {
      x: tangent.x * along + normal.x * meanNormal,
      y: tangent.y * along + normal.y * meanNormal,
    }
  })
}

export function buildBridgeMesh(solved: SolvedConnector, contours?: BridgeContours): BridgeMesh {
  const numericValues = [
    solved.receiverWidth, solved.plugWidth, solved.receiverDepth, solved.plugDepth,
    solved.receiverOrigin.x, solved.receiverOrigin.y, solved.plugOrigin.x, solved.plugOrigin.y,
    solved.receiverTangent.x, solved.receiverTangent.y, solved.plugTangent.x, solved.plugTangent.y,
  ]
  if (numericValues.some(value => !Number.isFinite(value))) {
    throw new Error('Bridge mesh requires finite connector geometry.')
  }
  const receiver = contours === undefined
    ? endRow(solved.receiverOrigin, solved.receiverTangent, solved.receiverWidth)
    : contourEndRow(contours.receiver, solved.receiverTangent, solved.receiverNormal)
  const plug = contours === undefined
    ? endRow(solved.plugOrigin, solved.plugTangent, solved.plugWidth)
    : contourEndRow(contours.plug, solved.plugTangent, solved.plugNormal)
  if (![...receiver, ...plug].every(finitePoint)) {
    throw new Error('Bridge mesh requires finite connector geometry.')
  }
  const rows = Array.from({ length: SIZE }, (_, row) => (
    row === 0
      ? receiver
      : row === SIZE - 1
        ? plug
        : receiver.map((point, column) => ({
          x: interpolate(point.x, plug[column]!.x, row / (SIZE - 1)),
          y: interpolate(point.y, plug[column]!.y, row / (SIZE - 1)),
        }))
  ))
  const triangles: BridgeTriangle[] = []
  for (let row = 0; row < SIZE - 1; row += 1) {
    for (let column = 0; column < SIZE - 1; column += 1) {
      const sourceX = column / (SIZE - 1)
      const sourceY = row / (SIZE - 1)
      const nextX = (column + 1) / (SIZE - 1)
      const nextY = (row + 1) / (SIZE - 1)
      const topLeft = rows[row]![column]!
      const topRight = rows[row]![column + 1]!
      const bottomLeft = rows[row + 1]![column]!
      const bottomRight = rows[row + 1]![column + 1]!
      triangles.push({
        source: [{ x: sourceX, y: sourceY }, { x: nextX, y: sourceY }, { x: sourceX, y: nextY }],
        destination: [topLeft, topRight, bottomLeft],
      }, {
        source: [{ x: nextX, y: sourceY }, { x: nextX, y: nextY }, { x: sourceX, y: nextY }],
        destination: [topRight, bottomRight, bottomLeft],
      })
    }
  }
  return { rows, triangles }
}
