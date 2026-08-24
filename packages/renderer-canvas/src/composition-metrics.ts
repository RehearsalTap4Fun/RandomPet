import type { WorldRect } from './types.js'

export interface FeatureAlphaMetric {
  insideRatio: number
  visibleRatio: number
}

function zonesArray(zones: WorldRect | readonly WorldRect[]): readonly WorldRect[] {
  return 'x' in zones ? [zones] : zones
}

function isInside(x: number, y: number, zones: readonly WorldRect[]): boolean {
  return zones.some(zone => (
    x >= zone.x
    && x < zone.x + zone.width
    && y >= zone.y
    && y < zone.y + zone.height
  ))
}

export function measureFeatureAlpha(
  feature: Uint8ClampedArray,
  occluder: Uint8ClampedArray,
  width: number,
  height: number,
  safeZones: WorldRect | readonly WorldRect[],
): FeatureAlphaMetric {
  const zones = zonesArray(safeZones)
  let featureAlpha = 0
  let insideAlpha = 0
  let visibleAlpha = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4 + 3
      const alpha = feature[index] ?? 0
      featureAlpha += alpha
      if (isInside(x, y, zones)) insideAlpha += alpha
      visibleAlpha += alpha * (1 - (occluder[index] ?? 0) / 255)
    }
  }

  if (featureAlpha === 0) return { insideRatio: 0, visibleRatio: 0 }
  return {
    insideRatio: insideAlpha / featureAlpha,
    visibleRatio: visibleAlpha / featureAlpha,
  }
}

export function measureVisibleBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WorldRect | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
