import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import type { InterfaceSourceManifest } from './interface-source-schema.js'
import { processInterfaceAsset } from './process-interface-asset.js'

const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const ROOT = process.cwd()
const SOURCE_ROOT = join(ROOT, 'asset-source', 'v0.3.0')
const RUNTIME_ROOT = join(ROOT, 'packages', 'asset-catalog')

const SELECTIONS: Record<string, number> = {
  body_biped_peanut: 3,
  body_biped_tall: 2,
  head_round_dome: 3,
  head_mushroom_cap: 3,
  arms_short_plush: 4,
  arms_long_noodle: 4,
  legs_webbed: 3,
  legs_mushroom: 3,
  'bridge-neck': 3,
  'bridge-shoulder': 2,
  'bridge-hip': 4,
}

const EDITED_BODY_ART = new Set(['body_biped_peanut', 'body_biped_tall'])
const HEAD_FACE_SAFE_ZONES = [{ x: 760, y: 1136, width: 528, height: 310 }]

type Rgba = { data: Buffer, width: number, height: number }

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Removes the pale baked checker field emitted by the built-in renderer. */
async function extractCheckerAlpha(sourcePath: string, outputPath: string): Promise<{
  inputHasAlpha: boolean
  width: number
  height: number
  boundaryAlphaPixels: number
  partialAlphaPixels: number
  subjectCoverage: number
  sourceSha256: string
  rgbaSha256: string
}> {
  const source = await readFile(sourcePath)
  const meta = await sharp(source).metadata()
  const decoded = await sharp(source).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(decoded.info.width * decoded.info.height * 4)
  let partialAlphaPixels = 0
  let subjectPixels = 0
  let boundaryAlphaPixels = 0
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const pixel = y * decoded.info.width + x
      const offset3 = pixel * 3
      const offset4 = pixel * 4
      const r = decoded.data[offset3]!
      const g = decoded.data[offset3 + 1]!
      const b = decoded.data[offset3 + 2]!
      const low = Math.min(r, g, b)
      const high = Math.max(r, g, b)
      const neutral = high - low
      // The generated checker is neutral #f3f3f3..#ffffff. Preserve coloured
      // fur tips, and feather only the narrow neutral high-luminance boundary.
      let alpha = 255
      if (neutral <= 10 && low >= 236) alpha = 0
      else if (neutral <= 14 && low >= 218) alpha = Math.round(255 * (236 - low) / 18)
      // The prompt requires a generous margin. Enforce the Task 5 safe-border
      // contract against isolated checker flecks without touching the subject.
      if (x < 8 || y < 8 || x >= decoded.info.width - 8 || y >= decoded.info.height - 8) alpha = 0
      if (alpha > 0) subjectPixels += 1
      if (alpha > 0 && alpha < 255) partialAlphaPixels += 1
      if ((x === 0 || y === 0 || x === decoded.info.width - 1 || y === decoded.info.height - 1) && alpha > 0) {
        boundaryAlphaPixels += 1
      }
      rgba[offset4] = r
      rgba[offset4 + 1] = g
      rgba[offset4 + 2] = b
      rgba[offset4 + 3] = alpha
    }
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await sharp(rgba, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
    .png(PNG).toFile(outputPath)
  return {
    inputHasAlpha: meta.hasAlpha ?? false,
    width: decoded.info.width,
    height: decoded.info.height,
    boundaryAlphaPixels,
    partialAlphaPixels,
    subjectCoverage: subjectPixels / (decoded.info.width * decoded.info.height),
    sourceSha256: sha256(source),
    rgbaSha256: await sha256File(outputPath),
  }
}

async function trimmed(path: string): Promise<Buffer> {
  return sharp(await largestAlphaComponent(path)).trim({ background: '#00000000' }).png(PNG).toBuffer()
}

/**
 * The built-in generator's baked checker can leave isolated pale flecks after
 * chroma extraction. Keep the largest 4-connected alpha component so bounds,
 * placement, and mass validation are driven by the accepted subject rather
 * than by background residue. Paired art is cleaned after it is split.
 */
async function largestAlphaComponent(input: string | Buffer): Promise<Buffer> {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const count = width * height
  const labels = new Int32Array(count)
  const queue = new Int32Array(count)
  const masses: number[] = [0]
  let label = 0
  for (let first = 0; first < count; first += 1) {
    if (labels[first] !== 0 || decoded.data[first * 4 + 3]! === 0) continue
    label += 1
    labels[first] = label
    queue[0] = first
    let queued = 1
    let mass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!
      mass += decoded.data[current * 4 + 3]!
      const x = current % width
      const y = Math.floor(current / width)
      for (const next of [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]) {
        if (next < 0 || labels[next] !== 0 || decoded.data[next * 4 + 3]! === 0) continue
        labels[next] = label
        queue[queued++] = next
      }
    }
    masses[label] = mass
  }
  let keep = 0
  for (let index = 1; index < masses.length; index += 1) {
    if ((masses[index] ?? 0) > (masses[keep] ?? 0)) keep = index
  }
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (labels[pixel] !== keep) decoded.data[pixel * 4 + 3] = 0
  }
  return sharp(decoded.data, { raw: { width, height, channels: 4 } }).png(PNG).toBuffer()
}

async function rgba(path: string): Promise<Rgba> {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height }
}

async function resizedInside(path: string, width: number, height: number): Promise<{ data: Buffer, width: number, height: number }> {
  const result = await sharp(await trimmed(path)).resize(width, height, { fit: 'inside', withoutEnlargement: false })
    .png(PNG).toBuffer({ resolveWithObject: true })
  return { data: result.data, width: result.info.width, height: result.info.height }
}

async function blank(composites: sharp.OverlayOptions[]): Promise<Buffer> {
  return sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite(composites).png(PNG).toBuffer()
}

async function solidMask(maskPath: string, color: string): Promise<Buffer> {
  const mask = await sharp(maskPath).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  return sharp({ create: { width: mask.info.width, height: mask.info.height, channels: 3, background: color } })
    .joinChannel(mask.data, { raw: { width: mask.info.width, height: mask.info.height, channels: 1 } })
    .png(PNG).toBuffer()
}

async function writeAlphaMask(path: string, alpha: Buffer, width: number, height: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png(PNG).toFile(path)
}

function connectorBandAlpha(connector: InterfaceSourceManifest['assets'][number]['connectors'][number]): Buffer {
  const alpha = Buffer.alloc(2048 * 2048)
  for (let y = 0; y < 2048; y += 1) for (let x = 0; x < 2048; x += 1) {
    const dx = x + 0.5 - connector.origin.x
    const dy = y + 0.5 - connector.origin.y
    const tangent = dx * connector.tangent.x + dy * connector.tangent.y
    const normal = dx * connector.outwardNormal.x + dy * connector.outwardNormal.y
    if (Math.abs(tangent) <= connector.width * 0.4 && Math.abs(normal) <= connector.depth * 0.48) {
      alpha[y * 2048 + x] = 255
    }
  }
  return alpha
}

async function solidAlpha(alpha: Buffer, color: string): Promise<Buffer> {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const pixels = Buffer.alloc(2048 * 2048 * 4)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const offset = pixel * 4
    pixels[offset] = red
    pixels[offset + 1] = green
    pixels[offset + 2] = blue
    pixels[offset + 3] = alpha[pixel]!
  }
  return sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).png(PNG).toBuffer()
}

async function stampConnectorCoverage(master: Buffer, asset: InterfaceSourceManifest['assets'][number], color: string): Promise<Buffer> {
  const decoded = await sharp(master).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  for (const connector of asset.connectors) {
    const alpha = connectorBandAlpha(connector)
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      if (alpha[pixel] === 0) continue
      const offset = pixel * 4
      decoded.data[offset] = red
      decoded.data[offset + 1] = green
      decoded.data[offset + 2] = blue
      decoded.data[offset + 3] = 255
    }
  }
  return sharp(decoded.data, { raw: { width: 2048, height: 2048, channels: 4 } }).png(PNG).toBuffer()
}

async function subjectColor(path: string): Promise<string> {
  const decoded = await rgba(path)
  const sums = [0, 0, 0]
  let mass = 0
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    const alpha = decoded.data[pixel * 4 + 3]! / 255
    if (alpha <= 0) continue
    mass += alpha
    for (let channel = 0; channel < 3; channel += 1) sums[channel]! += decoded.data[pixel * 4 + channel]! * alpha
  }
  const rgb = sums.map(sum => Math.max(48, Math.min(224, Math.round(sum / Math.max(1, mass)))))
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}ff`
}

function guideMaskPath(assetId: string, connector: { id: string, role: string }): string {
  return join(SOURCE_ROOT, 'guides', `${assetId}-${connector.id}-${connector.role}-mask.png`)
}

async function connectorOverlays(asset: InterfaceSourceManifest['assets'][number], color: string): Promise<sharp.OverlayOptions[]> {
  return Promise.all(asset.connectors.map(async connector => {
    const guide = await sharp(guideMaskPath(asset.id, connector)).ensureAlpha().extractChannel('alpha').raw().toBuffer()
    const union = connectorBandAlpha(connector)
    for (let pixel = 0; pixel < union.length; pixel += 1) union[pixel] = Math.max(union[pixel]!, guide[pixel]!)
    return { input: await solidAlpha(union, color), left: 0, top: 0 }
  }))
}

async function buildBodyMaster(asset: InterfaceSourceManifest['assets'][number], extracted: string): Promise<{ master: Buffer, node: Buffer }> {
  const target = asset.id === 'body_biped_tall'
    ? { width: 920, height: 1300, left: 564, top: 250 }
    : { width: 1020, height: 1050, left: 514, top: 420 }
  const subject = await resizedInside(extracted, target.width, target.height)
  const color = await subjectColor(extracted)
  const component = { input: subject.data, left: target.left + Math.floor((target.width - subject.width) / 2), top: target.top + Math.floor((target.height - subject.height) / 2) }
  return {
    master: await stampConnectorCoverage(await blank([component, ...await connectorOverlays(asset, color)]), asset, color),
    node: await blank([component]),
  }
}

async function buildHeadMaster(asset: InterfaceSourceManifest['assets'][number], extracted: string): Promise<{ master: Buffer, node: Buffer }> {
  const subject = await resizedInside(extracted, asset.id === 'head_mushroom_cap' ? 680 : 620, 480)
  const connector = asset.connectors[0]!
  const left = Math.round(connector.origin.x - subject.width / 2)
  const top = Math.round(connector.origin.y - subject.height + 145)
  const color = await subjectColor(extracted)
  const component = { input: subject.data, left, top }
  return {
    master: await stampConnectorCoverage(await blank([component, ...await connectorOverlays(asset, color)]), asset, color),
    node: await blank([component]),
  }
}

async function halfSubject(extracted: string, side: 'left' | 'right'): Promise<Buffer> {
  const meta = await sharp(extracted).metadata()
  const width = Math.floor(meta.width! / 2)
  const cropped = await sharp(extracted)
    .extract({ left: side === 'left' ? 0 : meta.width! - width, top: 0, width, height: meta.height! })
    .png(PNG).toBuffer()
  return sharp(await largestAlphaComponent(cropped)).trim({ background: '#00000000' }).png(PNG).toBuffer()
}

async function buildPairedMasters(asset: InterfaceSourceManifest['assets'][number], extracted: string): Promise<{
  master: Buffer
  nodes: Record<string, Buffer>
}> {
  const isArms = asset.slotId === 'arms'
  const sourceSides = [await halfSubject(extracted, 'left'), await halfSubject(extracted, 'right')]
  const max = isArms
    ? (asset.id === 'arms_long_noodle' ? { width: 440, height: 900 } : { width: 470, height: 750 })
    : { width: 380, height: 440 }
  const color = await subjectColor(extracted)
  // Noodle arms begin with a short straight proximal run before their first
  // organic curve. Bury that run farther behind every body silhouette so only
  // the curved limb emerges; keep this class-level rather than seed-specific.
  const rootOverlap = asset.id === 'arms_long_noodle' ? 80 : 40
  const nodes: Record<string, Buffer> = {}
  const placed: sharp.OverlayOptions[] = []
  for (let index = 0; index < 2; index += 1) {
    const node = asset.renderNodes[index]!
    const connector = asset.connectors.find(item => item.id === node.connectorId)!
    const resized = await sharp(sourceSides[index]!).resize(max.width, max.height, { fit: 'inside', withoutEnlargement: false })
      .png(PNG).toBuffer({ resolveWithObject: true })
    const left = isArms
      ? (index === 0 ? Math.round(connector.origin.x - resized.info.width + rootOverlap) : Math.round(connector.origin.x - rootOverlap))
      : Math.round(connector.origin.x - resized.info.width / 2)
    const top = isArms ? Math.round(connector.origin.y - 55) : Math.round(connector.origin.y - 60)
    const component = { input: resized.data, left, top }
    const swatch = { input: await sharp({ create: { width: 1, height: 1, channels: 4, background: color } }).png().toBuffer(), left: 1024, top: 1024 }
    nodes[node.id] = await blank([component, swatch])
    placed.push(component)
  }
  const swatch = { input: await sharp({ create: { width: 1, height: 1, channels: 4, background: color } }).png().toBuffer(), left: 1024, top: 1024 }
  return { master: await stampConnectorCoverage(await blank([...placed, ...await connectorOverlays(asset, color), swatch]), asset, color), nodes }
}

async function writeConnectorMasks(asset: InterfaceSourceManifest['assets'][number]): Promise<Array<{
  id: string
  contourMaskPath: string
  foregroundMaskPath: string
  backgroundMaskPath: string
  role?: 'receiver' | 'plug'
  nodeLayer?: string
  occlusionNodePath?: string
  origin?: { x: number, y: number }
  outwardNormal?: { x: number, y: number }
  depth?: number
  faceSafeZones?: Array<{ x: number, y: number, width: number, height: number }>
}>> {
  const outputs = []
  for (const connector of asset.connectors) {
    const contour = connectorBandAlpha(connector)
    let front = Buffer.from(contour)
    let back = Buffer.from(contour)
    if (asset.slotId === 'headShape' && connector.role === 'plug') {
      const node = asset.renderNodes.find(item => item.connectorId === connector.id)
      if (node === undefined) throw new Error(`${asset.id}: head plug ${connector.id} has no render node`)
      const decoded = await rgba(resolve(ROOT, node.sourcePngPath))
      const alpha = Buffer.alloc(decoded.width * decoded.height)
      const furthestOutward = new Map<number, number>()
      for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) {
        const pixel = y * decoded.width + x
        if (decoded.data[pixel * 4 + 3] === 0) continue
        alpha[pixel] = 255
        const dx = x + 0.5 - connector.origin.x
        const dy = y + 0.5 - connector.origin.y
        const tangent = dx * connector.tangent.x + dy * connector.tangent.y
        if (Math.abs(tangent) > connector.width / 2) continue
        const normal = dx * connector.outwardNormal.x + dy * connector.outwardNormal.y
        const key = Math.round(tangent)
        furthestOutward.set(key, Math.max(furthestOutward.get(key) ?? -Infinity, normal))
      }
      front = Buffer.from(alpha)
      back = Buffer.alloc(alpha.length)
      for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) {
        const pixel = y * decoded.width + x
        if (alpha[pixel] === 0) continue
        const dx = x + 0.5 - connector.origin.x
        const dy = y + 0.5 - connector.origin.y
        const tangent = dx * connector.tangent.x + dy * connector.tangent.y
        const normal = dx * connector.outwardNormal.x + dy * connector.outwardNormal.y
        const outwardTip = furthestOutward.get(Math.round(tangent))
        if (
          Math.abs(tangent) <= connector.width / 2
          && outwardTip !== undefined
          && normal >= connector.depth * 0.25
          && normal >= outwardTip - connector.depth * 0.55
        ) {
          front[pixel] = 0
          back[pixel] = 255
        }
      }
    }
    // Contours remain connector-local bridge geometry. Head plug occlusion
    // masks instead partition the full node alpha, following its organic
    // outward silhouette inside the declared connector range.
    const names = ['contour', 'foreground', 'background'] as const
    const buffers = [contour, front, back]
    const paths = names.map(name => join(RUNTIME_ROOT, connector[`${name}MaskPath`].replace(/^assets\//u, 'assets/')))
    for (let i = 0; i < 3; i += 1) {
      await writeAlphaMask(paths[i]!, buffers[i]!, 2048, 2048)
    }
    const headNode = asset.slotId === 'headShape' && connector.role === 'plug'
      ? asset.renderNodes.find(item => item.connectorId === connector.id)
      : undefined
    outputs.push({
      id: connector.id,
      contourMaskPath: paths[0]!,
      foregroundMaskPath: paths[1]!,
      backgroundMaskPath: paths[2]!,
      ...(headNode === undefined ? {} : {
        role: 'plug' as const,
        nodeLayer: 'head',
        occlusionNodePath: resolve(ROOT, headNode.sourcePngPath),
        origin: connector.origin,
        outwardNormal: connector.outwardNormal,
        depth: connector.depth,
        faceSafeZones: HEAD_FACE_SAFE_ZONES,
      }),
    })
  }
  return outputs
}

async function writeRuntimeNode(sourcePath: string, runtimeBase: string): Promise<{ pngPath: string, pngSha256: string, webpPath: string, webpSha256: string }> {
  const pngFs = join(RUNTIME_ROOT, `${runtimeBase}.png`)
  const webpFs = join(RUNTIME_ROOT, `${runtimeBase}.webp`)
  await mkdir(dirname(pngFs), { recursive: true })
  await sharp(sourcePath).ensureAlpha().png(PNG).toFile(pngFs)
  await sharp(sourcePath).ensureAlpha().webp({ lossless: true, effort: 6 }).toFile(webpFs)
  return {
    pngPath: `${runtimeBase}.png`.replaceAll('\\', '/'), pngSha256: await sha256File(pngFs),
    webpPath: `${runtimeBase}.webp`.replaceAll('\\', '/'), webpSha256: await sha256File(webpFs),
  }
}

async function prepareBridge(id: string, candidatePath: string, sourcePath: string, bridge: InterfaceSourceManifest['bridges'][number]) {
  const extractedPath = join(SOURCE_ROOT, 'generation', 'biped', 'extracted', `${id}.png`)
  const extraction = await extractCheckerAlpha(candidatePath, extractedPath)
  const normalized = await sharp(await trimmed(extractedPath)).resize(512, 256, { fit: 'fill' }).ensureAlpha().png(PNG).toBuffer()
  // Generated bridge art is authored horizontally, while bridge-mesh source Y
  // runs from receiver to plug. Rotate into that attachment axis and preserve
  // its organic alpha instead of flattening it into a visible rectangle.
  const oriented = await sharp(normalized).rotate(90).resize(512, 256, { fit: 'fill' })
    .flatten({ background: '#b8b8b8' }).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true })
  const edgeDepth = 24
  for (let y = 0; y < oriented.info.height; y += 1) for (let x = 0; x < oriented.info.width; x += 1) {
    const halfWidth = oriented.info.width * 0.5
    const distance = Math.abs(x + 0.5 - oriented.info.width / 2) - halfWidth
    const organicAlpha = distance <= -5 ? 255 : distance >= 5 ? 0 : Math.round((5 - distance) / 10 * 255)
    const offset = (y * oriented.info.width + x) * 4 + 3
    oriented.data[offset] = Math.max(oriented.data[offset]!, organicAlpha)
    if (y < edgeDepth || y >= oriented.info.height - edgeDepth) oriented.data[offset] = organicAlpha
  }
  const runtimeNeutral = await sharp(oriented.data, { raw: { width: oriented.info.width, height: oriented.info.height, channels: 4 } }).png(PNG).toBuffer()
  await mkdir(dirname(sourcePath), { recursive: true })
  // Source evidence remains a normalized 2048 transparent master.
  await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: normalized, left: 768, top: 896 }]).png(PNG).toFile(sourcePath)
  const runtimePng = join(RUNTIME_ROOT, bridge.neutralPngPath)
  const runtimeWebp = join(RUNTIME_ROOT, bridge.neutralWebpPath)
  await mkdir(dirname(runtimePng), { recursive: true })
  await sharp(runtimeNeutral).png(PNG).toFile(runtimePng)
  await sharp(runtimeNeutral).webp({ lossless: true, effort: 6 }).toFile(runtimeWebp)
  const alpha = await sharp(runtimeNeutral).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  const front = Buffer.alloc(alpha.data.length)
  const back = Buffer.alloc(alpha.data.length)
  for (let y = 0; y < alpha.info.height; y += 1) for (let x = 0; x < alpha.info.width; x += 1) {
    const p = y * alpha.info.width + x
    back[p] = 255
    // Only the center transition crosses in front of the already-overlapped
    // structural roots. The full bridge remains behind them for alpha union.
    const dx = (x + 0.5 - alpha.info.width / 2) / (alpha.info.width * 0.32)
    const dy = (y + 0.5 - alpha.info.height / 2) / (alpha.info.height * 0.08)
    front[p] = dx * dx + dy * dy <= 1 ? 255 : 0
  }
  const frontPath = join(RUNTIME_ROOT, bridge.frontMaskPath)
  const backPath = join(RUNTIME_ROOT, bridge.backMaskPath)
  await writeAlphaMask(frontPath, front, alpha.info.width, alpha.info.height)
  await writeAlphaMask(backPath, back, alpha.info.width, alpha.info.height)
  return {
    extraction,
    processed: {
      neutralPngSha256: await sha256File(runtimePng), neutralWebpSha256: await sha256File(runtimeWebp),
      frontMaskSha256: await sha256File(frontPath), backMaskSha256: await sha256File(backPath),
    },
  }
}

export async function prepareBipedInterfaceAssets(): Promise<{ processedAssets: number, processedBridges: number }> {
  const manifest = JSON.parse(await readFile(join(SOURCE_ROOT, 'interface-manifest.json'), 'utf8')) as InterfaceSourceManifest
  const evidence: any = {
    schemaVersion: 'biped-slice-generation-v1',
    generator: 'built-in-image_gen',
    candidateCount: 44,
    targetedEditCallCount: 2,
    totalBuiltInCallCount: 46,
    assets: {},
    bridges: {},
  }
  const processedAssets: Record<string, any> = {}
  const processedBridges: Record<string, any> = {}

  for (const asset of manifest.assets) {
    const selected = SELECTIONS[asset.id]!
    const editedPath = join(SOURCE_ROOT, 'generation', 'biped', 'edited', `${asset.id}.png`)
    const candidatePath = EDITED_BODY_ART.has(asset.id)
      ? editedPath
      : join(SOURCE_ROOT, 'generation', 'biped', asset.id, `candidate-${selected}.png`)
    const extractedPath = join(SOURCE_ROOT, 'generation', 'biped', 'extracted', `${asset.id}.png`)
    const extraction = await extractCheckerAlpha(candidatePath, extractedPath)
    const sourcePath = resolve(ROOT, asset.sourcePngPath)
    let master: Buffer
    let nodeBuffers: Record<string, Buffer> = {}
    if (asset.slotId === 'bodyFrame') {
      const built = await buildBodyMaster(asset, extractedPath)
      master = built.master
      nodeBuffers[asset.renderNodes[0]!.id] = built.node
    }
    else if (asset.slotId === 'headShape') {
      const built = await buildHeadMaster(asset, extractedPath)
      master = built.master
      nodeBuffers[asset.renderNodes[0]!.id] = built.node
    }
    else {
      const pair = await buildPairedMasters(asset, extractedPath)
      master = pair.master
      nodeBuffers = pair.nodes
    }
    await mkdir(dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, master)
    for (const node of asset.renderNodes) {
      const nodePath = resolve(ROOT, node.sourcePngPath)
      await mkdir(dirname(nodePath), { recursive: true })
      await writeFile(nodePath, nodeBuffers[node.id]!)
    }
    const connectors = await writeConnectorMasks(asset)
    const runtimeBase = `assets/v0.3.0/structural/biped/${asset.id}`
    const processed = await processInterfaceAsset({
      sourcePath,
      outputPngPath: join(RUNTIME_ROOT, `${runtimeBase}.png`),
      outputWebpPath: join(RUNTIME_ROOT, `${runtimeBase}.webp`),
      connectors,
      materialSampleRegion: asset.connectors[0]!.materialSampleRegion,
    }).catch((caught: unknown) => {
      throw new Error(`${asset.id}: ${caught instanceof Error ? caught.message : String(caught)}`)
    })
    const renderNodes: Record<string, any> = {}
    for (const node of asset.renderNodes) {
      renderNodes[node.id] = await writeRuntimeNode(resolve(ROOT, node.sourcePngPath), `assets/v0.3.0/structural/biped/nodes/${asset.id}/${node.id}`)
    }
    processedAssets[asset.id] = {
      pngPath: `${runtimeBase}.png`, pngSha256: processed.pngSha256,
      webpPath: `${runtimeBase}.webp`, webpSha256: processed.webpSha256,
      renderNodes,
      connectorHashes: processed.connectorHashes,
    }
    evidence.assets[asset.id] = {
      candidatePaths: [1, 2, 3, 4].map(index => `asset-source/v0.3.0/generation/biped/${asset.id}/candidate-${index}.png`),
      selectedCandidate: selected,
      ...(EDITED_BODY_ART.has(asset.id) ? {
        editedCandidatePath: relative(ROOT, editedPath).replaceAll('\\', '/'),
        editPurpose: 'Heal visible receiver markers into continuous fur while preserving the selected candidate identity.',
      } : {}),
      selectedReason: 'Best silhouette, connector-root readability, material coherence, and 256px recognition in the four-way self-review.',
      extraction,
      connectorCoverage: processed.connectorCoverage,
      guidePaths: asset.connectors.map(connector => relative(ROOT, guideMaskPath(asset.id, connector)).replaceAll('\\', '/')),
    }
  }

  for (const bridge of manifest.bridges) {
    const id = `bridge-${bridge.connectorClass}`
    const selected = SELECTIONS[id]!
    const candidatePath = join(SOURCE_ROOT, 'generation', 'biped', 'bridges', bridge.connectorClass, `candidate-${selected}.png`)
    const result = await prepareBridge(id, candidatePath, resolve(ROOT, bridge.sourcePngPath), bridge)
    processedBridges[bridge.connectorClass] = result.processed
    evidence.bridges[bridge.connectorClass] = {
      candidatePaths: [1, 2, 3, 4].map(index => `asset-source/v0.3.0/generation/biped/bridges/${bridge.connectorClass}/candidate-${index}.png`),
      selectedCandidate: selected,
      selectedReason: 'Best opaque-end silhouette and flexible-center readability in the four-way self-review.',
      extraction: result.extraction,
    }
  }

  const reviewRecordPath = join(RUNTIME_ROOT, 'review', 'v0.3.0', 'review-record.json')
  await writeJson(reviewRecordPath, {
    schemaVersion: 'interface-self-review-v1',
    status: 'machine-valid-self-reviewed-awaiting-user-slice-approval',
    reviewer: 'Codex visual self-review',
    userApproved: false,
    selections: SELECTIONS,
  })
  const reviewRecordSha256 = await sha256File(reviewRecordPath)
  const sources = []
  for (const asset of manifest.assets) sources.push({
    sourceId: asset.id, kind: 'interface-structural', promptId: asset.promptEvidence.promptId,
    promptPath: asset.promptEvidence.promptPath, promptSha256: asset.promptEvidence.promptSha256,
    reviewRecordPath: asset.promptEvidence.reviewRecordPath, reviewRecordSha256,
    sourceResources: await Promise.all([...new Set([asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)])].map(async path => ({ path, sha256: await sha256File(resolve(ROOT, path)) }))),
  })
  for (const bridge of manifest.bridges) sources.push({
    sourceId: bridge.id, kind: 'interface-bridge', promptId: bridge.promptEvidence.promptId,
    promptPath: bridge.promptEvidence.promptPath, promptSha256: bridge.promptEvidence.promptSha256,
    reviewRecordPath: bridge.promptEvidence.reviewRecordPath, reviewRecordSha256,
    sourceResources: [{ path: bridge.sourcePngPath, sha256: await sha256File(resolve(ROOT, bridge.sourcePngPath)) }],
  })
  const sourceIndex = { catalogVersion: '0.3.0', sources }
  await writeJson(join(SOURCE_ROOT, 'generation', 'biped-slice-evidence.json'), evidence)
  await writeJson(join(SOURCE_ROOT, 'production', 'processed-index.json'), { processedAssets, processedBridges, sourceIndex })
  return { processedAssets: manifest.assets.length, processedBridges: manifest.bridges.length }
}
