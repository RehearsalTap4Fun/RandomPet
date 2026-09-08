import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Catalog, Diagnostic, MonsterSpec, ThemeId } from '@qmonster/generator-core'
import type { CompositionMetrics, ConnectorMetric } from '@qmonster/renderer-canvas'
import { buildV08ContactSheet } from './v08-contact-sheet.js'

const REVIEW_COUNT = 10
const REVIEW_SEED = 'qmonster-v08-review'
const REVIEW_OUTPUT = 'artifacts/acceptance/v0.8.0-feline'
const THEMES = ['deep-sea', 'fungal', 'shadow'] as const satisfies readonly ThemeId[]

export interface V08ReviewInput {
  index: number
  seed: string
  themeId: ThemeId
  mode: 'normal'
}

interface IdentifiedRender {
  inputIndex: number
}

export interface V08OneShotOperations<TGenerated, TRendered extends IdentifiedRender> {
  generate(input: V08ReviewInput): TGenerated | Promise<TGenerated>
  render(input: V08ReviewInput, generated: TGenerated): TRendered | undefined | Promise<TRendered | undefined>
}

interface GeneratedEntry {
  spec: MonsterSpec
  diagnostics: Diagnostic[]
  blocked: boolean
  partRarities: Record<string, string>
}

interface AnatomyAcceptance {
  anatomyBundleId: string
  archetypeId: string
  structuralConnectedComponentCount: number
  frameBounds: CompositionMetrics['visibleBounds']
  faceRatios: Omit<CompositionMetrics, 'visibleBounds'> | null
  surfaceOutsideAlphaCount: number
  specialAnchorValid: boolean
}

interface RenderedEntry extends IdentifiedRender {
  pngBytes: Buffer
  diagnostics: Diagnostic[]
  compositionMetrics: CompositionMetrics | null
  connectorMetrics: ConnectorMetric[] | null
  anatomyAcceptance?: AnatomyAcceptance
  resolvedAssetPaths: string[]
}

export function buildV08ReviewInputs(batchSeed: string, count: number): V08ReviewInput[] {
  if (!/\S/u.test(batchSeed)) throw new Error('Batch seed must not be empty.')
  if (count !== REVIEW_COUNT) {
    throw new Error(`The v0.8 user-review batch must contain exactly ${REVIEW_COUNT} entries.`)
  }
  return Array.from({ length: REVIEW_COUNT }, (_, offset) => ({
    index: offset + 1,
    seed: `${batchSeed}-${String(offset + 1).padStart(3, '0')}`,
    themeId: THEMES[offset % THEMES.length]!,
    mode: 'normal' as const,
  }))
}

export function parseV08ReviewBatchArguments(args: readonly string[]): {
  catalogVersion: '0.8.0'
  batchSeed: typeof REVIEW_SEED
  count: 10
  outputDirectory: typeof REVIEW_OUTPUT
} {
  const allowedFlags = new Set(['--catalog-version', '--seed', '--count', '--output-directory'])
  const values = new Map<string, string>()
  for (let offset = 0; offset < args.length; offset += 2) {
    const flag = args[offset]
    const value = args[offset + 1]
    if (flag === undefined || !allowedFlags.has(flag) || value === undefined || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete v0.8 batch argument: ${flag ?? ''}`)
    }
    if (values.has(flag)) throw new Error(`Duplicate v0.8 batch argument: ${flag}`)
    values.set(flag, value)
  }
  if (values.size !== allowedFlags.size) {
    throw new Error('V0.8 batch requires --catalog-version, --seed, --count, and --output-directory.')
  }
  if (values.get('--catalog-version') !== '0.8.0') {
    throw new Error('V0.8 batch requires exact catalog version 0.8.0.')
  }
  if (values.get('--seed') !== REVIEW_SEED) {
    throw new Error(`V0.8 batch requires exact seed ${REVIEW_SEED}.`)
  }
  if (Number(values.get('--count')) !== REVIEW_COUNT) {
    throw new Error(`The v0.8 user-review batch must contain exactly ${REVIEW_COUNT} entries.`)
  }
  if (values.get('--output-directory') !== REVIEW_OUTPUT) {
    throw new Error(`V0.8 batch requires exact output directory ${REVIEW_OUTPUT}.`)
  }
  return {
    catalogVersion: '0.8.0',
    batchSeed: REVIEW_SEED,
    count: 10,
    outputDirectory: REVIEW_OUTPUT,
  }
}

export async function mapV08ReviewInputsOneShot<
  TGenerated,
  TRendered extends IdentifiedRender,
>(
  inputs: readonly V08ReviewInput[],
  operations: V08OneShotOperations<TGenerated, TRendered>,
): Promise<Array<{ input: V08ReviewInput, generated: TGenerated, rendered: TRendered }>> {
  const identities = new Set<number>()
  const outputs: Array<{ input: V08ReviewInput, generated: TGenerated, rendered: TRendered }> = []
  for (const input of inputs) {
    const generated = await operations.generate(input)
    const rendered = await operations.render(input, generated)
    if (rendered === undefined) throw new Error(`V0.8 batch input ${input.index} has a missing render.`)
    if (rendered.inputIndex !== input.index) {
      throw new Error(`V0.8 batch input ${input.index} produced render identity ${rendered.inputIndex}.`)
    }
    if (identities.has(rendered.inputIndex)) {
      throw new Error(`V0.8 batch input ${input.index} produced a duplicate render identity.`)
    }
    identities.add(rendered.inputIndex)
    outputs.push({ input, generated, rendered })
  }
  if (outputs.length !== inputs.length) throw new Error('V0.8 batch did not render every input exactly once.')
  return outputs
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function errorDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(item => item.severity === 'error')
}

function resolveOutputDirectory(repositoryRoot: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error('Batch output directory must be repository-relative.')
  const acceptanceRoot = resolve(repositoryRoot, 'artifacts', 'acceptance')
  const outputDirectory = resolve(repositoryRoot, requested)
  const relation = relative(acceptanceRoot, outputDirectory)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('Batch output directory must be a child of artifacts/acceptance/.')
  }
  return outputDirectory
}

function resolveRuntimeAsset(repositoryRoot: string, assetPath: string): string {
  const versionPrefix = 'assets/v0.8.0/'
  const relativeAssetPath = assetPath.startsWith(versionPrefix)
    ? assetPath.slice(versionPrefix.length)
    : assetPath
  const assetRoot = resolve(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.8.0')
  const candidate = resolve(assetRoot, relativeAssetPath)
  const relation = relative(assetRoot, candidate)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Resolved asset escapes the v0.8.0 asset root: ${assetPath}`)
  }
  return candidate
}

function decodePng(dataUrl: string): Buffer {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) throw new Error('Browser renderer did not return a PNG data URL.')
  return Buffer.from(dataUrl.slice(prefix.length), 'base64')
}

function assertGenerated(input: V08ReviewInput, generated: GeneratedEntry): void {
  const errors = errorDiagnostics(generated.diagnostics)
  const { spec } = generated
  if (generated.blocked || errors.length > 0) {
    throw new Error(`Generation failed for ${input.seed}: ${JSON.stringify(errors)}`)
  }
  if (
    spec.schemaVersion !== '0.3.0'
    || spec.catalogVersion !== '0.8.0'
    || spec.rendererVersion !== '0.8.0'
    || spec.seed !== input.seed
    || spec.themeId !== input.themeId
    || spec.archetypeId !== 'feline'
    || spec.anatomyBundleId !== 'feline-sit-canonical-v1'
    || spec.speciesRigId !== 'feline-sit-v1'
  ) {
    throw new Error(`Generation returned an invalid v0.8 identity tuple for ${input.seed}.`)
  }
}

function assertRendered(input: V08ReviewInput, rendered: RenderedEntry): void {
  const errors = errorDiagnostics(rendered.diagnostics)
  if (errors.length > 0) throw new Error(`Render failed for ${input.seed}: ${JSON.stringify(errors)}`)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!signature.every((value, index) => rendered.pngBytes[index] === value)) {
    throw new Error(`Renderer returned invalid PNG bytes for ${input.seed}.`)
  }
  if (rendered.connectorMetrics === null || rendered.connectorMetrics.length !== 0) {
    throw new Error(`V0.8 render unexpectedly used connector metrics for ${input.seed}.`)
  }
  if (rendered.resolvedAssetPaths.length === 0) {
    throw new Error(`Renderer resolved no production assets for ${input.seed}.`)
  }
}

function raritySummary(rarities: Record<string, string>): string {
  const counts = { N: 0, R: 0, L: 0 }
  for (const rarity of Object.values(rarities)) {
    if (rarity === 'L') counts.L += 1
    else if (rarity === 'R') counts.R += 1
    else counts.N += 1
  }
  return `N ${counts.N} · R ${counts.R} · L ${counts.L}`
}

export async function generateV08UserReviewBatch(options: {
  repositoryRoot: string
  outputDirectory: string
  browserVersion: string
  catalog: Catalog
  generate(input: V08ReviewInput): GeneratedEntry
  render(input: V08ReviewInput, generated: GeneratedEntry): Promise<RenderedEntry>
}): Promise<{ outputDirectory: string, manifestSha256: string, contactSheetSha256: string, count: number }> {
  const outputDirectory = resolveOutputDirectory(options.repositoryRoot, options.outputDirectory)
  try {
    await stat(outputDirectory)
    throw new Error(`Batch output directory already exists: ${options.outputDirectory}`)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }

  const inputs = buildV08ReviewInputs(REVIEW_SEED, REVIEW_COUNT)
  const outputs = await mapV08ReviewInputsOneShot(inputs, {
    generate(input) {
      const generated = options.generate(input)
      assertGenerated(input, generated)
      return generated
    },
    async render(input, generated) {
      const rendered = await options.render(input, generated)
      assertRendered(input, rendered)
      return rendered
    },
  })
  const contactSheet = await buildV08ContactSheet(outputs.map(({ input, generated, rendered }) => ({
    index: input.index,
    seed: input.seed,
    themeId: input.themeId,
    pngBytes: rendered.pngBytes,
    raritySummary: raritySummary(generated.partRarities),
  })))

  const entries = await Promise.all(outputs.map(async ({ input, generated, rendered }) => {
    const pngFilename = `${String(input.index).padStart(3, '0')}.png`
    const specFilename = `${String(input.index).padStart(3, '0')}.json`
    const specBytes = Buffer.from(`${JSON.stringify(generated.spec, null, 2)}\n`)
    const resolvedAssetPaths = [...new Set(rendered.resolvedAssetPaths)].sort()
    const resolvedAssets = await Promise.all(resolvedAssetPaths.map(async assetPath => ({
      path: assetPath,
      sha256: sha256(await readFile(resolveRuntimeAsset(options.repositoryRoot, assetPath))),
    })))
    return {
      index: input.index,
      seed: input.seed,
      themeId: input.themeId,
      mode: input.mode,
      schemaVersion: generated.spec.schemaVersion,
      catalogVersion: generated.spec.catalogVersion,
      rendererVersion: generated.spec.rendererVersion,
      archetypeId: generated.spec.archetypeId,
      anatomyBundleId: generated.spec.anatomyBundleId,
      speciesRigId: generated.spec.speciesRigId,
      spec: generated.spec,
      partRarities: generated.partRarities,
      pngFilename,
      specFilename,
      pngSha256: sha256(rendered.pngBytes),
      specSha256: sha256(specBytes),
      resolvedAssets,
      compositionMetrics: rendered.compositionMetrics,
      connectorMetrics: rendered.connectorMetrics,
      anatomyAcceptance: rendered.anatomyAcceptance,
      pngBytes: rendered.pngBytes,
      specBytes,
    }
  }))
  const manifest = {
    manifestVersion: 'qmonster-v08-feline-user-review-v1',
    batchSeed: REVIEW_SEED,
    count: REVIEW_COUNT,
    schemaVersion: '0.3.0',
    catalogVersion: '0.8.0',
    rendererVersion: '0.8.0',
    anatomyBundleId: 'feline-sit-canonical-v1',
    speciesRigId: 'feline-sit-v1',
    generationPolicy: {
      generateMonsterCallsPerInput: 1,
      browserRenderCallsPerInput: 1,
      retryCount: 0,
      replacementSeedCount: 0,
      visualPreferenceRegenerationCount: 0,
    },
    review: { decision: 'pending_user_review', userApproved: false },
    browserVersion: options.browserVersion,
    contactSheet: {
      filename: 'contact-sheet.png',
      width: contactSheet.width,
      height: contactSheet.height,
      sha256: sha256(contactSheet.bytes),
    },
    entries: entries.map(({ pngBytes: _pngBytes, specBytes: _specBytes, ...entry }) => entry),
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)

  await mkdir(dirname(outputDirectory), { recursive: true })
  await mkdir(outputDirectory)
  for (const entry of entries) {
    await writeFile(resolve(outputDirectory, entry.pngFilename), entry.pngBytes)
    await writeFile(resolve(outputDirectory, entry.specFilename), entry.specBytes)
  }
  await writeFile(resolve(outputDirectory, 'contact-sheet.png'), contactSheet.bytes)
  await writeFile(resolve(outputDirectory, 'batch-manifest.json'), manifestBytes)
  return {
    outputDirectory,
    manifestSha256: sha256(manifestBytes),
    contactSheetSha256: manifest.contactSheet.sha256,
    count: entries.length,
  }
}

async function runProduction(args: readonly string[]): Promise<Awaited<ReturnType<typeof generateV08UserReviewBatch>>> {
  const parsedArguments = parseV08ReviewBatchArguments(args)
  const repositoryRoot = process.cwd()
  const catalogDocument = JSON.parse(await readFile(
    resolve(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.8.0', 'catalog.json'),
    'utf8',
  )) as unknown
  const { generateMonster, parseCatalog, validateMonsterSpecAgainstCatalog } = await import('@qmonster/generator-core')
  const parsedCatalog = parseCatalog(catalogDocument)
  if (!parsedCatalog.ok) throw new Error(`Production v0.8.0 catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)

  const [{ chromium }, { createServer }] = await Promise.all([
    import('@playwright/test'),
    import('vite'),
  ])
  const server = await createServer({
    root: resolve(repositoryRoot, 'apps', 'creator-web'),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) {
    await server.close()
    throw new Error('Vite did not expose a local v0.8 batch-renderer URL.')
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
    await page.goto(`${baseUrl}acceptance-render.html`)
    await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
    return await generateV08UserReviewBatch({
      repositoryRoot,
      outputDirectory: parsedArguments.outputDirectory,
      browserVersion: browser.version(),
      catalog: parsedCatalog.value,
      generate(input) {
        const generated = generateMonster({
          seed: input.seed,
          themeId: input.themeId,
          mode: input.mode,
          archetypeId: 'feline',
        }, parsedCatalog.value)
        const diagnostics = [
          ...generated.diagnostics,
          ...validateMonsterSpecAgainstCatalog(generated.spec, parsedCatalog.value),
        ]
        const partRarities = Object.fromEntries(Object.entries(generated.spec.visualSlots).map(([slotId, selection]) => {
          const part = parsedCatalog.value.parts.find(candidate => candidate.id === selection.partId)
          if (part === undefined) throw new Error(`Generated part is missing from catalog: ${selection.partId}`)
          return [slotId, part.rarity]
        }))
        return { spec: generated.spec, diagnostics, blocked: generated.blocked, partRarities }
      },
      async render(input, generated) {
        const rendered = await page.evaluate(async spec => {
          return window.renderAcceptanceMonster(spec, '0.8.0')
        }, generated.spec)
        return {
          inputIndex: input.index,
          pngBytes: decodePng(rendered.dataUrl),
          diagnostics: rendered.diagnostics,
          compositionMetrics: rendered.compositionMetrics,
          connectorMetrics: rendered.connectorMetrics,
          anatomyAcceptance: rendered.anatomyAcceptance,
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
  void runProduction(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result))
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
