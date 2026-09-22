import type { PixelSceneStateV1 } from '../../generator-core/src/pixel-scene-state.js'
import {
  requirePixelSceneCatalogV1,
  requireSceneSubjectCompatibility,
  resolveBackdrop,
  verifyPixelSceneCatalogV1,
  type PixelSceneCatalogV1,
  type PixelSceneResource,
  type PixelSceneSubjectCatalog,
} from '../../asset-catalog/src/pixel-scene-catalog.js'

type Pixels = Uint8ClampedArray

export const SCENE_WIDTH = 96
export const SCENE_HEIGHT = 64
export const SUBJECT_WIDTH = 64
export const SUBJECT_HEIGHT = 64
export const SUBJECT_X = 16
export const SUBJECT_Y = 0

function requireBinaryPixels(pixels: Pixels, width: number, height: number, label: string): void {
  if (pixels.length !== width * height * 4) throw new Error(`Invalid pixel dimensions: ${label}`)
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0 && pixels[index] !== 255) throw new Error(`Invalid binary alpha: ${label}`)
  }
}

export function outlineSceneBackdrop(source: Pixels): Pixels {
  requireBinaryPixels(source, SCENE_WIDTH, SCENE_HEIGHT, 'backdrop')
  const output = new Uint8ClampedArray(source)
  for (let y = 0; y < SCENE_HEIGHT; y++) for (let x = 0; x < SCENE_WIDTH; x++) {
    const offset = (y * SCENE_WIDTH + x) * 4
    if (source[offset + 3]) continue
    let red = 0, green = 0, blue = 0, count = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextX = x + dx, nextY = y + dy
      if (nextX < 0 || nextX >= SCENE_WIDTH || nextY < 0 || nextY >= SCENE_HEIGHT) continue
      const next = (nextY * SCENE_WIDTH + nextX) * 4
      if (!source[next + 3]) continue
      red += source[next]!
      green += source[next + 1]!
      blue += source[next + 2]!
      count++
    }
    if (count) output.set([
      Math.round(red / count * 0.36),
      Math.round(green / count * 0.36),
      Math.round(blue / count * 0.36),
      255,
    ], offset)
  }
  return output
}

export function composePixelScene(
  state: PixelSceneStateV1,
  catalogInput: PixelSceneCatalogV1,
  subjectCatalog: PixelSceneSubjectCatalog,
  subjectPixels: Pixels,
  layers: Record<string, Pixels>,
): Pixels {
  const catalog = requirePixelSceneCatalogV1(catalogInput)
  requireSceneSubjectCompatibility(catalog, subjectCatalog)
  requireBinaryPixels(subjectPixels, SUBJECT_WIDTH, SUBJECT_HEIGHT, 'subject')
  const selected = resolveBackdrop(state, catalog)
  let scene: Pixels = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4)
  if (selected) {
    const source = layers[selected.resourceId]
    if (!source) throw new Error(`Missing scene layer: ${selected.resourceId}`)
    scene = outlineSceneBackdrop(source)
  }
  for (let y = 0; y < SUBJECT_HEIGHT; y++) for (let x = 0; x < SUBJECT_WIDTH; x++) {
    const source = (y * SUBJECT_WIDTH + x) * 4
    if (!subjectPixels[source + 3]) continue
    const target = ((y + SUBJECT_Y) * SCENE_WIDTH + x + SUBJECT_X) * 4
    scene.set(subjectPixels.subarray(source, source + 4), target)
  }
  return scene
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
    value => value.toString(16).padStart(2, '0'),
  ).join('')
}

export async function verifyScenePng(bytes: Uint8Array, resource: PixelSceneResource): Promise<void> {
  if (await digest(bytes) !== resource.sha256) throw new Error(`SHA-256 mismatch: ${resource.path}`)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) throw new Error('Invalid PNG signature.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(16) !== resource.width || view.getUint32(20) !== resource.height) {
    throw new Error('Invalid PNG dimensions.')
  }
}

async function loadSceneLayers(
  resources: Record<string, PixelSceneResource>,
  resourceUrl: (resource: PixelSceneResource) => string,
): Promise<Record<string, Pixels>> {
  const layers: Record<string, Pixels> = {}
  await Promise.all(Object.entries(resources).map(async ([id, resource]) => {
    const response = await fetch(resourceUrl(resource))
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${resource.path}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await verifyScenePng(bytes, resource)
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none', premultiplyAlpha: 'none',
    })
    try {
      if (bitmap.width !== resource.width || bitmap.height !== resource.height) {
        throw new Error(`Decoded dimensions mismatch: ${id}`)
      }
      const canvas = document.createElement('canvas')
      canvas.width = resource.width
      canvas.height = resource.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas unavailable.')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, resource.width, resource.height).data
      requireBinaryPixels(pixels, resource.width, resource.height, id)
      layers[id] = pixels
    } finally {
      bitmap.close()
    }
  }))
  return layers
}

export async function loadPixelScene(
  input: unknown,
  subjectCatalog: PixelSceneSubjectCatalog,
  resourceUrl: (resource: PixelSceneResource) => string,
) {
  const catalog = await verifyPixelSceneCatalogV1(input)
  requireSceneSubjectCompatibility(catalog, subjectCatalog)
  const layers = await loadSceneLayers(catalog.resources, resourceUrl)
  return {
    catalog: structuredClone(catalog),
    render: (state: PixelSceneStateV1, subjectPixels: Pixels) =>
      composePixelScene(state, catalog, subjectCatalog, subjectPixels, layers),
  }
}
