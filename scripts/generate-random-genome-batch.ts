import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Diagnostic, GenerationMode, MonsterSpec, ThemeId } from '@qmonster/generator-core'
import type { CompositionMetrics, ConnectorMetric } from '@qmonster/renderer-canvas'

const BATCH_THEMES = ['deep-sea', 'fungal', 'shadow'] as const satisfies readonly ThemeId[]
const BATCH_MODES = ['normal', 'mutation', 'aberration'] as const satisfies readonly GenerationMode[]
const PRODUCTION_BATCH_COUNT = 18
const RECOVERY_PROVENANCE = {
  productionCommandAttempts: 3,
  completedBatchRenderPasses: 1,
  priorFailedAttempts: [
    {
      attempt: 1,
      index: 2,
      seed: 'qmonster-v04-user-review-002',
      stage: 'generation',
      code: 'SPEC_SOCKET_MISSING',
    },
    {
      attempt: 2,
      index: 7,
      seed: 'qmonster-v04-user-review-007',
      stage: 'render',
      code: 'COMPOSITION_FACE_OUT_OF_ZONE',
    },
  ],
  visualPreferenceRetries: 0,
  visualPreferenceReplacements: 0,
  visualPreferenceFiltering: 0,
} as const

export interface RandomGenomeBatchInput {
  index: number
  seed: string
  themeId: ThemeId
  mode: GenerationMode
}

interface IdentifiedRender {
  inputIndex: number
}

export interface OneShotBatchOperations<TGenerated, TRendered extends IdentifiedRender> {
  generate(input: RandomGenomeBatchInput): TGenerated | Promise<TGenerated>
  render(
    input: RandomGenomeBatchInput,
    generated: TGenerated,
  ): TRendered | undefined | Promise<TRendered | undefined>
}

export interface RandomGenomeBatchCommandOperations<TResult> {
  runProductionBatch(args: readonly string[]): Promise<TResult>
  verifyExistingBatch(outputDirectory: string): Promise<TResult>
}

export interface GeneratedRandomGenomeBatchEntry {
  blocked: boolean
  diagnostics: Diagnostic[]
  spec: MonsterSpec
  strongFeatureCount: number
  strongNonFacialFeatureCount: number
}

export interface RenderedRandomGenomeBatchEntry extends IdentifiedRender {
  pngBytes: Buffer
  diagnostics: Diagnostic[]
  compositionMetrics: CompositionMetrics | null
  connectorMetrics: ConnectorMetric[] | null
  resolvedAssetPaths: string[]
}

export interface RandomGenomeUserReviewBatchOptions {
  repositoryRoot?: string
  batchSeed: string
  count: number
  outputDirectory: string
  catalogVersion: '0.4.0'
  browserVersion?: string
}

interface BatchManifestEntryForVerification {
  index: number
  pngFilename: string
  specFilename: string
  pngSha256: string
  specSha256: string
  genomeSha256: string
  resolvedAssets: Array<{ path: string, sha256: string }>
}

interface BatchManifestForVerification {
  manifestVersion: string
  catalogVersion: string
  rendererVersion: string
  genomeVersion: string
  count: number
  review: {
    decision: string
    userApproved: boolean
    regeneratedForVisualPreference: boolean
  }
  recoveryProvenance: {
    productionCommandAttempts: number
    completedBatchRenderPasses: number
    priorFailedAttempts: Array<{
      attempt: number
      index: number
      seed: string
      stage: string
      code: string
    }>
    visualPreferenceRetries: number
    visualPreferenceReplacements: number
    visualPreferenceFiltering: number
  }
  contactSheet: { filename: string, sha256: string }
  entries: BatchManifestEntryForVerification[]
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function resolveAcceptanceOutputDirectory(repositoryRoot: string, requested: string): string {
  if (isAbsolute(requested)) {
    throw new Error('Batch output directory must be relative to the repository.')
  }
  const acceptanceRoot = resolve(repositoryRoot, 'artifacts', 'acceptance')
  const outputDirectory = resolve(repositoryRoot, requested)
  const relation = relative(acceptanceRoot, outputDirectory)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('Batch output directory must be a child of artifacts/acceptance/.')
  }
  return outputDirectory
}

function resolveArtifactFile(outputDirectory: string, filename: string): string {
  if (isAbsolute(filename)) throw new Error(`Artifact filename must be relative: ${filename}`)
  const path = resolve(outputDirectory, filename)
  const relation = relative(outputDirectory, path)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Artifact filename escapes the batch directory: ${filename}`)
  }
  return path
}

function resolveRuntimeAsset(repositoryRoot: string, assetPath: string): string {
  const versionPrefix = 'assets/v0.4.0/'
  const relativeAssetPath = assetPath.startsWith(versionPrefix)
    ? assetPath.slice(versionPrefix.length)
    : assetPath
  const assetRoot = resolve(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.4.0')
  const path = resolve(assetRoot, relativeAssetPath)
  const relation = relative(assetRoot, path)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Resolved asset escapes the v0.4.0 asset root: ${assetPath}`)
  }
  return path
}

function parseManifest(bytes: Buffer): BatchManifestForVerification {
  const document = JSON.parse(bytes.toString('utf8')) as BatchManifestForVerification
  if (
    document.manifestVersion !== 'qmonster-random-genome-batch-v04-user-review-v1'
    || document.catalogVersion !== '0.4.0'
    || document.rendererVersion !== '0.4.0'
    || document.genomeVersion !== '0.1.0'
    || document.review?.decision !== 'pending_user_review'
    || document.review.userApproved !== false
    || document.review.regeneratedForVisualPreference !== false
    || document.recoveryProvenance?.productionCommandAttempts !== RECOVERY_PROVENANCE.productionCommandAttempts
    || document.recoveryProvenance.completedBatchRenderPasses !== RECOVERY_PROVENANCE.completedBatchRenderPasses
    || document.recoveryProvenance.visualPreferenceRetries !== RECOVERY_PROVENANCE.visualPreferenceRetries
    || document.recoveryProvenance.visualPreferenceReplacements !== RECOVERY_PROVENANCE.visualPreferenceReplacements
    || document.recoveryProvenance.visualPreferenceFiltering !== RECOVERY_PROVENANCE.visualPreferenceFiltering
    || !Array.isArray(document.recoveryProvenance.priorFailedAttempts)
    || document.recoveryProvenance.priorFailedAttempts.length !== RECOVERY_PROVENANCE.priorFailedAttempts.length
    || document.recoveryProvenance.priorFailedAttempts.some((failure, index) => {
      const expected = RECOVERY_PROVENANCE.priorFailedAttempts[index]
      return expected === undefined
        || failure.attempt !== expected.attempt
        || failure.index !== expected.index
        || failure.seed !== expected.seed
        || failure.stage !== expected.stage
        || failure.code !== expected.code
    })
    || !Array.isArray(document.entries)
    || !Number.isSafeInteger(document.count)
    || document.count !== document.entries.length
  ) {
    throw new Error('Batch manifest contract is invalid.')
  }
  return document
}

export function buildRandomGenomeBatchInputs(
  batchSeed: string,
  count: number,
): RandomGenomeBatchInput[] {
  if (batchSeed.trim().length === 0) throw new Error('Batch seed must not be empty.')
  if (count !== PRODUCTION_BATCH_COUNT) {
    throw new Error(`The user-review production batch must contain exactly ${PRODUCTION_BATCH_COUNT} entries.`)
  }
  const entries: RandomGenomeBatchInput[] = []
  for (let sample = 0; sample < 2; sample += 1) {
    for (let row = 0; row < BATCH_THEMES.length; row += 1) {
      for (let column = 0; column < BATCH_THEMES.length; column += 1) {
        const index = entries.length + 1
        entries.push({
          index,
          seed: `${batchSeed}-${String(index).padStart(3, '0')}`,
          themeId: BATCH_THEMES[column]!,
          mode: BATCH_MODES[(row + column) % BATCH_MODES.length]!,
        })
      }
    }
  }
  return entries
}

export function parseRandomGenomeBatchArguments(args: readonly string[]): {
  catalogVersion: '0.4.0'
  batchSeed: string
  count: 18
  outputDirectory: string
} {
  const values = new Map<string, string>()
  const allowedFlags = new Set(['--catalog-version', '--seed', '--count', '--output-directory'])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === undefined || !allowedFlags.has(flag) || value === undefined || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete random-batch argument: ${flag ?? ''}`)
    }
    if (values.has(flag)) throw new Error(`Duplicate random-batch argument: ${flag}`)
    values.set(flag, value)
  }
  if (values.size !== allowedFlags.size) {
    throw new Error('Production batch requires --catalog-version, --seed, --count, and --output-directory.')
  }
  const catalogVersion = values.get('--catalog-version')
  if (catalogVersion !== '0.4.0') throw new Error('Production batch requires exact catalog version 0.4.0.')
  const batchSeed = values.get('--seed')!
  if (batchSeed.trim().length === 0) throw new Error('Batch seed must not be empty.')
  const count = Number(values.get('--count'))
  if (count !== PRODUCTION_BATCH_COUNT) {
    throw new Error(`The user-review production batch must contain exactly ${PRODUCTION_BATCH_COUNT} entries.`)
  }
  return {
    catalogVersion,
    batchSeed,
    count,
    outputDirectory: values.get('--output-directory')!,
  }
}

export async function mapRandomGenomeBatchInputsOneShot<
  TGenerated,
  TRendered extends IdentifiedRender,
>(
  inputs: readonly RandomGenomeBatchInput[],
  operations: OneShotBatchOperations<TGenerated, TRendered>,
): Promise<Array<{ input: RandomGenomeBatchInput, generated: TGenerated, rendered: TRendered }>> {
  const renderedInputIndexes = new Set<number>()
  const outputs: Array<{
    input: RandomGenomeBatchInput
    generated: TGenerated
    rendered: TRendered
  }> = []
  for (const input of inputs) {
    const generated = await operations.generate(input)
    const rendered = await operations.render(input, generated)
    if (rendered === undefined) throw new Error(`Batch input ${input.index} has a missing render.`)
    if (renderedInputIndexes.has(rendered.inputIndex)) {
      throw new Error(`Batch input ${input.index} produced a duplicate render identity ${rendered.inputIndex}.`)
    }
    if (rendered.inputIndex !== input.index) {
      throw new Error(`Batch input ${input.index} produced render identity ${rendered.inputIndex}.`)
    }
    renderedInputIndexes.add(rendered.inputIndex)
    outputs.push({ input, generated, rendered })
  }
  if (outputs.length !== inputs.length || renderedInputIndexes.size !== inputs.length) {
    throw new Error('Batch generation did not produce exactly one render for every input.')
  }
  return outputs
}

function errorDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(diagnostic => diagnostic.severity === 'error')
}

function assertGeneratedEntry(
  input: RandomGenomeBatchInput,
  generated: GeneratedRandomGenomeBatchEntry,
): void {
  const errors = errorDiagnostics(generated.diagnostics)
  if (generated.blocked || errors.length > 0) {
    throw new Error(`Generation failed for ${input.seed}: ${JSON.stringify(errors.length > 0 ? errors : generated.diagnostics)}`)
  }
  const { spec } = generated
  if (
    spec.schemaVersion !== '0.1.0'
    || spec.catalogVersion !== '0.4.0'
    || spec.rendererVersion !== '0.4.0'
    || spec.seed !== input.seed
    || spec.themeId !== input.themeId
    || spec.genome?.genomeVersion !== '0.1.0'
  ) {
    throw new Error(`Generation returned invalid exact-version evidence for ${input.seed}.`)
  }
  if (
    !Number.isSafeInteger(generated.strongFeatureCount)
    || generated.strongFeatureCount < 0
    || generated.strongFeatureCount > 2
    || !Number.isSafeInteger(generated.strongNonFacialFeatureCount)
    || generated.strongNonFacialFeatureCount < 0
    || generated.strongNonFacialFeatureCount > 1
  ) {
    throw new Error(`Generation returned invalid strong-feature counts for ${input.seed}.`)
  }
}

function assertRenderedEntry(
  input: RandomGenomeBatchInput,
  rendered: RenderedRandomGenomeBatchEntry,
): void {
  const errors = errorDiagnostics(rendered.diagnostics)
  if (errors.length > 0) {
    throw new Error(`Render failed for ${input.seed}: ${JSON.stringify(errors)}`)
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!signature.every((value, index) => rendered.pngBytes[index] === value)) {
    throw new Error(`Renderer returned invalid PNG bytes for ${input.seed}.`)
  }
  if (rendered.resolvedAssetPaths.length === 0) {
    throw new Error(`Renderer returned no resolved assets for ${input.seed}.`)
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function buildContactSheet(
  entries: ReadonlyArray<{
    input: RandomGenomeBatchInput
    generated: GeneratedRandomGenomeBatchEntry
    rendered: RenderedRandomGenomeBatchEntry
  }>,
): Promise<{ bytes: Buffer, width: number, height: number }> {
  const { default: sharp } = await import('sharp')
  const columns = 6
  const rows = Math.ceil(entries.length / columns)
  const cellWidth = 220
  const artSize = 216
  const labelHeight = 58
  const cellHeight = artSize + labelHeight
  const composites: import('sharp').OverlayOptions[] = []
  for (const [offset, entry] of entries.entries()) {
    const left = (offset % columns) * cellWidth
    const top = Math.floor(offset / columns) * cellHeight
    const art = await sharp(entry.rendered.pngBytes)
      .resize(artSize, artSize, { fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()
    const rigId = entry.generated.spec.visualSlots.bodyFrame.rigId
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${artSize}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="7" y="20" font-family="Segoe UI, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${escapeXml(`${String(entry.input.index).padStart(3, '0')} · ${entry.input.themeId}`)}</text>
      <text x="7" y="39" font-family="Segoe UI, sans-serif" font-size="12" fill="#b8c4d6">${escapeXml(`${entry.input.mode} · ${rigId}`)}</text>
      <text x="7" y="54" font-family="Segoe UI, sans-serif" font-size="10" fill="#7dd3fc">${escapeXml(entry.input.seed)}</text>
    </svg>`)
    composites.push({ input: art, left: left + 2, top: top + 2 })
    composites.push({ input: label, left: left + 2, top: top + artSize + 2 })
  }
  const width = columns * cellWidth
  const height = rows * cellHeight
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#202938ff' },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  return { bytes, width, height }
}

export async function generateRandomGenomeUserReviewBatch(
  options: RandomGenomeUserReviewBatchOptions,
  operations: OneShotBatchOperations<GeneratedRandomGenomeBatchEntry, RenderedRandomGenomeBatchEntry>,
): Promise<Awaited<ReturnType<typeof verifyRandomGenomeBatchArtifacts>>> {
  if (options.catalogVersion !== '0.4.0') {
    throw new Error('The user-review batch requires exact catalog version 0.4.0.')
  }
  const repositoryRoot = options.repositoryRoot ?? process.cwd()
  const outputDirectory = resolveAcceptanceOutputDirectory(repositoryRoot, options.outputDirectory)
  try {
    await stat(outputDirectory)
    throw new Error(`Batch output directory already exists: ${options.outputDirectory}`)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const inputs = buildRandomGenomeBatchInputs(options.batchSeed, options.count)
  const mapped = await mapRandomGenomeBatchInputsOneShot(inputs, {
    generate: async input => {
      const generated = await operations.generate(input)
      assertGeneratedEntry(input, generated)
      return generated
    },
    render: async (input, generated) => {
      const rendered = await operations.render(input, generated)
      if (rendered !== undefined) assertRenderedEntry(input, rendered)
      return rendered
    },
  })

  const contactSheet = await buildContactSheet(mapped)
  const themeModeDistribution = Object.fromEntries(BATCH_THEMES.flatMap(themeId => (
    BATCH_MODES.map(mode => [
      `${themeId}:${mode}`,
      inputs.filter(input => input.themeId === themeId && input.mode === mode).length,
    ] as const)
  )))
  const rigDistribution: Record<string, number> = {}
  const entries = []
  for (const { input, generated, rendered } of mapped) {
    const rigId = generated.spec.visualSlots.bodyFrame.rigId
    rigDistribution[rigId] = (rigDistribution[rigId] ?? 0) + 1
    const baseFilename = `${String(input.index).padStart(3, '0')}-${input.themeId}-${input.mode}-${rigId}`
    const pngFilename = `${baseFilename}.png`
    const specFilename = `${baseFilename}.json`
    const specBytes = Buffer.from(`${JSON.stringify(generated.spec, null, 2)}\n`)
    const resolvedAssetPaths = [...new Set(rendered.resolvedAssetPaths)].sort()
    const resolvedAssets = await Promise.all(resolvedAssetPaths.map(async path => ({
      path,
      sha256: sha256(await readFile(resolveRuntimeAsset(repositoryRoot, path))),
    })))
    entries.push({
      index: input.index,
      seed: input.seed,
      themeId: input.themeId,
      mode: input.mode,
      rigId,
      catalogVersion: generated.spec.catalogVersion,
      rendererVersion: generated.spec.rendererVersion,
      genomeVersion: generated.spec.genome!.genomeVersion,
      pngFilename,
      specFilename,
      pngSha256: sha256(rendered.pngBytes),
      specSha256: sha256(specBytes),
      genomeSha256: sha256(JSON.stringify(generated.spec.genome)),
      resolvedAssetPaths,
      resolvedAssets,
      strongFeatureCount: generated.strongFeatureCount,
      strongNonFacialFeatureCount: generated.strongNonFacialFeatureCount,
      generationDiagnostics: generated.diagnostics,
      renderDiagnostics: rendered.diagnostics,
      compositionMetrics: rendered.compositionMetrics,
      connectorMetrics: rendered.connectorMetrics,
      pngBytes: rendered.pngBytes,
      specBytes,
    })
  }
  const manifest = {
    manifestVersion: 'qmonster-random-genome-batch-v04-user-review-v1',
    batchSeed: options.batchSeed,
    catalogVersion: '0.4.0',
    schemaVersion: '0.1.0',
    rendererVersion: '0.4.0',
    genomeVersion: '0.1.0',
    count: entries.length,
    generationPolicy: {
      productionRuns: 1,
      generateMonsterCallsPerInput: 1,
      browserRenderCallsPerInput: 1,
      retryCount: 0,
      replacementSeedCount: 0,
      filteredEntryCount: 0,
      visualPreferenceRegenerationCount: 0,
    },
    review: {
      decision: 'pending_user_review',
      userApproved: false,
      regeneratedForVisualPreference: false,
    },
    recoveryProvenance: RECOVERY_PROVENANCE,
    render: {
      width: 1024,
      height: 1024,
      transparent: true,
      browser: options.browserVersion ?? 'injected-test-renderer',
    },
    themeModeDistribution,
    rigDistribution,
    contactSheet: {
      filename: 'contact-sheet.png',
      sha256: sha256(contactSheet.bytes),
      width: contactSheet.width,
      height: contactSheet.height,
    },
    entries: entries.map(({ pngBytes: _pngBytes, specBytes: _specBytes, ...entry }) => entry),
  }

  await mkdir(outputDirectory)
  for (const entry of entries) {
    await writeFile(join(outputDirectory, entry.pngFilename), entry.pngBytes)
    await writeFile(join(outputDirectory, entry.specFilename), entry.specBytes)
  }
  await writeFile(join(outputDirectory, manifest.contactSheet.filename), contactSheet.bytes)
  await writeFile(join(outputDirectory, 'batch-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return verifyRandomGenomeBatchArtifacts(options.outputDirectory, {
    repositoryRoot,
    expectedCount: options.count,
  })
}

export async function runRandomGenomeBatchCommand<TResult>(
  args: readonly string[],
  operations: RandomGenomeBatchCommandOperations<TResult>,
): Promise<TResult> {
  if (args[0] === '--verify-only') {
    if (args.length !== 3 || args[1] !== '--output-directory' || args[2] === undefined) {
      throw new Error('Verify-only usage: --verify-only --output-directory <relative-path>')
    }
    return operations.verifyExistingBatch(args[2])
  }
  return operations.runProductionBatch(args)
}

export async function verifyRandomGenomeBatchArtifacts(
  requestedOutputDirectory: string,
  options: { repositoryRoot?: string, expectedCount?: number } = {},
): Promise<{
  manifestPath: string
  manifestSha256: string
  contactSheetSha256: string
  entryCount: number
  pngCount: number
  specCount: number
  resolvedAssetCount: number
}> {
  const repositoryRoot = options.repositoryRoot ?? process.cwd()
  const expectedCount = options.expectedCount ?? PRODUCTION_BATCH_COUNT
  const outputDirectory = resolveAcceptanceOutputDirectory(repositoryRoot, requestedOutputDirectory)
  const manifestPath = resolveArtifactFile(outputDirectory, 'batch-manifest.json')
  const manifestBytes = await readFile(manifestPath)
  const manifest = parseManifest(manifestBytes)
  if (manifest.count !== expectedCount) {
    throw new Error(`Batch manifest contains ${manifest.count} entries; expected ${expectedCount}.`)
  }
  const indexes = new Set<number>()
  const pngFilenames = new Set<string>()
  const specFilenames = new Set<string>()
  let resolvedAssetCount = 0
  for (const entry of manifest.entries) {
    if (indexes.has(entry.index)) throw new Error(`Duplicate manifest entry index ${entry.index}.`)
    if (pngFilenames.has(entry.pngFilename)) throw new Error(`Duplicate PNG filename ${entry.pngFilename}.`)
    if (specFilenames.has(entry.specFilename)) throw new Error(`Duplicate spec filename ${entry.specFilename}.`)
    indexes.add(entry.index)
    pngFilenames.add(entry.pngFilename)
    specFilenames.add(entry.specFilename)

    const pngBytes = await readFile(resolveArtifactFile(outputDirectory, entry.pngFilename))
    if (sha256(pngBytes) !== entry.pngSha256) {
      throw new Error(`PNG hash mismatch for ${entry.pngFilename}.`)
    }
    const specBytes = await readFile(resolveArtifactFile(outputDirectory, entry.specFilename))
    if (sha256(specBytes) !== entry.specSha256) {
      throw new Error(`Spec hash mismatch for ${entry.specFilename}.`)
    }
    const spec = JSON.parse(specBytes.toString('utf8')) as { genome?: unknown }
    if (spec.genome === undefined || sha256(JSON.stringify(spec.genome)) !== entry.genomeSha256) {
      throw new Error(`Genome hash mismatch for ${entry.specFilename}.`)
    }
    for (const asset of entry.resolvedAssets) {
      const assetBytes = await readFile(resolveRuntimeAsset(repositoryRoot, asset.path))
      if (sha256(assetBytes) !== asset.sha256) {
        throw new Error(`Resolved asset hash mismatch for ${asset.path}.`)
      }
      resolvedAssetCount += 1
    }
  }
  const contactSheetBytes = await readFile(resolveArtifactFile(outputDirectory, manifest.contactSheet.filename))
  if (sha256(contactSheetBytes) !== manifest.contactSheet.sha256) {
    throw new Error('Contact sheet hash mismatch.')
  }
  const filenames = await readdir(outputDirectory)
  const pngCount = filenames.filter(filename => filename.endsWith('.png') && filename !== manifest.contactSheet.filename).length
  const specCount = filenames.filter(filename => filename.endsWith('.json') && filename !== 'batch-manifest.json').length
  if (pngCount !== expectedCount || specCount !== expectedCount) {
    throw new Error(`Artifact count mismatch: ${pngCount} PNGs and ${specCount} specs.`)
  }
  return {
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    contactSheetSha256: sha256(contactSheetBytes),
    entryCount: manifest.entries.length,
    pngCount,
    specCount,
    resolvedAssetCount,
  }
}

function decodeBrowserPng(dataUrl: string): Buffer {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) throw new Error('Browser renderer did not return a PNG data URL.')
  return Buffer.from(dataUrl.slice(prefix.length), 'base64')
}

async function runProductionRandomGenomeBatch(
  args: readonly string[],
): Promise<Awaited<ReturnType<typeof verifyRandomGenomeBatchArtifacts>>> {
  const parsedArguments = parseRandomGenomeBatchArguments(args)
  const repositoryRoot = process.cwd()
  const catalogDocument = JSON.parse(await readFile(
    resolve(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.4.0', 'catalog.json'),
    'utf8',
  )) as unknown
  const {
    generateMonster,
    parseCatalog,
    strongFeatureCount,
    strongNonFacialFeatureCount,
    validateMonsterSpecAgainstCatalog,
  } = await import('@qmonster/generator-core')
  const parsedCatalog = parseCatalog(catalogDocument)
  if (!parsedCatalog.ok) {
    throw new Error(`Production v0.4.0 catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
  }

  const [{ chromium }, { createServer }] = await Promise.all([
    import('@playwright/test'),
    import('vite'),
  ])
  const server = await createServer({
    root: resolve(repositoryRoot, 'apps', 'creator-web'),
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) {
    await server.close()
    throw new Error('Vite did not expose a local batch-renderer URL.')
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 1024 },
      deviceScaleFactor: 1,
    })
    await page.goto(`${baseUrl}acceptance-render.html`)
    await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
    return await generateRandomGenomeUserReviewBatch({
      repositoryRoot,
      ...parsedArguments,
      browserVersion: browser.version(),
    }, {
      generate(input) {
        const generated = generateMonster({
          seed: input.seed,
          themeId: input.themeId,
          mode: input.mode,
        }, parsedCatalog.value)
        const diagnostics = [
          ...generated.diagnostics,
          ...validateMonsterSpecAgainstCatalog(generated.spec, parsedCatalog.value),
        ]
        return {
          spec: generated.spec,
          diagnostics,
          blocked: generated.blocked || diagnostics.some(item => item.severity === 'error'),
          strongFeatureCount: strongFeatureCount(generated.spec, parsedCatalog.value),
          strongNonFacialFeatureCount: strongNonFacialFeatureCount(generated.spec, parsedCatalog.value),
        }
      },
      async render(input, generated) {
        let rendered: {
          dataUrl: string
          diagnostics: Diagnostic[]
          compositionMetrics: CompositionMetrics | null
          connectorMetrics: ConnectorMetric[] | null
          resolvedAssetPaths: string[]
        }
        try {
          rendered = await page.evaluate(async ({ spec }) => {
            const acceptanceWindow = window as unknown as {
              renderAcceptanceMonster(
                input: unknown,
                catalogVersion: '0.4.0',
              ): Promise<{
                dataUrl: string
                diagnostics: Diagnostic[]
                compositionMetrics: CompositionMetrics | null
                connectorMetrics: ConnectorMetric[] | null
                resolvedAssetPaths: string[]
              }>
            }
            return acceptanceWindow.renderAcceptanceMonster(spec, '0.4.0')
          }, { spec: generated.spec })
        } catch (error) {
          throw new Error(`Browser render failed for ${input.seed}.`, { cause: error })
        }
        return {
          inputIndex: input.index,
          pngBytes: decodeBrowserPng(rendered.dataUrl),
          diagnostics: rendered.diagnostics,
          compositionMetrics: rendered.compositionMetrics,
          connectorMetrics: rendered.connectorMetrics,
          resolvedAssetPaths: rendered.resolvedAssetPaths,
        }
      },
    })
  } finally {
    await browser.close()
    await server.close()
  }
}

const invokedModule = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedModule === import.meta.url) {
  void runRandomGenomeBatchCommand(process.argv.slice(2), {
    runProductionBatch: runProductionRandomGenomeBatch,
    verifyExistingBatch: outputDirectory => verifyRandomGenomeBatchArtifacts(outputDirectory),
  }).then(result => {
    console.log(JSON.stringify(result))
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
