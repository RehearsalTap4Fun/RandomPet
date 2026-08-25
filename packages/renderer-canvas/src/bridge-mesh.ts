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

export function buildBridgeMesh(solved: SolvedConnector): BridgeMesh {
  const numericValues = [
    solved.receiverWidth, solved.plugWidth, solved.receiverDepth, solved.plugDepth,
    solved.receiverOrigin.x, solved.receiverOrigin.y, solved.plugOrigin.x, solved.plugOrigin.y,
    solved.receiverTangent.x, solved.receiverTangent.y, solved.plugTangent.x, solved.plugTangent.y,
  ]
  if (numericValues.some(value => !Number.isFinite(value))) {
    throw new Error('Bridge mesh requires finite connector geometry.')
  }
  const receiver = endRow(solved.receiverOrigin, solved.receiverTangent, solved.receiverWidth)
  const plug = endRow(solved.plugOrigin, solved.plugTangent, solved.plugWidth)
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
