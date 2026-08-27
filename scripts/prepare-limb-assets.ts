import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { processInterfaceAsset } from './process-interface-asset.js'
import { splitPairedPart, type PairCrop, type SplitNodeResult } from './split-paired-part.js'
import { alphaMaskFromRgba, calibrateChildOrigin } from './alpha-junction-calibration.js'

const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const SIZE = 2048

export type LimbRigId = 'blob' | 'biped' | 'floating'
export type LimbSlotId = 'arms' | 'legs'
export type LimbResizeFit = 'fill' | 'inside'

export function limbRenderTransform(input: { rigId: LimbRigId; partId: string }): { scale: number; mirrorX: false } | undefined {
  if (input.rigId === 'blob' && input.partId === 'arms_short_plush') return { scale: 1.15, mirrorX: false }
  if (input.rigId === 'blob' && input.partId === 'legs_mushroom') return { scale: 1.15, mirrorX: false }
  if (input.rigId === 'biped' && (input.partId === 'legs_stub_feet' || input.partId === 'legs_shadow_tiptoe')) {
    return { scale: 0.89, mirrorX: false }
  }
  return undefined
}

export function rootPreservingDistalWarp(input: {
  rgba: Buffer
  width: number
  height: number
  anchor: { x: number; y: number }
  side: 'left' | 'right'
  connectorWidth: number
  connectorDepth: number
  distalRatio: number
}): Buffer {
  const { rgba, width, height, anchor, side, connectorWidth, connectorDepth, distalRatio } = input
  if (rgba.length !== width * height * 4) throw new Error('LIMB_DISTAL_WARP_INVALID: RGBA byte length does not match dimensions')
  if (!(distalRatio > 0 && distalRatio <= 1)) throw new Error('LIMB_DISTAL_WARP_INVALID: ratio must be in (0, 1]')
  const halfWidth = Math.ceil(connectorWidth / 2)
  const halfDepth = Math.ceil(connectorDepth / 2)
  const outerBoundary = side === 'left' ? anchor.x - halfWidth : anchor.x + halfWidth
  const output = Buffer.from(rgba)
  const outward = (x: number) => side === 'left' ? x < outerBoundary : x > outerBoundary
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!outward(x)) continue
    const sourceX = side === 'left'
      ? Math.round(outerBoundary - (outerBoundary - x) / distalRatio)
      : Math.round(outerBoundary + (x - outerBoundary) / distalRatio)
    const destination = (y * width + x) * 4
    if (sourceX < 0 || sourceX >= width) output.fill(0, destination, destination + 4)
    else rgba.copy(output, destination, (y * width + sourceX) * 4, (y * width + sourceX) * 4 + 4)
  }
  // The entire connector plug envelope is authored evidence. Assert that the
  // shared distal warp left every byte in that envelope untouched.
  const left = Math.max(0, anchor.x - halfWidth); const right = Math.min(width - 1, anchor.x + halfWidth)
  const top = Math.max(0, anchor.y - halfDepth); const bottom = Math.min(height - 1, anchor.y + halfDepth)
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
    const pixel = (y * width + x) * 4
    if (!output.subarray(pixel, pixel + 4).equals(rgba.subarray(pixel, pixel + 4))) {
      throw new Error('LIMB_DISTAL_WARP_INVALID: connector plug envelope changed')
    }
  }
  return output
}

function distalWarpSpec(input: { rigId: LimbRigId; partId?: string }): { ratio: number } | undefined {
  if (input.rigId === 'blob' && (input.partId === 'arms_paddle' || input.partId === 'arms_long_noodle')) return { ratio: 0.78 }
  return undefined
}

export function limbNormalizationSpec(input: { rigId: LimbRigId; slotId: LimbSlotId; partId?: string }): { width: number; height: number; fit: LimbResizeFit } {
  const identity = `${input.partId ?? ''}:${input.rigId}`
  const exact: Record<string, { width: number; height: number; fit: LimbResizeFit }> = {
    'arms_short_plush:blob': { width: 400, height: 500, fit: 'inside' },
    'arms_paddle:blob': { width: 520, height: 900, fit: 'fill' },
    'legs_webbed:blob': { width: 520, height: 720, fit: 'inside' },
    'legs_mushroom:blob': { width: 400, height: 720, fit: 'inside' },
    'legs_shadow_tiptoe:blob': { width: 480, height: 720, fit: 'inside' },
  }
  if (exact[identity] !== undefined) return exact[identity]!
  if (input.slotId === 'arms') {
    if (input.rigId === 'floating') return { width: 460, height: 900, fit: 'inside' }
    if (input.rigId === 'blob') return { width: 520, height: 900, fit: 'fill' }
    return { width: 480, height: 720, fit: 'inside' }
  }
  if (input.rigId === 'floating') return { width: 420, height: 820, fit: 'fill' }
  return { width: 430, height: 560, fit: 'inside' }
}

export function connectorMaskFractions(input: { rigId: LimbRigId; slotId: LimbSlotId }): { tangent: number; normal: number } {
  if (input.rigId === 'biped' && input.slotId === 'arms') return { tangent: 0.4, normal: 0.43 }
  if (input.rigId === 'biped') return { tangent: 0.38, normal: 0.48 }
  return input.slotId === 'arms' ? { tangent: 0.32, normal: 0.42 } : { tangent: 0.4, normal: 0.48 }
}

export function connectorProfileSize(input: { rigId: LimbRigId; slotId: LimbSlotId }): { width: number; depth: number } {
  if (input.rigId === 'biped' && input.slotId === 'arms') return { width: 230, depth: 130 }
  if (input.rigId === 'biped' && input.slotId === 'legs') return { width: 240, depth: 140 }
  return { width: 220, depth: 120 }
}

interface Component {
  mass: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  centroidX: number
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export function derivePairedNodeOrigin(input: {
  preferredOrigin: { x: number; y: number }
  anchor: { x: number; y: number }
  nodeSize: { width: number; height: number }
  cell: Rect
}): { origin: { x: number; y: number }; left: number; top: number } {
  const { preferredOrigin, anchor, nodeSize, cell } = input
  if (nodeSize.width > cell.width || nodeSize.height > cell.height) {
    throw new Error(`LIMB_PAIR_INVALID: normalized node ${nodeSize.width}x${nodeSize.height} exceeds staging cell ${cell.width}x${cell.height}`)
  }
  const minOriginX = cell.left + anchor.x
  const maxOriginX = cell.left + cell.width - nodeSize.width + anchor.x
  const minOriginY = cell.top + anchor.y
  const maxOriginY = cell.top + cell.height - nodeSize.height + anchor.y
  const origin = {
    x: Math.max(minOriginX, Math.min(maxOriginX, preferredOrigin.x)),
    y: Math.max(minOriginY, Math.min(maxOriginY, preferredOrigin.y)),
  }
  return { origin, left: origin.x - anchor.x, top: origin.y - anchor.y }
}

function shaAlphaComponents(pixels: Buffer, width: number, height: number): Component[] {
  const count = width * height
  const labels = new Int32Array(count)
  const queue = new Int32Array(count)
  const components: Component[] = []
  let label = 0
  for (let first = 0; first < count; first += 1) {
    if (labels[first] !== 0 || pixels[first * 4 + 3]! <= 8) continue
    label += 1
    labels[first] = label
    queue[0] = first
    let queued = 1
    let mass = 0
    let weightedX = 0
    let minX = width; let minY = height; let maxX = -1; let maxY = -1
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!
      const x = current % width; const y = Math.floor(current / width)
      const alpha = pixels[current * 4 + 3]!
      mass += alpha; weightedX += x * alpha
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      for (const next of [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1]) {
        if (next < 0 || labels[next] !== 0 || pixels[next * 4 + 3]! <= 8) continue
        labels[next] = label; queue[queued++] = next
      }
    }
    components.push({ mass, minX, minY, maxX, maxY, centroidX: weightedX / mass })
  }
  return components.sort((a, b) => b.mass - a.mass)
}

export async function extractPairedLimbCandidate(sourcePath: string, outputPath: string): Promise<{
  componentCount: number
  boundaryAlphaPixels: number
  partialAlphaPixels: number
}> {
  const decoded = await sharp(await readFile(sourcePath)).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(decoded.info.width * decoded.info.height * 4)
  let boundaryAlphaPixels = 0
  let partialAlphaPixels = 0
  for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
    const pixel = y * decoded.info.width + x; const i3 = pixel * 3; const i4 = pixel * 4
    const r = decoded.data[i3]!; const g = decoded.data[i3 + 1]!; const b = decoded.data[i3 + 2]!
    const low = Math.min(r, g, b); const neutral = Math.max(r, g, b) - low
    let alpha = 255
    if (neutral <= 10 && low >= 236) alpha = 0
    else if (neutral <= 14 && low >= 218) alpha = Math.round(255 * (236 - low) / 18)
    if (x < 8 || y < 8 || x >= decoded.info.width - 8 || y >= decoded.info.height - 8) alpha = 0
    rgba[i4] = r; rgba[i4 + 1] = g; rgba[i4 + 2] = b; rgba[i4 + 3] = alpha
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1
    if ((x === 0 || y === 0 || x === decoded.info.width - 1 || y === decoded.info.height - 1) && alpha > 0) boundaryAlphaPixels += 1
  }
  const components = shaAlphaComponents(rgba, decoded.info.width, decoded.info.height)
  if (components.length < 2) throw new Error('LIMB_PAIR_INVALID: candidate does not contain two separated authored alpha components')
  const kept = components.slice(0, 2)
  const keepAlpha = Buffer.alloc(decoded.info.width * decoded.info.height)
  for (const component of kept) {
    for (let y = component.minY; y <= component.maxY; y += 1) for (let x = component.minX; x <= component.maxX; x += 1) {
      const pixel = y * decoded.info.width + x
      if (rgba[pixel * 4 + 3]! > 8) keepAlpha[pixel] = 255
    }
  }
  for (let pixel = 0; pixel < keepAlpha.length; pixel += 1) if (keepAlpha[pixel] === 0) rgba[pixel * 4 + 3] = 0
  await mkdir(dirname(outputPath), { recursive: true })
  await sharp(rgba, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } }).png(PNG).toFile(outputPath)
  return { componentCount: kept.length, boundaryAlphaPixels, partialAlphaPixels }
}

function integralAlpha(alpha: Buffer, width: number, height: number): Uint32Array {
  const integral = new Uint32Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    for (let x = 0; x < width; x += 1) {
      row += alpha[y * width + x]! > 8 ? 1 : 0
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1]! + row
    }
  }
  return integral
}

function regionSum(integral: Uint32Array, width: number, left: number, top: number, right: number, bottom: number): number {
  const stride = width + 1
  return integral[bottom * stride + right]! - integral[top * stride + right]!
    - integral[bottom * stride + left]! + integral[top * stride + left]!
}

function proximalAnchor(rgba: Buffer, width: number, height: number, slotId: LimbSlotId, side: 'left' | 'right') {
  const alpha = Buffer.alloc(width * height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3]!
  const halfW = slotId === 'arms' ? 50 : 88
  const halfH = slotId === 'arms' ? 70 : 58
  const integral = integralAlpha(alpha, width, height)
  let best = { x: Math.floor(width / 2), y: Math.floor(height / 4), coverage: -1, preference: -Infinity }
  // Arm art may place a broad shoulder root below an upraised paw. Search the
  // complete authored node height so the inward-most solid root wins instead
  // of mistaking a dense distal paw for the connector. Leg roots remain in
  // the declared upper hip band.
  const maxY = slotId === 'arms'
    ? Math.max(halfH + 1, height - halfH)
    : Math.max(halfH + 1, Math.floor(height * 0.42))
  for (let y = halfH; y < maxY; y += 4) for (let x = halfW; x < width - halfW; x += 4) {
    const coverage = regionSum(integral, width, x - halfW, y - halfH, x + halfW, y + halfH) / (4 * halfW * halfH)
    if (coverage < 0.9) continue
    const inward = slotId === 'arms' ? (side === 'left' ? x / width : 1 - x / width) : 1 - Math.abs(x / width - 0.5)
    const targetY = slotId === 'arms' ? height * 0.28 : height * 0.18
    const preference = slotId === 'arms'
      ? 100000 + inward * 1000 - Math.abs(y - targetY) / height * 20 + coverage
      : 100000 - Math.abs(y - targetY) / height * 100 + inward * 10 + coverage
    if (preference > best.preference) best = { x, y, coverage, preference }
  }
  if (best.coverage < 0.9) throw new Error(`LIMB_PAIR_INVALID: ${side} proximal authored alpha coverage ${best.coverage.toFixed(4)} is below 0.9`)
  return best
}

export async function normalizePairedLimb(input: {
  extractedPath: string
  rigId: LimbRigId
  slotId: LimbSlotId
  partId?: string
}): Promise<{
  master: Buffer
  nodes: readonly [Buffer, Buffer]
  origins: readonly [{ x: number, y: number }, { x: number, y: number }]
  splitAnchors: readonly [{ x: number, y: number }, { x: number, y: number }]
  anchorCoverage: readonly [number, number]
}> {
  const decoded = await sharp(input.extractedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const components = shaAlphaComponents(decoded.data, decoded.info.width, decoded.info.height).slice(0, 2).sort((a, b) => a.centroidX - b.centroidX)
  if (components.length !== 2) throw new Error('LIMB_PAIR_INVALID: extracted source does not contain exactly two principal nodes')
  const target = limbNormalizationSpec(input)
  const preferredOrigins = [{ x: 680, y: input.slotId === 'arms' ? 480 : 420 }, { x: 1368, y: input.slotId === 'arms' ? 480 : 420 }] as const
  const stagingCells = [{ left: 0, top: 0, width: 1024, height: SIZE }, { left: 1024, top: 0, width: 1024, height: SIZE }] as const
  const origins: Array<{ x: number; y: number }> = []
  const nodes: Buffer[] = []
  const coverages: number[] = []
  const splitAnchors: Array<{ x: number, y: number }> = []
  const distalWarp = distalWarpSpec(input)
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!
    const crop = await sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
      .extract({ left: component.minX, top: component.minY, width: component.maxX - component.minX + 1, height: component.maxY - component.minY + 1 })
      .resize(target.width, target.height, { fit: target.fit, withoutEnlargement: false })
      .png(PNG).toBuffer({ resolveWithObject: true })
    const rgba = await sharp(crop.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const side = index === 0 ? 'left' : 'right'
    const anchor = proximalAnchor(rgba.data, rgba.info.width, rgba.info.height, input.slotId, side)
    const profile = connectorProfileSize(input)
    const nodeRgba = distalWarp === undefined ? Buffer.from(rgba.data) : rootPreservingDistalWarp({
      rgba: rgba.data, width: rgba.info.width, height: rgba.info.height, anchor, side,
      connectorWidth: profile.width, connectorDepth: profile.depth, distalRatio: distalWarp.ratio,
    })
    const nodePng = await sharp(nodeRgba, { raw: { width: rgba.info.width, height: rgba.info.height, channels: 4 } }).png(PNG).toBuffer()
    const splitAnchor = calibrateChildOrigin(alphaMaskFromRgba(nodeRgba, rgba.info.width, rgba.info.height, 4), {
      junction: input.slotId === 'arms' ? (index === 0 ? 'armLeft' : 'armRight') : (index === 0 ? 'legLeft' : 'legRight'),
      insetPx: 32,
    })
    const staged = derivePairedNodeOrigin({
      preferredOrigin: preferredOrigins[index]!, anchor,
      nodeSize: { width: rgba.info.width, height: rgba.info.height },
      cell: stagingCells[index]!,
    })
    const { origin, left, top } = staged
    origins.push(origin)
    nodes.push(await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
      .composite([{ input: nodePng, left, top }]).png(PNG).toBuffer())
    coverages.push(anchor.coverage)
    splitAnchors.push({ x: left + splitAnchor.x, y: top + splitAnchor.y })
  }
  const master = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' } })
    .composite(nodes.map(node => ({ input: node, left: 0, top: 0 }))).png(PNG).toBuffer()
  return {
    master, nodes: nodes as [Buffer, Buffer], origins: origins as [{ x: number, y: number }, { x: number, y: number }], splitAnchors: splitAnchors as [{ x: number, y: number }, { x: number, y: number }],
    anchorCoverage: coverages as [number, number], distalWarp,
  }
}

export async function writeNormalizedPrototype(input: {
  candidatePath: string
  extractedPath: string
  masterPath: string
  nodePaths: readonly [string, string]
  rigId: LimbRigId
  slotId: LimbSlotId
  partId?: string
}) {
  const extraction = await extractPairedLimbCandidate(input.candidatePath, input.extractedPath)
  const normalized = await normalizePairedLimb({ extractedPath: input.extractedPath, rigId: input.rigId, slotId: input.slotId, partId: input.partId })
  for (const [path, bytes] of [[input.masterPath, normalized.master], [input.nodePaths[0], normalized.nodes[0]], [input.nodePaths[1], normalized.nodes[1]]] as const) {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
  }
  return { extraction, origins: normalized.origins, splitAnchors: normalized.splitAnchors, anchorCoverage: normalized.anchorCoverage, distalWarp: normalized.distalWarp }
}

const ROOT = process.cwd()
const SOURCE_ROOT = join(ROOT, 'asset-source', 'v0.3.0')
const CATALOG_ROOT = join(ROOT, 'packages', 'asset-catalog')

interface LimbSelection {
  rigId: LimbRigId
  partId: string
  slotId: LimbSlotId
  selected: number
  candidateCount?: number
}

const GENERATED_SELECTIONS: readonly LimbSelection[] = [
  { rigId: 'blob', partId: 'arms_short_plush', slotId: 'arms', selected: 3, candidateCount: 7 },
  { rigId: 'blob', partId: 'arms_long_noodle', slotId: 'arms', selected: 2, candidateCount: 2 },
  { rigId: 'blob', partId: 'arms_paddle', slotId: 'arms', selected: 4, candidateCount: 5 },
  { rigId: 'blob', partId: 'legs_stub_feet', slotId: 'legs', selected: 1 },
  { rigId: 'blob', partId: 'legs_webbed', slotId: 'legs', selected: 2, candidateCount: 2 },
  { rigId: 'blob', partId: 'legs_mushroom', slotId: 'legs', selected: 4, candidateCount: 5 },
  { rigId: 'blob', partId: 'legs_shadow_tiptoe', slotId: 'legs', selected: 3, candidateCount: 3 },
  { rigId: 'biped', partId: 'arms_paddle', slotId: 'arms', selected: 1 },
  { rigId: 'biped', partId: 'legs_stub_feet', slotId: 'legs', selected: 1 },
  { rigId: 'biped', partId: 'legs_shadow_tiptoe', slotId: 'legs', selected: 1 },
  { rigId: 'floating', partId: 'arms_short_plush', slotId: 'arms', selected: 1 },
  { rigId: 'floating', partId: 'arms_long_noodle', slotId: 'arms', selected: 1 },
  { rigId: 'floating', partId: 'arms_paddle', slotId: 'arms', selected: 1 },
  { rigId: 'floating', partId: 'legs_stub_feet', slotId: 'legs', selected: 1 },
  { rigId: 'floating', partId: 'legs_webbed', slotId: 'legs', selected: 1 },
  { rigId: 'floating', partId: 'legs_mushroom', slotId: 'legs', selected: 1 },
  { rigId: 'floating', partId: 'legs_shadow_tiptoe', slotId: 'legs', selected: 1 },
]

const PROTOTYPES: readonly LimbSelection[] = GENERATED_SELECTIONS.filter(selection => [
  'arms_paddle:blob', 'legs_stub_feet:blob', 'arms_long_noodle:floating', 'legs_shadow_tiptoe:floating',
].includes(`${selection.partId}:${selection.rigId}`))

const OPTION_A_PROTOTYPES: readonly LimbSelection[] = GENERATED_SELECTIONS.filter(selection => [
  'arms_short_plush:blob', 'legs_shadow_tiptoe:blob',
].includes(`${selection.partId}:${selection.rigId}`))

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return sha256(await readFile(path)) }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function maskBand(profile: any, selection: LimbSelection): Buffer {
  const alpha = Buffer.alloc(SIZE * SIZE)
  const fractions = connectorMaskFractions(selection)
  const tangentLimit = profile.width * fractions.tangent
  const normalLimit = profile.depth * fractions.normal
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
    const tangent = dx * profile.tangent.x + dy * profile.tangent.y
    const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
    if (Math.abs(tangent) <= tangentLimit && Math.abs(normal) <= normalLimit) alpha[y * SIZE + x] = 255
  }
  return alpha
}

async function maskPng(alpha: Buffer): Promise<Buffer> {
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } }).png(PNG).toBuffer()
}

function limbProfiles(selection: LimbSelection, origins: readonly [{ x: number, y: number }, { x: number, y: number }]) {
  const isArms = selection.slotId === 'arms'
  const ids = isArms ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight']
  const size = connectorProfileSize(selection)
  return ids.map((id, index) => {
    const base = `assets/v0.3.0/connectors/${selection.rigId}/${selection.partId}-${id}`
    return {
      id, role: 'plug' as const, connectorClass: isArms ? 'shoulder' as const : 'hip' as const,
      origin: origins[index]!, tangent: isArms ? { x: 0, y: 1 } : { x: 1, y: 0 },
      outwardNormal: isArms ? (index === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }) : { x: 0, y: -1 },
      width: size.width, depth: size.depth,
      contourMaskPath: `${base}-contour.png`, foregroundMaskPath: `${base}-foreground.png`, backgroundMaskPath: `${base}-background.png`,
      materialSampleRegion: { x: origins[index]!.x - 16, y: origins[index]!.y - 16, width: 32, height: 32 },
      warpLimits: { widthRatio: { min: 0.85, max: 1.15 }, depthRatio: { min: 0.8, max: 1.2 }, rotationDegrees: { min: -12, max: 12 } },
    }
  })
}

async function writeMasks(selection: LimbSelection, profiles: ReturnType<typeof limbProfiles>) {
  const inputs = []
  for (const profile of profiles) {
    const contour = maskBand(profile, selection)
    const foreground = Buffer.alloc(contour.length); const background = Buffer.alloc(contour.length)
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      const pixel = y * SIZE + x
      if (contour[pixel] === 0) continue
      const tangent = (x + 0.5 - profile.origin.x) * profile.tangent.x + (y + 0.5 - profile.origin.y) * profile.tangent.y
      if (tangent < 0) background[pixel] = 255
      else foreground[pixel] = 255
    }
    for (const [kind, alpha] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
      const bytes = await maskPng(alpha)
      const runtimePath = resolve(CATALOG_ROOT, profile[`${kind}MaskPath`])
      const sourcePath = join(SOURCE_ROOT, 'masks', selection.rigId, selection.partId, `${profile.id}-${kind}.png`)
      await mkdir(dirname(runtimePath), { recursive: true }); await mkdir(dirname(sourcePath), { recursive: true })
      await writeFile(runtimePath, bytes); await writeFile(sourcePath, bytes)
    }
    inputs.push({
      id: profile.id,
      contourMaskPath: resolve(CATALOG_ROOT, profile.contourMaskPath),
      foregroundMaskPath: resolve(CATALOG_ROOT, profile.foregroundMaskPath),
      backgroundMaskPath: resolve(CATALOG_ROOT, profile.backgroundMaskPath),
    })
  }
  return inputs
}

async function writeRuntimeNode(source: string, base: string) {
  const pngPath = resolve(CATALOG_ROOT, `${base}.png`); const webpPath = resolve(CATALOG_ROOT, `${base}.webp`)
  await mkdir(dirname(pngPath), { recursive: true })
  await sharp(source).png(PNG).toFile(pngPath)
  await sharp(source).webp({ lossless: true, effort: 6 }).toFile(webpPath)
  return { pngPath: `${base}.png`, pngSha256: await hashFile(pngPath), webpPath: `${base}.webp`, webpSha256: await hashFile(webpPath) }
}

async function decodedIdentity(path: string) {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels, rgbaSha256: sha256(decoded.data) }
}

async function assertSplitDeterministic(
  masterPath: string, selection: LimbSelection,
  origins: readonly [{ x: number, y: number }, { x: number, y: number }],
) {
  const crops: readonly [PairCrop, PairCrop] = [
    { id: 'left', rect: { left: 0, top: 0, width: 1024, height: 2048 }, anchor: origins[0], mirrorX: false },
    { id: 'right', rect: { left: 1024, top: 0, width: 1024, height: 2048 }, anchor: origins[1], mirrorX: false },
  ]
  const base = join(SOURCE_ROOT, 'generation', 'task8-splits', selection.rigId, selection.partId)
  const first = await splitPairedPart(masterPath, join(base, 'run-1'), crops)
  const second = await splitPairedPart(masterPath, join(base, 'run-2'), crops)
  const evidence = []
  for (let index = 0; index < 2; index += 1) {
    const left = first[index]!; const right = second[index]!
    const [leftDecoded, rightDecoded, leftStat, rightStat] = await Promise.all([
      decodedIdentity(left.pngPath), decodedIdentity(right.pngPath), stat(left.pngPath), stat(right.pngPath),
    ])
    const metadata = (node: SplitNodeResult) => ({ id: node.id, width: node.width, height: node.height, origin: node.origin, mirrorX: node.mirrorX, pngSha256: node.pngSha256, webpSha256: node.webpSha256 })
    if (JSON.stringify(metadata(left)) !== JSON.stringify(metadata(right)) || JSON.stringify(leftDecoded) !== JSON.stringify(rightDecoded)) {
      throw new Error(`LIMB_SPLIT_NONDETERMINISTIC: ${selection.partId}:${selection.rigId}:${left.id}`)
    }
    if (leftStat.nlink !== 1 || rightStat.nlink !== 1 || resolve(left.pngPath) !== await realpath(left.pngPath) || resolve(right.pngPath) !== await realpath(right.pngPath)) {
      throw new Error(`LIMB_SPLIT_UNSAFE: ${selection.partId}:${selection.rigId}:${left.id}`)
    }
    evidence.push({ side: left.id, run1: metadata(left), run2: metadata(right), decoded: leftDecoded, ordinaryFileNlink: 1 })
  }
  return evidence
}

async function prepareSelection(selection: LimbSelection, promptEvidence: any) {
  const candidatePath = join(SOURCE_ROOT, 'generation', 'task8-candidates', selection.rigId, selection.partId, `candidate-${selection.selected}.png`)
  const extractedPath = join(SOURCE_ROOT, 'generation', 'task8-extracted', selection.rigId, `${selection.partId}.png`)
  const sourcePngPath = `asset-source/v0.3.0/structural/${selection.rigId}/${selection.partId}.png`
  const masterPath = resolve(ROOT, sourcePngPath)
  const connectorIds = selection.slotId === 'arms' ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight']
  const nodeSourcePaths = connectorIds.map(id => `asset-source/v0.3.0/structural/${selection.rigId}/nodes/${selection.partId}/${id}.png`) as [string, string]
  const normalized = await writeNormalizedPrototype({
    candidatePath, extractedPath, masterPath,
    nodePaths: nodeSourcePaths.map(path => resolve(ROOT, path)) as [string, string],
    rigId: selection.rigId, slotId: selection.slotId, partId: selection.partId,
  })
  const splitEvidence = await assertSplitDeterministic(masterPath, selection, normalized.splitAnchors)
  const profiles = limbProfiles(selection, normalized.origins)
  const maskInputs = await writeMasks(selection, profiles)
  const runtimeBase = `assets/v0.3.0/structural/${selection.rigId}/${selection.partId}`
  const processed = await processInterfaceAsset({
    sourcePath: masterPath,
    outputPngPath: resolve(CATALOG_ROOT, `${runtimeBase}.png`),
    outputWebpPath: resolve(CATALOG_ROOT, `${runtimeBase}.webp`),
    connectors: maskInputs,
    materialSampleRegion: profiles[0]!.materialSampleRegion,
  })
  const renderNodes: Record<string, Awaited<ReturnType<typeof writeRuntimeNode>>> = {}
  const renderNodeSources = []
  const renderTransform = limbRenderTransform(selection)
  for (let index = 0; index < 2; index += 1) {
    const connectorId = connectorIds[index]!
    const nodeId = `${selection.partId}-${selection.rigId}-${connectorId}`
    renderNodes[nodeId] = await writeRuntimeNode(resolve(ROOT, nodeSourcePaths[index]!), `${runtimeBase}/nodes/${nodeId}`)
    renderNodeSources.push({
      id: nodeId, connectorId, sourcePngPath: nodeSourcePaths[index]!,
      ...(renderTransform === undefined ? {} : { transform: renderTransform }),
    })
  }
  return {
    variant: {
      rigId: selection.rigId,
      materialFamily: selection.partId.includes('mushroom') ? 'mushroom-velvet' : 'short-fur',
      sourcePngPath, promptEvidence, connectors: profiles, renderNodes: renderNodeSources,
    },
    processed: {
      pngPath: `${runtimeBase}.png`, pngSha256: processed.pngSha256,
      webpPath: `${runtimeBase}.webp`, webpSha256: processed.webpSha256,
      renderNodes, connectorHashes: processed.connectorHashes,
    },
    evidence: {
      candidatePaths: Array.from({ length: selection.candidateCount ?? selection.selected }, (_, index) => `asset-source/v0.3.0/generation/task8-candidates/${selection.rigId}/${selection.partId}/candidate-${index + 1}.png`),
      selectedCandidate: selection.selected,
      extraction: normalized.extraction,
      connectorOrigins: normalized.origins,
      splitAnchors: normalized.splitAnchors,
      authoredAnchorCoverage: normalized.anchorCoverage,
      processConnectorCoverage: processed.connectorCoverage,
      splitRuns: splitEvidence,
      ...(normalized.distalWarp === undefined ? {} : {
        distalWarp: {
          ratio: normalized.distalWarp.ratio,
          coordinateSpace: 'connector-local-outward-axis',
          invariantRegion: 'full authored connector plug envelope',
          provenance: 'task8 live hash-bound uniform-transform sweeps exhausted; shared root-preserving distal warp',
        },
      }),
      ...(renderTransform === undefined ? {} : {
        renderTransform: {
          ...renderTransform,
          provenance: selection.rigId === 'biped'
            ? 'task8 full-matrix tall-leg bounds correction; same exact-rig transform for both biped bodies'
            : 'task8 joint shoulder feasibility solution; same exact-rig transform for both blob bodies',
        },
      }),
    },
  }
}

async function rebuildSourceIndex(manifest: any, processedIndex: any) {
  const sources = []
  for (const asset of manifest.assets) for (const variant of asset.variants) {
    const reviewRecordPath = variant.promptEvidence.reviewRecordPath
    sources.push({
      sourceId: `${asset.id}:${variant.rigId}`, kind: 'interface-structural',
      promptId: variant.promptEvidence.promptId, promptPath: variant.promptEvidence.promptPath,
      promptSha256: variant.promptEvidence.promptSha256, reviewRecordPath,
      reviewRecordSha256: await hashFile(resolve(ROOT, reviewRecordPath)),
      sourceResources: await Promise.all([...new Set([variant.sourcePngPath, ...variant.renderNodes.map((node: any) => node.sourcePngPath)])]
        .map(async path => ({ path, sha256: await hashFile(resolve(ROOT, path)) }))),
    })
  }
  for (const bridge of manifest.bridges) {
    const reviewRecordPath = bridge.promptEvidence.reviewRecordPath
    sources.push({
      sourceId: bridge.id, kind: 'interface-bridge', promptId: bridge.promptEvidence.promptId,
      promptPath: bridge.promptEvidence.promptPath, promptSha256: bridge.promptEvidence.promptSha256,
      reviewRecordPath, reviewRecordSha256: await hashFile(resolve(ROOT, reviewRecordPath)),
      sourceResources: [{ path: bridge.sourcePngPath, sha256: await hashFile(resolve(ROOT, bridge.sourcePngPath)) }],
    })
  }
  processedIndex.sourceIndex = { catalogVersion: '0.3.0', sources }
}

export async function prepareLimbAssets(mode: 'prototype' | 'option-a-prototype' | 'all' = 'prototype') {
  const selections = mode === 'prototype' ? PROTOTYPES : mode === 'option-a-prototype' ? OPTION_A_PROTOTYPES : GENERATED_SELECTIONS
  const promptPath = join(SOURCE_ROOT, 'prompts', 'task8-limb-prompts.json')
  const reviewRecordPath = 'packages/asset-catalog/review/v0.3.0/limb-review-record.json'
  const promptEvidence = {
    promptId: 'task8-exact-rig-limbs', promptPath: 'asset-source/v0.3.0/prompts/task8-limb-prompts.json',
    promptSha256: await hashFile(promptPath), reviewRecordPath,
  }
  await writeJson(resolve(ROOT, reviewRecordPath), {
    schemaVersion: 'limb-self-review-v1', status: 'WAITING_FOR_USER_APPROVAL',
    reviewer: 'Codex visual self-review', userApproved: false,
    mode, selections: Object.fromEntries(selections.map(item => [`${item.partId}:${item.rigId}`, item.selected])),
  })
  const manifestPath = join(SOURCE_ROOT, 'interface-manifest.json')
  const processedPath = join(SOURCE_ROOT, 'production', 'processed-index.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const processedIndex = JSON.parse(await readFile(processedPath, 'utf8'))
  const evidence: Record<string, unknown> = {}
  for (const selection of selections) {
    const result = await prepareSelection(selection, promptEvidence)
    const group = manifest.assets.find((asset: any) => asset.id === selection.partId)
      ?? (() => { const created = { id: selection.partId, slotId: selection.slotId, variants: [] }; manifest.assets.push(created); return created })()
    group.variants = group.variants.filter((variant: any) => variant.rigId !== selection.rigId)
    group.variants.push(result.variant)
    processedIndex.processedAssets[`${selection.partId}:${selection.rigId}`] = result.processed
    evidence[`${selection.partId}:${selection.rigId}`] = result.evidence
  }
  await rebuildSourceIndex(manifest, processedIndex)
  await writeJson(manifestPath, manifest)
  await writeJson(processedPath, processedIndex)
  await writeJson(join(SOURCE_ROOT, 'generation', 'task8-limb-production.json'), {
    schemaVersion: 'task8-limb-production-v1', generator: 'built-in-image_gen', mode,
    imageGenCalls: selections.reduce((sum, item) => sum + (item.candidateCount ?? item.selected), 0), targetedRegenerationCalls: selections.reduce((sum, item) => sum + (item.candidateCount ?? item.selected) - 1, 0), assets: evidence,
  })
  return { processed: selections.length, mode }
}

function directExecution(): boolean {
  const invoked = process.argv[1]
  return invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url)
}

if (directExecution()) {
  const mode = process.argv.includes('--all') ? 'all' : process.argv.includes('--option-a-prototype') ? 'option-a-prototype' : 'prototype'
  console.log(JSON.stringify(await prepareLimbAssets(mode)))
}
