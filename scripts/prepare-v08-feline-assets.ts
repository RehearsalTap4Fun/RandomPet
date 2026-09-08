import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  V08_REGION_IDS,
  type ResourceRef,
  type V08RegionId,
} from '@qmonster/generator-core'
import { validateV08RasterContract } from '../packages/asset-catalog/src/v08-raster-contract.js'

const CANVAS_SIZE = 2048
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

export const V08_REGION_GUIDE_FILENAMES = {
  bodySurface: 'body-surface.png',
  headSurface: 'head-surface.png',
  faceSafeZone: 'face-safe-zone.png',
  eyesRegion: 'eyes-region.png',
  mouthRegion: 'mouth-region.png',
  oralRegion: 'oral-region.png',
  tailSurface: 'tail-surface.png',
  frontPawDetail: 'front-paw-detail.png',
  hindPawDetail: 'hind-paw-detail.png',
  headAccessory: 'head-accessory.png',
  mutationEar: 'mutation-ear.png',
  mutationBack: 'mutation-back.png',
  mutationTailTip: 'mutation-tail-tip.png',
  effectField: 'effect-field.png',
  faceProtection: 'face-protection.png',
} as const satisfies Record<V08RegionId, string>

interface RegionGuideEntry {
  sourcePath: string
  equals?: 'structureAlpha'
  within?: V08RegionId
  subtract?: V08RegionId[]
}

interface RegionGuideDocument {
  schemaVersion: 'qmonster-region-guide-v1'
  canvas: { width: 2048; height: 2048 }
  regions: Record<V08RegionId, RegionGuideEntry>
}

export interface PrepareV08FelineMasterInput {
  sourceRoot: string
  outputDirectory: string
}

export interface V08PreparedMaster {
  sourceMasterPath: string
  sourceMasterSha256: string
  structure: ResourceRef
  regions: Record<V08RegionId, ResourceRef>
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeStable(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (await exists(path)) {
    const previous = await readFile(path)
    if (!previous.equals(bytes)) throw new Error(`V08_IMMUTABLE_OUTPUT_MISMATCH:${path}`)
    return
  }
  await writeFile(path, bytes, { flag: 'wx' })
}

export async function establishV08CanonicalMaster(
  rawPath: string,
  outputPath: string,
): Promise<void> {
  const metadata = await sharp(rawPath).metadata()
  if (
    metadata.width === undefined
    || metadata.height === undefined
    || metadata.width !== metadata.height
  ) throw new Error('V08_RAW_MASTER_NOT_SQUARE')

  const normalized = await sharp(rawPath)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = Buffer.from(normalized.data)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!
    const green = pixels[offset + 1]!
    const blue = pixels[offset + 2]!
    const sourceAlpha = pixels[offset + 3]!
    const excessGreen = green - Math.max(red, blue)
    const chroma = Math.max(0, Math.min(1, (excessGreen - 24) / 104))
    pixels[offset + 3] = Math.round(sourceAlpha * (1 - chroma))
    if (chroma > 0) pixels[offset + 1] = Math.min(green, Math.max(red, blue) + 8)
  }
  const encoded = await sharp(pixels, {
    raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4 },
  }).png(PNG_OPTIONS).toBuffer()
  await writeStable(outputPath, encoded)
}

function parseRegionGuide(document: unknown): RegionGuideDocument {
  if (typeof document !== 'object' || document === null) throw new Error('V08_REGION_GUIDE_INVALID')
  const candidate = document as Partial<RegionGuideDocument>
  if (
    candidate.schemaVersion !== 'qmonster-region-guide-v1'
    || candidate.canvas?.width !== CANVAS_SIZE
    || candidate.canvas.height !== CANVAS_SIZE
    || typeof candidate.regions !== 'object'
    || candidate.regions === null
  ) throw new Error('V08_REGION_GUIDE_INVALID')
  const keys = Object.keys(candidate.regions)
  if (
    keys.length !== V08_REGION_IDS.length
    || V08_REGION_IDS.some(regionId => !keys.includes(regionId))
  ) throw new Error('V08_REGION_GUIDE_INVENTORY_INVALID')
  return candidate as RegionGuideDocument
}

function safeSourcePath(sourceRoot: string, sourcePath: string): string {
  const root = resolve(sourceRoot)
  const target = resolve(root, sourcePath)
  const remainder = relative(root, target)
  if (remainder === '' || remainder.startsWith('..') || isAbsolute(remainder)) {
    throw new Error(`V08_REGION_GUIDE_PATH_INVALID:${sourcePath}`)
  }
  return target
}

async function alphaSet(path: string): Promise<Uint8Array> {
  const image = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (image.info.width !== CANVAS_SIZE || image.info.height !== CANVAS_SIZE) {
    throw new Error(`V08_CANVAS_SIZE_INVALID:${path}`)
  }
  return Uint8Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, (_value, pixel) => (
    image.data[pixel * image.info.channels + 3]! > 0 ? 1 : 0
  ))
}

function relationViolation(child: Uint8Array, parent: Uint8Array, mode: 'within' | 'subtract'): number {
  let count = 0
  for (let pixel = 0; pixel < child.length; pixel += 1) {
    if (child[pixel] === 0) continue
    if (mode === 'within' ? parent[pixel] === 0 : parent[pixel] !== 0) count += 1
  }
  return count
}

function alphaDifference(left: Uint8Array, right: Uint8Array): number {
  let count = 0
  for (let pixel = 0; pixel < left.length; pixel += 1) {
    if (left[pixel] !== right[pixel]) count += 1
  }
  return count
}

function componentCount8(alpha: Uint8Array): number {
  const visited = new Uint8Array(alpha.length)
  const queue = new Int32Array(alpha.length)
  let components = 0
  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] === 0 || visited[start] !== 0) continue
    components += 1
    visited[start] = 1
    let read = 0
    let written = 1
    queue[0] = start
    while (read < written) {
      const pixel = queue[read++]!
      const x = pixel % CANVAS_SIZE
      const y = Math.floor(pixel / CANVAS_SIZE)
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue
          const nextX = x + deltaX
          const nextY = y + deltaY
          if (nextX < 0 || nextX >= CANVAS_SIZE || nextY < 0 || nextY >= CANVAS_SIZE) continue
          const candidate = nextY * CANVAS_SIZE + nextX
          if (alpha[candidate] === 0 || visited[candidate] !== 0) continue
          visited[candidate] = 1
          queue[written++] = candidate
        }
      }
    }
  }
  return components
}

async function resourceRef(pngPath: string, webpPath: string): Promise<ResourceRef> {
  const [png, webp] = await Promise.all([readFile(pngPath), readFile(webpPath)])
  return {
    assetPath: webpPath,
    assetSha256: sha256(webp),
    pngPath,
    pngSha256: sha256(png),
  }
}

async function packageResource(sourcePath: string, destinationRoot: string, stem: string): Promise<ResourceRef> {
  const pngPath = join(destinationRoot, `${stem}.png`)
  const webpPath = join(destinationRoot, `${stem}.webp`)
  await mkdir(destinationRoot, { recursive: true })
  const source = await readFile(sourcePath)
  await writeStable(pngPath, source)
  const webp = await sharp(sourcePath).webp({ lossless: true, effort: 1 }).toBuffer()
  await writeStable(webpPath, webp)
  return resourceRef(pngPath, webpPath)
}

export async function prepareV08FelineMaster(
  input: PrepareV08FelineMasterInput,
): Promise<V08PreparedMaster> {
  const sourceRoot = resolve(input.sourceRoot)
  const rawMasterPath = join(sourceRoot, 'master', 'feline-sit-v1-raw.png')
  const masterPath = join(sourceRoot, 'master', 'feline-sit-v1.png')
  if (!(await exists(masterPath))) await establishV08CanonicalMaster(rawMasterPath, masterPath)

  const structureDiagnostics = await validateV08RasterContract({
    sourcePath: masterPath,
    role: 'structure',
  })
  if (structureDiagnostics.some(item => item.severity === 'error')) {
    throw new Error(structureDiagnostics.map(item => `${item.code}:${item.message}`).join('\n'))
  }

  const guide = parseRegionGuide(JSON.parse(await readFile(join(sourceRoot, 'region-guides.json'), 'utf8')))
  const regionPaths = {} as Record<V08RegionId, string>
  const regionAlpha = {} as Record<V08RegionId, Uint8Array>
  const decodedRegions = await Promise.all(V08_REGION_IDS.map(async regionId => {
    const entry = guide.regions[regionId]
    const expectedPath = `master/masks/${V08_REGION_GUIDE_FILENAMES[regionId]}`
    if (entry.sourcePath.replaceAll('\\', '/') !== expectedPath) {
      throw new Error(`V08_REGION_GUIDE_PATH_INVALID:${regionId}:${entry.sourcePath}`)
    }
    const sourcePath = safeSourcePath(sourceRoot, entry.sourcePath)
    const diagnostics = await validateV08RasterContract({ sourcePath, role: 'mask' })
    if (diagnostics.some(item => item.severity === 'error')) {
      throw new Error(diagnostics.map(item => `${item.code}:${item.message}`).join('\n'))
    }
    return { regionId, sourcePath, alpha: await alphaSet(sourcePath) }
  }))
  for (const { regionId, sourcePath, alpha } of decodedRegions) {
    regionPaths[regionId] = sourcePath
    regionAlpha[regionId] = alpha
  }

  const structureAlpha = await alphaSet(masterPath)
  const bodyDifference = alphaDifference(regionAlpha.bodySurface, structureAlpha)
  if (bodyDifference > 0) throw new Error(
    `V08_REGION_RELATION_INVALID:bodySurface:equals:structureAlpha:${bodyDifference}`,
  )
  for (const regionId of V08_REGION_IDS) {
    const entry = guide.regions[regionId]
    if (entry.within !== undefined) {
      const count = relationViolation(regionAlpha[regionId], regionAlpha[entry.within], 'within')
      if (count > 0) throw new Error(
        `V08_REGION_RELATION_INVALID:${regionId}:within:${entry.within}:${count}`,
      )
    }
    for (const subtract of entry.subtract ?? []) {
      const count = relationViolation(regionAlpha[regionId], regionAlpha[subtract], 'subtract')
      if (count > 0) throw new Error(
        `V08_REGION_RELATION_INVALID:${regionId}:subtract:${subtract}:${count}`,
      )
    }
  }
  for (const [left, right] of [
    ['eyesRegion', 'mouthRegion'],
    ['frontPawDetail', 'hindPawDetail'],
  ] as const) {
    const count = relationViolation(regionAlpha[left], regionAlpha[right], 'subtract')
    if (count > 0) throw new Error(`V08_REGION_DISJOINT_INVALID:${left}:${right}:${count}`)
  }
  for (const pawRegion of ['frontPawDetail', 'hindPawDetail'] as const) {
    const components = componentCount8(regionAlpha[pawRegion])
    if (components < 2) throw new Error(`V08_PAW_COMPONENTS_INVALID:${pawRegion}:${components}`)
  }

  const destinationRoot = resolve(input.outputDirectory, 'rigs', 'feline-sit-v1')
  const [structure, packagedRegions] = await Promise.all([
    packageResource(masterPath, destinationRoot, 'structure'),
    Promise.all(V08_REGION_IDS.map(async regionId => ({
      regionId,
      resource: await packageResource(
        regionPaths[regionId], join(destinationRoot, 'masks'), regionId,
      ),
    }))),
  ])
  const regions = {} as Record<V08RegionId, ResourceRef>
  for (const { regionId, resource } of packagedRegions) regions[regionId] = resource
  return {
    sourceMasterPath: masterPath,
    sourceMasterSha256: sha256(await readFile(masterPath)),
    structure,
    regions,
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== '--master-only') {
    throw new Error('Usage: tsx scripts/prepare-v08-feline-assets.ts --master-only <source-root>')
  }
  const sourceRoot = resolve(args[1]!)
  const prepared = await prepareV08FelineMaster({
    sourceRoot,
    outputDirectory: join(sourceRoot, 'prepared'),
  })
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2))
}
