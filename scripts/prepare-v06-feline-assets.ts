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
const VISIBLE_ALPHA_THRESHOLD = 16
const MIN_FRAGMENT_PIXELS = 64
const FELINE_MASK_DILATION_PIXELS = 192
const INTENTIONAL_EMPTY_SOURCE_FILENAMES = new Set<V06SourceFilename>([
  'oral_feline_none-source.png',
  'effect_feline_none-source.png',
])

type ConnectorId = 'neck' | 'tailRoot'
type ConnectorRole = 'receiver' | 'plug'
interface ConnectorGuideRegion {
  id: ConnectorId
  role: ConnectorRole
  x: number
  y: number
  width: number
  height: number
}

// These are fixed registration windows on the shared 2048px feline canvas.
const REQUIRED_CONNECTOR_GUIDES: Record<string, ConnectorGuideRegion[]> = {
  body_feline_sit_round: [
    { id: 'neck', role: 'receiver', x: 880, y: 250, width: 300, height: 320 },
    { id: 'tailRoot', role: 'receiver', x: 1520, y: 1080, width: 320, height: 320 },
  ],
  body_feline_sit_plush: [
    { id: 'neck', role: 'receiver', x: 880, y: 250, width: 300, height: 320 },
    { id: 'tailRoot', role: 'receiver', x: 1520, y: 1080, width: 320, height: 320 },
  ],
  head_feline_round: [{ id: 'neck', role: 'plug', x: 880, y: 1600, width: 300, height: 340 }],
  head_feline_tufted: [{ id: 'neck', role: 'plug', x: 880, y: 1600, width: 300, height: 340 }],
  tail_feline_long: [{ id: 'tailRoot', role: 'plug', x: 250, y: 1350, width: 320, height: 350 }],
  tail_feline_curl: [{ id: 'tailRoot', role: 'plug', x: 250, y: 1350, width: 320, height: 350 }],
  tail_feline_star_tip: [{ id: 'tailRoot', role: 'plug', x: 250, y: 1350, width: 320, height: 350 }],
}

const PRESENTATION_HEAD_OCCLUSION_SEEDS: Partial<Record<string, { x: number, y: number }>> = {
  head_feline_round: { x: 1024, y: 518 },
  head_feline_tufted: { x: 1024, y: 518 },
}

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
    if (visited[start] !== 0 || data[start * 4 + 3]! < VISIBLE_ALPHA_THRESHOLD) continue
    let cursor = 0
    let queued = 1
    queue[0] = start
    visited[start] = 1
    while (cursor < queued) {
      const pixel = queue[cursor++]!
      const x = pixel % width
      const y = Math.floor(pixel / width)
      const enqueue = (candidate: number): void => {
        if (visited[candidate] !== 0 || data[candidate * 4 + 3]! < VISIBLE_ALPHA_THRESHOLD) return
        visited[candidate] = 1
        queue[queued++] = candidate
      }
      if (x > 0) enqueue(pixel - 1)
      if (x + 1 < width) enqueue(pixel + 1)
      if (y > 0) enqueue(pixel - width)
      if (y + 1 < height) enqueue(pixel + width)
    }
    if (queued >= MIN_FRAGMENT_PIXELS) components += 1
  }
  return components
}

function visibleAlphaPixels(data: Uint8Array): number {
  let pixels = 0
  for (let pixel = 0; pixel < data.length / 4; pixel += 1) {
    if (data[pixel * 4 + 3]! >= VISIBLE_ALPHA_THRESHOLD) pixels += 1
  }
  return pixels
}

function guideCoverage(data: Uint8Array, width: number, guide: ConnectorGuideRegion): number {
  let pixels = 0
  for (let y = guide.y; y < guide.y + guide.height; y += 1) {
    for (let x = guide.x; x < guide.x + guide.width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! >= VISIBLE_ALPHA_THRESHOLD) pixels += 1
    }
  }
  return pixels
}

function connectorGuide(id: string, connectorId: ConnectorId, role: ConnectorRole): ConnectorGuideRegion {
  const guide = REQUIRED_CONNECTOR_GUIDES[id]?.find(candidate => candidate.id === connectorId && candidate.role === role)
  if (guide === undefined) throw new Error(`V06_FELINE_CONNECTOR_GUIDE_UNDECLARED:${id}:${connectorId}`)
  return guide
}

function assertRequiredConnectorGuides(id: string, data: Uint8Array, width: number): void {
  for (const guide of REQUIRED_CONNECTOR_GUIDES[id] ?? []) {
    if (guideCoverage(data, width, guide) < MIN_FRAGMENT_PIXELS) {
      throw new Error(`V06_FELINE_CONNECTOR_GUIDE_EMPTY:${id}:${guide.id}`)
    }
  }
}

function expandedFelineStructuralMask(
  structural: Array<{ image: { data: Uint8Array, info: { width: number, height: number } } }>,
): Uint8Array {
  const width = structural[0]!.image.info.width
  const height = structural[0]!.image.info.height
  const pixels = width * height
  const unavailable = 0xffff
  const distance = new Uint16Array(pixels)
  distance.fill(unavailable)
  for (const item of structural) {
    if (item.image.info.width !== width || item.image.info.height !== height) throw new Error('V06_FELINE_STRUCTURAL_MASK_DIMENSIONS_INVALID')
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      if (item.image.data[pixel * 4 + 3]! >= VISIBLE_ALPHA_THRESHOLD) distance[pixel] = 0
    }
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    let value = distance[pixel]!
    for (const candidate of [
      x > 0 ? pixel - 1 : -1,
      y > 0 ? pixel - width : -1,
      x > 0 && y > 0 ? pixel - width - 1 : -1,
      x + 1 < width && y > 0 ? pixel - width + 1 : -1,
    ]) if (candidate >= 0 && distance[candidate]! !== unavailable) value = Math.min(value, distance[candidate]! + 1)
    distance[pixel] = value
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const pixel = y * width + x
    let value = distance[pixel]!
    for (const candidate of [
      x + 1 < width ? pixel + 1 : -1,
      y + 1 < height ? pixel + width : -1,
      x + 1 < width && y + 1 < height ? pixel + width + 1 : -1,
      x > 0 && y + 1 < height ? pixel + width - 1 : -1,
    ]) if (candidate >= 0 && distance[candidate]! !== unavailable) value = Math.min(value, distance[candidate]! + 1)
    distance[pixel] = value
  }
  return Uint8Array.from(distance, value => value <= FELINE_MASK_DILATION_PIXELS ? 1 : 0)
}

function countOutsideFelineMask(data: Uint8Array, mask: Uint8Array): number {
  let pixels = 0
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (data[pixel * 4 + 3]! >= VISIBLE_ALPHA_THRESHOLD && mask[pixel] === 0) pixels += 1
  }
  return pixels
}

function guideOrigin(
  data: Uint8Array,
  width: number,
  guide: ConnectorGuideRegion,
): { x: number, y: number } {
  let best: { x: number, y: number, distance: number } | undefined
  const target = { x: guide.x + Math.floor(guide.width / 2), y: guide.y + Math.floor(guide.height / 2) }
  for (let y = guide.y; y < guide.y + guide.height; y += 1) for (let x = guide.x; x < guide.x + guide.width; x += 1) {
    const pixel = y * width + x
    if (data[pixel * 4 + 3]! < VISIBLE_ALPHA_THRESHOLD) continue
    const distance = (x - target.x) ** 2 + (y - target.y) ** 2
    if (best === undefined || distance < best.distance) best = { x, y, distance }
  }
  if (best === undefined) throw new Error(`V06_FELINE_CONNECTOR_GUIDE_EMPTY:${guide.id}`)
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
  const guide = connectorGuide(id, connectorId, role)
  const origin = guideOrigin(sourceData, width, guide)
  const contour = new Uint8Array(width * height * 4)
  const foreground = new Uint8Array(width * height * 4)
  const background = new Uint8Array(width * height * 4)

  if (role === 'plug' && connectorId === 'neck') {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (sourceData[pixel * 4 + 3]! === 0) continue
      setMaskPixel(foreground, pixel)
    }
    const seed = PRESENTATION_HEAD_OCCLUSION_SEEDS[id]
    if (seed === undefined || sourceData[(seed.y * width + seed.x) * 4 + 3]! === 0) {
      throw new Error(`V06_FELINE_PRESENTATION_HEAD_SEED_INVALID:${id}`)
    }
    const seedPixel = seed.y * width + seed.x
    setMaskPixel(background, seedPixel)
    foreground.fill(0, seedPixel * 4, seedPixel * 4 + 4)
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
    const metadata = await sharp(source).metadata()
    if (!metadata.hasAlpha) throw new Error(`V06_FELINE_SOURCE_ALPHA_INVALID:${sourceFilename}`)
    const image = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (image.info.width !== 2048 || image.info.height !== 2048 || image.info.channels !== 4) {
      throw new Error(`V06_FELINE_SOURCE_DIMENSIONS_INVALID:${sourceFilename}`)
    }
    const category = categoryFor(sourceFilename)
    const visiblePixels = visibleAlphaPixels(image.data)
    const hasTransparency = image.data.some((value, index) => index % 4 === 3 && value < 255)
    if (!hasTransparency) throw new Error(`V06_FELINE_SOURCE_ALPHA_INVALID:${sourceFilename}`)
    if (!INTENTIONAL_EMPTY_SOURCE_FILENAMES.has(sourceFilename) && visiblePixels === 0) {
      throw new Error(`V06_FELINE_VISIBLE_LAYER_ALPHA_EMPTY:${sourceFilename}`)
    }
    const connectedComponents = countAlphaComponents(image.data, image.info.width, image.info.height)
    if (category === 'structural' && connectedComponents !== 1) {
      throw new Error(`V06_FELINE_COMPONENT_COUNT_INVALID:${sourceFilename}:${connectedComponents}`)
    }
    if (category === 'structural') assertRequiredConnectorGuides(partId(sourceFilename), image.data, image.info.width)
    return { sourceFilename, sourcePath, source, image, category, id: partId(sourceFilename), connectedComponents }
  }))

  const felineMask = expandedFelineStructuralMask(decoded.filter(item => item.category === 'structural'))

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
    const outsideFelineMaskPixels = ['surface', 'pattern', 'palette'].includes(item.category)
      ? countOutsideFelineMask(item.image.data, felineMask)
      : 0
    if (outsideFelineMaskPixels !== 0) throw new Error(`V06_FELINE_MASK_CONTAINMENT_INVALID:${item.sourceFilename}:${outsideFelineMaskPixels}`)
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
      outsideFelineMaskPixels,
    })
  }
  return result
}
