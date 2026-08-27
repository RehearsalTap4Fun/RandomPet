import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Catalog, Point2D, VisualSlotId } from '@qmonster/generator-core'
import { resolveAttachmentTree } from '../packages/renderer-canvas/src/attachment-tree.js'
import type { Placement, ResolvedRenderNode, WorldRect } from '../packages/renderer-canvas/src/types.js'
import catalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import { loadCompositionAcceptanceInput } from './composition-acceptance-input.js'

const MASTER_SIZE = 2048
const ALPHA_THRESHOLD = 8
const CONTOUR_LIMIT = 24
const GAP_LIMIT = 8
const catalog = catalogDocument as unknown as Catalog
const acceptance = await loadCompositionAcceptanceInput(process.cwd()) as unknown as {
  entries: Array<{ index: number; seed: string; spec: Parameters<typeof resolveAttachmentTree>[0] }>
}

interface AlphaSource {
  width: number
  height: number
  alpha: Uint8Array
  bounds: WorldRect
}

interface WorldMask {
  alpha: Uint8Array
  bounds: WorldRect
  pixels: number
}

interface JunctionMeasurement {
  entry: number
  node: ResolvedRenderNode
  body: WorldMask
  child: WorldMask
  socket: Point2D
  parentContourDistance: number
  childContourDistance: number
  externalGap: number
  overlapRatio: number
  fractionAboveSocket: number
  fractionBelowSocket: number
}

const sourceCache = new Map<string, Promise<AlphaSource>>()

async function loadAlpha(path: string): Promise<AlphaSource> {
  const cached = sourceCache.get(path)
  if (cached !== undefined) return cached
  const pending = (async () => {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = new Uint8Array(info.width * info.height)
    let minX = info.width
    let minY = info.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const value = data[(y * info.width + x) * 4 + 3] ?? 0
        if (value <= ALPHA_THRESHOLD) continue
        alpha[y * info.width + x] = value
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (maxX < minX || maxY < minY) throw new Error(`No opaque alpha in ${path}`)
    return {
      width: info.width,
      height: info.height,
      alpha,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    }
  })()
  sourceCache.set(path, pending)
  return pending
}

function toWorldMask(source: AlphaSource, placement: Placement): WorldMask {
  const alpha = new Uint8Array(MASTER_SIZE * MASTER_SIZE)
  let minX = MASTER_SIZE
  let minY = MASTER_SIZE
  let maxX = -1
  let maxY = -1
  let pixels = 0
  for (let y = source.bounds.y; y < source.bounds.y + source.bounds.height; y += 1) {
    for (let x = source.bounds.x; x < source.bounds.x + source.bounds.width; x += 1) {
      const value = source.alpha[y * source.width + x] ?? 0
      if (value === 0) continue
      const worldX = Math.floor(placement.x + (x + 0.5) * placement.scaleX)
      const worldY = Math.floor(placement.y + (y + 0.5) * placement.scaleY)
      if (worldX < 0 || worldX >= MASTER_SIZE || worldY < 0 || worldY >= MASTER_SIZE) continue
      const index = worldY * MASTER_SIZE + worldX
      if ((alpha[index] ?? 0) === 0) pixels += 1
      alpha[index] = Math.max(alpha[index] ?? 0, value)
      minX = Math.min(minX, worldX)
      minY = Math.min(minY, worldY)
      maxX = Math.max(maxX, worldX)
      maxY = Math.max(maxY, worldY)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Node is outside the master canvas')
  return {
    alpha,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    pixels,
  }
}

function opaqueAt(mask: WorldMask, x: number, y: number): boolean {
  return x >= 0 && x < MASTER_SIZE && y >= 0 && y < MASTER_SIZE
    && (mask.alpha[y * MASTER_SIZE + x] ?? 0) > ALPHA_THRESHOLD
}

function distanceToStatus(mask: WorldMask, point: Point2D, targetOpaque: boolean): number {
  const centerX = Math.round(point.x)
  const centerY = Math.round(point.y)
  for (let radius = 0; radius <= MASTER_SIZE; radius += 1) {
    let closest = Number.POSITIVE_INFINITY
    for (let offset = -radius; offset <= radius; offset += 1) {
      for (const [x, y] of [
        [centerX + offset, centerY - radius],
        [centerX + offset, centerY + radius],
        [centerX - radius, centerY + offset],
        [centerX + radius, centerY + offset],
      ]) {
        if (opaqueAt(mask, x, y) !== targetOpaque) continue
        closest = Math.min(closest, Math.hypot(x - point.x, y - point.y))
      }
    }
    if (Number.isFinite(closest)) return closest
  }
  return Number.POSITIVE_INFINITY
}

function contourDistance(mask: WorldMask, point: Point2D): number {
  return distanceToStatus(mask, point, !opaqueAt(mask, Math.round(point.x), Math.round(point.y)))
}

function distanceToOpaque(mask: WorldMask, point: Point2D): number {
  return opaqueAt(mask, Math.round(point.x), Math.round(point.y)) ? 0 : distanceToStatus(mask, point, true)
}

function intersectionPixels(left: WorldMask, right: WorldMask): number {
  let intersection = 0
  const minX = Math.max(left.bounds.x, right.bounds.x)
  const minY = Math.max(left.bounds.y, right.bounds.y)
  const maxX = Math.min(left.bounds.x + left.bounds.width, right.bounds.x + right.bounds.width)
  const maxY = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height)
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const index = y * MASTER_SIZE + x
      if ((left.alpha[index] ?? 0) > 0 && (right.alpha[index] ?? 0) > 0) intersection += 1
    }
  }
  return intersection
}

function fractionOnSide(mask: WorldMask, socketY: number, side: 'above' | 'below'): number {
  let count = 0
  for (let y = mask.bounds.y; y < mask.bounds.y + mask.bounds.height; y += 1) {
    if (side === 'above' ? y > socketY : y < socketY) continue
    for (let x = mask.bounds.x; x < mask.bounds.x + mask.bounds.width; x += 1) {
      if ((mask.alpha[y * MASTER_SIZE + x] ?? 0) > 0) count += 1
    }
  }
  return count / mask.pixels
}

function worldPoint(placement: Placement, local: Point2D): Point2D {
  return {
    x: placement.x + local.x * placement.scaleX,
    y: placement.y + local.y * placement.scaleY,
  }
}

async function maskFor(node: ResolvedRenderNode): Promise<WorldMask> {
  const path = join('packages', 'asset-catalog', 'assets', 'v0.2.0', node.node.pngPath)
  return toWorldMask(await loadAlpha(path), node.placement)
}

async function measurements(): Promise<JunctionMeasurement[]> {
  const result: JunctionMeasurement[] = []
  for (const entry of acceptance.entries) {
    const attachment = resolveAttachmentTree(entry.spec, catalog)
    expect(attachment.diagnostics, `entry ${entry.index} attachment diagnostics`).toEqual([])
    const bodyNode = attachment.nodes.find(node => node.slotId === 'bodyFrame')
    if (bodyNode === undefined) throw new Error(`Entry ${entry.index} has no body`)
    const body = await maskFor(bodyNode)
    for (const node of attachment.nodes.filter(candidate => (
      candidate.slotId === 'headShape' || candidate.slotId === 'arms' || candidate.slotId === 'legs'
    ))) {
      const child = await maskFor(node)
      const socket = worldPoint(node.placement, node.node.origin)
      const overlap = intersectionPixels(body, child)
      result.push({
        entry: entry.index,
        node,
        body,
        child,
        socket,
        parentContourDistance: contourDistance(body, socket),
        childContourDistance: contourDistance(child, socket),
        externalGap: distanceToOpaque(body, socket) + distanceToOpaque(child, socket),
        overlapRatio: overlap / child.pixels,
        fractionAboveSocket: fractionOnSide(child, socket.y, 'above'),
        fractionBelowSocket: fractionOnSide(child, socket.y, 'below'),
      })
    }
  }
  return result
}

let measured: Promise<JunctionMeasurement[]>
function fixedMeasurements(): Promise<JunctionMeasurement[]> {
  measured ??= measurements()
  return measured
}

function label(value: JunctionMeasurement): string {
  return `entry ${value.entry} ${value.node.key}`
}

function rounded(value: number): string {
  return value.toFixed(3)
}

describe('fixed-21 body junction geometry', () => {
  it('places every head at a small continuous seam above the body', async () => {
    const heads = (await fixedMeasurements()).filter(value => value.node.slotId === 'headShape')
    const violations = heads.flatMap(value => {
      const parentY = (value.socket.y - value.body.bounds.y) / value.body.bounds.height
      const failures = []
      if (value.parentContourDistance > CONTOUR_LIMIT) failures.push(`parentContour=${rounded(value.parentContourDistance)}`)
      if (value.childContourDistance > CONTOUR_LIMIT) failures.push(`childContour=${rounded(value.childContourDistance)}`)
      if (value.externalGap > GAP_LIMIT) failures.push(`gap=${rounded(value.externalGap)}`)
      if (value.overlapRatio < 0.02 || value.overlapRatio > 0.20) failures.push(`overlap=${rounded(value.overlapRatio)}`)
      if (parentY > 0.35) failures.push(`parentY=${rounded(parentY)}`)
      if (value.fractionAboveSocket < 0.65) failures.push(`above=${rounded(value.fractionAboveSocket)}`)
      return failures.length === 0 ? [] : [`${label(value)} ${failures.join(' ')}`]
    })
    expect(violations).toEqual([])
  }, 60_000)

  it('places every leg at a proximal seam below the body with most alpha external', async () => {
    const legs = (await fixedMeasurements()).filter(value => value.node.slotId === 'legs')
    const violations = legs.flatMap(value => {
      const parentY = (value.socket.y - value.body.bounds.y) / value.body.bounds.height
      const failures = []
      if (value.parentContourDistance > CONTOUR_LIMIT) failures.push(`parentContour=${rounded(value.parentContourDistance)}`)
      if (value.childContourDistance > CONTOUR_LIMIT) failures.push(`childContour=${rounded(value.childContourDistance)}`)
      if (value.externalGap > GAP_LIMIT) failures.push(`gap=${rounded(value.externalGap)}`)
      if (1 - value.overlapRatio < 0.65) failures.push(`external=${rounded(1 - value.overlapRatio)}`)
      if (parentY < 0.70) failures.push(`parentY=${rounded(parentY)}`)
      if (value.fractionBelowSocket < 0.65) failures.push(`below=${rounded(value.fractionBelowSocket)}`)
      return failures.length === 0 ? [] : [`${label(value)} ${failures.join(' ')}`]
    })
    expect(violations).toEqual([])
  }, 60_000)

  it('places every arm on the upper or middle side contour without enclosing its vertical bbox', async () => {
    const arms = (await fixedMeasurements()).filter(value => value.node.slotId === 'arms')
    const violations = arms.flatMap(value => {
      const parentX = (value.socket.x - value.body.bounds.x) / value.body.bounds.width
      const parentY = (value.socket.y - value.body.bounds.y) / value.body.bounds.height
      const sideCorrect = value.node.node.socket === 'armLeft' ? parentX <= 0.40 : parentX >= 0.60
      const verticallyEnclosed = value.child.bounds.y >= value.body.bounds.y
        && value.child.bounds.y + value.child.bounds.height <= value.body.bounds.y + value.body.bounds.height
      const failures = []
      if (value.parentContourDistance > CONTOUR_LIMIT) failures.push(`parentContour=${rounded(value.parentContourDistance)}`)
      if (value.childContourDistance > CONTOUR_LIMIT) failures.push(`childContour=${rounded(value.childContourDistance)}`)
      if (value.externalGap > GAP_LIMIT) failures.push(`gap=${rounded(value.externalGap)}`)
      if (1 - value.overlapRatio < 0.65) failures.push(`external=${rounded(1 - value.overlapRatio)}`)
      if (!sideCorrect) failures.push(`parentX=${rounded(parentX)}`)
      if (parentY < 0.15 || parentY > 0.70) failures.push(`parentY=${rounded(parentY)}`)
      if (verticallyEnclosed) failures.push('verticalBBox=enclosed')
      return failures.length === 0 ? [] : [`${label(value)} ${failures.join(' ')}`]
    })
    expect(violations).toEqual([])
  }, 60_000)
})
