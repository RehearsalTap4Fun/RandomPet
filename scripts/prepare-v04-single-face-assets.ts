import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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
const CHECKERBOARD_RECOVERY_PARAMETERS = {
  minimumChannel: 225,
  maximumChannelSpread: 12,
  connectivity: 4,
  minimumBorderLuminanceRange: 6,
} as const
const AUTHORIZED_CHECKERBOARD_RECOVERY_SHA256: Record<V04PartId, string> = {
  surface_soft_scales: '086ab9f3ab69019d29ea5cd57e13824cb66dba30dbffff8a4826257d2c5abd03',
  pattern_gentle_stripes: 'a8a98c6e4515231c29678e5e88cb4826159bc40574fa9451556f6ccaa516ccba',
  effect_bioluminescent_orbs: '2c4f2ae34e4d0ce4e8af0e9d5eb1eee5d836297d479fa5f296d4ae90fad30ac1',
}

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

export interface V04PublishOperations {
  publish(stagedPath: string, targetPath: string): Promise<void>
}

const DEFAULT_PUBLISH_OPERATIONS: V04PublishOperations = {
  async publish(stagedPath, targetPath) {
    await link(stagedPath, targetPath)
    await rm(stagedPath)
  },
}

interface V04OutputFile {
  repositoryRelativePath: string
  bytes: Buffer
}

interface V04FileIdentity {
  dev: number
  ino: number
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function assertCanonicalContainment(root: string, target: string, label: string): void {
  const remainder = relative(root, target)
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`${label} escapes canonical repository root: ${target}`)
}

function directoryChain(root: string, target: string): string[] {
  assertCanonicalContainment(root, target, 'V04_OUTPUT_DIRECTORY')
  const chain: string[] = []
  let cursor = target
  while (cursor !== root) {
    chain.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`V04_OUTPUT_DIRECTORY_ESCAPE:${target}`)
    cursor = parent
  }
  return chain.reverse()
}

async function ensureSafeDirectory(
  canonicalRoot: string,
  target: string,
  create: boolean,
  createdDirectories: string[] = [],
): Promise<boolean> {
  for (const directory of directoryChain(canonicalRoot, target)) {
    let metadata
    try {
      metadata = await lstat(directory)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (!create) return false
      try {
        await mkdir(directory)
        createdDirectories.push(directory)
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      metadata = await lstat(directory)
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`V04_OUTPUT_DIRECTORY_LINK_OR_REPARSE_INVALID:${directory}`)
    }
    const canonicalDirectory = await realpath(directory)
    assertCanonicalContainment(canonicalRoot, canonicalDirectory, 'V04_OUTPUT_DIRECTORY')
  }
  return true
}

async function assertOutputAbsent(canonicalRoot: string, target: string): Promise<void> {
  assertCanonicalContainment(canonicalRoot, target, 'V04_OUTPUT')
  if (!await ensureSafeDirectory(canonicalRoot, dirname(target), false)) return
  try {
    await lstat(target)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  throw new Error(`V04_OUTPUT_EXISTS_NO_OVERWRITE:${target}`)
}

function sameIdentity(left: V04FileIdentity, right: V04FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function fileIdentity(metadata: Awaited<ReturnType<typeof lstat>>): V04FileIdentity {
  return { dev: metadata.dev, ino: metadata.ino }
}

async function stageOutputFile(stageRoot: string, output: V04OutputFile): Promise<{ stagedPath: string; targetRelativePath: string }> {
  const targetRelativePath = relative('asset-source/v0.4.0', output.repositoryRelativePath).replaceAll('\\', '/')
  if (!targetRelativePath || targetRelativePath.startsWith('..') || isAbsolute(targetRelativePath)) {
    throw new Error(`V04_STAGE_PATH_INVALID:${output.repositoryRelativePath}`)
  }
  const stagedPath = resolve(stageRoot, targetRelativePath)
  assertCanonicalContainment(stageRoot, stagedPath, 'V04_STAGE')
  await ensureSafeDirectory(stageRoot, dirname(stagedPath), true)
  const handle = await open(stagedPath, 'wx')
  try {
    await handle.writeFile(output.bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const metadata = await lstat(stagedPath)
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error(`V04_STAGE_FILE_INVALID:${stagedPath}`)
  }
  return { stagedPath, targetRelativePath }
}

async function publishV04Outputs(input: {
  canonicalRoot: string
  outputs: readonly V04OutputFile[]
  operations: V04PublishOperations
}): Promise<void> {
  const v04Root = resolve(input.canonicalRoot, 'asset-source', 'v0.4.0')
  if (!await ensureSafeDirectory(input.canonicalRoot, v04Root, false)) throw new Error('V04_OUTPUT_ROOT_MISSING')
  const targets = input.outputs.map(output => resolve(input.canonicalRoot, output.repositoryRelativePath))
  if (new Set(targets).size !== targets.length) throw new Error('V04_OUTPUT_DUPLICATE_TARGET')
  for (const target of targets) await assertOutputAbsent(input.canonicalRoot, target)

  const stageRoot = join(v04Root, `.qmonster-v04-transaction-${randomUUID()}`)
  await assertOutputAbsent(input.canonicalRoot, stageRoot)
  await mkdir(stageRoot)
  let canonicalStageRoot = stageRoot
  const staged: Array<{ stagedPath: string; targetPath: string }> = []
  const committed: Array<{ targetPath: string; identity: V04FileIdentity }> = []
  const createdDirectories: string[] = []
  let caught: unknown
  try {
    canonicalStageRoot = await realpath(stageRoot)
    if (canonicalStageRoot !== stageRoot) throw new Error(`V04_STAGE_ROOT_REPARSE_INVALID:${stageRoot}`)
    for (const output of input.outputs) {
      const item = await stageOutputFile(canonicalStageRoot, output)
      staged.push({ stagedPath: item.stagedPath, targetPath: resolve(v04Root, item.targetRelativePath) })
    }
    for (const item of staged) await ensureSafeDirectory(input.canonicalRoot, dirname(item.targetPath), true, createdDirectories)
    for (const item of staged) await assertOutputAbsent(input.canonicalRoot, item.targetPath)

    for (const item of staged) {
      await ensureSafeDirectory(input.canonicalRoot, dirname(item.targetPath), false)
      await assertOutputAbsent(input.canonicalRoot, item.targetPath)
      const stagedMetadata = await lstat(item.stagedPath)
      if (stagedMetadata.isSymbolicLink() || !stagedMetadata.isFile() || stagedMetadata.nlink !== 1) {
        throw new Error(`V04_STAGE_FILE_CHANGED:${item.stagedPath}`)
      }
      const expectedIdentity = fileIdentity(stagedMetadata)
      try {
        await input.operations.publish(item.stagedPath, item.targetPath)
      } catch (error) {
        try {
          const published = await lstat(item.targetPath)
          if (!published.isSymbolicLink() && published.isFile() && sameIdentity(expectedIdentity, fileIdentity(published))) {
            committed.push({ targetPath: item.targetPath, identity: expectedIdentity })
          }
        } catch (inspectionError) {
          if (!isMissing(inspectionError)) throw inspectionError
        }
        throw error
      }
      const published = await lstat(item.targetPath)
      if (!published.isSymbolicLink() && published.isFile() && sameIdentity(expectedIdentity, fileIdentity(published))) {
        committed.push({ targetPath: item.targetPath, identity: expectedIdentity })
      }
      if (published.isSymbolicLink() || !published.isFile() || published.nlink !== 1
        || !sameIdentity(expectedIdentity, fileIdentity(published))) {
        throw new Error(`V04_PUBLISHED_FILE_INVALID:${item.targetPath}`)
      }
    }
  } catch (error) {
    caught = error
    for (const item of [...committed].reverse()) {
      try {
        if (!await ensureSafeDirectory(input.canonicalRoot, dirname(item.targetPath), false)) {
          throw new Error(`V04_ROLLBACK_OUTPUT_PARENT_MISSING:${item.targetPath}`)
        }
        const current = await lstat(item.targetPath)
        if (current.isSymbolicLink() || !current.isFile() || !sameIdentity(item.identity, fileIdentity(current))) {
          throw new Error(`V04_ROLLBACK_OUTPUT_IDENTITY_CHANGED:${item.targetPath}`)
        }
        await rm(item.targetPath)
      } catch (rollbackError) {
        if (!isMissing(rollbackError)) throw rollbackError
      }
    }
    for (const directory of [...createdDirectories].reverse()) {
      try {
        await rmdir(directory)
      } catch (cleanupError) {
        if (!['ENOENT', 'ENOTEMPTY'].includes((cleanupError as NodeJS.ErrnoException).code ?? '')) throw cleanupError
      }
    }
  } finally {
    await rm(stageRoot, { recursive: true, force: true })
  }
  if (caught !== undefined) throw caught
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

export async function recoverBorderConnectedNearNeutralCheckerboard(generatedBytes: Buffer, partId: V04PartId): Promise<{
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
    const generatedSha256 = sha256(generatedBytes)
    if (generatedSha256 !== AUTHORIZED_CHECKERBOARD_RECOVERY_SHA256[input.partId]) {
      throw new Error(`${input.partId} recovery source hash is not authorized: ${generatedSha256}`)
    }
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
  options: {
    repositoryRoot?: string
    recoverBorderConnectedNearNeutralCheckerboard?: true
    publishOperations?: V04PublishOperations
  } = {},
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

  const outputs: V04OutputFile[] = []
  for (const item of normalized) {
    if (item.recoveredPng !== undefined) {
      outputs.push({
        repositoryRelativePath: `asset-source/v0.4.0/recovered/single-face/${item.input.partId}-recovered.png`,
        bytes: item.recoveredPng,
      })
    }
    outputs.push(
      { repositoryRelativePath: `asset-source/v0.4.0/parts/${item.input.partId}.png`, bytes: item.master },
      { repositoryRelativePath: `asset-source/v0.4.0/runtime-staging/parts/${item.input.partId}.png`, bytes: item.runtimePng },
      { repositoryRelativePath: `asset-source/v0.4.0/runtime-staging/parts/${item.input.partId}.webp`, bytes: item.runtimeWebp },
    )
  }
  outputs.push({
    repositoryRelativePath: 'asset-source/v0.4.0/runtime-staging/parts/provenance.json',
    bytes: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
  })
  await publishV04Outputs({
    canonicalRoot: repositoryRoot,
    outputs,
    operations: options.publishOperations ?? DEFAULT_PUBLISH_OPERATIONS,
  })
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
