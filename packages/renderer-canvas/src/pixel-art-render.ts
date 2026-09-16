import { canonicalJson, requirePixelArtCatalog, resolvePixelArt, type PixelArtPlan, type PixelPolygon, type PixelResource } from '../../asset-catalog/src/pixel-art-catalog.js'
import type { FelinePhenotype } from '../../generator-core/src/feline-phenotype.js'

type Pixels = Uint8ClampedArray
const N = 64

function erase(pixels: Pixels, polygons: PixelPolygon[]): void {
  for (const polygon of polygons) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!
      if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside
    }
    if (inside) pixels.fill(0, (y * N + x) * 4, (y * N + x) * 4 + 4)
  }
}

function over(dst: Pixels, src: Pixels): void {
  for (let i = 0; i < dst.length; i += 4) if (src[i + 3]) dst.set(src.subarray(i, i + 4), i)
}

/** Nutri pixel-rgba-v1 semantics: four-neighbor 1px outline, darkened by 0.36. */
function outline(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4
    if (src[i + 3]) continue
    let r = 0, g = 0, b = 0, count = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue
      const j = (ny * N + nx) * 4
      if (!src[j + 3]) continue
      r += src[j]!; g += src[j + 1]!; b += src[j + 2]!; count++
    }
    if (count) out.set([Math.round(r / count * 0.36), Math.round(g / count * 0.36), Math.round(b / count * 0.36), 255], i)
  }
  return out
}

/** Synchronous pure renderer. Resolve plans from a validated catalog, not user JSON. */
export function composePixelArt(plan: PixelArtPlan, layers: Record<string, Pixels>): Pixels {
  if (plan.size !== N) throw new Error('Unsupported pixel dimensions.')
  const frame = new Uint8ClampedArray(N * N * 4), subject = new Uint8ClampedArray(N * N * 4)
  for (const op of plan.operations) {
    if (op.kind === 'clear') { erase(subject, op.polygons); continue }
    const source = layers[op.resource]
    if (!source) throw new Error(`Missing pixel layer: ${op.resource}`)
    if (source.length !== N * N * 4) throw new Error(`Invalid pixel dimensions: ${op.resource}`)
    const pixels = new Uint8ClampedArray(source)
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 0 && pixels[i + 3] !== 255) throw new Error(`Invalid binary alpha: ${op.resource}`)
      if (!pixels[i + 3]) pixels.fill(0, i, i + 4)
    }
    erase(pixels, op.occlusion)
    over(op.target === 'frame' ? frame : subject, op.target === 'frame' ? outline(pixels) : pixels)
  }
  over(frame, outline(subject))
  return frame
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPixelCatalog(input: unknown) {
  const catalog = requirePixelArtCatalog(input)
  const { revision, ...content } = catalog
  if (await digest(new TextEncoder().encode(canonicalJson(content))) !== revision) throw new Error('Pixel catalog revision mismatch.')
  return catalog
}

export async function verifyPixelPng(bytes: Uint8Array, resource: PixelResource): Promise<void> {
  if (await digest(bytes) !== resource.sha256) throw new Error(`SHA-256 mismatch: ${resource.path}`)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || signature.some((n, i) => bytes[i] !== n)) throw new Error('Invalid PNG signature.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(16) !== resource.width || view.getUint32(20) !== resource.height) throw new Error('Invalid PNG dimensions.')
}

/** Browser loader. Every layer is hash-checked before decode; no implicit fallback. */
export async function loadPixelArt(input: unknown, resourceUrl: (resource: PixelResource) => string) {
  const catalog = await verifyPixelCatalog(input)
  const layers: Record<string, Pixels> = {}
  await Promise.all(Object.entries(catalog.resources).map(async ([id, resource]) => {
    const response = await fetch(resourceUrl(resource))
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${resource.path}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await verifyPixelPng(bytes, resource)
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    try {
      if (bitmap.width !== N || bitmap.height !== N) throw new Error(`Decoded dimensions mismatch: ${id}`)
      const canvas = document.createElement('canvas'); canvas.width = N; canvas.height = N
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas unavailable.')
      context.drawImage(bitmap, 0, 0)
      layers[id] = context.getImageData(0, 0, N, N).data
      for (let i = 3; i < layers[id].length; i += 4) if (layers[id][i] !== 0 && layers[id][i] !== 255) throw new Error(`Invalid binary alpha: ${id}`)
    } finally { bitmap.close() }
  }))
  // Keep the verified catalog/layers private; exposed metadata is a detached copy.
  return { catalog: structuredClone(catalog), render: (phenotype: FelinePhenotype) => composePixelArt(resolvePixelArt(phenotype, catalog), layers) }
}

/** Use the same native pixels for display and transparent integer-scale downloads. */
export function pixelCanvas(pixels: Pixels, scale: 1 | 2 = 1): HTMLCanvasElement {
  if (pixels.length !== N * N * 4 || (scale !== 1 && scale !== 2)) throw new Error('Invalid pixel export size.')
  const native = document.createElement('canvas'); native.width = N; native.height = N
  const context = native.getContext('2d')
  if (!context) throw new Error('Canvas unavailable.')
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), N, N), 0, 0)
  if (scale === 1) return native
  const big = document.createElement('canvas'); big.width = N * scale; big.height = N * scale
  const target = big.getContext('2d')
  if (!target) throw new Error('Canvas unavailable.')
  target.imageSmoothingEnabled = false; target.drawImage(native, 0, 0, big.width, big.height)
  return big
}
