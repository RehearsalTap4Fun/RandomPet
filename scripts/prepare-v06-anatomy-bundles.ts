import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type { Point2D, Rect, ResourceRef, VisualSlotId } from '@qmonster/generator-core'

const SIZE = 2048
const VISIBLE_ALPHA = 16

export interface AnatomyBundleSource {
  id: string
  sourcePath: string
  prompt: string
  faceSafeZone: Rect
  featureSockets: Record<string, Point2D>
  mutationAnchors: Record<string, Rect>
  allowedTraitPools: Partial<Record<VisualSlotId, string[]>>
}

export interface PreparedResource extends ResourceRef {
  absolutePngPath: string
  absoluteWebpPath: string
}

export interface PreparedAnatomyBundle {
  id: string
  sourcePath: string
  prompt: string
  structural: PreparedResource
  alpha: PreparedResource
  clip: PreparedResource
  faceSafeZone: Rect
  featureSockets: Record<string, Point2D>
  mutationAnchors: Record<string, Rect>
  allowedTraitPools: AnatomyBundleSource['allowedTraitPools']
  alphaBounds: Rect
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function pathFor(id: string, kind: string, extension: 'png' | 'webp'): string {
  return `assets/v0.6.0/anatomy/feline-sit/${id}/${kind}.${extension}`
}

async function writeNew(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}

function inCanvas(rect: Rect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= SIZE && rect.y + rect.height <= SIZE
}

function assertGeometry(entry: AnatomyBundleSource): void {
  if (!inCanvas(entry.faceSafeZone)) throw new Error(`ANATOMY_BUNDLE_FACE_RECT_INVALID:${entry.id}`)
  for (const [id, anchor] of Object.entries(entry.mutationAnchors)) {
    if (!inCanvas(anchor)) throw new Error(`ANATOMY_BUNDLE_ANCHOR_RECT_INVALID:${entry.id}:${id}`)
  }
  for (const [id, point] of Object.entries(entry.featureSockets)) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > SIZE || point.y > SIZE) {
      throw new Error(`ANATOMY_BUNDLE_SOCKET_INVALID:${entry.id}:${id}`)
    }
  }
}

function alphaBounds(data: Uint8Array): Rect {
  let minX = SIZE; let minY = SIZE; let maxX = -1; let maxY = -1
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    if (data[(y * SIZE + x) * 4 + 3]! < VISIBLE_ALPHA) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error('ANATOMY_BUNDLE_ALPHA_EMPTY')
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function componentCount(data: Uint8Array): number {
  const pixels = SIZE * SIZE
  const visited = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  let count = 0
  for (let start = 0; start < pixels; start += 1) {
    if (visited[start] !== 0 || data[start * 4 + 3]! < VISIBLE_ALPHA) continue
    let head = 0; let tail = 1
    queue[0] = start; visited[start] = 1
    while (head < tail) {
      const pixel = queue[head++]!; const x = pixel % SIZE; const y = Math.floor(pixel / SIZE)
      const enqueue = (candidate: number): void => {
        if (visited[candidate] !== 0 || data[candidate * 4 + 3]! < VISIBLE_ALPHA) return
        visited[candidate] = 1; queue[tail++] = candidate
      }
      if (x > 0) enqueue(pixel - 1)
      if (x + 1 < SIZE) enqueue(pixel + 1)
      if (y > 0) enqueue(pixel - SIZE)
      if (y + 1 < SIZE) enqueue(pixel + SIZE)
    }
    count += 1
  }
  return count
}

async function persistResource(
  outputDirectory: string,
  id: string,
  kind: string,
  rgba: Uint8Array,
): Promise<PreparedResource> {
  const png = await sharp(Buffer.from(rgba), { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 3, adaptiveFiltering: false }).toBuffer()
  const webp = await sharp(png).webp({ lossless: true, effort: 2 }).toBuffer()
  const pngPath = pathFor(id, kind, 'png')
  const assetPath = pathFor(id, kind, 'webp')
  const absolutePngPath = join(outputDirectory, 'anatomy', 'feline-sit', id, `${kind}.png`)
  const absoluteWebpPath = join(outputDirectory, 'anatomy', 'feline-sit', id, `${kind}.webp`)
  await Promise.all([writeNew(absolutePngPath, png), writeNew(absoluteWebpPath, webp)])
  return { assetPath, assetSha256: sha256(webp), pngPath, pngSha256: sha256(png), absolutePngPath, absoluteWebpPath }
}

export async function prepareAnatomyBundle(entry: AnatomyBundleSource, outputDirectory: string): Promise<PreparedAnatomyBundle> {
  assertGeometry(entry)
  const source = await readFile(resolve(entry.sourcePath))
  const metadata = await sharp(source).metadata()
  if (!metadata.hasAlpha) throw new Error(`ANATOMY_BUNDLE_SOURCE_ALPHA_INVALID:${entry.id}`)
  const image = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (image.info.width !== SIZE || image.info.height !== SIZE || image.info.channels !== 4) {
    throw new Error(`ANATOMY_BUNDLE_SOURCE_DIMENSIONS_INVALID:${entry.id}`)
  }
  const bounds = alphaBounds(image.data)
  const components = componentCount(image.data)
  if (components !== 1) throw new Error(`ANATOMY_BUNDLE_STRUCTURE_NOT_CONNECTED:${entry.id}:${components}`)

  const alpha = new Uint8Array(image.data.length)
  const clip = new Uint8Array(image.data.length)
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    const offset = pixel * 4; const sourceAlpha = image.data[offset + 3]!
    alpha[offset] = alpha[offset + 1] = alpha[offset + 2] = 255; alpha[offset + 3] = sourceAlpha
    if (sourceAlpha >= VISIBLE_ALPHA) clip[offset] = clip[offset + 1] = clip[offset + 2] = clip[offset + 3] = 255
  }
  const destination = resolve(outputDirectory)
  const [structural, alphaResource, clipResource] = await Promise.all([
    persistResource(destination, entry.id, 'structural', image.data),
    persistResource(destination, entry.id, 'alpha', alpha),
    persistResource(destination, entry.id, 'clip', clip),
  ])
  return { ...entry, sourcePath: entry.sourcePath.replaceAll('\\', '/'), structural, alpha: alphaResource, clip: clipResource, alphaBounds: bounds }
}
