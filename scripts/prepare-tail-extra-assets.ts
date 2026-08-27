import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { processInterfaceAsset } from './process-interface-asset.js'
import { renderInterfaceGuides } from './render-interface-guides.js'
import { TASK9_BODY_RIG_IDS, TASK9_EXTRA_IDS, TASK9_RIG_IDS, TASK9_TAIL_IDS, type Task9RigId } from './task9-structural-identities.js'
export type { Task9RigId } from './task9-structural-identities.js'

const SIZE = 2048
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
export function task9StructuralSelections() {
  return TASK9_RIG_IDS.flatMap(rigId => [
    ...TASK9_TAIL_IDS.map(partId => ({ rigId, partId, slotId: 'tail' as const })),
    ...TASK9_EXTRA_IDS.map(partId => ({ rigId, partId, slotId: 'extraAppendage' as const })),
  ])
}

const TASK9_RECEIVERS = {
  body_blob_round: { tailRoot: { x: 1480, y: 1170 }, extraLeft: { x: 560, y: 900 }, extraRight: { x: 1488, y: 900 } },
  body_blob_wide: { tailRoot: { x: 1600, y: 1080 }, extraLeft: { x: 400, y: 900 }, extraRight: { x: 1648, y: 900 } },
  body_biped_peanut: { tailRoot: { x: 1430, y: 1230 }, extraLeft: { x: 600, y: 900 }, extraRight: { x: 1448, y: 900 } },
  body_biped_tall: { tailRoot: { x: 1380, y: 1200 }, extraLeft: { x: 660, y: 900 }, extraRight: { x: 1388, y: 900 } },
  body_floating_drop: { tailRoot: { x: 1400, y: 1180 }, extraLeft: { x: 620, y: 900 }, extraRight: { x: 1428, y: 900 } },
} as const

export function task9ReceiverSockets(bodyId: keyof typeof TASK9_RECEIVERS) {
  return TASK9_RECEIVERS[bodyId]
}

export function resolveTask9ProcessedBodyKey(processedAssets: Record<string, unknown>, bodyId: string, rigId: Task9RigId): string {
  const candidates = [bodyId, `${bodyId}:${rigId}`].filter(key => processedAssets[key] !== undefined)
  if (candidates.length === 0) throw new Error(`TASK9_BODY_PROCESSED_INVALID: missing ${bodyId}:${rigId}`)
  if (candidates.length > 1) throw new Error(`TASK9_BODY_PROCESSED_INVALID: duplicate aliases for ${bodyId}:${rigId}`)
  return candidates[0]!
}

export async function auditTask9EdgeResidual(path: string): Promise<{
  boundaryPixels: number
  paleNeutralBoundaryPixels: number
}> {
  const decoded = await sharp(path).ensureAlpha().toColourspace('srgb').raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const rgba = decoded.data
  let boundaryPixels = 0
  let paleNeutralBoundaryPixels = 0
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    const offset = (y * width + x) * 4
    if (rgba[offset + 3]! <= 8) continue
    const adjacentToTransparency = rgba[offset - 4 + 3]! <= 8
      || rgba[offset + 4 + 3]! <= 8
      || rgba[offset - width * 4 + 3]! <= 8
      || rgba[offset + width * 4 + 3]! <= 8
    if (!adjacentToTransparency) continue
    boundaryPixels += 1
    const low = Math.min(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!)
    const neutral = Math.max(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!) - low
    if (low >= 218 && neutral <= 14) paleNeutralBoundaryPixels += 1
  }
  return { boundaryPixels, paleNeutralBoundaryPixels }
}

interface AlphaComponent {
  indices: number[]
  mass: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function alphaComponents(alpha: Uint8Array, width: number, height: number): AlphaComponent[] {
  const seen = new Uint8Array(alpha.length)
  const queue = new Int32Array(alpha.length)
  const components: AlphaComponent[] = []
  for (let first = 0; first < alpha.length; first += 1) {
    if (seen[first] !== 0 || alpha[first]! <= 8) continue
    seen[first] = 1
    queue[0] = first
    let queued = 1
    let mass = 0
    let minX = width; let minY = height; let maxX = -1; let maxY = -1
    const indices: number[] = []
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const pixel = queue[cursor]!
      indices.push(pixel)
      const x = pixel % width; const y = Math.floor(pixel / width)
      mass += alpha[pixel]!
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      for (const next of [
        x > 0 ? pixel - 1 : -1,
        x + 1 < width ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y + 1 < height ? pixel + width : -1,
      ]) {
        if (next < 0 || seen[next] !== 0 || alpha[next]! <= 8) continue
        seen[next] = 1
        queue[queued++] = next
      }
    }
    components.push({ indices, mass, minX, minY, maxX, maxY })
  }
  return components.sort((left, right) => right.mass - left.mass)
}

export async function extractTask9Candidate(input: {
  sourcePath: string
  outputPath: string
  expectedComponents: 1 | 2
}): Promise<{
  sourceSha256: string
  processedSha256: string
  detectedComponents: number
  retainedComponents: number
  discardedComponents: number
  boundaryAlphaPixels: number
  partialAlphaPixels: number
}> {
  const source = await readFile(input.sourcePath)
  const decoded = await sharp(source).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const rgba = Buffer.alloc(width * height * 4)
  const alpha = new Uint8Array(width * height)
  let partialAlphaPixels = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x; const rgb = pixel * 3; const out = pixel * 4
    const red = decoded.data[rgb]!; const green = decoded.data[rgb + 1]!; const blue = decoded.data[rgb + 2]!
    const low = Math.min(red, green, blue); const neutral = Math.max(red, green, blue) - low
    let value = 255
    if (neutral <= 10 && low >= 236) value = 0
    else if (neutral <= 14 && low >= 218) value = Math.round(255 * (236 - low) / 18)
    if (x < 8 || y < 8 || x >= width - 8 || y >= height - 8) value = 0
    rgba[out] = red; rgba[out + 1] = green; rgba[out + 2] = blue; rgba[out + 3] = value
    alpha[pixel] = value
    if (value > 0 && value < 255) partialAlphaPixels += 1
  }
  const components = alphaComponents(alpha, width, height)
  if (components.length < input.expectedComponents) {
    throw new Error(`TASK9_CANDIDATE_INVALID: expected ${input.expectedComponents} components, got ${components.length}`)
  }
  const retained = components.slice(0, input.expectedComponents)
  const keep = new Uint8Array(alpha.length)
  for (const component of retained) for (const pixel of component.indices) keep[pixel] = 1
  for (let pixel = 0; pixel < keep.length; pixel += 1) if (keep[pixel] === 0) rgba[pixel * 4 + 3] = 0
  let boundaryAlphaPixels = 0
  for (let x = 0; x < width; x += 1) {
    if (rgba[x * 4 + 3]! > 0) boundaryAlphaPixels += 1
    if (rgba[((height - 1) * width + x) * 4 + 3]! > 0) boundaryAlphaPixels += 1
  }
  for (let y = 1; y + 1 < height; y += 1) {
    if (rgba[(y * width) * 4 + 3]! > 0) boundaryAlphaPixels += 1
    if (rgba[(y * width + width - 1) * 4 + 3]! > 0) boundaryAlphaPixels += 1
  }
  await mkdir(dirname(input.outputPath), { recursive: true })
  const processed = await sharp(rgba, { raw: { width, height, channels: 4 } }).png(PNG).toBuffer()
  await sharp(processed).toFile(input.outputPath)
  return {
    sourceSha256: sha256(source), processedSha256: sha256(processed),
    detectedComponents: components.length, retainedComponents: retained.length,
    discardedComponents: components.length - retained.length,
    boundaryAlphaPixels, partialAlphaPixels,
  }
}

function alphaBounds(rgba: Buffer, width: number, height: number) {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rgba[(y * width + x) * 4 + 3]! <= 8) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < minX) throw new Error('TASK9_CANDIDATE_INVALID: normalized candidate is empty')
  return { minX, minY, maxX, maxY }
}

function denseTailRoot(rgba: Buffer, width: number, height: number): { x: number; y: number; coverage: number } {
  const normalSize = 140
  const tangentSize = 220
  const bounds = alphaBounds(rgba, width, height)
  const searchRight = Math.min(width - normalSize, bounds.minX + Math.round((bounds.maxX - bounds.minX + 1) * 0.28))
  let best = { x: 0, y: 0, coverage: -1, score: Number.NEGATIVE_INFINITY }
  for (let top = bounds.minY; top + tangentSize <= bounds.maxY + 1; top += 4) {
    for (let left = bounds.minX; left <= searchRight; left += 4) {
      let opaque = 0
      for (let y = top; y < top + tangentSize; y += 1) for (let x = left; x < left + normalSize; x += 1) {
        if (rgba[(y * width + x) * 4 + 3]! > 8) opaque += 1
      }
      const coverage = opaque / (normalSize * tangentSize)
      const score = coverage * 1000 - left - Math.abs(top + tangentSize / 2 - height / 2) * 0.05
      if (coverage >= 0.9 && score > best.score) best = { x: left + normalSize / 2, y: top + tangentSize / 2, coverage, score }
    }
  }
  if (best.coverage < 0.9) throw new Error(`TASK9_TAIL_ROOT_INVALID: best coverage ${best.coverage}`)
  return best
}

function denseExtraRoot(
  rgba: Buffer,
  width: number,
  height: number,
  side: 'left' | 'right',
): { x: number; y: number; coverage: number } {
  const normalSize = 120
  const tangentSize = 200
  const bounds = alphaBounds(rgba, width, height)
  const span = bounds.maxX - bounds.minX + 1
  const searchLeft = side === 'left'
    ? Math.max(bounds.minX, bounds.maxX - Math.round(span * 0.32) - normalSize + 1)
    : bounds.minX
  const searchRight = side === 'left'
    ? bounds.maxX - normalSize + 1
    : Math.min(bounds.maxX - normalSize + 1, bounds.minX + Math.round(span * 0.32))
  let best = { x: 0, y: 0, coverage: -1, score: Number.NEGATIVE_INFINITY }
  for (let top = bounds.minY; top + tangentSize <= bounds.maxY + 1; top += 4) {
    for (let left = searchLeft; left <= searchRight; left += 4) {
      let opaque = 0
      for (let y = top; y < top + tangentSize; y += 1) for (let x = left; x < left + normalSize; x += 1) {
        if (rgba[(y * width + x) * 4 + 3]! > 8) opaque += 1
      }
      const coverage = opaque / (normalSize * tangentSize)
      const inwardPreference = side === 'left' ? left : -left
      const score = coverage * 1000 + inwardPreference - Math.abs(top + tangentSize / 2 - height / 2) * 0.05
      if (coverage >= 0.9 && score > best.score) {
        best = { x: left + normalSize / 2, y: top + tangentSize / 2, coverage, score }
      }
    }
  }
  if (best.coverage < 0.9) {
    throw new Error(`TASK9_EXTRA_ROOT_INVALID: ${side} best coverage ${best.coverage}`)
  }
  return best
}

export async function normalizeTask9Tail(input: { extractedPath: string; rigId: Task9RigId }): Promise<{
  master: Buffer
  connector: { id: 'tailRoot'; origin: { x: number; y: number }; width: 220; depth: 140 }
  connectorCoverage: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}> {
  const target = input.rigId === 'blob' ? { width: 820, height: 760 }
    : input.rigId === 'biped' ? { width: 760, height: 700 }
      : { width: 720, height: 660 }
  const trimmed = await sharp(input.extractedPath).trim({ background: '#00000000' })
    .resize(target.width, target.height, { fit: 'inside', withoutEnlargement: false })
    .png(PNG).toBuffer({ resolveWithObject: true })
  const decoded = await sharp(trimmed.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const root = denseTailRoot(decoded.data, decoded.info.width, decoded.info.height)
  const connectorOrigin = { x: 400, y: 1040 }
  const left = Math.round(connectorOrigin.x - root.x)
  const top = Math.round(connectorOrigin.y - root.y)
  const master = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
    .composite([{ input: trimmed.data, left, top }]).png(PNG).toBuffer()
  const masterRgba = await sharp(master).ensureAlpha().raw().toBuffer()
  return {
    master,
    connector: { id: 'tailRoot', origin: connectorOrigin, width: 220, depth: 140 },
    connectorCoverage: root.coverage,
    bounds: alphaBounds(masterRgba, SIZE, SIZE),
  }
}

export async function normalizeTask9Extra(input: { extractedPath: string; rigId: Task9RigId }): Promise<{
  master: Buffer
  nodes: readonly [Buffer, Buffer]
  connectors: readonly [
    { id: 'extraLeft'; origin: { x: number; y: number }; width: 200; depth: 120 },
    { id: 'extraRight'; origin: { x: number; y: number }; width: 200; depth: 120 },
  ]
  connectorCoverage: readonly [number, number]
}> {
  const decoded = await sharp(input.extractedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alpha = new Uint8Array(decoded.info.width * decoded.info.height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = decoded.data[pixel * 4 + 3]!
  const components = alphaComponents(alpha, decoded.info.width, decoded.info.height).slice(0, 2)
    .sort((left, right) => left.minX - right.minX)
  if (components.length !== 2) throw new Error('TASK9_EXTRA_INVALID: expected exactly two principal nodes')
  const target = input.rigId === 'blob' ? { width: 650, height: 650 }
    : input.rigId === 'biped' ? { width: 690, height: 780 }
      : { width: 760, height: 600 }
  const connectorOrigins = [{ x: 760, y: 900 }, { x: 1288, y: 900 }] as const
  const nodes: Buffer[] = []
  const coverages: number[] = []
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!
    const crop = await sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
      .extract({
        left: component.minX,
        top: component.minY,
        width: component.maxX - component.minX + 1,
        height: component.maxY - component.minY + 1,
      })
      .resize(target.width, target.height, { fit: 'inside', withoutEnlargement: false })
      .png(PNG).toBuffer({ resolveWithObject: true })
    const rgba = await sharp(crop.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const side = index === 0 ? 'left' : 'right'
    const root = denseExtraRoot(rgba.data, rgba.info.width, rgba.info.height, side)
    const origin = connectorOrigins[index]!
    const left = Math.round(origin.x - root.x)
    const top = Math.round(origin.y - root.y)
    if (left < (index === 0 ? 0 : 1024) || left + rgba.info.width > (index === 0 ? 1024 : SIZE) || top < 0 || top + rgba.info.height > SIZE) {
      throw new Error(`TASK9_EXTRA_INVALID: ${side} normalized node exceeds its staging cell`)
    }
    nodes.push(await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
      .composite([{ input: crop.data, left, top }]).png(PNG).toBuffer())
    coverages.push(root.coverage)
  }
  const master = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
    .composite(nodes.map(node => ({ input: node, left: 0, top: 0 }))).png(PNG).toBuffer()
  return {
    master,
    nodes: nodes as [Buffer, Buffer],
    connectors: [
      { id: 'extraLeft', origin: connectorOrigins[0], width: 200, depth: 120 },
      { id: 'extraRight', origin: connectorOrigins[1], width: 200, depth: 120 },
    ],
    connectorCoverage: coverages as [number, number],
  }
}

type Task9Profile = {
  id: 'tailRoot' | 'extraLeft' | 'extraRight'
  role: 'receiver' | 'plug'
  connectorClass: 'tail' | 'extra'
  origin: { x: number; y: number }
  tangent: { x: number; y: number }
  outwardNormal: { x: number; y: number }
  width: number
  depth: number
  contourMaskPath: string
  foregroundMaskPath: string
  backgroundMaskPath: string
  materialSampleRegion: { x: number; y: number; width: number; height: number }
  warpLimits: { widthRatio: { min: number; max: number }; depthRatio: { min: number; max: number }; rotationDegrees: { min: number; max: number } }
}

const TASK9_ROOT = process.cwd()
const TASK9_SOURCE_ROOT = join(TASK9_ROOT, 'asset-source', 'v0.3.0')
const TASK9_CATALOG_ROOT = join(TASK9_ROOT, 'packages', 'asset-catalog')

async function hashTask9File(path: string): Promise<string> { return sha256(await readFile(path)) }
async function writeTask9Json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readTask9Alpha(path: string): Promise<{ alpha: Uint8Array, width: number, height: number }> {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    alpha: Uint8Array.from({ length: decoded.data.length / 4 }, (_, index) => decoded.data[index * 4 + 3]!),
    width: decoded.info.width,
    height: decoded.info.height,
  }
}

function task9BridgeSplitStats(neutral: Uint8Array, front: Uint8Array, back: Uint8Array) {
  let nonBinaryPixels = 0
  let outsideNeutralPixels = 0
  let overlapPixels = 0
  let unionMismatchPixels = 0
  let splitPixels = 0
  for (let index = 0; index < neutral.length; index += 1) {
    const neutralSupported = neutral[index]! > 0
    const frontOpaque = front[index] === 255
    const backOpaque = back[index] === 255
    if ((front[index] !== 0 && front[index] !== 255) || (back[index] !== 0 && back[index] !== 255)) nonBinaryPixels += 1
    if ((frontOpaque || backOpaque) && !neutralSupported) outsideNeutralPixels += 1
    if (frontOpaque && backOpaque) overlapPixels += 1
    if (neutralSupported !== (frontOpaque || backOpaque)) unionMismatchPixels += 1
    if (frontOpaque || backOpaque) splitPixels += 1
  }
  return { nonBinaryPixels, outsideNeutralPixels, overlapPixels, unionMismatchPixels, splitPixels }
}

export async function auditTask9BridgeSplits() {
  const manifest = JSON.parse(await readFile(join(TASK9_SOURCE_ROOT, 'interface-manifest.json'), 'utf8'))
  const bridges = manifest.bridges.filter((bridge: any) => bridge.connectorClass === 'tail' || bridge.connectorClass === 'extra')
  const totals = { bridges: bridges.length, nonBinaryPixels: 0, outsideNeutralPixels: 0, overlapPixels: 0, unionMismatchPixels: 0, nonemptyPairs: 0 }
  for (const bridge of bridges) {
    const [neutral, front, back] = await Promise.all([
      readTask9Alpha(resolve(TASK9_CATALOG_ROOT, bridge.neutralPngPath)),
      readTask9Alpha(resolve(TASK9_CATALOG_ROOT, bridge.frontMaskPath)),
      readTask9Alpha(resolve(TASK9_CATALOG_ROOT, bridge.backMaskPath)),
    ])
    if (neutral.width !== front.width || neutral.height !== front.height || neutral.width !== back.width || neutral.height !== back.height) {
      totals.unionMismatchPixels += neutral.width * neutral.height
      continue
    }
    const stats = task9BridgeSplitStats(neutral.alpha, front.alpha, back.alpha)
    totals.nonBinaryPixels += stats.nonBinaryPixels
    totals.outsideNeutralPixels += stats.outsideNeutralPixels
    totals.overlapPixels += stats.overlapPixels
    totals.unionMismatchPixels += stats.unionMismatchPixels
    if (stats.splitPixels > 0) totals.nonemptyPairs += 1
  }
  return totals
}

async function writeTask9BridgeBackMask(neutralPath: string, frontPath: string, backPath: string): Promise<string> {
  const [neutral, front] = await Promise.all([readTask9Alpha(neutralPath), readTask9Alpha(frontPath)])
  if (neutral.width !== front.width || neutral.height !== front.height) throw new Error('TASK9_BRIDGE_SPLIT_INVALID: dimensions')
  const rgba = Buffer.alloc(neutral.width * neutral.height * 4, 255)
  for (let index = 0; index < neutral.alpha.length; index += 1) rgba[index * 4 + 3] = neutral.alpha[index]! > 0 && front.alpha[index] !== 255 ? 255 : 0
  const backBytes = await sharp(rgba, { raw: { width: neutral.width, height: neutral.height, channels: 4 } }).png(PNG).toBuffer()
  await writeFile(backPath, backBytes)
  return sha256(backBytes)
}

export async function rebuildTask9BridgeSplits() {
  const manifestPath = join(TASK9_SOURCE_ROOT, 'interface-manifest.json')
  const processedPath = join(TASK9_SOURCE_ROOT, 'production', 'processed-index.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const processedIndex = JSON.parse(await readFile(processedPath, 'utf8'))
  const bridges = manifest.bridges.filter((bridge: any) => bridge.connectorClass === 'tail' || bridge.connectorClass === 'extra')
  let frontHashesUnchanged = true
  for (const bridge of bridges) {
    const neutralPath = resolve(TASK9_CATALOG_ROOT, bridge.neutralPngPath)
    const frontPath = resolve(TASK9_CATALOG_ROOT, bridge.frontMaskPath)
    const backPath = resolve(TASK9_CATALOG_ROOT, bridge.backMaskPath)
    const frontBefore = await hashTask9File(frontPath)
    const backMaskSha256 = await writeTask9BridgeBackMask(neutralPath, frontPath, backPath)
    if (frontBefore !== await hashTask9File(frontPath)) frontHashesUnchanged = false
    const processed = processedIndex.processedBridges[`${bridge.rigId}:${bridge.connectorClass}`]
    if (processed === undefined) throw new Error(`TASK9_BRIDGE_SPLIT_INVALID: missing processed ${bridge.id}`)
    processed.backMaskSha256 = backMaskSha256
  }
  const sourceIndex = await rebuildTask9SourceIndex(manifest, processedIndex)
  await writeTask9Json(processedPath, processedIndex)
  await writeTask9Json(join(TASK9_CATALOG_ROOT, 'source-index-v0.3.0.json'), sourceIndex)
  return { ...(await auditTask9BridgeSplits()), frontHashesUnchanged }
}

function task9Profile(input: {
  rigId: Task9RigId
  ownerId: string
  id: Task9Profile['id']
  role: Task9Profile['role']
  origin: { x: number; y: number }
  outwardNormal: { x: number; y: number }
}): Task9Profile {
  const connectorClass = input.id === 'tailRoot' ? 'tail' : 'extra'
  const width = connectorClass === 'tail' ? 220 : 200
  const depth = connectorClass === 'tail' ? 140 : 120
  const base = `assets/v0.3.0/connectors/${input.rigId}/${input.ownerId}-${input.id}`
  return {
    id: input.id, role: input.role, connectorClass, origin: input.origin,
    tangent: { x: 0, y: 1 }, outwardNormal: input.outwardNormal, width, depth,
    contourMaskPath: `${base}-contour.png`, foregroundMaskPath: `${base}-foreground.png`, backgroundMaskPath: `${base}-background.png`,
    materialSampleRegion: { x: input.origin.x - 16, y: input.origin.y - 16, width: 32, height: 32 },
    warpLimits: { widthRatio: { min: 0.85, max: 1.15 }, depthRatio: { min: 0.8, max: 1.2 }, rotationDegrees: { min: -12, max: 12 } },
  }
}

type Task9TangentWindow = { min: number; max: number }
type Task9TangentWindows = Record<Task9RigId, Record<Task9Profile['id'], Task9TangentWindow>>

function task9MaskBand(
  profile: Task9Profile,
  supportAlpha: Uint8Array,
  tangentWindow?: Task9TangentWindow,
  ribbonDepth = profile.depth * 0.125,
): Buffer {
  const supportedBand = Buffer.alloc(SIZE * SIZE)
  const tangentLimit = profile.width * 0.32
  const normalLimit = profile.depth * 0.42
  let frontier = Number.NEGATIVE_INFINITY
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
    const tangent = dx * profile.tangent.x + dy * profile.tangent.y
    const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
    const pixel = y * SIZE + x
    if (
      Math.abs(tangent) <= tangentLimit
      && (tangentWindow === undefined || (tangent >= tangentWindow.min && tangent <= tangentWindow.max))
      && Math.abs(normal) <= normalLimit
      && supportAlpha[pixel]! > 8
    ) {
      supportedBand[pixel] = 255
      frontier = Math.max(frontier, normal)
    }
  }
  if (!Number.isFinite(frontier)) throw new Error(`TASK9_MASK_INVALID: ${profile.id} has no alpha-supported interface band`)
  // Connector contours are causal seam ribbons, not the whole root volume.
  // Keeping the same profile-relative depth on both receiver and plug sides
  // makes the warped neutral bridge cover the exact alpha-supported frontier.
  const alpha = Buffer.alloc(SIZE * SIZE)
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const pixel = y * SIZE + x
    if (supportedBand[pixel] === 0) continue
    const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
    const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
    if (frontier - normal <= ribbonDepth) alpha[pixel] = 255
  }
  return alpha
}

async function task9MaskPng(alpha: Buffer): Promise<Buffer> {
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } }).png(PNG).toBuffer()
}

function splitTask9Contour(profile: Task9Profile, contour: Buffer): { foreground: Buffer; background: Buffer } {
  const tangents: number[] = []
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    if (contour[y * SIZE + x] === 0) continue
    tangents.push((x + 0.5 - profile.origin.x) * profile.tangent.x + (y + 0.5 - profile.origin.y) * profile.tangent.y)
  }
  tangents.sort((left, right) => left - right)
  if (tangents.length < 2) throw new Error(`TASK9_MASK_INVALID: ${profile.id} local support is too small`)
  const split = tangents[Math.floor(tangents.length / 2)]!
  const foreground = Buffer.alloc(contour.length); const background = Buffer.alloc(contour.length)
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const pixel = y * SIZE + x
    if (contour[pixel] === 0) continue
    const tangent = (x + 0.5 - profile.origin.x) * profile.tangent.x + (y + 0.5 - profile.origin.y) * profile.tangent.y
    if (tangent < split) foreground[pixel] = 255
    else background[pixel] = 255
  }
  return { foreground, background }
}

async function writeTask9Masks(
  rigId: Task9RigId,
  ownerId: string,
  profiles: Task9Profile[],
  supportPath: string,
  tangentWindows: Task9TangentWindows[Task9RigId],
  ribbonDepths: Record<Task9Profile['id'], number>,
) {
  const decoded = await sharp(supportPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.width !== SIZE || decoded.info.height !== SIZE || decoded.info.channels !== 4) throw new Error(`TASK9_RECEIVER_INVALID: ${ownerId} support must be 2048 RGBA`)
  const supportAlpha = new Uint8Array(SIZE * SIZE)
  for (let pixel = 0; pixel < supportAlpha.length; pixel += 1) supportAlpha[pixel] = decoded.data[pixel * 4 + 3]!
  const inputs = []
  for (const profile of profiles) {
    const contour = task9MaskBand(profile, supportAlpha, tangentWindows[profile.id], ribbonDepths[profile.id])
    const { foreground, background } = splitTask9Contour(profile, contour)
    for (const [kind, alpha] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
      const bytes = await task9MaskPng(alpha)
      const runtimePath = resolve(TASK9_CATALOG_ROOT, profile[`${kind}MaskPath`])
      const sourcePath = join(TASK9_SOURCE_ROOT, 'masks', rigId, ownerId, `${profile.id}-${kind}.png`)
      await mkdir(dirname(runtimePath), { recursive: true }); await mkdir(dirname(sourcePath), { recursive: true })
      await writeFile(runtimePath, bytes); await writeFile(sourcePath, bytes)
    }
    inputs.push({
      id: profile.id,
      contourMaskPath: resolve(TASK9_CATALOG_ROOT, profile.contourMaskPath),
      foregroundMaskPath: resolve(TASK9_CATALOG_ROOT, profile.foregroundMaskPath),
      backgroundMaskPath: resolve(TASK9_CATALOG_ROOT, profile.backgroundMaskPath),
    })
  }
  return inputs
}

async function writeTask9RuntimeNode(sourcePath: string, runtimeBase: string, rigId: Task9RigId, connectorId: Task9Profile['id']) {
  const pngPath = resolve(TASK9_CATALOG_ROOT, `${runtimeBase}.png`)
  const webpPath = resolve(TASK9_CATALOG_ROOT, `${runtimeBase}.webp`)
  await mkdir(dirname(pngPath), { recursive: true })
  const fitted = await fitTask9DistalNode({ sourcePath, rigId, connectorId })
  await writeFile(pngPath, fitted.png)
  await sharp(fitted.png).webp({ lossless: true, effort: 6 }).toFile(webpPath)
  return {
    pngPath: `${runtimeBase}.png`, pngSha256: await hashTask9File(pngPath),
    webpPath: `${runtimeBase}.webp`, webpSha256: await hashTask9File(webpPath),
  }
}

function task9PlugProfiles(rigId: Task9RigId, partId: string, slotId: 'tail' | 'extraAppendage'): Task9Profile[] {
  if (slotId === 'tail') return [task9Profile({
    rigId, ownerId: partId, id: 'tailRoot', role: 'plug', origin: { x: 400, y: 1040 }, outwardNormal: { x: -1, y: 0 },
  })]
  return [
    task9Profile({ rigId, ownerId: partId, id: 'extraLeft', role: 'plug', origin: { x: 760, y: 900 }, outwardNormal: { x: 1, y: 0 } }),
    task9Profile({ rigId, ownerId: partId, id: 'extraRight', role: 'plug', origin: { x: 1288, y: 900 }, outwardNormal: { x: -1, y: 0 } }),
  ]
}

function task9BodyReceiverProfiles(bodyId: keyof typeof TASK9_RECEIVERS, rigId: Task9RigId): Task9Profile[] {
  const sockets = task9ReceiverSockets(bodyId)
  return [
    task9Profile({ rigId, ownerId: bodyId, id: 'tailRoot', role: 'receiver', origin: sockets.tailRoot, outwardNormal: { x: 1, y: 0 } }),
    task9Profile({ rigId, ownerId: bodyId, id: 'extraLeft', role: 'receiver', origin: sockets.extraLeft, outwardNormal: { x: -1, y: 0 } }),
    task9Profile({ rigId, ownerId: bodyId, id: 'extraRight', role: 'receiver', origin: sockets.extraRight, outwardNormal: { x: 1, y: 0 } }),
  ]
}

const TASK9_FRAME_X = { min: 96, max: 1952 } as const

function task9RigBodyIds(rigId: Task9RigId): Array<keyof typeof TASK9_RECEIVERS> {
  return (Object.keys(TASK9_RECEIVERS) as Array<keyof typeof TASK9_RECEIVERS>).filter(bodyId => (
    rigId === 'blob' ? bodyId.startsWith('body_blob_')
      : rigId === 'biped' ? bodyId.startsWith('body_biped_')
        : bodyId.startsWith('body_floating_')
  ))
}

export async function fitTask9DistalNode(input: {
  sourcePath: string
  rigId: Task9RigId
  connectorId: Task9Profile['id']
}): Promise<{
  png: Buffer
  applied: boolean
  sourceBounds: { minX: number; minY: number; maxX: number; maxY: number }
  fittedBounds: { minX: number; minY: number; maxX: number; maxY: number }
  allowed: { minX: number; maxX: number }
  profile: Task9Profile
}> {
  const slotId = input.connectorId === 'tailRoot' ? 'tail' : 'extraAppendage'
  const profile = task9PlugProfiles(input.rigId, 'distal-fit', slotId).find(item => item.id === input.connectorId)!
  const bodyIds = task9RigBodyIds(input.rigId)
  const placements = bodyIds.map(bodyId => task9ReceiverSockets(bodyId)[input.connectorId].x - profile.origin.x)
  const allowed = {
    minX: Math.max(...placements.map(placement => TASK9_FRAME_X.min - placement)),
    maxX: Math.min(...placements.map(placement => TASK9_FRAME_X.max - placement)),
  }
  const source = await sharp(input.sourcePath).ensureAlpha().png(PNG).toBuffer()
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const sourceBounds = alphaBounds(decoded.data, decoded.info.width, decoded.info.height)
  const distalDirection = -profile.outwardNormal.x
  const boundary = profile.origin.x + distalDirection * profile.depth * 0.42
  let png = source
  let applied = false
  if (distalDirection > 0 && sourceBounds.maxX > allowed.maxX) {
    const start = Math.floor(boundary + 0.5)
    const end = sourceBounds.maxX
    const targetEnd = Math.floor(allowed.maxX)
    const targetWidth = targetEnd - start + 1
    if (targetWidth <= 0 || start <= sourceBounds.minX) throw new Error(`TASK9_DISTAL_FIT_INVALID:${input.rigId}:${input.connectorId}`)
    const proximal = await sharp(source).extract({ left: 0, top: 0, width: start, height: SIZE }).png(PNG).toBuffer()
    const distal = await sharp(source).extract({ left: start, top: 0, width: end - start + 1, height: SIZE })
      .resize(targetWidth, SIZE, { fit: 'fill' }).png(PNG).toBuffer()
    png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
      .composite([{ input: proximal, left: 0, top: 0 }, { input: distal, left: start, top: 0 }]).png(PNG).toBuffer()
    applied = true
  } else if (distalDirection < 0 && sourceBounds.minX < allowed.minX) {
    const proximalStart = Math.ceil(boundary - 0.5)
    const start = sourceBounds.minX
    const targetStart = Math.ceil(allowed.minX)
    const targetWidth = proximalStart - targetStart
    if (targetWidth <= 0 || proximalStart > sourceBounds.maxX) throw new Error(`TASK9_DISTAL_FIT_INVALID:${input.rigId}:${input.connectorId}`)
    const distal = await sharp(source).extract({ left: start, top: 0, width: proximalStart - start, height: SIZE })
      .resize(targetWidth, SIZE, { fit: 'fill' }).png(PNG).toBuffer()
    const proximal = await sharp(source).extract({ left: proximalStart, top: 0, width: SIZE - proximalStart, height: SIZE }).png(PNG).toBuffer()
    png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
      .composite([{ input: distal, left: targetStart, top: 0 }, { input: proximal, left: proximalStart, top: 0 }]).png(PNG).toBuffer()
    applied = true
  }
  const fitted = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const fittedBounds = alphaBounds(fitted.data, fitted.info.width, fitted.info.height)
  return { png, applied, sourceBounds, fittedBounds, allowed, profile }
}

export async function auditTask9DistalFits(): Promise<{
  runtimeNodes: number
  projectedBodyPairs: number
  violations: string[]
  appliedKeys: string[]
  plugEnvelopeBytesIdentical: boolean
}> {
  let runtimeNodes = 0; let projectedBodyPairs = 0; let plugEnvelopeBytesIdentical = true
  const violations: string[] = []; const appliedKeys: string[] = []
  for (const selection of task9StructuralSelections()) {
    for (const profile of task9PlugProfiles(selection.rigId, selection.partId, selection.slotId)) {
      runtimeNodes += 1
      const key = `${selection.partId}:${selection.rigId}:${profile.id}`
      const sourcePath = resolve(TASK9_ROOT, `asset-source/v0.3.0/structural/${selection.rigId}/nodes/${selection.partId}/${profile.id}.png`)
      const fitted = await fitTask9DistalNode({ sourcePath, rigId: selection.rigId, connectorId: profile.id })
      if (fitted.applied) appliedKeys.push(key)
      const [before, after] = await Promise.all([
        sharp(sourcePath).ensureAlpha().raw().toBuffer(),
        sharp(fitted.png).ensureAlpha().raw().toBuffer(),
      ])
      for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
        const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
        const tangent = dx * profile.tangent.x + dy * profile.tangent.y
        const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
        if (Math.abs(tangent) > profile.width * 0.32 || Math.abs(normal) > profile.depth * 0.42) continue
        const offset = (y * SIZE + x) * 4
        for (let channel = 0; channel < 4; channel += 1) if (before[offset + channel] !== after[offset + channel]) plugEnvelopeBytesIdentical = false
      }
      for (const bodyId of task9RigBodyIds(selection.rigId)) {
        projectedBodyPairs += 1
        const placementX = task9ReceiverSockets(bodyId)[profile.id].x - profile.origin.x
        const minX = fitted.fittedBounds.minX + placementX
        const maxX = fitted.fittedBounds.maxX + placementX
        if (minX < TASK9_FRAME_X.min || maxX > TASK9_FRAME_X.max) violations.push(`${key}:${bodyId}:${minX}..${maxX}`)
      }
    }
  }
  return { runtimeNodes, projectedBodyPairs, violations, appliedKeys, plugEnvelopeBytesIdentical }
}

function task9AlphaSupportRange(profile: Task9Profile, alpha: Uint8Array): Task9TangentWindow {
  const tangentLimit = profile.width * 0.32
  const normalLimit = profile.depth * 0.42
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const pixel = y * SIZE + x
    if (alpha[pixel]! <= 8) continue
    const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
    const tangent = dx * profile.tangent.x + dy * profile.tangent.y
    const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
    if (Math.abs(tangent) > tangentLimit || Math.abs(normal) > normalLimit) continue
    min = Math.min(min, tangent); max = Math.max(max, tangent)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error(`TASK9_MASK_INVALID: ${profile.id} has no tangent support range`)
  return { min, max }
}

export async function deriveTask9TangentWindows(manifestInput?: any): Promise<Task9TangentWindows> {
  const manifest = manifestInput ?? JSON.parse(await readFile(join(TASK9_SOURCE_ROOT, 'interface-manifest.json'), 'utf8'))
  const ranges = { blob: { tailRoot: [], extraLeft: [], extraRight: [] }, biped: { tailRoot: [], extraLeft: [], extraRight: [] }, floating: { tailRoot: [], extraLeft: [], extraRight: [] } } as Record<Task9RigId, Record<Task9Profile['id'], Task9TangentWindow[]>>
  for (const bodyId of Object.keys(TASK9_RECEIVERS) as Array<keyof typeof TASK9_RECEIVERS>) {
    const rigId = TASK9_BODY_RIG_IDS[bodyId]
    const variant = manifest.assets.find((asset: any) => asset.id === bodyId)?.variants.find((item: any) => item.rigId === rigId)
    if (variant === undefined) throw new Error(`TASK9_BODY_INVALID: missing ${bodyId}`)
    const decoded = await sharp(resolve(TASK9_ROOT, variant.sourcePngPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = new Uint8Array(SIZE * SIZE)
    for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = decoded.data[pixel * 4 + 3]!
    for (const profile of task9BodyReceiverProfiles(bodyId, rigId)) ranges[rigId][profile.id].push(task9AlphaSupportRange(profile, alpha))
  }
  const intersect = (items: Task9TangentWindow[]): Task9TangentWindow => {
    const value = { min: Math.max(...items.map(item => item.min)), max: Math.min(...items.map(item => item.max)) }
    if (!Number.isFinite(value.min) || !Number.isFinite(value.max) || value.min >= value.max) throw new Error('TASK9_MASK_INVALID: receiver tangent windows do not intersect')
    return value
  }
  return Object.fromEntries((['blob', 'biped', 'floating'] as const).map(rigId => {
    const extra = intersect([...ranges[rigId].extraLeft, ...ranges[rigId].extraRight])
    return [rigId, { tailRoot: intersect(ranges[rigId].tailRoot), extraLeft: extra, extraRight: extra }]
  })) as Task9TangentWindows
}

export async function deriveTask9ConnectorContracts(manifestInput?: any): Promise<{
  tangentWindows: Task9TangentWindows
  ribbonDepths: Record<Task9RigId, Record<Task9Profile['id'], number>>
}> {
  const manifest = manifestInput ?? JSON.parse(await readFile(join(TASK9_SOURCE_ROOT, 'interface-manifest.json'), 'utf8'))
  const tangentWindows = await deriveTask9TangentWindows(manifest)
  // The proximal interface seam is 10% of the declared connector depth on
  // both sides. This preserves physical alpha area while keeping the contour
  // focused on the endpoint the affine bridge is required to cover.
  const tailDepth = task9PlugProfiles('blob', 'contract', 'tail')[0]!.depth * 0.1
  const extraDepth = task9PlugProfiles('blob', 'contract', 'extraAppendage')[0]!.depth * 0.1
  const ribbonDepths = Object.fromEntries((['blob', 'biped', 'floating'] as const).map(rigId => [rigId, {
    tailRoot: tailDepth, extraLeft: extraDepth, extraRight: extraDepth,
  }])) as Record<Task9RigId, Record<Task9Profile['id'], number>>
  return { tangentWindows, ribbonDepths }
}

export async function auditTask9ReceiverSupports(): Promise<{
  receiverCount: number
  minimumCoverage: number
  allHalvesNonempty: boolean
  allWithinCanvas: boolean
  sourceHashesUnchanged: boolean
  minimumPixels: number
  emptyHalves: string[]
}> {
  const manifest = JSON.parse(await readFile(join(TASK9_SOURCE_ROOT, 'interface-manifest.json'), 'utf8'))
  const contracts = await deriveTask9ConnectorContracts(manifest)
  let receiverCount = 0; let minimumCoverage = 1; let minimumPixels = Number.POSITIVE_INFINITY; let allHalvesNonempty = true; let allWithinCanvas = true; let sourceHashesUnchanged = true
  const emptyHalves: string[] = []
  for (const bodyId of Object.keys(TASK9_RECEIVERS) as Array<keyof typeof TASK9_RECEIVERS>) {
    const variant = manifest.assets.find((asset: any) => asset.id === bodyId)?.variants.find((item: any) => item.rigId === TASK9_BODY_RIG_IDS[bodyId])
    if (variant === undefined) throw new Error(`TASK9_BODY_INVALID: missing ${bodyId}`)
    const sourcePath = resolve(TASK9_ROOT, variant.sourcePngPath)
    const before = await hashTask9File(sourcePath)
    const decoded = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alpha = new Uint8Array(SIZE * SIZE)
    for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = decoded.data[pixel * 4 + 3]!
    for (const profile of task9BodyReceiverProfiles(bodyId, TASK9_BODY_RIG_IDS[bodyId])) {
      receiverCount += 1
      const contour = task9MaskBand(profile, alpha, contracts.tangentWindows[TASK9_BODY_RIG_IDS[bodyId]][profile.id], contracts.ribbonDepths[TASK9_BODY_RIG_IDS[bodyId]][profile.id])
      const split = splitTask9Contour(profile, contour)
      let pixels = 0; let covered = 0; let foreground = 0; let background = 0
      for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
        const pixel = y * SIZE + x
        if (contour[pixel] === 0) continue
        pixels += 1; if (alpha[pixel]! > 8) covered += 1
        if (split.foreground[pixel] !== 0) foreground += 1
        if (split.background[pixel] !== 0) background += 1
      }
      if (pixels === 0 || foreground === 0 || background === 0) {
        allHalvesNonempty = false
        emptyHalves.push(`${bodyId}:${profile.id}:pixels=${pixels}:front=${foreground}:back=${background}`)
      }
      minimumCoverage = Math.min(minimumCoverage, pixels === 0 ? 0 : covered / pixels)
      minimumPixels = Math.min(minimumPixels, pixels)
      if (profile.origin.x < 0 || profile.origin.y < 0 || profile.origin.x >= SIZE || profile.origin.y >= SIZE) allWithinCanvas = false
    }
    if (before !== await hashTask9File(sourcePath)) sourceHashesUnchanged = false
  }
  return { receiverCount, minimumCoverage, minimumPixels, allHalvesNonempty, allWithinCanvas, sourceHashesUnchanged, emptyHalves }
}

async function rebuildTask9SourceIndex(manifest: any, processedIndex: any) {
  const sources = (processedIndex.sourceIndex?.sources ?? []).filter((source: any) => (
    source.kind !== 'interface-structural' && source.kind !== 'interface-bridge'
  ))
  for (const asset of manifest.assets) for (const variant of asset.variants) {
    const processed = processedIndex.processedAssets[`${asset.id}:${variant.rigId}`]
      ?? (variant.rigId === 'biped' ? processedIndex.processedAssets[asset.id] : undefined)
    if (processed === undefined) throw new Error(`TASK9_SOURCE_INDEX_INVALID: missing processed asset ${asset.id}:${variant.rigId}`)
    const task9Variant = asset.slotId === 'tail' || asset.slotId === 'extraAppendage'
    const reviewRecordPath = task9Variant
      ? 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'
      : variant.promptEvidence.reviewRecordPath
    const runtimeResources = [
      { path: processed.webpPath, sha256: processed.webpSha256 },
      { path: processed.pngPath, sha256: processed.pngSha256 },
      ...Object.values(processed.renderNodes as Record<string, any>).flatMap(node => [
        { path: node.webpPath, sha256: node.webpSha256 },
        { path: node.pngPath, sha256: node.pngSha256 },
      ]),
      ...variant.connectors.flatMap((connector: any) => {
        const hashes = processed.connectorHashes[connector.id]
        if (hashes === undefined) throw new Error(`TASK9_SOURCE_INDEX_INVALID: missing connector hashes ${asset.id}:${variant.rigId}:${connector.id}`)
        return [
          { path: connector.contourMaskPath, sha256: hashes.contourMaskSha256 },
          { path: connector.foregroundMaskPath, sha256: hashes.foregroundMaskSha256 },
          { path: connector.backgroundMaskPath, sha256: hashes.backgroundMaskSha256 },
        ]
      }),
    ]
    sources.push({
      sourceId: `${asset.id}:${variant.rigId}`, kind: 'interface-structural',
      promptId: variant.promptEvidence.promptId, promptPath: variant.promptEvidence.promptPath,
      promptSha256: variant.promptEvidence.promptSha256, reviewRecordPath,
      reviewRecordSha256: await hashTask9File(resolve(TASK9_ROOT, reviewRecordPath)),
      sourceResources: await Promise.all([...new Set([variant.sourcePngPath, ...variant.renderNodes.map((node: any) => node.sourcePngPath)])]
        .map(async path => ({ path, sha256: await hashTask9File(resolve(TASK9_ROOT, path)) }))),
      runtimeResources,
    })
  }
  for (const bridge of manifest.bridges) {
    const processed = processedIndex.processedBridges[`${bridge.rigId}:${bridge.connectorClass}`]
      ?? (bridge.rigId === 'biped' ? processedIndex.processedBridges[bridge.connectorClass] : undefined)
    if (processed === undefined) throw new Error(`TASK9_SOURCE_INDEX_INVALID: missing processed bridge ${bridge.rigId}:${bridge.connectorClass}`)
    const task9Bridge = bridge.connectorClass === 'tail' || bridge.connectorClass === 'extra'
    const reviewRecordPath = task9Bridge
      ? 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'
      : bridge.promptEvidence.reviewRecordPath
    sources.push({
      sourceId: bridge.id, kind: 'interface-bridge', promptId: bridge.promptEvidence.promptId,
      promptPath: bridge.promptEvidence.promptPath, promptSha256: bridge.promptEvidence.promptSha256,
      reviewRecordPath, reviewRecordSha256: await hashTask9File(resolve(TASK9_ROOT, reviewRecordPath)),
      sourceResources: [{ path: bridge.sourcePngPath, sha256: await hashTask9File(resolve(TASK9_ROOT, bridge.sourcePngPath)) }],
      runtimeResources: [
        { path: bridge.neutralWebpPath, sha256: processed.neutralWebpSha256 },
        { path: bridge.neutralPngPath, sha256: processed.neutralPngSha256 },
        { path: bridge.frontMaskPath, sha256: processed.frontMaskSha256 },
        { path: bridge.backMaskPath, sha256: processed.backMaskSha256 },
      ],
    })
  }
  processedIndex.sourceIndex = { ...(processedIndex.sourceIndex ?? {}), catalogVersion: '0.3.0', sources }
  return processedIndex.sourceIndex
}

export async function synchronizeTask9SourceIndex(options: { dryRun?: boolean } = {}): Promise<any> {
  const manifestPath = join(TASK9_SOURCE_ROOT, 'interface-manifest.json')
  const processedPath = join(TASK9_SOURCE_ROOT, 'production', 'processed-index.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const processedIndex = JSON.parse(await readFile(processedPath, 'utf8'))
  const task9ReviewRecordPath = 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json'
  for (const asset of manifest.assets) {
    if (asset.slotId === 'tail' || asset.slotId === 'extraAppendage') {
      for (const variant of asset.variants) variant.promptEvidence.reviewRecordPath = task9ReviewRecordPath
    }
  }
  for (const bridge of manifest.bridges) {
    if (bridge.connectorClass === 'tail' || bridge.connectorClass === 'extra') bridge.promptEvidence.reviewRecordPath = task9ReviewRecordPath
  }
  const sourceIndex = await rebuildTask9SourceIndex(manifest, processedIndex)
  if (!options.dryRun) {
    await writeTask9Json(manifestPath, manifest)
    await writeTask9Json(processedPath, processedIndex)
    await writeTask9Json(join(TASK9_CATALOG_ROOT, 'source-index-v0.3.0.json'), sourceIndex)
  }
  return sourceIndex
}

export async function prepareTask9StructuralAssets(): Promise<{ variants: number; nodes: number; plugMasks: number; receiverMasks: number; bridges: number }> {
  const manifestPath = join(TASK9_SOURCE_ROOT, 'interface-manifest.json')
  const processedPath = join(TASK9_SOURCE_ROOT, 'production', 'processed-index.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const processedIndex = JSON.parse(await readFile(processedPath, 'utf8'))
  const promptPath = join(TASK9_SOURCE_ROOT, 'prompts', 'task9-tail-extra-prompts.json')
  const promptSha256 = await hashTask9File(promptPath)
  const promptEvidence = {
    promptId: 'task9-exact-rig-tail-extra', promptPath: 'asset-source/v0.3.0/prompts/task9-tail-extra-prompts.json',
    promptSha256, reviewRecordPath: 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json',
  }
  const contracts = await deriveTask9ConnectorContracts(manifest)
  let nodeCount = 0
  for (const selection of task9StructuralSelections()) {
    const sourcePngPath = `asset-source/v0.3.0/structural/${selection.rigId}/${selection.partId}.png`
    const sourcePath = resolve(TASK9_ROOT, sourcePngPath)
    const profiles = task9PlugProfiles(selection.rigId, selection.partId, selection.slotId)
    const maskInputs = await writeTask9Masks(
      selection.rigId, selection.partId, profiles, sourcePath,
      contracts.tangentWindows[selection.rigId], contracts.ribbonDepths[selection.rigId],
    )
    const runtimeBase = `assets/v0.3.0/structural/${selection.rigId}/${selection.partId}`
    const processed = await processInterfaceAsset({
      sourcePath, outputPngPath: resolve(TASK9_CATALOG_ROOT, `${runtimeBase}.png`), outputWebpPath: resolve(TASK9_CATALOG_ROOT, `${runtimeBase}.webp`),
      connectors: maskInputs, materialSampleRegion: profiles[0]!.materialSampleRegion,
    })
    const renderNodes = []
    const processedNodes: Record<string, any> = {}
    for (const profile of profiles) {
      const nodeId = `${selection.partId}-${selection.rigId}-${profile.id}`
      const nodeSourcePath = `asset-source/v0.3.0/structural/${selection.rigId}/nodes/${selection.partId}/${profile.id}.png`
      renderNodes.push({ id: nodeId, connectorId: profile.id, sourcePngPath: nodeSourcePath })
      processedNodes[nodeId] = await writeTask9RuntimeNode(
        resolve(TASK9_ROOT, nodeSourcePath), `${runtimeBase}/nodes/${nodeId}`, selection.rigId, profile.id,
      )
      nodeCount += 1
    }
    const group = manifest.assets.find((asset: any) => asset.id === selection.partId)
      ?? (() => { const created = { id: selection.partId, slotId: selection.slotId, variants: [] }; manifest.assets.push(created); return created })()
    group.slotId = selection.slotId
    group.variants = group.variants.filter((variant: any) => variant.rigId !== selection.rigId)
    group.variants.push({
      rigId: selection.rigId, materialFamily: selection.partId.includes('mushroom') ? 'mushroom-velvet' : 'short-fur',
      sourcePngPath, promptEvidence, connectors: profiles, renderNodes,
    })
    processedIndex.processedAssets[`${selection.partId}:${selection.rigId}`] = {
      pngPath: `${runtimeBase}.png`, pngSha256: processed.pngSha256,
      webpPath: `${runtimeBase}.webp`, webpSha256: processed.webpSha256,
      renderNodes: processedNodes, connectorHashes: processed.connectorHashes,
    }
  }

  for (const bodyId of Object.keys(TASK9_RECEIVERS) as Array<keyof typeof TASK9_RECEIVERS>) {
    const group = manifest.assets.find((asset: any) => asset.id === bodyId)
    const variant = group?.variants.find((item: any) => item.rigId === TASK9_BODY_RIG_IDS[bodyId])
    if (variant === undefined) throw new Error(`TASK9_BODY_INVALID: missing ${bodyId}`)
    const before = await hashTask9File(resolve(TASK9_ROOT, variant.sourcePngPath))
    const profiles = task9BodyReceiverProfiles(bodyId, TASK9_BODY_RIG_IDS[bodyId])
    variant.connectors = variant.connectors.filter((item: any) => !profiles.some(profile => profile.id === item.id)).concat(profiles)
    await writeTask9Masks(
      TASK9_BODY_RIG_IDS[bodyId], bodyId, profiles, resolve(TASK9_ROOT, variant.sourcePngPath),
      contracts.tangentWindows[TASK9_BODY_RIG_IDS[bodyId]], contracts.ribbonDepths[TASK9_BODY_RIG_IDS[bodyId]],
    )
    const processedKey = resolveTask9ProcessedBodyKey(processedIndex.processedAssets, bodyId, TASK9_BODY_RIG_IDS[bodyId])
    const existing = processedIndex.processedAssets[processedKey]
    const inputs = variant.connectors.map((profile: any) => ({
      id: profile.id, contourMaskPath: resolve(TASK9_CATALOG_ROOT, profile.contourMaskPath),
      foregroundMaskPath: resolve(TASK9_CATALOG_ROOT, profile.foregroundMaskPath), backgroundMaskPath: resolve(TASK9_CATALOG_ROOT, profile.backgroundMaskPath),
    }))
    const processed = await processInterfaceAsset({
      sourcePath: resolve(TASK9_ROOT, variant.sourcePngPath), outputPngPath: resolve(TASK9_CATALOG_ROOT, existing.pngPath),
      outputWebpPath: resolve(TASK9_CATALOG_ROOT, existing.webpPath), connectors: inputs,
      materialSampleRegion: variant.connectors[0].materialSampleRegion,
    })
    if (before !== await hashTask9File(resolve(TASK9_ROOT, variant.sourcePngPath))) throw new Error(`TASK9_BODY_MUTATED: ${bodyId}`)
    processedIndex.processedAssets[processedKey] = {
      ...existing, pngSha256: processed.pngSha256, webpSha256: processed.webpSha256, connectorHashes: processed.connectorHashes,
    }
  }

  const bridgeSource: Record<'tail' | 'extra', string> = {
    tail: 'asset-source/v0.3.0/production/bridges/tail.png', extra: 'asset-source/v0.3.0/production/bridges/extra.png',
  }
  for (const connectorClass of ['tail', 'extra'] as const) {
    const target = resolve(TASK9_ROOT, bridgeSource[connectorClass])
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(TASK9_ROOT, 'asset-source/v0.3.0/production/bridges/shoulder.png'), target)
  }
  let bridgeCount = 0
  for (const rigId of ['blob', 'biped', 'floating'] as const) for (const connectorClass of ['tail', 'extra'] as const) {
    const shoulder = manifest.bridges.find((bridge: any) => bridge.rigId === rigId && bridge.connectorClass === 'shoulder')
    const bridge = {
      ...shoulder, id: `${rigId}-${connectorClass}-bridge`, rigId, connectorClass,
      sourcePngPath: bridgeSource[connectorClass], neutralPngPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.png`,
      neutralWebpPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.webp`, frontMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-front.png`,
      backMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-back.png`, promptEvidence,
    }
    manifest.bridges = manifest.bridges.filter((item: any) => item.id !== bridge.id)
    manifest.bridges.push(bridge)
    for (const [sourceSuffix, targetPath] of [
      ['shoulder.png', bridge.neutralPngPath], ['shoulder.webp', bridge.neutralWebpPath],
      ['shoulder-front.png', bridge.frontMaskPath],
    ] as const) {
      const source = resolve(TASK9_CATALOG_ROOT, `assets/v0.3.0/bridges/${rigId}/${sourceSuffix}`)
      const target = resolve(TASK9_CATALOG_ROOT, targetPath)
      await mkdir(dirname(target), { recursive: true }); await copyFile(source, target)
    }
    await writeTask9BridgeBackMask(
      resolve(TASK9_CATALOG_ROOT, bridge.neutralPngPath),
      resolve(TASK9_CATALOG_ROOT, bridge.frontMaskPath),
      resolve(TASK9_CATALOG_ROOT, bridge.backMaskPath),
    )
    processedIndex.processedBridges[`${rigId}:${connectorClass}`] = {
      neutralPngSha256: await hashTask9File(resolve(TASK9_CATALOG_ROOT, bridge.neutralPngPath)),
      neutralWebpSha256: await hashTask9File(resolve(TASK9_CATALOG_ROOT, bridge.neutralWebpPath)),
      frontMaskSha256: await hashTask9File(resolve(TASK9_CATALOG_ROOT, bridge.frontMaskPath)),
      backMaskSha256: await hashTask9File(resolve(TASK9_CATALOG_ROOT, bridge.backMaskPath)),
    }
    bridgeCount += 1
  }
  const sourceIndex = await rebuildTask9SourceIndex(manifest, processedIndex)
  await writeTask9Json(manifestPath, manifest)
  await writeTask9Json(processedPath, processedIndex)
  await writeTask9Json(join(TASK9_CATALOG_ROOT, 'source-index-v0.3.0.json'), sourceIndex)
  return { variants: 18, nodes: nodeCount, plugMasks: 27 * 3, receiverMasks: 15 * 3, bridges: bridgeCount }
}

export async function renderTask9ReceiverGuides(): Promise<{ profiles: number; files: number; indexPath: string }> {
  const manifest = JSON.parse(await readFile(join(TASK9_SOURCE_ROOT, 'interface-manifest.json'), 'utf8'))
  const profiles = []
  for (const bodyId of Object.keys(TASK9_RECEIVERS)) {
    const asset = manifest.assets.find((item: any) => item.id === bodyId)
    if (asset === undefined || asset.variants.length !== 1) throw new Error(`TASK9_GUIDE_INVALID: body ${bodyId} must have one variant`)
    for (const connector of asset.variants[0].connectors.filter((item: any) => ['tailRoot', 'extraLeft', 'extraRight'].includes(item.id))) {
      profiles.push({ ...connector, assetId: bodyId })
    }
  }
  if (profiles.length !== 15) throw new Error(`TASK9_GUIDE_INVALID: expected 15 receiver profiles, got ${profiles.length}`)
  const outputRoot = join(TASK9_SOURCE_ROOT, 'generation', 'task9-review', 'receiver-guides')
  const rendered = await renderInterfaceGuides({ outputRoot, rigId: 'biped', profiles })
  const indexPath = join(outputRoot, 'task9-receiver-guide-index.json')
  await writeTask9Json(indexPath, {
    schemaVersion: 'task9-receiver-guides-v1',
    files: rendered.files.map(file => ({
      assetId: file.assetId, connectorId: file.connectorId, role: file.role,
      guidePath: relativeTask9Path(file.guidePath), guideSha256: file.guideSha256,
      maskPath: relativeTask9Path(file.maskPath), maskSha256: file.maskSha256,
    })),
  })
  return { profiles: profiles.length, files: rendered.files.length * 2, indexPath: relativeTask9Path(indexPath) }
}

function relativeTask9Path(path: string): string {
  return path.replaceAll('\\', '/').replace(`${TASK9_ROOT.replaceAll('\\', '/')}/`, '')
}
