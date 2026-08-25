import sharp from 'sharp'

export interface AlphaBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AlphaMask {
  width: number
  height: number
  alpha: Uint8Array
  bounds: AlphaBounds
}

export interface CalibrationPoint {
  x: number
  y: number
}

export type BodyJunctionSocket = 'head' | 'headAlternate' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight'
export type ChildJunction = 'head' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight'

export const ALPHA_JUNCTION_THRESHOLD = 8
export const MAX_PROXIMAL_CONTOUR_DISTANCE_PX = 48

export function alphaMaskFromRgba(
  data: Uint8Array,
  width: number,
  height: number,
  channels = 4,
): AlphaMask {
  const alpha = new Uint8Array(width * height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = channels === 4 ? data[(y * width + x) * channels + 3] ?? 0 : 255
      if (value <= ALPHA_JUNCTION_THRESHOLD) continue
      alpha[y * width + x] = value
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Alpha calibration requires opaque pixels')
  return {
    width,
    height,
    alpha,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

export async function loadAlphaMask(path: string): Promise<AlphaMask> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return alphaMaskFromRgba(data, info.width, info.height, info.channels)
}

export function cropAlphaMask(mask: AlphaMask, rect: { left: number; top: number; width: number; height: number }): AlphaMask {
  const alpha = new Uint8Array(rect.width * rect.height)
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      alpha[y * rect.width + x] = mask.alpha[(rect.top + y) * mask.width + rect.left + x] ?? 0
    }
  }
  const rgba = new Uint8Array(rect.width * rect.height * 4)
  for (let index = 0; index < alpha.length; index += 1) rgba[index * 4 + 3] = alpha[index] ?? 0
  return alphaMaskFromRgba(rgba, rect.width, rect.height)
}

function opaqueAt(mask: AlphaMask, x: number, y: number): boolean {
  return x >= 0 && x < mask.width && y >= 0 && y < mask.height
    && (mask.alpha[y * mask.width + x] ?? 0) > ALPHA_JUNCTION_THRESHOLD
}

function nearestPopulatedColumn(mask: AlphaMask, targetX: number): number {
  const center = Math.round(targetX)
  for (let radius = 0; radius <= mask.width; radius += 1) {
    for (const x of radius === 0 ? [center] : [center - radius, center + radius]) {
      if (x < 0 || x >= mask.width) continue
      for (let y = mask.bounds.y; y < mask.bounds.y + mask.bounds.height; y += 1) {
        if (opaqueAt(mask, x, y)) return x
      }
    }
  }
  throw new Error('No populated alpha column')
}

function nearestPopulatedRow(mask: AlphaMask, targetY: number): number {
  const center = Math.round(targetY)
  for (let radius = 0; radius <= mask.height; radius += 1) {
    for (const y of radius === 0 ? [center] : [center - radius, center + radius]) {
      if (y < 0 || y >= mask.height) continue
      for (let x = mask.bounds.x; x < mask.bounds.x + mask.bounds.width; x += 1) {
        if (opaqueAt(mask, x, y)) return y
      }
    }
  }
  throw new Error('No populated alpha row')
}

function verticalExtent(mask: AlphaMask, targetX: number): { x: number; top: number; bottom: number } {
  const x = nearestPopulatedColumn(mask, targetX)
  let top = mask.height
  let bottom = -1
  for (let y = mask.bounds.y; y < mask.bounds.y + mask.bounds.height; y += 1) {
    if (!opaqueAt(mask, x, y)) continue
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  return { x, top, bottom }
}

function horizontalExtent(mask: AlphaMask, targetY: number): { y: number; left: number; right: number } {
  const y = nearestPopulatedRow(mask, targetY)
  let left = mask.width
  let right = -1
  for (let x = mask.bounds.x; x < mask.bounds.x + mask.bounds.width; x += 1) {
    if (!opaqueAt(mask, x, y)) continue
    left = Math.min(left, x)
    right = Math.max(right, x)
  }
  return { y, left, right }
}

function insetToward(value: number, opposite: number, insetPx: number): number {
  const direction = Math.sign(opposite - value)
  return Math.round(value + direction * Math.min(insetPx, Math.abs(opposite - value)))
}

export function calibrateBodySocket(
  mask: AlphaMask,
  input: { socket: BodyJunctionSocket; insetPx: number; targetY?: number },
): CalibrationPoint {
  if (input.socket === 'head' || input.socket === 'headAlternate') {
    const ratio = input.socket === 'head' ? 0.42 : 0.72
    const targetX = mask.bounds.x + (mask.bounds.width - 1) * ratio
    const extent = verticalExtent(mask, targetX)
    return { x: extent.x, y: insetToward(extent.top, extent.bottom, input.insetPx) }
  }
  if (input.socket === 'legLeft' || input.socket === 'legRight') {
    const ratio = input.socket === 'legLeft' ? 0.38 : 0.62
    const targetX = mask.bounds.x + (mask.bounds.width - 1) * ratio
    const extent = verticalExtent(mask, targetX)
    return { x: extent.x, y: insetToward(extent.bottom, extent.top, input.insetPx) }
  }
  if (input.targetY === undefined) throw new Error(`${input.socket} calibration requires targetY`)
  const extent = horizontalExtent(mask, input.targetY)
  return input.socket === 'armLeft'
    ? { x: insetToward(extent.left, extent.right, input.insetPx), y: extent.y }
    : { x: insetToward(extent.right, extent.left, input.insetPx), y: extent.y }
}

export function calibrateChildOrigin(
  mask: AlphaMask,
  input: { junction: ChildJunction; insetPx: number },
): CalibrationPoint {
  if (input.junction === 'head') {
    const extent = verticalExtent(mask, mask.bounds.x + (mask.bounds.width - 1) * 0.42)
    return { x: extent.x, y: insetToward(extent.bottom, extent.top, input.insetPx) }
  }
  if (input.junction === 'legLeft' || input.junction === 'legRight') {
    const extent = verticalExtent(mask, mask.bounds.x + (mask.bounds.width - 1) * 0.5)
    return { x: extent.x, y: insetToward(extent.top, extent.bottom, input.insetPx) }
  }
  const regionTop = Math.round(mask.bounds.y + (mask.bounds.height - 1) * 0.25)
  const targetY = Math.round(mask.bounds.y + (mask.bounds.height - 1) * 0.4)
  const regionBottom = Math.round(mask.bounds.y + (mask.bounds.height - 1) * 0.65)
  const rows: Array<{ y: number; inner: number; opposite: number }> = []
  for (let y = regionTop; y <= regionBottom; y += 1) {
    try {
      const extent = horizontalExtent(mask, y)
      rows.push(input.junction === 'armLeft'
        ? { y: extent.y, inner: extent.right, opposite: extent.left }
        : { y: extent.y, inner: extent.left, opposite: extent.right })
    } catch {
      // Transparent rows are not proximal candidates.
    }
  }
  if (rows.length === 0) throw new Error(`No ${input.junction} proximal alpha`)
  const extreme = input.junction === 'armLeft'
    ? Math.max(...rows.map(row => row.inner))
    : Math.min(...rows.map(row => row.inner))
  const tolerance = mask.bounds.width * 0.02
  const eligible = rows.filter(row => input.junction === 'armLeft'
    ? row.inner >= extreme - tolerance
    : row.inner <= extreme + tolerance)
  const proximal = eligible.sort((left, right) => Math.abs(left.y - targetY) - Math.abs(right.y - targetY))[0]!
  return { x: insetToward(proximal.inner, proximal.opposite, input.insetPx), y: proximal.y }
}

export function contourDistance(mask: AlphaMask, point: CalibrationPoint): number {
  const centerX = Math.round(point.x)
  const centerY = Math.round(point.y)
  const centerOpaque = opaqueAt(mask, centerX, centerY)
  for (let radius = 0; radius <= Math.max(mask.width, mask.height); radius += 1) {
    let closest = Number.POSITIVE_INFINITY
    for (let offset = -radius; offset <= radius; offset += 1) {
      for (const [x, y] of [
        [centerX + offset, centerY - radius],
        [centerX + offset, centerY + radius],
        [centerX - radius, centerY + offset],
        [centerX + radius, centerY + offset],
      ]) {
        if (opaqueAt(mask, x, y) === centerOpaque) continue
        closest = Math.min(closest, Math.hypot(x - point.x, y - point.y))
      }
    }
    if (Number.isFinite(closest)) return closest
  }
  return Number.POSITIVE_INFINITY
}

export function assertNearOpaqueProximalContour(
  mask: AlphaMask,
  point: CalibrationPoint,
  maxDistancePx = MAX_PROXIMAL_CONTOUR_DISTANCE_PX,
): void {
  const distance = contourDistance(mask, point)
  if (distance > maxDistancePx) {
    throw new Error(`anchor must lie on or near the actual opaque proximal contour (distance ${distance.toFixed(1)}px > ${maxDistancePx}px)`)
  }
}
