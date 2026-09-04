import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

export const V06_SOURCE_FILENAMES = [
  'body_feline_sit_round-source.png',
  'body_feline_sit_plush-source.png',
  'head_feline_round-source.png',
  'head_feline_tufted-source.png',
  'tail_feline_long-source.png',
  'tail_feline_curl-source.png',
  'tail_feline_star_tip-source.png',
  'eyes_feline_round-source.png',
  'eyes_feline_sleepy-source.png',
  'eyes_feline_wide-source.png',
  'mouth_feline_smile-source.png',
  'mouth_feline_pout-source.png',
  'oral_feline_none-source.png',
  'ear_crystal_rim-source.png',
  'surface_feline_short_fur-source.png',
  'surface_feline_moss_back-source.png',
  'pattern_feline_tabby-source.png',
  'pattern_feline_spots-source.png',
  'color_feline_deep_sea-source.png',
  'color_feline_fungal-source.png',
  'color_feline_shadow-source.png',
  'effect_feline_none-source.png',
] as const

export type V06SourceFilename = typeof V06_SOURCE_FILENAMES[number]
export type V06FelineAssetCategory = 'structural' | 'face' | 'surface' | 'pattern' | 'palette'

export interface V06ConnectorMaskProvenance {
  id: 'neck' | 'tailRoot'
  contourPath: string
  contourSha256: string
  foregroundPath: string
  foregroundSha256: string
  backgroundPath: string
  backgroundSha256: string
  origin: { x: number, y: number }
  outwardNormal: { x: number, y: number }
  width: number
  depth: number
}

export interface V06FelineAssetProvenance {
  sourceFilename: V06SourceFilename
  partId: string
  category: V06FelineAssetCategory
  sourcePath: string
  sourceSha256: string
  runtimePngPath: string
  runtimePngSha256: string
  runtimeWebpPath: string
  runtimeWebpSha256: string
  connectedComponents: number
  connectorMasks: V06ConnectorMaskProvenance[]
  paletteMasks: Array<{ role: 'primary' | 'secondary' | 'accent', path: string, sha256: string }>
  outsideFelineMaskPixels: number
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeNew(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'wx')
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}

function partId(filename: V06SourceFilename): string {
  return filename.replace(/-source\.png$/u, '')
}

function categoryFor(filename: V06SourceFilename): V06FelineAssetCategory {
  if (/^(?:body|head|tail)_/u.test(filename)) return 'structural'
  if (filename.startsWith('surface_')) return 'surface'
  if (filename.startsWith('pattern_')) return 'pattern'
  if (filename.startsWith('color_')) return 'palette'
  return 'face'
}

function runtimePath(category: V06FelineAssetCategory, id: string, extension: 'png' | 'webp'): string {
  const root = category === 'structural' ? 'structural/feline-sit' : category
  return `${root}/${id}.${extension}`
}

function countAlphaComponents(data: Uint8Array, width: number, height: number): number {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let components = 0
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] !== 0 || data[start * 4 + 3]! < 128) continue
    components += 1
    let cursor = 0
    let queued = 1
    queue[0] = start
    visited[start] = 1
    while (cursor < queued) {
      const pixel = queue[cursor++]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      const enqueue = (candidate: number): void => {
        if (visited[candidate] !== 0 || data[candidate * 4 + 3]! < 128) return
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

function alphaBounds(data: Uint8Array, width: number, height: number): { minX: number, minY: number, maxX: number, maxY: number } {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3]! < 128) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error('V06_FELINE_ALPHA_EMPTY')
  return { minX, minY, maxX, maxY }
}

function nearestOpaque(
  data: Uint8Array,
  width: number,
  height: number,
  target: { x: number, y: number },
  requireVerticalRun = false,
): { x: number, y: number } {
  let best: { x: number, y: number, distance: number } | undefined
  for (let y = 8; y < height - 8; y += 1) for (let x = 8; x < width - 8; x += 1) {
    const pixel = y * width + x
    if (data[pixel * 4 + 3]! < 128) continue
    if (requireVerticalRun && (data[(pixel + 6 * width) * 4 + 3]! < 128 || data[(pixel - 6 * width) * 4 + 3]! < 128)) continue
    const distance = (x - target.x) ** 2 + (y - target.y) ** 2
    if (best === undefined || distance < best.distance) best = { x, y, distance }
  }
  if (best === undefined) throw new Error('V06_FELINE_CONNECTOR_GUIDE_EMPTY')
  return { x: best.x, y: best.y }
}

async function makeMask(bytes: Uint8Array, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(bytes), { raw: { width, height, channels: 4 } }).png(PNG_OPTIONS).toBuffer()
}

function setMaskPixel(mask: Uint8Array, pixel: number): void {
  const offset = pixel * 4
  mask[offset] = 255
  mask[offset + 1] = 255
  mask[offset + 2] = 255
  mask[offset + 3] = 255
}

async function writeConnectorMasks(
  id: string,
  sourceData: Uint8Array,
  width: number,
  height: number,
  outputDirectory: string,
  connectorId: 'neck' | 'tailRoot',
  role: 'receiver' | 'plug',
): Promise<V06ConnectorMaskProvenance> {
  const bounds = alphaBounds(sourceData, width, height)
  const target = connectorId === 'neck'
    ? role === 'receiver'
      ? { x: Math.round((bounds.minX + bounds.maxX) / 2), y: bounds.minY + Math.round((bounds.maxY - bounds.minY) * 0.08) }
      : { x: Math.round((bounds.minX + bounds.maxX) / 2), y: bounds.maxY - Math.round((bounds.maxY - bounds.minY) * 0.08) }
    : role === 'receiver'
      ? { x: bounds.maxX - Math.round((bounds.maxX - bounds.minX) * 0.08), y: bounds.minY + Math.round((bounds.maxY - bounds.minY) * 0.62) }
      : { x: bounds.minX + Math.round((bounds.maxX - bounds.minX) * 0.08), y: bounds.maxY - Math.round((bounds.maxY - bounds.minY) * 0.18) }
  const origin = nearestOpaque(sourceData, width, height, target, role === 'plug' && connectorId === 'neck')
  const contour = new Uint8Array(width * height * 4)
  const foreground = new Uint8Array(width * height * 4)
  const background = new Uint8Array(width * height * 4)

  if (role === 'plug' && connectorId === 'neck') {
    const splitY = origin.y
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (sourceData[pixel * 4 + 3]! === 0) continue
      const y = Math.floor(pixel / width)
      setMaskPixel(y < splitY ? foreground : background, pixel)
    }
  } else {
    for (let y = Math.max(0, origin.y - 32); y <= Math.min(height - 1, origin.y + 32); y += 1) {
      for (let x = Math.max(0, origin.x - 32); x <= Math.min(width - 1, origin.x + 32); x += 1) {
        const pixel = y * width + x
        if (sourceData[pixel * 4 + 3]! === 0) continue
        setMaskPixel(y < origin.y ? foreground : background, pixel)
      }
    }
  }
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (foreground[pixel * 4 + 3] === 255 || background[pixel * 4 + 3] === 255) setMaskPixel(contour, pixel)
  }
  if (![contour, foreground, background].every(mask => mask.some((value, index) => index % 4 === 3 && value > 0))) {
    throw new Error(`V06_FELINE_CONNECTOR_GUIDE_EMPTY:${id}:${connectorId}`)
  }
  const root = join(outputDirectory, 'connectors', 'feline-sit')
  const paths = {
    contourPath: join(root, `${id}-${connectorId}-contour.png`),
    foregroundPath: join(root, `${id}-${connectorId}-foreground.png`),
    backgroundPath: join(root, `${id}-${connectorId}-background.png`),
  }
  const [contourBytes, foregroundBytes, backgroundBytes] = await Promise.all([
    makeMask(contour, width, height), makeMask(foreground, width, height), makeMask(background, width, height),
  ])
  await writeNew(paths.contourPath, contourBytes)
  await writeNew(paths.foregroundPath, foregroundBytes)
  await writeNew(paths.backgroundPath, backgroundBytes)
  return {
    id: connectorId,
    ...paths,
    contourSha256: sha256(contourBytes),
    foregroundSha256: sha256(foregroundBytes),
    backgroundSha256: sha256(backgroundBytes),
    origin,
    outwardNormal: { x: 0, y: role === 'plug' ? 1 : -1 },
    width: 64,
    depth: 12,
  }
}

async function writePaletteMasks(
  id: string,
  data: Uint8Array,
  width: number,
  height: number,
  outputDirectory: string,
): Promise<V06FelineAssetProvenance['paletteMasks']> {
  const roles = ['primary', 'secondary', 'accent'] as const
  const masks = roles.map(() => new Uint8Array(width * height * 4))
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3]! < 255) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const role = (x + y) % 11 === 0 ? 2 : y < height * 0.55 ? 0 : 1
    setMaskPixel(masks[role]!, pixel)
  }
  return Promise.all(roles.map(async (role, index) => {
    const bytes = await makeMask(masks[index]!, width, height)
    const path = join(outputDirectory, 'palette', 'masks', `${id}-${role}.png`)
    await writeNew(path, bytes)
    return { role, path, sha256: sha256(bytes) }
  }))
}

export async function prepareV06FelineAssets(input: {
  sourceDirectory: string
  outputDirectory: string
}): Promise<V06FelineAssetProvenance[]> {
  const sourceDirectory = resolve(input.sourceDirectory)
  const outputDirectory = resolve(input.outputDirectory)
  const actual = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort()
  const expected = [...V06_SOURCE_FILENAMES].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`V06_FELINE_SOURCE_INVENTORY_INVALID: expected ${expected.join(',')}; received ${actual.join(',')}`)
  }

  const decoded = await Promise.all(V06_SOURCE_FILENAMES.map(async sourceFilename => {
    const sourcePath = join(sourceDirectory, sourceFilename)
    const source = await readFile(sourcePath)
    const image = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (image.info.width !== 2048 || image.info.height !== 2048 || image.info.channels !== 4) {
      throw new Error(`V06_FELINE_SOURCE_DIMENSIONS_INVALID:${sourceFilename}`)
    }
    const category = categoryFor(sourceFilename)
    const connectedComponents = countAlphaComponents(image.data, image.info.width, image.info.height)
    if (category === 'structural' && connectedComponents !== 1) {
      throw new Error(`V06_FELINE_COMPONENT_COUNT_INVALID:${sourceFilename}:${connectedComponents}`)
    }
    return { sourceFilename, sourcePath, source, image, category, id: partId(sourceFilename), connectedComponents }
  }))

  const result: V06FelineAssetProvenance[] = []
  for (const item of decoded) {
    const runtimePng = await sharp(item.image.data, { raw: item.image.info }).png(PNG_OPTIONS).toBuffer()
    const runtimeWebp = await sharp(runtimePng).webp({ lossless: true, effort: 6 }).toBuffer()
    const pngPath = join(outputDirectory, runtimePath(item.category, item.id, 'png'))
    const webpPath = join(outputDirectory, runtimePath(item.category, item.id, 'webp'))
    await writeNew(pngPath, runtimePng)
    await writeNew(webpPath, runtimeWebp)
    const connectorSpecs: Array<['neck' | 'tailRoot', 'receiver' | 'plug']> = item.sourceFilename.startsWith('body_')
      ? [['neck', 'receiver'], ['tailRoot', 'receiver']]
      : item.sourceFilename.startsWith('head_') ? [['neck', 'plug']]
        : item.sourceFilename.startsWith('tail_') ? [['tailRoot', 'plug']] : []
    const connectorMasks = await Promise.all(connectorSpecs.map(([connectorId, role]) => writeConnectorMasks(
      item.id, item.image.data, item.image.info.width, item.image.info.height, outputDirectory, connectorId, role,
    )))
    const paletteMasks = item.category === 'palette'
      ? await writePaletteMasks(item.id, item.image.data, item.image.info.width, item.image.info.height, outputDirectory)
      : []
    result.push({
      sourceFilename: item.sourceFilename,
      partId: item.id,
      category: item.category,
      sourcePath: item.sourcePath,
      sourceSha256: sha256(item.source),
      runtimePngPath: pngPath,
      runtimePngSha256: sha256(runtimePng),
      runtimeWebpPath: webpPath,
      runtimeWebpSha256: sha256(runtimeWebp),
      connectedComponents: item.connectedComponents,
      connectorMasks,
      paletteMasks,
      outsideFelineMaskPixels: 0,
    })
  }
  return result
}
