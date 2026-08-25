import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { createServer } from 'vite'
import {
  generateMonster,
  parseCatalog,
  planComposition,
  strongFeatureCount,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type RigId,
  type ThemeId,
} from '@qmonster/generator-core'
import type { CompositionMetrics } from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import { pruneStaleFiles } from './safe-output.js'

const ACCEPTANCE_THEMES = ['deep-sea', 'fungal', 'shadow'] as const
const ACCEPTANCE_RIGS = ['blob', 'biped', 'floating'] as const
const DEFAULT_SEED_START = 2026082101
const DEFAULT_COUNT = 20
const OUTPUT_DIRECTORY = 'artifacts/acceptance/v0.2'
const RENDER_SIZE = 1024

export interface AcceptanceManifestEntry {
  index: number
  seed: string
  themeId: ThemeId
  rigId: RigId
  filename: string
  spec: MonsterSpec
  generationDiagnostics: Diagnostic[]
  regression: boolean
  strongFeatureCount: number
  surpriseSlots: number
  motifOpportunityCount: number
}

export interface RenderedAcceptanceEntry extends AcceptanceManifestEntry {
  pngSha256: string
  pngBytes: number
  specSha256: string
  renderDiagnostics: Diagnostic[]
  compositionMetrics: CompositionMetrics | null
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
  const inputs = [
    ...Array.from({ length: count }, (_, offset) => ({
      seed: String(seedStart + offset),
      themeId: ACCEPTANCE_THEMES[offset % ACCEPTANCE_THEMES.length]!,
      regression: false,
    })),
    { seed: 'qmonster-v0.1-first-hatch', themeId: 'fungal' as const, regression: true },
  ]
  const entries = inputs.map(({ seed, themeId, regression }, offset): AcceptanceManifestEntry => {
    const generated = generateMonster({ seed, themeId, mode: 'normal' }, catalog)
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
      filename: filenameFor(offset + 1, themeId, seed),
      spec: generated.spec,
      generationDiagnostics: generated.diagnostics,
      regression,
      strongFeatureCount: strongFeatureCount(generated.spec, catalog),
      surpriseSlots,
      motifOpportunityCount,
    }
  })
  const coveredRigs = new Set(entries.map(entry => entry.rigId))
  if (ACCEPTANCE_RIGS.some(rigId => !coveredRigs.has(rigId))) {
    throw new Error(`Acceptance generation did not naturally cover every rig: ${[...coveredRigs].join(', ')}`)
  }
  return entries
}

export function assertCompositionAcceptance(entry: Pick<RenderedAcceptanceEntry,
  | 'generationDiagnostics'
  | 'strongFeatureCount'
  | 'surpriseSlots'
  | 'motifOpportunityCount'
  | 'compositionMetrics'
  | 'renderDiagnostics'
>): void {
  const metrics = entry.compositionMetrics
  const accepted = entry.generationDiagnostics.length === 0
    && entry.strongFeatureCount <= 2
    && entry.surpriseSlots <= Math.floor(entry.motifOpportunityCount * 0.3)
    && metrics !== null
    && metrics.eyesInsideRatio >= 0.8
    && metrics.eyesVisibleRatio >= 0.85
    && metrics.mouthInsideRatio >= 0.8
    && metrics.mouthVisibleRatio >= 0.85
    && entry.renderDiagnostics.length === 0
  if (!accepted) {
    throw new Error(`composition acceptance failed: ${JSON.stringify(entry)}`)
  }
}

function parseArguments(args: readonly string[]): { seedStart: number; count: number } {
  let seedStart = DEFAULT_SEED_START
  let count = DEFAULT_COUNT
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const rawValue = args[index + 1]
    if ((flag !== '--seed-start' && flag !== '--count') || rawValue === undefined) {
      throw new Error(`Unknown or incomplete acceptance argument: ${flag ?? ''}`)
    }
    const value = Number(rawValue)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} must be a positive safe integer.`)
    if (flag === '--seed-start') seedStart = value
    if (flag === '--count') count = value
    index += 1
  }
  return { seedStart, count }
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
  const repositoryRoot = process.cwd()
  const { seedStart, count } = parseArguments(args)
  const parsedCatalog = parseCatalog(productionCatalogDocument)
  if (!parsedCatalog.ok) {
    throw new Error(`Production catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
  }
  const entries = await buildAcceptanceManifest(parsedCatalog.value, seedStart, count)
  const outputDirectory = resolve(repositoryRoot, OUTPUT_DIRECTORY)
  await mkdir(outputDirectory, { recursive: true })
  const expectedFiles = new Set([
    ...entries.map(entry => `${OUTPUT_DIRECTORY}/${entry.filename}`),
    `${OUTPUT_DIRECTORY}/acceptance-set.json`,
    `${OUTPUT_DIRECTORY}/contact-sheet.png`,
  ])
  await pruneStaleFiles({
    root: repositoryRoot,
    directory: OUTPUT_DIRECTORY,
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
        rendered = await page.evaluate(async spec => window.renderAcceptanceMonster(spec), entry.spec)
      } catch (error) {
        throw new Error(`Acceptance render failed for ${entry.seed}.`, { cause: error })
      }
      const bytes = decodePng(rendered.dataUrl)
      const outputPath = join(outputDirectory, entry.filename)
      await writeFile(outputPath, bytes)
      const serializedSpec = JSON.stringify(entry.spec)
      const renderedEntry: RenderedAcceptanceEntry = {
        ...entry,
        pngSha256: sha256(bytes),
        pngBytes: bytes.byteLength,
        specSha256: sha256(serializedSpec),
        renderDiagnostics: rendered.diagnostics,
        compositionMetrics: rendered.compositionMetrics,
      }
      assertCompositionAcceptance(renderedEntry)
      renderedEntries.push(renderedEntry)
    }
    const contactSheet = await assembleContactSheet(renderedEntries, outputDirectory)
    const manifest = {
      manifestVersion: 'qmonster-v0.2-acceptance-v1',
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
