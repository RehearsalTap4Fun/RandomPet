import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import type { Rect } from '@qmonster/generator-core'

const INTERFACE_IMAGE_SIZE = 2048
const INTERFACE_IMAGE_PIXELS = INTERFACE_IMAGE_SIZE * INTERFACE_IMAGE_SIZE
const INTERFACE_IMAGE_COMPRESSED_BYTES_MAX = 8 * 1024 * 1024

interface ConnectorAssetInput {
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
  faceSafeZones?: Rect[]
}

export interface ProcessInterfaceAssetInput {
  sourcePath: string
  outputPngPath: string
  outputWebpPath: string
  connectors: ConnectorAssetInput[]
  materialSampleRegion: Rect
  readInput?(path: string): Promise<Buffer>
  writeOutput?(path: string, data: Uint8Array): Promise<void>
}

interface Decoded {
  bytes: Buffer
  pixels: Buffer
  width: number
  height: number
  sha256: string
}

async function decode(path: string, readInput: (path: string) => Promise<Buffer>): Promise<Decoded> {
  const bytes = await readInput(path)
  if (bytes.byteLength > INTERFACE_IMAGE_COMPRESSED_BYTES_MAX) {
    throw new Error(`CONNECTOR_PROFILE_INVALID: compressed image exceeds ${INTERFACE_IMAGE_COMPRESSED_BYTES_MAX} bytes`)
  }
  const image = sharp(bytes, { limitInputPixels: INTERFACE_IMAGE_PIXELS })
  const metadata = await image.metadata()
  if (metadata.width !== INTERFACE_IMAGE_SIZE || metadata.height !== INTERFACE_IMAGE_SIZE) {
    throw new Error(`CONNECTOR_PROFILE_INVALID: interface images must be exactly ${INTERFACE_IMAGE_SIZE} by ${INTERFACE_IMAGE_SIZE}`)
  }
  const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error(`CONNECTOR_PROFILE_INVALID: ${path} did not decode as RGBA`)
  return { bytes, pixels: decoded.data, width: decoded.info.width, height: decoded.info.height, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function processInterfaceAsset(input: ProcessInterfaceAssetInput): Promise<{
  sourcePath: string
  sourceSha256: string
  pngPath: string
  pngSha256: string
  webpPath: string
  webpSha256: string
  connectorCoverage: Record<string, number>
  connectorHashes: Record<string, {
    contourMaskSha256: string
    foregroundMaskSha256: string
    backgroundMaskSha256: string
  }>
}> {
  const readInput = input.readInput ?? readFile
  const writeOutput = input.writeOutput ?? (async (path: string, data: Uint8Array) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  })
  const source = await decode(input.sourcePath, readInput)
  const region = input.materialSampleRegion
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isInteger)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > source.width || region.y + region.height > source.height
  ) {
    throw new Error('CONNECTOR_PROFILE_INVALID: material sample region is outside source bounds')
  }
  let materialPixels = 0
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (source.pixels[(y * source.width + x) * 4 + 3]! > 0) materialPixels += 1
    }
  }
  if (materialPixels === 0) throw new Error('CONNECTOR_PROFILE_INVALID: material sample region has no opaque source pixels')
  const connectorCoverage: Record<string, number> = {}
  const connectorHashes: Record<string, { contourMaskSha256: string; foregroundMaskSha256: string; backgroundMaskSha256: string }> = {}
  for (const connector of input.connectors) {
    const [contour, foreground, background] = await Promise.all([
      decode(connector.contourMaskPath, readInput), decode(connector.foregroundMaskPath, readInput), decode(connector.backgroundMaskPath, readInput),
    ])
    if ([contour, foreground, background].some(mask => mask.width !== source.width || mask.height !== source.height)) {
      throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} masks do not match source dimensions`)
    }
    for (const [maskName, mask] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
      let visible = false
      for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
        const alpha = mask.pixels[pixel * 4 + 3]!
        if (alpha !== 0 && alpha !== 255) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} ${maskName} mask is not binary`)
        if (alpha === 255) visible = true
      }
      if (!visible) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} ${maskName} mask is empty`)
    }
    if (connector.role === 'plug' && connector.nodeLayer === 'head') {
      const node = await decode(connector.occlusionNodePath ?? input.sourcePath, readInput)
      if (node.width !== source.width || node.height !== source.height) {
        throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} occlusion node does not match source dimensions`)
      }
      let overlap = 0
      let uncovered = 0
      let outside = 0
      for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
        const supported = node.pixels[pixel * 4 + 3]! > 0
        const front = foreground.pixels[pixel * 4 + 3]! > 0
        const back = background.pixels[pixel * 4 + 3]! > 0
        if (front && back) overlap += 1
        if (supported && !front && !back) uncovered += 1
        if (!supported && (front || back)) outside += 1
      }
      if (overlap > 0) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} foreground/background masks overlap`)
      if (uncovered > 0) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} foreground/background masks do not cover the node alpha`)
      if (outside > 0) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} foreground/background masks extend outside the node alpha`)
      for (const zone of connector.faceSafeZones ?? []) {
        for (let y = zone.y; y < zone.y + zone.height; y += 1) for (let x = zone.x; x < zone.x + zone.width; x += 1) {
          const pixel = y * node.width + x
          if (node.pixels[pixel * 4 + 3]! > 0 && foreground.pixels[pixel * 4 + 3]! === 0) {
            throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} face-safe alpha is not foreground`)
          }
        }
      }
      if (connector.origin !== undefined && connector.outwardNormal !== undefined && connector.depth !== undefined) {
        const x = Math.round(connector.origin.x + connector.outwardNormal.x * connector.depth / 2)
        const y = Math.round(connector.origin.y + connector.outwardNormal.y * connector.depth / 2)
        const pixel = y * node.width + x
        if (
          x < 0 || y < 0 || x >= node.width || y >= node.height
          || node.pixels[pixel * 4 + 3]! === 0
          || background.pixels[pixel * 4 + 3]! === 0
        ) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} outward plug seed is not background`)
      }
    }
    let maskPixels = 0
    let coveredPixels = 0
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
      const alpha = contour.pixels[pixel * 4 + 3]!
      if (alpha === 0) continue
      maskPixels += 1
      if (source.pixels[pixel * 4 + 3]! > 0) coveredPixels += 1
    }
    const coverage = coveredPixels / maskPixels
    connectorCoverage[connector.id] = coverage
    if (coverage < 0.9) throw new Error(`CONNECTOR_PROFILE_INVALID: ${connector.id} opaque coverage ${coverage.toFixed(4)} is below 0.9`)
    connectorHashes[connector.id] = {
      contourMaskSha256: contour.sha256,
      foregroundMaskSha256: foreground.sha256,
      backgroundMaskSha256: background.sha256,
    }
  }
  const [pngBytes, webpBytes] = await Promise.all([
    sharp(source.bytes).ensureAlpha().png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer(),
    sharp(source.bytes).ensureAlpha().webp({ lossless: true, effort: 6 }).toBuffer(),
  ])
  await Promise.all([
    writeOutput(input.outputPngPath, pngBytes),
    writeOutput(input.outputWebpPath, webpBytes),
  ])
  return {
    sourcePath: input.sourcePath,
    sourceSha256: source.sha256,
    pngPath: input.outputPngPath,
    pngSha256: createHash('sha256').update(pngBytes).digest('hex'),
    webpPath: input.outputWebpPath,
    webpSha256: createHash('sha256').update(webpBytes).digest('hex'),
    connectorCoverage,
    connectorHashes,
  }
}
