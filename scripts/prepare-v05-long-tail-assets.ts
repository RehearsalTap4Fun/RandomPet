import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

export const V05_LONG_TAIL_IDS = ['tail_cat_long', 'tail_dog_long'] as const
export const V05_LONG_TAIL_RIG_IDS = ['blob', 'biped', 'floating'] as const

export type V05LongTailId = typeof V05_LONG_TAIL_IDS[number]
export type V05LongTailRigId = typeof V05_LONG_TAIL_RIG_IDS[number]

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const ROOT_GUIDE = { x: 348, y: 1040, halfWidth: 7, foregroundTop: 970, backgroundBottom: 1109 } as const
const RECOVERY = { minimumChannel: 225, maximumChannelSpread: 12, minimumBorderLuminanceRange: 6 } as const
const MINIMUM_STRUCTURAL_COMPONENT_PIXELS = 512

interface DecodedImage {
  data: Buffer
  info: { width: number; height: number; channels: number }
}

interface AlphaBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PreparedV05LongTailAsset {
  tailId: V05LongTailId
  rigId: V05LongTailRigId
  sourcePath: string
  sourceSha256: string
  recoveredSha256: string
  previewPngPath: string
  previewWebpPath: string
  nodePngPath: string
  nodeWebpPath: string
  connectorMaskPaths: { contour: string; foreground: string; background: string }
  connectedComponents: number
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function alphaAt(image: DecodedImage, pixel: number): number {
  return image.data[pixel * image.info.channels + 3]!
}

function isNearNeutralMatte(image: DecodedImage, pixel: number): boolean {
  const offset = pixel * image.info.channels
  const red = image.data[offset]!
  const green = image.data[offset + 1]!
  const blue = image.data[offset + 2]!
  return Math.min(red, green, blue) >= RECOVERY.minimumChannel
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= RECOVERY.maximumChannelSpread
}

function alphaBounds(image: DecodedImage): AlphaBounds {
  const { width, height } = image.info
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (alphaAt(image, pixel) === 0) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error('V05_LONG_TAIL_ALPHA_EMPTY')
  return { minX, minY, maxX, maxY }
}

function countAlphaComponents(image: DecodedImage): number {
  const { width, height } = image.info
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let components = 0
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] !== 0 || alphaAt(image, start) < 128) continue
    components += 1
    let queued = 0
    queue[queued++] = start
    visited[start] = 1
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const pixel = queue[cursor]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      const enqueue = (candidate: number): void => {
        if (visited[candidate] !== 0 || alphaAt(image, candidate) < 128) return
        visited[candidate] = 1
        queue[queued++] = candidate
      }
      if (x > 0) enqueue(pixel - 1)
      if (x + 1 < width) enqueue(pixel + 1)
      if (y > 0) enqueue(pixel - width)
      if (y + 1 < height) enqueue(pixel + width)
    }
  }
  return components
}

async function retainSingleStructuralComponent(source: Buffer, label: string): Promise<Buffer> {
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = decoded.info
  const pixelCount = width * height
  const componentByPixel = new Int32Array(pixelCount)
  const componentSizes: number[] = []
  const queue = new Int32Array(pixelCount)
  for (let start = 0; start < pixelCount; start += 1) {
    if (componentByPixel[start] !== 0 || decoded.data[start * channels + 3]! < 128) continue
    const componentId = componentSizes.length + 1
    let queued = 0
    let size = 0
    componentByPixel[start] = componentId
    queue[queued++] = start
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const pixel = queue[cursor]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      size += 1
      const enqueue = (candidate: number): void => {
        if (componentByPixel[candidate] !== 0 || decoded.data[candidate * channels + 3]! < 128) return
        componentByPixel[candidate] = componentId
        queue[queued++] = candidate
      }
      if (x > 0) enqueue(pixel - 1)
      if (x + 1 < width) enqueue(pixel + 1)
      if (y > 0) enqueue(pixel - width)
      if (y + 1 < height) enqueue(pixel + width)
    }
    componentSizes.push(size)
  }
  const structural = componentSizes
    .map((size, index) => ({ id: index + 1, size }))
    .filter(component => component.size >= MINIMUM_STRUCTURAL_COMPONENT_PIXELS)
  if (structural.length !== 1) throw new Error(`V05_LONG_TAIL_COMPONENT_COUNT_INVALID:${label}:${structural.length}`)

  const retainedId = structural[0]!.id
  const cleaned = Buffer.from(decoded.data)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const componentId = componentByPixel[pixel]!
    if (componentId !== 0 && componentId !== retainedId) cleaned[pixel * channels + 3] = 0
  }
  return sharp(cleaned, { raw: { width, height, channels } }).png(PNG_OPTIONS).toBuffer()
}

async function recoverOpaqueCheckerboard(source: Buffer, label: string): Promise<Buffer> {
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = decoded.info
  const image: DecodedImage = { data: decoded.data, info: { width, height, channels } }
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (alphaAt(image, pixel) !== 255) throw new Error(`V05_LONG_TAIL_SOURCE_ALPHA_INVALID:${label}`)
  }

  let borderMinLuminance = 255
  let borderMaxLuminance = 0
  let matteBorderPixels = 0
  const borderPixels: number[] = []
  for (let x = 0; x < width; x += 1) {
    borderPixels.push(x, (height - 1) * width + x)
  }
  for (let y = 1; y + 1 < height; y += 1) {
    borderPixels.push(y * width, y * width + width - 1)
  }
  for (const pixel of borderPixels) {
    if (!isNearNeutralMatte(image, pixel)) continue
    matteBorderPixels += 1
    const offset = pixel * channels
    const luminance = Math.round((image.data[offset]! + image.data[offset + 1]! + image.data[offset + 2]!) / 3)
    borderMinLuminance = Math.min(borderMinLuminance, luminance)
    borderMaxLuminance = Math.max(borderMaxLuminance, luminance)
  }
  if (matteBorderPixels < borderPixels.length * 0.8
    || borderMaxLuminance - borderMinLuminance < RECOVERY.minimumBorderLuminanceRange) {
    throw new Error(`V05_LONG_TAIL_SOURCE_CHECKERBOARD_UNCONFIRMED:${label}`)
  }

  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let queued = 0
  const enqueue = (pixel: number): void => {
    if (visited[pixel] !== 0 || !isNearNeutralMatte(image, pixel)) return
    visited[pixel] = 1
    queue[queued++] = pixel
  }
  for (const pixel of borderPixels) enqueue(pixel)
  for (let cursor = 0; cursor < queued; cursor += 1) {
    const pixel = queue[cursor]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }
  const recovered = Buffer.from(image.data)
  for (let pixel = 0; pixel < visited.length; pixel += 1) {
    if (visited[pixel] !== 0) recovered[pixel * channels + 3] = 0
  }
  const output = await sharp(recovered, { raw: { width, height, channels } }).png(PNG_OPTIONS).toBuffer()
  const outputDecoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (alphaBounds({ data: outputDecoded.data, info: outputDecoded.info }).minX === 0) {
    throw new Error(`V05_LONG_TAIL_RECOVERY_EDGE_ALPHA:${label}`)
  }
  return output
}

async function writeNew(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function makeNode(recovered: Buffer): Promise<Buffer> {
  const decoded = await sharp(recovered).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = alphaBounds({ data: decoded.data, info: decoded.info })
  const cropped = await sharp(recovered)
    .extract({ left: bounds.minX, top: bounds.minY, width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1 })
    .resize({ height: 600, fit: 'inside', withoutEnlargement: false })
    .png(PNG_OPTIONS)
    .toBuffer()
  const metadata = await sharp(cropped).metadata()
  if (metadata.width === undefined || metadata.height === undefined) throw new Error('V05_LONG_TAIL_CROP_DIMENSIONS_INVALID')
  const left = Math.round(ROOT_GUIDE.x - metadata.width / 2)
  const top = ROOT_GUIDE.backgroundBottom + 1 - metadata.height
  if (left < 0 || top < 0 || left + metadata.width > 2048 || top + metadata.height > 2048) {
    throw new Error('V05_LONG_TAIL_NODE_BOUNDS_EXCEEDED')
  }
  return sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: cropped, left, top }])
    .png(PNG_OPTIONS)
    .toBuffer()
}

async function writeConnectorMasks(node: Buffer, root: string, rigId: V05LongTailRigId, tailId: V05LongTailId): Promise<PreparedV05LongTailAsset['connectorMaskPaths']> {
  const decoded = await sharp(node).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = decoded.info
  const masks = {
    contour: Buffer.alloc(width * height * 4),
    foreground: Buffer.alloc(width * height * 4),
    background: Buffer.alloc(width * height * 4),
  }
  for (let y = ROOT_GUIDE.foregroundTop; y <= ROOT_GUIDE.backgroundBottom; y += 1) for (let x = ROOT_GUIDE.x - ROOT_GUIDE.halfWidth; x <= ROOT_GUIDE.x + ROOT_GUIDE.halfWidth; x += 1) {
    const pixel = y * width + x
    if (decoded.data[pixel * channels + 3] === 0) continue
    const target = y < ROOT_GUIDE.y ? masks.foreground : masks.background
    for (const mask of [masks.contour, target]) {
      const offset = pixel * 4
      mask[offset] = 255
      mask[offset + 1] = 255
      mask[offset + 2] = 255
      mask[offset + 3] = 255
    }
  }
  const paths = {
    contour: join(root, 'connectors', rigId, `${tailId}-tailRoot-contour.png`),
    foreground: join(root, 'connectors', rigId, `${tailId}-tailRoot-foreground.png`),
    background: join(root, 'connectors', rigId, `${tailId}-tailRoot-background.png`),
  }
  for (const [key, bytes] of Object.entries(masks) as Array<[keyof typeof masks, Buffer]>) {
    const output = await sharp(bytes, { raw: { width, height, channels: 4 } }).png(PNG_OPTIONS).toBuffer()
    const check = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (!check.data.some((value, offset) => offset % 4 === 3 && value > 0)) {
      throw new Error(`V05_LONG_TAIL_CONNECTOR_MASK_EMPTY:${tailId}:${rigId}:${key}`)
    }
    await writeNew(paths[key], output)
  }
  return paths
}

export async function prepareV05LongTailAssets(input: {
  sourceDirectory: string
  outputDirectory: string
}): Promise<PreparedV05LongTailAsset[]> {
  const sourceDirectory = resolve(input.sourceDirectory)
  const outputDirectory = resolve(input.outputDirectory)
  const prepared: PreparedV05LongTailAsset[] = []
  for (const tailId of V05_LONG_TAIL_IDS) for (const rigId of V05_LONG_TAIL_RIG_IDS) {
    const sourcePath = join(sourceDirectory, `${tailId}-${rigId}-source.png`)
    let source: Buffer
    try {
      source = await readFile(sourcePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`V05_LONG_TAIL_SOURCE_MISSING:${tailId}:${rigId}`)
      throw error
    }
    const checkerboardRecovered = await recoverOpaqueCheckerboard(source, `${tailId}:${rigId}`)
    const recovered = await retainSingleStructuralComponent(checkerboardRecovered, `${tailId}:${rigId}`)
    const decoded = await sharp(recovered).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const connectedComponents = countAlphaComponents({ data: decoded.data, info: decoded.info })
    if (connectedComponents !== 1) throw new Error(`V05_LONG_TAIL_COMPONENT_COUNT_INVALID:${tailId}:${rigId}:${connectedComponents}`)

    const node = await makeNode(recovered)
    const nodePngPath = join(outputDirectory, 'structural', rigId, tailId, 'nodes', `${tailId}-${rigId}-tailRoot.png`)
    const nodeWebpPath = nodePngPath.replace(/\.png$/u, '.webp')
    const previewPngPath = join(outputDirectory, 'structural', rigId, `${tailId}.png`)
    const previewWebpPath = previewPngPath.replace(/\.png$/u, '.webp')
    await writeNew(nodePngPath, node)
    await writeNew(nodeWebpPath, await sharp(node).webp({ lossless: true, effort: 6 }).toBuffer())
    await writeNew(previewPngPath, await sharp(node).resize(1024, 1024).png(PNG_OPTIONS).toBuffer())
    await writeNew(previewWebpPath, await sharp(node).resize(1024, 1024).webp({ lossless: true, effort: 6 }).toBuffer())
    const connectorMaskPaths = await writeConnectorMasks(node, outputDirectory, rigId, tailId)
    prepared.push({
      tailId,
      rigId,
      sourcePath,
      sourceSha256: sha256(source),
      recoveredSha256: sha256(recovered),
      previewPngPath,
      previewWebpPath,
      nodePngPath,
      nodeWebpPath,
      connectorMaskPaths,
      connectedComponents,
    })
  }
  return prepared
}
