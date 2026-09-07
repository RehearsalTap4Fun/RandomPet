import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { createServer } from 'vite'
import {
  generateMonster,
  parseCatalog,
  planComposition,
  strongFeatureCount,
  strongNonFacialFeatureCount,
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type RigId,
  type ThemeId,
} from '@qmonster/generator-core'
import {
  compositionMetricsMeetThresholds,
  connectorMetricMeetsThresholds,
  structureMetricMeetsThreshold,
  type CompositionMetrics,
  type ConnectorMetric,
} from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import v03ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import v04ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.4.0/catalog.json'
import v06ProductionCatalogDocument from '../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import problemSeeds from '../tests/fixtures/v04-problem-seeds.json'
import { pruneStaleFiles } from './safe-output.js'

const ACCEPTANCE_THEMES = ['deep-sea', 'fungal', 'shadow'] as const
const ACCEPTANCE_RIGS = ['blob', 'biped', 'floating'] as const
const DEFAULT_SEED_START = 2026082101
const DEFAULT_COUNT = 20
const RENDER_SIZE = 1024
type AcceptanceCatalogVersion = '0.2.0' | '0.3.0' | '0.4.0' | '0.6.0'
type AcceptanceMode = 'normal' | 'mutation' | 'aberration'

export interface AcceptanceManifestEntry {
  index: number
  seed: string
  themeId: ThemeId
  rigId: RigId
  mode: AcceptanceMode
  filename: string
  spec: MonsterSpec
  generationDiagnostics: Diagnostic[]
  regression: boolean
  strongFeatureCount: number
  strongNonFacialFeatureCount: number
  surpriseSlots: number
  motifOpportunityCount: number
  catalogVersion: AcceptanceCatalogVersion
  archetypeId?: string
  anatomyBundleId?: string
}

export interface RenderedAcceptanceEntry extends AcceptanceManifestEntry {
  pngSha256: string
  pngBytes: number
  specSha256: string
  renderDiagnostics: Diagnostic[]
  compositionMetrics: CompositionMetrics | null
  connectorMetrics: ConnectorMetric[] | null
  structuralConnectedComponentCount?: number
  frameBounds?: CompositionMetrics['visibleBounds']
  faceRatios?: Pick<CompositionMetrics,
    | 'eyesInsideRatio'
    | 'eyesVisibleRatio'
    | 'mouthInsideRatio'
    | 'mouthVisibleRatio'
    | 'oralDetailInsideRatio'
    | 'oralDetailVisibleRatio'
  >
  surfaceOutsideAlphaCount?: number
  specialAnchorValid?: boolean
  resolvedAssetPaths: string[]
  resolvedAssets: Array<{ path: string; sha256: string }>
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function filenameFor(index: number, themeId: ThemeId, seed: string): string {
  return `${String(index).padStart(3, '0')}-${themeId}-${seed}.png`
}

export async function buildAcceptanceManifest(
  catalog: Catalog,
  seedStart = DEFAULT_SEED_START,
  count = DEFAULT_COUNT,
): Promise<AcceptanceManifestEntry[]> {
  if (!Number.isSafeInteger(seedStart) || !Number.isSafeInteger(count) || count <= 0) {
    throw new Error('Acceptance seed start and count must be positive safe integers.')
  }
  const inputs: Array<{ seed: string, themeId: ThemeId, mode: AcceptanceMode, regression: boolean }> = catalog.version === '0.6.0'
    ? Array.from({ length: count }, (_, offset) => ({
      seed: String(seedStart + offset),
      themeId: ACCEPTANCE_THEMES[Math.floor(offset / 3) % ACCEPTANCE_THEMES.length]!,
      mode: (['normal', 'mutation', 'aberration'] as const)[offset % 3]!,
      regression: false,
    }))
    : [
      ...Array.from({ length: count }, (_, offset) => ({
        seed: String(seedStart + offset),
        themeId: ACCEPTANCE_THEMES[offset % ACCEPTANCE_THEMES.length]!,
        mode: 'normal' as const,
        regression: false,
      })),
      { seed: 'qmonster-v0.1-first-hatch', themeId: 'fungal' as const, mode: 'normal' as const, regression: true },
    ]
  const entries = inputs.map(({ seed, themeId, mode, regression }, offset): AcceptanceManifestEntry => {
    const generated = generateMonster({
      seed,
      themeId,
      mode,
      ...(catalog.version === '0.6.0' ? { archetypeId: 'feline' as const } : {}),
    }, catalog)
    if (generated.blocked || generated.diagnostics.length > 0) {
      throw new Error(`Acceptance generation failed for ${seed}: ${JSON.stringify(generated.diagnostics)}`)
    }
    const rigId = generated.spec.visualSlots.bodyFrame.rigId
    const compositionPlan = planComposition(seed, themeId, rigId, catalog)
    const motifOpportunityCount = catalog.compositionPolicy?.motifSlots.length ?? 0
    const surpriseSlots = (catalog.compositionPolicy?.motifSlots ?? []).filter(slotId => {
      if (compositionPlan.motifModes[slotId] !== 'surprise') return false
      const partId = generated.spec.visualSlots[slotId].partId
      return catalog.parts.find(part => part.slotId === slotId && part.id === partId)?.composition?.isNone === false
    }).length
    return {
      index: offset + 1,
      seed,
      themeId,
      rigId,
      mode,
      filename: filenameFor(offset + 1, themeId, seed),
      spec: generated.spec,
      generationDiagnostics: generated.diagnostics,
      regression,
      strongFeatureCount: strongFeatureCount(generated.spec, catalog),
      strongNonFacialFeatureCount: strongNonFacialFeatureCount(generated.spec, catalog),
      surpriseSlots,
      motifOpportunityCount,
      catalogVersion: catalog.version as AcceptanceCatalogVersion,
      ...(catalog.version === '0.6.0' ? {
        archetypeId: generated.spec.archetypeId,
        anatomyBundleId: generated.spec.anatomyBundleId,
      } : {}),
    }
  })
  const coveredRigs = new Set(entries.map(entry => entry.rigId))
  if (catalog.version !== '0.6.0' && ACCEPTANCE_RIGS.some(rigId => !coveredRigs.has(rigId))) {
    throw new Error(`Acceptance generation did not naturally cover every rig: ${[...coveredRigs].join(', ')}`)
  }
  return entries
}

export function buildProblemSeedAcceptanceEvidence(
  catalog: Catalog,
  fixture: { sourceBatch: string, seeds: readonly string[] },
) {
  if (catalog.version !== '0.4.0' || fixture.seeds.length === 0) {
    throw new Error('Problem-seed acceptance requires the exact v0.4 catalog and at least one seed.')
  }
  let generationErrorCount = 0
  let maximumStrongFeatures = 0
  let maximumStrongNonFacialFeatures = 0
  const entries = fixture.seeds.map((seed, index) => {
    const themeId = ACCEPTANCE_THEMES[index % ACCEPTANCE_THEMES.length]!
    const first = generateMonster({ seed, themeId, mode: 'normal' }, catalog)
    const second = generateMonster({ seed, themeId, mode: 'normal' }, catalog)
    const validationErrorCount = validateMonsterSpecAgainstCatalog(first.spec, catalog)
      .filter(item => item.severity === 'error').length
    const deterministic = JSON.stringify(first) === JSON.stringify(second)
    const entryStrongFeatures = strongFeatureCount(first.spec, catalog)
    const entryStrongNonFacialFeatures = strongNonFacialFeatureCount(first.spec, catalog)
    const hasGenerationError = first.blocked
      || first.diagnostics.some(item => item.severity === 'error')
      || validationErrorCount > 0
      || !deterministic
      || first.spec.catalogVersion !== '0.4.0'
      || first.spec.rendererVersion !== '0.4.0'
    if (hasGenerationError) generationErrorCount += 1
    maximumStrongFeatures = Math.max(maximumStrongFeatures, entryStrongFeatures)
    maximumStrongNonFacialFeatures = Math.max(
      maximumStrongNonFacialFeatures,
      entryStrongNonFacialFeatures,
    )
    return {
      index: index + 1,
      seed,
      themeId,
      deterministic,
      validationErrorCount,
      strongFeatureCount: entryStrongFeatures,
      strongNonFacialFeatureCount: entryStrongNonFacialFeatures,
      specSha256: sha256(JSON.stringify(first.spec)),
    }
  })
  return {
    schemaVersion: 'qmonster-v0.4-machine-acceptance-v1',
    catalogVersion: catalog.version,
    sourceBatch: fixture.sourceBatch,
    mode: 'normal' as const,
    seedCount: fixture.seeds.length,
    generationErrorCount,
    maximumStrongFeatures,
    maximumStrongFeaturesLimit: 2,
    maximumStrongNonFacialFeatures,
    maximumStrongNonFacialFeaturesLimit: 1,
    entries,
  }
}

export function parseMachineEvidenceArguments(args: readonly string[]): { version: '0.4.0' } {
  if (
    args.length !== 3
    || args[0] !== '--write-machine-evidence'
    || args[1] !== '--version'
    || args[2] !== '0.4.0'
  ) {
    throw new Error('Machine acceptance evidence requires --write-machine-evidence --version 0.4.0.')
  }
  return { version: '0.4.0' }
}

async function writeMachineAcceptanceEvidence(args: readonly string[]): Promise<void> {
  const { version } = parseMachineEvidenceArguments(args)
  const parsedCatalog = parseCatalog(v04ProductionCatalogDocument)
  if (!parsedCatalog.ok) throw new Error(`Machine acceptance catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
  const evidence = buildProblemSeedAcceptanceEvidence(parsedCatalog.value, problemSeeds)
  if (
    evidence.generationErrorCount !== 0
    || evidence.maximumStrongFeatures > evidence.maximumStrongFeaturesLimit
    || evidence.maximumStrongNonFacialFeatures > evidence.maximumStrongNonFacialFeaturesLimit
  ) throw new Error(`Problem-seed machine acceptance failed: ${JSON.stringify(evidence)}`)
  const auditRoot = resolve(process.cwd(), 'packages', 'asset-catalog', 'audit', `v${version}`)
  await mkdir(auditRoot, { recursive: true })
  const evidencePath = resolve(auditRoot, 'task7-machine-acceptance.json')
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  await writeFile(evidencePath, serialized)
  console.log(JSON.stringify({
    evidencePath,
    evidenceSha256: sha256(serialized),
    seedCount: evidence.seedCount,
    generationErrorCount: evidence.generationErrorCount,
    maximumStrongFeatures: evidence.maximumStrongFeatures,
    maximumStrongNonFacialFeatures: evidence.maximumStrongNonFacialFeatures,
  }))
}

export function assertCompositionAcceptance(entry: Pick<RenderedAcceptanceEntry,
  | 'generationDiagnostics'
  | 'strongFeatureCount'
  | 'strongNonFacialFeatureCount'
  | 'surpriseSlots'
  | 'motifOpportunityCount'
  | 'compositionMetrics'
  | 'renderDiagnostics'
  | 'catalogVersion'
  | 'archetypeId'
  | 'anatomyBundleId'
  | 'structuralConnectedComponentCount'
  | 'frameBounds'
  | 'faceRatios'
  | 'surfaceOutsideAlphaCount'
  | 'specialAnchorValid'
  | 'connectorMetrics'
  | 'resolvedAssetPaths'
  | 'spec'
> & { catalog: Catalog }): void {
  const metrics = entry.compositionMetrics
  const compositionPolicy = entry.catalog.compositionPolicy!
  const requiresInterfaceEvidence = entry.catalogVersion === '0.3.0' || entry.catalogVersion === '0.4.0'
  const isV06BundleAcceptance = entry.catalogVersion === '0.6.0'
  const connectorMetricsAccepted = isV06BundleAcceptance
    ? entry.connectorMetrics !== null && entry.connectorMetrics.length === 0
    : !requiresInterfaceEvidence || (
    entry.connectorMetrics !== null
    && entry.connectorMetrics.length > 0
    && entry.connectorMetrics.every(metric => (
      connectorMetricMeetsThresholds(metric, /^(shoulder|hip)/u.test(metric.connectorId))
      && structureMetricMeetsThreshold(metric)
    ))
  )
  const oralDetailPart = entry.catalog.parts.find(part => (
    part.slotId === 'oralDetail'
    && part.id === entry.spec.visualSlots.oralDetail.partId
  ))
  const oralMetricsHaveResolvedContext = metrics !== null && oralDetailPart !== undefined && (
    metrics.oralDetailInsideRatio !== null && metrics.oralDetailVisibleRatio !== null
    || metrics.oralDetailInsideRatio === null
      && metrics.oralDetailVisibleRatio === null
      && oralDetailPart?.composition?.isNone === true
  )
  const exactContext = entry.catalog.version === entry.catalogVersion
    && entry.spec.catalogVersion === entry.catalogVersion
    && entry.spec.rendererVersion === entry.catalogVersion
  const exactAssetPrefix = `assets/v${entry.catalogVersion}/`
  const anatomyBundleAccepted = !isV06BundleAcceptance || (
    entry.archetypeId === 'feline'
    && entry.anatomyBundleId !== undefined
    && entry.spec.anatomyBundleId === entry.anatomyBundleId
    && entry.spec.archetypeId === entry.archetypeId
    && entry.catalog.anatomyBundles?.some(bundle => bundle.id === entry.anatomyBundleId) === true
  )
  const anatomyMetricsAccepted = !isV06BundleAcceptance || (
    entry.structuralConnectedComponentCount === 1
    && entry.frameBounds !== undefined
    && entry.faceRatios !== undefined
    && entry.faceRatios.eyesInsideRatio === metrics?.eyesInsideRatio
    && entry.faceRatios.eyesVisibleRatio === metrics?.eyesVisibleRatio
    && entry.faceRatios.mouthInsideRatio === metrics?.mouthInsideRatio
    && entry.faceRatios.mouthVisibleRatio === metrics?.mouthVisibleRatio
    && entry.faceRatios.oralDetailInsideRatio === metrics?.oralDetailInsideRatio
    && entry.faceRatios.oralDetailVisibleRatio === metrics?.oralDetailVisibleRatio
    && JSON.stringify(entry.frameBounds) === JSON.stringify(metrics?.visibleBounds ?? null)
    && entry.surfaceOutsideAlphaCount === 0
    && entry.specialAnchorValid === true
  )
  const accepted = entry.generationDiagnostics.length === 0
    && entry.strongFeatureCount <= 2
    && entry.strongNonFacialFeatureCount <= 1
    && entry.surpriseSlots <= Math.floor(entry.motifOpportunityCount * 0.3)
    && metrics !== null
    && oralMetricsHaveResolvedContext
    && compositionMetricsMeetThresholds(metrics, compositionPolicy)
    && connectorMetricsAccepted
    && anatomyBundleAccepted
    && anatomyMetricsAccepted
    && exactContext
    && (!(requiresInterfaceEvidence || isV06BundleAcceptance) || (
      entry.resolvedAssetPaths.length > 0
      && entry.resolvedAssetPaths.every(path => path.startsWith(exactAssetPrefix))
    ))
    && entry.renderDiagnostics.length === 0
  if (!accepted) {
    throw new Error(`composition acceptance failed: ${JSON.stringify(entry)}`)
  }
}

export function parseAcceptanceArguments(args: readonly string[]): {
  seedStart: number
  count: number
  catalogVersion: AcceptanceCatalogVersion
  outputDirectory?: string
} {
  let seedStart = DEFAULT_SEED_START
  let count = DEFAULT_COUNT
  let catalogVersion: AcceptanceCatalogVersion = '0.3.0'
  let outputDirectory: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const rawValue = args[index + 1]
    if ((flag !== '--seed-start' && flag !== '--count' && flag !== '--catalog-version' && flag !== '--version' && flag !== '--output-directory') || rawValue === undefined) {
      throw new Error(`Unknown or incomplete acceptance argument: ${flag ?? ''}`)
    }
    if (flag === '--output-directory') {
      outputDirectory = rawValue
      index += 1
      continue
    }
    if (flag === '--catalog-version' || flag === '--version') {
      if (rawValue !== '0.2.0' && rawValue !== '0.3.0' && rawValue !== '0.4.0' && rawValue !== '0.6.0') {
        throw new Error(`${flag} must be exactly 0.2.0, 0.3.0, 0.4.0, or 0.6.0.`)
      }
      catalogVersion = rawValue
      index += 1
      continue
    }
    const value = Number(rawValue)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} must be a positive safe integer.`)
    if (flag === '--seed-start') seedStart = value
    if (flag === '--count') count = value
    index += 1
  }
  return {
    seedStart,
    count,
    catalogVersion,
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
  }
}

function catalogDocument(version: AcceptanceCatalogVersion): unknown {
  if (version === '0.6.0') return v06ProductionCatalogDocument
  if (version === '0.4.0') return v04ProductionCatalogDocument
  return version === '0.3.0' ? v03ProductionCatalogDocument : productionCatalogDocument
}

function outputDirectoryFor(version: AcceptanceCatalogVersion): string {
  return `artifacts/acceptance/v${version.split('.').slice(0, 2).join('.')}`
}

export function resolveAcceptanceOutputDirectory(
  repositoryRoot: string,
  catalogVersion: AcceptanceCatalogVersion,
  requested?: string,
): { relativePath: string, absolutePath: string } {
  const relativePath = requested ?? outputDirectoryFor(catalogVersion)
  const acceptanceRoot = resolve(repositoryRoot, 'artifacts', 'acceptance')
  const absolutePath = resolve(repositoryRoot, relativePath)
  const relation = relative(acceptanceRoot, absolutePath)
  const escapesRoot = relation === '..'
    || relation.startsWith(`..${sep}`)
    || isAbsolute(relation)
  if (
    requested !== undefined && isAbsolute(requested)
    || relation === ''
    || escapesRoot
  ) {
    throw new Error('Acceptance output directory must be a relative child of artifacts/acceptance/.')
  }
  return {
    relativePath: relative(repositoryRoot, absolutePath).replaceAll('\\', '/'),
    absolutePath,
  }
}

function runtimeAssetPath(
  repositoryRoot: string,
  catalogVersion: AcceptanceCatalogVersion,
  assetPath: string,
): string {
  const versionPrefix = `assets/v${catalogVersion}/`
  const relativeAssetPath = assetPath.startsWith(versionPrefix)
    ? assetPath.slice(versionPrefix.length)
    : assetPath
  const assetRoot = resolve(repositoryRoot, 'packages', 'asset-catalog', 'assets', `v${catalogVersion}`)
  const candidate = resolve(assetRoot, relativeAssetPath)
  const relation = relative(assetRoot, candidate)
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`Acceptance asset path escapes v${catalogVersion}: ${assetPath}`)
  }
  return candidate
}

function decodePng(dataUrl: string): Buffer {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) throw new Error('Acceptance renderer did not return a PNG data URL.')
  const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!pngSignature.every((value, index) => bytes[index] === value)) {
    throw new Error('Acceptance renderer returned invalid PNG bytes.')
  }
  return bytes
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

async function assembleContactSheet(
  entries: readonly RenderedAcceptanceEntry[],
  outputDirectory: string,
): Promise<{ path: string; sha256: string; width: number; height: number }> {
  const columns = 5
  const rows = Math.ceil(entries.length / columns)
  const cellWidth = 260
  const cellHeight = 316
  const artSize = 256
  const width = columns * cellWidth
  const height = rows * cellHeight
  const composites: sharp.OverlayOptions[] = []
  for (const [offset, entry] of entries.entries()) {
    const left = (offset % columns) * cellWidth
    const top = Math.floor(offset / columns) * cellHeight
    const image = await sharp(join(outputDirectory, entry.filename))
      .resize(artSize, artSize, { fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${artSize}" height="56">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="8" y="21" font-family="Segoe UI, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeXml(`${String(entry.index).padStart(3, '0')} · ${entry.themeId}`)}</text>
      <text x="8" y="41" font-family="Segoe UI, sans-serif" font-size="12" fill="#b8c4d6">${escapeXml(`${entry.seed} · ${entry.rigId}`)}</text>
      <text x="8" y="54" font-family="Segoe UI, sans-serif" font-size="11" fill="#7dd3fc">${escapeXml(`strong ${entry.strongFeatureCount} · surprise ${entry.surpriseSlots}`)}</text>
    </svg>`)
    composites.push({ input: image, left: left + 2, top: top + 2 })
    composites.push({ input: label, left: left + 2, top: top + artSize + 2 })
  }
  const outputPath = join(outputDirectory, 'contact-sheet.png')
  await sharp({ create: { width, height, channels: 4, background: '#202938ff' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(outputPath)
  const bytes = await readFile(outputPath)
  return { path: outputPath, sha256: sha256(bytes), width, height }
}

export async function generateAcceptanceSet(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--write-machine-evidence')) {
    await writeMachineAcceptanceEvidence(args)
    return
  }
  const repositoryRoot = process.cwd()
  const { seedStart, count, catalogVersion, outputDirectory: requestedOutputDirectory } = parseAcceptanceArguments(args)
  const parsedCatalog = parseCatalog(catalogDocument(catalogVersion))
  if (!parsedCatalog.ok) {
    throw new Error(`Production catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
  }
  const entries = await buildAcceptanceManifest(parsedCatalog.value, seedStart, count)
  const { relativePath: outputDirectoryName, absolutePath: outputDirectory } = resolveAcceptanceOutputDirectory(
    repositoryRoot,
    catalogVersion,
    requestedOutputDirectory,
  )
  await mkdir(outputDirectory, { recursive: true })
  const expectedFiles = new Set([
    ...entries.map(entry => `${outputDirectoryName}/${entry.filename}`),
    `${outputDirectoryName}/acceptance-set.json`,
    `${outputDirectoryName}/contact-sheet.png`,
  ])
  await pruneStaleFiles({
    root: repositoryRoot,
    directory: outputDirectoryName,
    expected: expectedFiles,
    extensions: new Set(['.json', '.png']),
  })

  const server = await createServer({
    root: join(repositoryRoot, 'apps', 'creator-web'),
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) {
    await server.close()
    throw new Error('Vite did not expose an acceptance renderer URL.')
  }

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: RENDER_SIZE, height: RENDER_SIZE },
      deviceScaleFactor: 1,
    })
    await page.goto(`${baseUrl}acceptance-render.html`)
    await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
    const renderedEntries: RenderedAcceptanceEntry[] = []
    for (const entry of entries) {
      let rendered: Awaited<ReturnType<Window['renderAcceptanceMonster']>>
      try {
        rendered = await page.evaluate(async ({ spec, catalogVersion: exactVersion }) => (
          window.renderAcceptanceMonster(spec, exactVersion)
        ), { spec: entry.spec, catalogVersion })
      } catch (error) {
        throw new Error(`Acceptance render failed for ${entry.seed}.`, { cause: error })
      }
      const bytes = decodePng(rendered.dataUrl)
      const outputPath = join(outputDirectory, entry.filename)
      await writeFile(outputPath, bytes)
      const serializedSpec = JSON.stringify(entry.spec)
      const resolvedAssetPaths = [...new Set(rendered.resolvedAssetPaths)].sort()
      const resolvedAssets = await Promise.all(resolvedAssetPaths.map(async assetPath => ({
        path: assetPath,
        sha256: sha256(await readFile(runtimeAssetPath(repositoryRoot, catalogVersion, assetPath))),
      })))
      const renderedEntry: RenderedAcceptanceEntry = {
        ...entry,
        pngSha256: sha256(bytes),
        pngBytes: bytes.byteLength,
        specSha256: sha256(serializedSpec),
        renderDiagnostics: rendered.diagnostics,
        compositionMetrics: rendered.compositionMetrics,
        connectorMetrics: rendered.connectorMetrics,
        ...(rendered.anatomyAcceptance === undefined ? {} : rendered.anatomyAcceptance),
        resolvedAssetPaths,
        resolvedAssets,
      }
      assertCompositionAcceptance({ ...renderedEntry, catalog: parsedCatalog.value })
      renderedEntries.push(renderedEntry)
    }
    const contactSheet = await assembleContactSheet(renderedEntries, outputDirectory)
    const manifest = {
      manifestVersion: `qmonster-v${catalogVersion.split('.').slice(0, 2).join('.')}-acceptance-v1`,
      catalogVersion: parsedCatalog.value.version,
      schemaVersion: renderedEntries[0]?.spec.schemaVersion,
      rendererVersion: renderedEntries[0]?.spec.rendererVersion,
      rendererPath: 'product PreviewCanvas -> @qmonster/renderer-canvas -> browser canvas PNG',
      browser: { name: 'bundled-chromium', version: browser.version() },
      render: { width: RENDER_SIZE, height: RENDER_SIZE, transparent: true },
      seedStart,
      count: renderedEntries.length,
      fixedSeedCount: count,
      themes: ACCEPTANCE_THEMES,
      rigs: ACCEPTANCE_RIGS,
      contactSheet: {
        filename: basename(contactSheet.path),
        sha256: contactSheet.sha256,
        width: contactSheet.width,
        height: contactSheet.height,
      },
      entries: renderedEntries,
    }
    const manifestPath = join(outputDirectory, 'acceptance-set.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(JSON.stringify({
      manifestPath,
      manifestSha256: sha256(await readFile(manifestPath)),
      contactSheetPath: contactSheet.path,
      contactSheetSha256: contactSheet.sha256,
      browserVersion: browser.version(),
      entries: renderedEntries.map(entry => ({
        index: entry.index,
        seed: entry.seed,
        themeId: entry.themeId,
        rigId: entry.rigId,
        filename: entry.filename,
        pngSha256: entry.pngSha256,
        specSha256: entry.specSha256,
      })),
    }))
  } finally {
    await browser.close()
    await server.close()
  }
}

const invokedModule = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedModule === import.meta.url) {
  void generateAcceptanceSet().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
