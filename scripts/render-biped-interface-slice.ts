import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import type { Catalog, MonsterSpec, SemanticSlotId, VisualSlotId } from '@qmonster/generator-core'
import type { CompositionMetrics, ConnectorMetric } from '@qmonster/renderer-canvas'
import sharp from 'sharp'
import { createServer, type InlineConfig } from 'vite'

export const BIPED_SLICE_OPTIONS = {
  bodyFrame: ['body_biped_peanut', 'body_biped_tall'],
  headShape: ['head_mushroom_cap', 'head_round_dome'],
  arms: ['arms_short_plush', 'arms_long_noodle'],
  legs: ['legs_webbed', 'legs_mushroom'],
} as const

export const BIPED_SLICE_COLUMNS = 4
export const BIPED_SLICE_ENTRY_COUNT = Object.values(BIPED_SLICE_OPTIONS)
  .reduce((count, options) => count * options.length, 1)
export const BIPED_SLICE_ROWS = Math.ceil(BIPED_SLICE_ENTRY_COUNT / BIPED_SLICE_COLUMNS)

export interface BipedSliceCatalog {
  catalogVersion: '0.3.0'
  rendererVersion: '0.3.0'
  options: typeof BIPED_SLICE_OPTIONS
}

export interface BipedSliceEntry {
  index: number
  structuralKey: string
  selections: {
    bodyFrame: string
    headShape: string
    arms: string
    legs: string
  }
  originalPngPath: string
  review256PngPath: string
  diagnostics: Array<{ severity: string, code: string, path: string[], message: string }>
  connectorMetrics: ConnectorMetric[]
  compositionMetrics: CompositionMetrics
  originalSha256: string
  review256Sha256: string
}

export interface BipedSliceManifest {
  catalogVersion: '0.3.0'
  rendererVersion: '0.3.0'
  rigId: 'biped'
  entryCount: number
  entries: BipedSliceEntry[]
  sheetPath?: string
  sheetSha256?: string
  review256SheetPath?: string
  review256SheetSha256?: string
}

export function makeBipedSliceCatalog(): BipedSliceCatalog {
  return {
    catalogVersion: '0.3.0',
    rendererVersion: '0.3.0',
    options: BIPED_SLICE_OPTIONS,
  }
}

export async function buildBipedSliceManifest(
  catalog: BipedSliceCatalog,
): Promise<BipedSliceManifest> {
  const entries: BipedSliceEntry[] = []
  for (const bodyFrame of catalog.options.bodyFrame) {
    for (const headShape of catalog.options.headShape) {
      for (const arms of catalog.options.arms) {
        for (const legs of catalog.options.legs) {
          const structuralKey = [bodyFrame, headShape, arms, legs].join('|')
          entries.push({
            index: entries.length,
            structuralKey,
            selections: { bodyFrame, headShape, arms, legs },
            originalPngPath: '',
            review256PngPath: '',
            diagnostics: [],
            connectorMetrics: [],
            compositionMetrics: {
              eyesInsideRatio: 1,
              eyesVisibleRatio: 1,
              mouthInsideRatio: 1,
              mouthVisibleRatio: 1,
              oralDetailInsideRatio: 1,
              oralDetailVisibleRatio: 1,
              visibleBounds: null,
            },
            originalSha256: '',
            review256Sha256: '',
          })
        }
      }
    }
  }
  return {
    catalogVersion: catalog.catalogVersion,
    rendererVersion: catalog.rendererVersion,
    rigId: 'biped',
    entryCount: entries.length,
    entries,
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fsUrl(path: string): string {
  return `/@fs/${resolve(path).replaceAll('\\', '/')}`
}

function runtimeFsPath(path: string): string {
  return path.startsWith('assets/v0.3.0/')
    ? join('packages', 'asset-catalog', path)
    : join('packages', 'asset-catalog', 'assets', 'v0.2.0', path)
}

export function browserCatalog(input: Catalog): Catalog {
  const catalog = structuredClone(input)
  for (const part of catalog.parts) {
    // The fixed Cartesian slice intentionally exercises combinations beyond
    // theme-weighted generation. Keep validation focused on interfaces.
    part.themeIds = ['deep-sea', 'fungal', 'shadow']
    part.themeWeights = { 'deep-sea': 1, fungal: 1, shadow: 1 }
    if (part.composition !== undefined && !['bodyFrame', 'headShape', 'arms', 'legs', 'eyes', 'mouthShape', 'oralDetail'].includes(part.slotId)) {
      part.composition.isNone = true
      if (part.composition.mode !== 'interface') part.composition.renderNodes = []
    }
    if (part.composition?.mode === 'interface') {
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const node of variant.renderNodes) node.assetPath = fsUrl(runtimeFsPath(node.assetPath))
        for (const connector of variant.connectors) {
          connector.contourMaskPath = fsUrl(runtimeFsPath(connector.contourMaskPath))
          connector.foregroundMaskPath = fsUrl(runtimeFsPath(connector.foregroundMaskPath))
          connector.backgroundMaskPath = fsUrl(runtimeFsPath(connector.backgroundMaskPath))
        }
      }
    } else if (part.composition !== undefined) {
      for (const node of part.composition.renderNodes) node.assetPath = fsUrl(runtimeFsPath(node.assetPath))
    }
    for (const rigMasks of Object.values(part.rigMaskPaths ?? {})) {
      if (rigMasks === undefined) continue
      for (const maskName of ['primary', 'secondary', 'accent'] as const) {
        const maskPath = rigMasks[maskName]
        if (maskPath !== undefined) rigMasks[maskName] = fsUrl(runtimeFsPath(maskPath))
      }
    }
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    bridge.neutralAssetPath = fsUrl(runtimeFsPath(bridge.neutralAssetPath))
    bridge.neutralPngPath = fsUrl(runtimeFsPath(bridge.neutralPngPath))
    bridge.frontMaskPath = fsUrl(runtimeFsPath(bridge.frontMaskPath))
    bridge.backMaskPath = fsUrl(runtimeFsPath(bridge.backMaskPath))
  }
  return catalog
}

function makeSliceSpec(catalog: Catalog, selections: BipedSliceEntry['selections'], index: number): MonsterSpec {
  const chosen: Partial<Record<VisualSlotId, string>> = { ...selections }
  for (const slotId of [
    'eyes', 'mouthShape', 'oralDetail', 'headAppendage', 'tail', 'extraAppendage',
    'surfaceMaterial', 'pattern', 'colorScheme', 'effect',
  ] as const) {
    chosen[slotId] = catalog.parts.find(part => part.slotId === slotId && part.id.endsWith('_none'))?.id
      ?? catalog.parts.find(part => part.slotId === slotId)!.id
  }
  const semanticTraits = {} as MonsterSpec['semanticTraits']
  for (const slotId of ['frame', 'appendage', 'headAndEyes', 'mouth', 'surface', 'pattern', 'personality', 'quirk'] as SemanticSlotId[]) {
    semanticTraits[slotId] = {
      primaryTraitId: catalog.semanticTraits.find(trait => trait.semanticSlotId === slotId)!.id,
      detailTraitIds: [],
    }
  }
  return {
    schemaVersion: '0.1.0', catalogVersion: '0.3.0', rendererVersion: '0.3.0',
    seed: `biped-vertical-slice-${index.toString().padStart(2, '0')}`,
    themeId: 'fungal', palette: { primary: '#9b72d0', secondary: '#58b9dc', accent: '#f3c66d' },
    slotRolls: Object.fromEntries(Object.keys(chosen).map(slotId => [slotId, 0])) as MonsterSpec['slotRolls'],
    visualSlots: Object.fromEntries(Object.entries(chosen).map(([slotId, partId]) => [slotId, { partId, rigId: 'biped' }])) as MonsterSpec['visualSlots'],
    semanticTraits,
    mutation: null, aberrations: [],
  }
}

export async function withTemporaryBipedSliceInputRoot<T>(run: (inputRoot: string) => Promise<T>): Promise<T> {
  const inputRoot = await mkdtemp(join(resolve('.'), '.qmonster-biped-slice-inputs-'))
  try {
    return await run(inputRoot)
  } finally {
    await rm(inputRoot, { recursive: true, force: true })
  }
}

export function bipedSliceViteServerOptions(inputRoot: string): InlineConfig {
  return {
    root: resolve('apps/creator-web'),
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [resolve('.'), resolve(inputRoot)] },
    },
    logLevel: 'error',
  }
}

export async function renderBipedSlice(): Promise<BipedSliceManifest> {
  return withTemporaryBipedSliceInputRoot(async inputRoot => {
  const reviewRoot = join('packages', 'asset-catalog', 'review', 'v0.3.0')
  const entriesRoot = join(reviewRoot, 'biped-vertical-slice-entries')
  const review256Root = join(reviewRoot, 'biped-vertical-slice-entries-256')
  await Promise.all([mkdir(entriesRoot, { recursive: true }), mkdir(review256Root, { recursive: true })])
  const sourceCatalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8')) as Catalog
  const catalog = browserCatalog(sourceCatalog)
  const manifest = await buildBipedSliceManifest(makeBipedSliceCatalog())
  const server = await createServer(bipedSliceViteServerOptions(inputRoot))
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('BIPED_SLICE_RENDER_FAILED: Vite server has no local URL')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    for (const entry of manifest.entries) {
      const spec = makeSliceSpec(catalog, entry.selections, entry.index)
      const inputPath = resolve(inputRoot, `${entry.index.toString().padStart(2, '0')}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog, spec })}\n`)
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const error = await page.evaluate(() => document.body.dataset.renderError)
      if (error !== undefined) throw new Error(`BIPED_SLICE_RENDER_FAILED: ${entry.structuralKey}: ${error}`)
      const result = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as {
        diagnostics: BipedSliceEntry['diagnostics']
        connectorMetrics: ConnectorMetric[]
        compositionMetrics: BipedSliceEntry['compositionMetrics']
      }
      const dataUrl = await page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
      const original = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      const name = `${entry.index.toString().padStart(2, '0')}.png`
      const originalPath = join(entriesRoot, name)
      const review256Path = join(review256Root, name)
      const review256 = await sharp(original).resize(256, 256, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer()
      await Promise.all([writeFile(originalPath, original), writeFile(review256Path, review256)])
      Object.assign(entry, {
        originalPngPath: originalPath.replaceAll('\\', '/'), review256PngPath: review256Path.replaceAll('\\', '/'),
        diagnostics: result.diagnostics, connectorMetrics: result.connectorMetrics,
        compositionMetrics: result.compositionMetrics,
        originalSha256: sha256(original), review256Sha256: sha256(review256),
      })
    }
  } finally {
    await page.close()
    await browser.close()
    await server.close()
  }
  const tiles = await Promise.all(manifest.entries.map(async (entry, index) => ({
    input: await sharp(entry.originalPngPath).resize(512, 512, { fit: 'fill' }).png().toBuffer(),
    left: (index % BIPED_SLICE_COLUMNS) * 512, top: Math.floor(index / BIPED_SLICE_COLUMNS) * 512,
  })))
  const sheet = await sharp({ create: { width: BIPED_SLICE_COLUMNS * 512, height: BIPED_SLICE_ROWS * 512, channels: 4, background: '#00000000' } })
    .composite(tiles).png({ compressionLevel: 9 }).toBuffer()
  const sheetPath = join(reviewRoot, 'biped-vertical-slice.png')
  const review256SheetPath = join(reviewRoot, 'biped-vertical-slice-256.png')
  const manifestPath = join(reviewRoot, 'biped-vertical-slice-manifest.json')
  const review256Tiles = await Promise.all(manifest.entries.map(async (entry, index) => ({
    input: await readFile(entry.review256PngPath),
    left: (index % BIPED_SLICE_COLUMNS) * 256, top: Math.floor(index / BIPED_SLICE_COLUMNS) * 256,
  })))
  const review256Sheet = await sharp({ create: { width: BIPED_SLICE_COLUMNS * 256, height: BIPED_SLICE_ROWS * 256, channels: 4, background: '#00000000' } })
    .composite(review256Tiles).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(sheetPath, sheet)
  await writeFile(review256SheetPath, review256Sheet)
  await writeFile(manifestPath, `${JSON.stringify({
    ...manifest,
    sheetPath: sheetPath.replaceAll('\\', '/'),
    sheetSha256: sha256(sheet),
    review256SheetPath: review256SheetPath.replaceAll('\\', '/'),
    review256SheetSha256: sha256(review256Sheet),
  }, null, 2)}\n`)
  return manifest
  })
}

function isDirectExecution(): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  try { return realpathSync(resolve(invoked)) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isDirectExecution()) {
  const args = process.argv.slice(2)
  const valid = args.join(' ') === `--all ${BIPED_SLICE_ENTRY_COUNT} --size 2048 --review-size 256`
    || args.join(' ') === '--version 0.3.0'
  if (!valid) throw new Error('Usage: tsx scripts/render-biped-interface-slice.ts --version 0.3.0')
  const manifest = await renderBipedSlice()
  console.log(JSON.stringify({ entryCount: manifest.entryCount }))
}
