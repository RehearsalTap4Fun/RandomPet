import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import sharp from 'sharp'
import { resolveOutputPath } from './safe-output.js'

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

export interface ColorMaskMetrics {
  width: number
  height: number
  rigOpaqueCorePixels: number
  maskUnionPixels: number
  outsideRigCorePixels: number
  overlappingMaskPixels: number
  primaryPixels: number
  secondaryPixels: number
  accentPixels: number
}

export interface DerivedRigColorMasks {
  primary: Buffer
  secondary: Buffer
  accent: Buffer
  metrics: ColorMaskMetrics
}

interface ColorSchemeRuntimeInput {
  sourceId: string
  sourcePath: string
  runtimePngPath: string
  runtimeWebpPath: string
  maskRoot: string
  rigs: Array<{ rigId: string; assetPath: string }>
}

interface ColorSchemeRuntimeAudit {
  version: 'rig-aware-palette-masks-v1'
  sourceId: string
  sourcePath: string
  sourceSha256: string
  runtimePngPath: string
  runtimePngSha256: string
  runtimeWebpPath: string
  runtimeWebpSha256: string
  rigMasks: Record<string, {
    rigAssetPath: string
    rigAssetSha256: string
    paths: Record<'primary' | 'secondary' | 'accent', string>
    sha256: Record<'primary' | 'secondary' | 'accent', string>
    metrics: ColorMaskMetrics
  }>
}

interface RawRgba {
  data: Buffer
  width: number
  height: number
}

async function decodeRgba(input: Buffer): Promise<RawRgba> {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error('Color-mask inputs must decode to RGBA.')
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function portablePath(path: string): string {
  return (isAbsolute(path) ? relative(process.cwd(), path) : path).replaceAll('\\', '/')
}

function rgbDistanceSquared(left: readonly number[], right: readonly number[]): number {
  const red = left[0]! - right[0]!
  const green = left[1]! - right[1]!
  const blue = left[2]! - right[2]!
  return red * red + green * green + blue * blue
}

function nearestCentroid(pixel: readonly number[], centroids: ReadonlyArray<readonly number[]>): number {
  let best = 0
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < centroids.length; index += 1) {
    const candidate = rgbDistanceSquared(pixel, centroids[index]!)
    if (candidate < distance) {
      distance = candidate
      best = index
    }
  }
  return best
}

function clusterSource(source: RawRgba): Int8Array {
  const pixels: number[][] = []
  const stride = Math.max(1, Math.floor(Math.sqrt(source.width * source.height / 50_000)))
  for (let y = 0; y < source.height; y += stride) {
    for (let x = 0; x < source.width; x += stride) {
      const offset = (y * source.width + x) * 4
      if (source.data[offset + 3]! < 240) continue
      pixels.push([source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!])
    }
  }
  if (pixels.length < 3) throw new Error('Approved color layout has too few opaque pixels for three zones.')

  const luminance = (pixel: readonly number[]) => pixel[0]! * 0.2126 + pixel[1]! * 0.7152 + pixel[2]! * 0.0722
  const first = pixels.reduce((best, pixel) => luminance(pixel) < luminance(best) ? pixel : best, pixels[0]!)
  const second = pixels.reduce((best, pixel) => (
    rgbDistanceSquared(pixel, first) > rgbDistanceSquared(best, first) ? pixel : best
  ), pixels[0]!)
  const third = pixels.reduce((best, pixel) => {
    const distance = Math.min(rgbDistanceSquared(pixel, first), rgbDistanceSquared(pixel, second))
    const bestDistance = Math.min(rgbDistanceSquared(best, first), rgbDistanceSquared(best, second))
    return distance > bestDistance ? pixel : best
  }, pixels[0]!)
  let centroids = [first.slice(), second.slice(), third.slice()]
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const totals = Array.from({ length: 3 }, () => [0, 0, 0, 0])
    for (const pixel of pixels) {
      const index = nearestCentroid(pixel, centroids)
      totals[index]![0] += pixel[0]!
      totals[index]![1] += pixel[1]!
      totals[index]![2] += pixel[2]!
      totals[index]![3] += 1
    }
    centroids = totals.map((total, index) => total[3] === 0
      ? centroids[index]!.slice()
      : [total[0] / total[3], total[1] / total[3], total[2] / total[3]])
  }

  const labels = new Int8Array(source.width * source.height).fill(-1)
  const counts = [0, 0, 0]
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const offset = pixel * 4
    if (source.data[offset + 3]! < 240) continue
    const label = nearestCentroid([
      source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!,
    ], centroids)
    labels[pixel] = label
    counts[label] += 1
  }
  const order = [0, 1, 2].sort((left, right) => counts[right]! - counts[left]! || left - right)
  const roleForCluster = new Int8Array(3)
  order.forEach((cluster, role) => { roleForCluster[cluster] = role })
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel]! >= 0) labels[pixel] = roleForCluster[labels[pixel]!]!
  }

  const queue = new Int32Array(labels.length)
  let read = 0
  let write = 0
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel]! >= 0) queue[write++] = pixel
  }
  while (read < write) {
    const pixel = queue[read++]!
    const x = pixel % source.width
    const neighbours = [
      x > 0 ? pixel - 1 : -1,
      x + 1 < source.width ? pixel + 1 : -1,
      pixel >= source.width ? pixel - source.width : -1,
      pixel + source.width < labels.length ? pixel + source.width : -1,
    ]
    for (const neighbour of neighbours) {
      if (neighbour < 0 || labels[neighbour]! >= 0) continue
      labels[neighbour] = labels[pixel]!
      queue[write++] = neighbour
    }
  }
  return labels
}

export async function deriveRigColorMasks(sourceInput: Buffer, rigInput: Buffer): Promise<DerivedRigColorMasks> {
  const [source, rig] = await Promise.all([decodeRgba(sourceInput), decodeRgba(rigInput)])
  const labels = clusterSource(source)
  const outputs = [
    Buffer.alloc(rig.width * rig.height * 4),
    Buffer.alloc(rig.width * rig.height * 4),
    Buffer.alloc(rig.width * rig.height * 4),
  ]
  const counts = [0, 0, 0]
  let rigOpaqueCorePixels = 0
  for (let y = 0; y < rig.height; y += 1) {
    for (let x = 0; x < rig.width; x += 1) {
      const pixel = y * rig.width + x
      if (rig.data[pixel * 4 + 3] !== 255) continue
      rigOpaqueCorePixels += 1
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / rig.width))
      const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / rig.height))
      const role = labels[sourceY * source.width + sourceX]!
      if (role < 0 || role > 2) throw new Error('Approved color layout could not classify the rig core.')
      const output = outputs[role]!
      const offset = pixel * 4
      output[offset] = 255
      output[offset + 1] = 255
      output[offset + 2] = 255
      output[offset + 3] = 255
      counts[role] += 1
    }
  }
  if (counts.some(count => count === 0)) throw new Error('Approved color layout does not produce all three rig mask zones.')
  const encoded = await Promise.all(outputs.map(data => sharp(data, {
    raw: { width: rig.width, height: rig.height, channels: 4 },
  }).png(PNG_OPTIONS).toBuffer()))
  return {
    primary: encoded[0]!,
    secondary: encoded[1]!,
    accent: encoded[2]!,
    metrics: {
      width: rig.width,
      height: rig.height,
      rigOpaqueCorePixels,
      maskUnionPixels: counts[0]! + counts[1]! + counts[2]!,
      outsideRigCorePixels: 0,
      overlappingMaskPixels: 0,
      primaryPixels: counts[0]!,
      secondaryPixels: counts[1]!,
      accentPixels: counts[2]!,
    },
  }
}

export async function buildColorSchemeRuntime(input: ColorSchemeRuntimeInput): Promise<ColorSchemeRuntimeAudit> {
  if (input.rigs.length === 0) throw new Error(`${input.sourceId} needs at least one compatible rig.`)
  const source = await readFile(input.sourcePath)
  const rigMasks: ColorSchemeRuntimeAudit['rigMasks'] = {}
  for (const rig of input.rigs) {
    const rigBytes = await readFile(rig.assetPath)
    const masks = await deriveRigColorMasks(source, rigBytes)
    const paths = {
      primary: join(input.maskRoot, input.sourceId, `${rig.rigId}-primary.png`),
      secondary: join(input.maskRoot, input.sourceId, `${rig.rigId}-secondary.png`),
      accent: join(input.maskRoot, input.sourceId, `${rig.rigId}-accent.png`),
    }
    await mkdir(dirname(paths.primary), { recursive: true })
    await Promise.all([
      writeFile(paths.primary, masks.primary),
      writeFile(paths.secondary, masks.secondary),
      writeFile(paths.accent, masks.accent),
    ])
    rigMasks[rig.rigId] = {
      rigAssetPath: portablePath(rig.assetPath),
      rigAssetSha256: sha256(rigBytes),
      paths: {
        primary: portablePath(paths.primary),
        secondary: portablePath(paths.secondary),
        accent: portablePath(paths.accent),
      },
      sha256: {
        primary: sha256(masks.primary),
        secondary: sha256(masks.secondary),
        accent: sha256(masks.accent),
      },
      metrics: masks.metrics,
    }
  }

  const firstRig = await sharp(input.rigs[0]!.assetPath).metadata()
  if (firstRig.width === undefined || firstRig.height === undefined) throw new Error('Cannot read rig dimensions.')
  const transparent = sharp({
    create: { width: firstRig.width, height: firstRig.height, channels: 4, background: '#00000000' },
  })
  await mkdir(dirname(input.runtimePngPath), { recursive: true })
  await Promise.all([
    transparent.clone().png(PNG_OPTIONS).toFile(input.runtimePngPath),
    transparent.clone().webp({ lossless: true }).toFile(input.runtimeWebpPath),
  ])
  const [runtimePng, runtimeWebp] = await Promise.all([
    readFile(input.runtimePngPath), readFile(input.runtimeWebpPath),
  ])
  return {
    version: 'rig-aware-palette-masks-v1',
    sourceId: input.sourceId,
    sourcePath: portablePath(input.sourcePath),
    sourceSha256: sha256(source),
    runtimePngPath: portablePath(input.runtimePngPath),
    runtimePngSha256: sha256(runtimePng),
    runtimeWebpPath: portablePath(input.runtimeWebpPath),
    runtimeWebpSha256: sha256(runtimeWebp),
    rigMasks,
  }
}

export async function buildProductionColorSchemeMasks(input: {
  sourceRoot: string
  runtimeAssetRoot: string
  productionIndexPath: string
  schemes: Array<{ sourceId: string; compatibleRigs: string[] }>
}): Promise<ColorSchemeRuntimeAudit[]> {
  const indexPath = resolveOutputPath(input.sourceRoot, input.productionIndexPath)
  const entries = JSON.parse(await readFile(indexPath, 'utf8')) as Array<Record<string, unknown>>
  const audits: ColorSchemeRuntimeAudit[] = []
  for (const scheme of input.schemes) {
    const entry = entries.find(candidate => candidate.id === scheme.sourceId)
    if (entry === undefined) throw new Error(`Missing production-index entry for ${scheme.sourceId}.`)
    const audit = await buildColorSchemeRuntime({
      sourceId: scheme.sourceId,
      sourcePath: resolveOutputPath(input.sourceRoot, 'parts', `${scheme.sourceId}.png`),
      runtimePngPath: resolveOutputPath(input.runtimeAssetRoot, 'parts', `${scheme.sourceId}.png`),
      runtimeWebpPath: resolveOutputPath(input.runtimeAssetRoot, 'parts', `${scheme.sourceId}.webp`),
      maskRoot: resolveOutputPath(input.runtimeAssetRoot, 'masks'),
      rigs: scheme.compatibleRigs.map(rigId => ({
        rigId,
        assetPath: resolveOutputPath(input.runtimeAssetRoot, 'rigs', `base_${rigId}_v1.png`),
      })),
    })
    Object.assign(entry, {
      postProcess: 'rig-aware-palette-masks-v1',
      paletteMaskAudit: audit,
      pngPath: audit.runtimePngPath,
      pngSha256: audit.runtimePngSha256,
      webpPath: audit.runtimeWebpPath,
      webpSha256: audit.runtimeWebpSha256,
    })
    audits.push(audit)
  }
  await writeFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`)
  return audits
}

if (process.argv[1]?.endsWith('build-color-scheme-masks.ts')) {
  const sourceRoot = process.argv[2] ?? 'asset-source/v0.1.0'
  const runtimeAssetRoot = process.argv[3] ?? 'packages/asset-catalog/assets/v0.1.0'
  const audits = await buildProductionColorSchemeMasks({
    sourceRoot,
    runtimeAssetRoot,
    productionIndexPath: 'generation/production-index.json',
    schemes: [
      { sourceId: 'color_deep_sea_coral', compatibleRigs: ['blob', 'biped', 'floating'] },
      { sourceId: 'color_fungal_amber', compatibleRigs: ['blob', 'biped', 'floating'] },
      { sourceId: 'color_shadow_violet', compatibleRigs: ['blob', 'biped', 'floating'] },
    ],
  })
  console.log(JSON.stringify({ schemes: audits.length, masks: audits.length * 9 }))
}
