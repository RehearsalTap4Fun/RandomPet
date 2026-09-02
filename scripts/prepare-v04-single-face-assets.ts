import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { resolveExistingContainedPath, resolveOutputPath } from './safe-output.js'

const REQUIRED_IDS = [
  'surface_soft_scales',
  'pattern_gentle_stripes',
  'effect_bioluminescent_orbs',
] as const

type V04PartId = typeof REQUIRED_IDS[number]

export interface V04ReplacementInput {
  partId: V04PartId
  generatedPath: string
  prompt: string
  referencedV03Path: string
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const SOURCE_PARTS = ['asset-source', 'v0.4.0', 'parts'] as const
const RECOVERED_PARTS = ['asset-source', 'v0.4.0', 'recovered', 'single-face'] as const
const RUNTIME_PARTS = ['asset-source', 'v0.4.0', 'runtime-staging', 'parts'] as const
const CHECKERBOARD_RECOVERY_PARAMETERS = {
  minimumChannel: 225,
  maximumChannelSpread: 12,
  connectivity: 4,
  minimumBorderLuminanceRange: 6,
} as const

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function portable(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

function expectedGeneratedPath(root: string, partId: V04PartId): string {
  return resolveOutputPath(root, 'asset-source', 'v0.4.0', 'generation', 'single-face', `${partId}-generated.png`)
}

function expectedReferencePath(root: string, partId: V04PartId): string {
  return resolveOutputPath(root, 'packages', 'asset-catalog', 'assets', 'v0.3.0', 'parts', `${partId}.png`)
}

async function exactExistingInput(
  root: string,
  lexicalRoot: string,
  suppliedPath: string,
  expectedPath: string,
  label: string,
): Promise<string> {
  const suppliedAbsolute = resolve(lexicalRoot, suppliedPath)
  const suppliedRelative = relative(lexicalRoot, suppliedAbsolute)
  if (suppliedRelative.startsWith('..') || isAbsolute(suppliedRelative)) {
    throw new Error(`${label} path escapes repository root: ${suppliedPath}`)
  }
  const [actual, expected] = await Promise.all([
    resolveExistingContainedPath(root, suppliedRelative),
    resolveExistingContainedPath(root, expectedPath),
  ])
  if (actual !== expected) throw new Error(`${label} must resolve to the expected repository path: ${expectedPath}`)
  return actual
}

function alphaEvidence(decoded: { data: Buffer; info: { width: number; height: number; channels: number } }): {
  alphaPixels: number
  opaquePixels: number
  borderAlphaPixels: number
} {
  const { width, height, channels } = decoded.info
  let alphaPixels = 0
  let opaquePixels = 0
  let borderAlphaPixels = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const alpha = decoded.data[(y * width + x) * channels + 3]!
    if (alpha > 0) alphaPixels += 1
    if (alpha === 255) opaquePixels += 1
    if (alpha > 0 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) borderAlphaPixels += 1
  }
  return { alphaPixels, opaquePixels, borderAlphaPixels }
}

async function recoverBorderConnectedNearNeutralCheckerboard(generatedBytes: Buffer, partId: V04PartId): Promise<{
  recoveredPng: Buffer
  recovery: {
    method: 'border-connected-near-neutral-checkerboard-v1'
    sourceSha256: string
    recoveredPngSha256: string
    recoveredPngPath: string
    parameters: typeof CHECKERBOARD_RECOVERY_PARAMETERS
    evidence: {
      sourceOpaquePixels: number
      borderMinimumChannel: number
      borderMaximumChannelSpread: number
      borderLuminanceRange: number
      removedConnectedMattePixels: number
      retainedForegroundPixels: number
      borderAlphaPixels: number
    }
  }
}> {
  const decoded = await sharp(generatedBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = decoded.info
  const sourceEvidence = alphaEvidence(decoded)
  if (sourceEvidence.opaquePixels !== width * height) {
    throw new Error(`${partId} checkerboard recovery requires a fully opaque source`)
  }
  let borderMinimumChannel = 255
  let borderMaximumChannelSpread = 0
  let borderMinimumLuminance = 255
  let borderMaximumLuminance = 0
  const isMatte = (pixel: number): boolean => {
    const offset = pixel * channels
    const red = decoded.data[offset]!
    const green = decoded.data[offset + 1]!
    const blue = decoded.data[offset + 2]!
    const minimum = Math.min(red, green, blue)
    const maximum = Math.max(red, green, blue)
    return minimum >= CHECKERBOARD_RECOVERY_PARAMETERS.minimumChannel
      && maximum - minimum <= CHECKERBOARD_RECOVERY_PARAMETERS.maximumChannelSpread
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
    const pixel = y * width + x
    const offset = pixel * channels
    const red = decoded.data[offset]!
    const green = decoded.data[offset + 1]!
    const blue = decoded.data[offset + 2]!
    const minimum = Math.min(red, green, blue)
    const maximum = Math.max(red, green, blue)
    const luminance = Math.round((red + green + blue) / 3)
    borderMinimumChannel = Math.min(borderMinimumChannel, minimum)
    borderMaximumChannelSpread = Math.max(borderMaximumChannelSpread, maximum - minimum)
    borderMinimumLuminance = Math.min(borderMinimumLuminance, luminance)
    borderMaximumLuminance = Math.max(borderMaximumLuminance, luminance)
    if (!isMatte(pixel)) throw new Error(`${partId} border is not an authorized near-neutral checkerboard matte`)
  }
  const borderLuminanceRange = borderMaximumLuminance - borderMinimumLuminance
  if (borderLuminanceRange < CHECKERBOARD_RECOVERY_PARAMETERS.minimumBorderLuminanceRange) {
    throw new Error(`${partId} border lacks the required checkerboard luminance range`)
  }

  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let queued = 0
  const enqueue = (pixel: number): void => {
    if (visited[pixel] !== 0 || !isMatte(pixel)) return
    visited[pixel] = 1
    queue[queued++] = pixel
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  for (let cursor = 0; cursor < queued; cursor += 1) {
    const pixel = queue[cursor]!
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }
  const recoveredData = Buffer.from(decoded.data)
  for (let pixel = 0; pixel < visited.length; pixel += 1) {
    if (visited[pixel] !== 0) recoveredData[pixel * channels + 3] = 0
  }
  const recoveredPng = await sharp(recoveredData, { raw: { width, height, channels: 4 } })
    .png(PNG_OPTIONS)
    .toBuffer()
  const recoveredDecoded = await sharp(recoveredPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const recoveredEvidence = alphaEvidence(recoveredDecoded)
  if (recoveredEvidence.alphaPixels === 0 || recoveredEvidence.borderAlphaPixels !== 0) {
    throw new Error(`${partId} checkerboard recovery failed the final alpha gate`)
  }
  return {
    recoveredPng,
    recovery: {
      method: 'border-connected-near-neutral-checkerboard-v1',
      sourceSha256: sha256(generatedBytes),
      recoveredPngSha256: sha256(recoveredPng),
      recoveredPngPath: `asset-source/v0.4.0/recovered/single-face/${partId}-recovered.png`,
      parameters: CHECKERBOARD_RECOVERY_PARAMETERS,
      evidence: {
        sourceOpaquePixels: sourceEvidence.opaquePixels,
        borderMinimumChannel,
        borderMaximumChannelSpread,
        borderLuminanceRange,
        removedConnectedMattePixels: queued,
        retainedForegroundPixels: recoveredEvidence.alphaPixels,
        borderAlphaPixels: recoveredEvidence.borderAlphaPixels,
      },
    },
  }
}

async function normalizeInput(
  input: V04ReplacementInput,
  repositoryRoot: string,
  lexicalRoot: string,
  recoverCheckerboard: boolean,
): Promise<{
  input: V04ReplacementInput
  generatedPath: string
  referencedV03Path: string
  generatedSha256: string
  referencedV03Sha256: string
  master: Buffer
  runtimePng: Buffer
  runtimeWebp: Buffer
  recoveredPng?: Buffer
  recovery: Awaited<ReturnType<typeof recoverBorderConnectedNearNeutralCheckerboard>>['recovery'] | null
}> {
  const generatedPath = await exactExistingInput(
    repositoryRoot,
    lexicalRoot,
    input.generatedPath,
    expectedGeneratedPath(repositoryRoot, input.partId),
    `${input.partId} generatedPath`,
  )
  const referencedV03Path = await exactExistingInput(
    repositoryRoot,
    lexicalRoot,
    input.referencedV03Path,
    expectedReferencePath(repositoryRoot, input.partId),
    `${input.partId} referencedV03Path`,
  )
  const [generatedBytes, referencedBytes] = await Promise.all([readFile(generatedPath), readFile(referencedV03Path)])
  let normalizedInput = generatedBytes
  let recoveredPng: Buffer | undefined
  let recovery: Awaited<ReturnType<typeof recoverBorderConnectedNearNeutralCheckerboard>>['recovery'] | null = null
  const sourceDecoded = await sharp(generatedBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const sourceAlpha = alphaEvidence(sourceDecoded)
  if (sourceAlpha.alphaPixels === 0) throw new Error(`${input.partId} has empty alpha`)
  if (sourceAlpha.borderAlphaPixels !== 0) {
    if (!recoverCheckerboard) throw new Error(`${input.partId} must have a fully transparent border`)
    const recovered = await recoverBorderConnectedNearNeutralCheckerboard(generatedBytes, input.partId)
    normalizedInput = recovered.recoveredPng
    recoveredPng = recovered.recoveredPng
    recovery = recovered.recovery
  }

  const master = await sharp(normalizedInput)
    .ensureAlpha()
    .resize(2048, 2048, { fit: 'contain', background: '#00000000' })
    .png(PNG_OPTIONS)
    .toBuffer()
  const runtimePng = await sharp(master)
    .resize(1024, 1024, { fit: 'contain', background: '#00000000' })
    .png(PNG_OPTIONS)
    .toBuffer()
  const runtimeWebp = await sharp(master)
    .resize(1024, 1024, { fit: 'contain', background: '#00000000' })
    .webp({ lossless: true, effort: 6 })
    .toBuffer()
  return {
    input,
    generatedPath,
    referencedV03Path,
    generatedSha256: sha256(generatedBytes),
    referencedV03Sha256: sha256(referencedBytes),
    master,
    runtimePng,
    runtimeWebp,
    ...(recoveredPng === undefined ? {} : { recoveredPng }),
    recovery,
  }
}

export async function prepareV04SingleFaceAssets(
  inputs: readonly V04ReplacementInput[],
  options: { repositoryRoot?: string; recoverBorderConnectedNearNeutralCheckerboard?: true } = {},
): Promise<{ assets: Array<{ partId: string; pngSha256: string; webpSha256: string }> }> {
  const lexicalRoot = resolve(options.repositoryRoot ?? process.cwd())
  const repositoryRoot = await realpath(lexicalRoot)
  const seen = new Set(inputs.map(input => input.partId))
  if (inputs.length !== REQUIRED_IDS.length || seen.size !== inputs.length || REQUIRED_IDS.some(partId => !seen.has(partId))) {
    throw new Error(`Expected exactly one input for each required part ID: ${REQUIRED_IDS.join(', ')}`)
  }
  const byId = new Map(inputs.map(input => [input.partId, input] as const))
  const normalized = await Promise.all(REQUIRED_IDS.map(partId => normalizeInput(
    byId.get(partId)!,
    repositoryRoot,
    lexicalRoot,
    options.recoverBorderConnectedNearNeutralCheckerboard === true,
  )))

  const assets = normalized.map(item => ({
    partId: item.input.partId,
    pngSha256: sha256(item.runtimePng),
    webpSha256: sha256(item.runtimeWebp),
  }))
  const provenance = {
    schemaVersion: 'v0.4-single-face-replacement-provenance-v1',
    assets: normalized.map((item, index) => ({
      partId: item.input.partId,
      prompt: item.input.prompt,
      generatedPath: portable(repositoryRoot, item.generatedPath),
      generatedSha256: item.generatedSha256,
      recovery: item.recovery,
      referencedV03Path: portable(repositoryRoot, item.referencedV03Path),
      referencedV03Sha256: item.referencedV03Sha256,
      masterPngPath: `asset-source/v0.4.0/parts/${item.input.partId}.png`,
      masterPngSha256: sha256(item.master),
      runtimePngPath: `asset-source/v0.4.0/runtime-staging/parts/${item.input.partId}.png`,
      runtimePngSha256: assets[index]!.pngSha256,
      runtimeWebpPath: `asset-source/v0.4.0/runtime-staging/parts/${item.input.partId}.webp`,
      runtimeWebpSha256: assets[index]!.webpSha256,
    })),
  }

  for (const directory of [SOURCE_PARTS, RECOVERED_PARTS, RUNTIME_PARTS]) {
    await mkdir(resolveOutputPath(repositoryRoot, ...directory), { recursive: true })
  }
  for (const item of normalized) {
    if (item.recoveredPng !== undefined) {
      await writeFile(resolveOutputPath(repositoryRoot, ...RECOVERED_PARTS, `${item.input.partId}-recovered.png`), item.recoveredPng)
    }
    await writeFile(resolveOutputPath(repositoryRoot, ...SOURCE_PARTS, `${item.input.partId}.png`), item.master)
    await writeFile(resolveOutputPath(repositoryRoot, ...RUNTIME_PARTS, `${item.input.partId}.png`), item.runtimePng)
    await writeFile(resolveOutputPath(repositoryRoot, ...RUNTIME_PARTS, `${item.input.partId}.webp`), item.runtimeWebp)
  }
  await writeFile(
    resolveOutputPath(repositoryRoot, ...RUNTIME_PARTS, 'provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  )
  return { assets }
}

function cliArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = process.argv[index + 1]
  if (index < 0 || value === undefined || value.startsWith('--')) throw new Error(`Missing required argument ${name}`)
  return value
}

async function main(): Promise<void> {
  const repositoryRoot = await realpath(process.cwd())
  const inputRootArgument = cliArgument('--input-root')
  const inputRoot = isAbsolute(inputRootArgument) ? inputRootArgument : resolve(repositoryRoot, inputRootArgument)
  const promptPath = resolveOutputPath(repositoryRoot, 'asset-source', 'v0.4.0', 'prompts', 'single-face-reworks.json')
  const prompts = JSON.parse(await readFile(promptPath, 'utf8')) as Record<V04PartId, string>
  const inputs = REQUIRED_IDS.map(partId => ({
    partId,
    generatedPath: resolve(inputRoot, `${partId}-generated.png`),
    prompt: prompts[partId],
    referencedV03Path: expectedReferencePath(repositoryRoot, partId),
  }))
  const recoverBorderConnectedNearNeutralCheckerboard = process.argv.includes('--recover-border-connected-near-neutral-checkerboard')
  console.log(JSON.stringify(await prepareV04SingleFaceAssets(inputs, {
    repositoryRoot,
    ...(recoverBorderConnectedNearNeutralCheckerboard ? { recoverBorderConnectedNearNeutralCheckerboard: true } : {}),
  }), null, 2))
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
