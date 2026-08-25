import type { Point2D, Rect } from '@qmonster/generator-core'
import type { Placement } from './types.js'

export function rgbaInsideTransformedRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rasterOrigin: Point2D,
  placement: Placement,
  region: Rect,
): string | null {
  if (
    width <= 0 || height <= 0 || pixels.length !== width * height * 4
    || placement.scaleX === 0 || placement.scaleY === 0
  ) return null
  const radians = (placement.rotationDegrees ?? 0) * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0
  let count = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const worldX = rasterOrigin.x + x + 0.5
      const worldY = rasterOrigin.y + y + 0.5
      const deltaX = worldX - placement.x
      const deltaY = worldY - placement.y
      const localX = (deltaX * cosine + deltaY * sine) / placement.scaleX
      const localY = (-deltaX * sine + deltaY * cosine) / placement.scaleY
      if (
        localX < region.x || localX >= region.x + region.width
        || localY < region.y || localY >= region.y + region.height
      ) continue
      const offset = (y * width + x) * 4
      red += pixels[offset] ?? 0
      green += pixels[offset + 1] ?? 0
      blue += pixels[offset + 2] ?? 0
      alpha += pixels[offset + 3] ?? 0
      count += 1
    }
  }
  if (count === 0) return null
  return `rgba(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)}, ${alpha / count / 255})`
}
