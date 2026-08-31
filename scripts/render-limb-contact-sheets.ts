import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
// TASK8_STABLE_BEGIN:limb-canonical-structural-import
import { STRUCTURAL_SLOT_IDS, type Catalog, type MonsterSpec, type SemanticSlotId, type StructuralSlotId, type VisualSlotId } from '@qmonster/generator-core'
// TASK8_STABLE_END:limb-canonical-structural-import
import { EXTERNAL_LIMB_ALPHA_MIN, type ConnectorMetric } from '@qmonster/renderer-canvas'
import sharp from 'sharp'
import { createServer } from 'vite'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'packages', 'asset-catalog', 'review', 'v0.3.0')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const ARMS = ['arms_short_plush', 'arms_long_noodle', 'arms_paddle'] as const
const LEGS = ['legs_stub_feet', 'legs_webbed', 'legs_mushroom', 'legs_shadow_tiptoe'] as const
export const BODIES = {
  blob: ['body_blob_round', 'body_blob_wide'],
  biped: ['body_biped_peanut', 'body_biped_tall'],
  floating: ['body_floating_drop'],
} as const
// TASK8_STABLE_BEGIN:limb-canonical-structural-subset
export const LIMB_REVIEW_STRUCTURAL_SLOT_IDS = [
  'bodyFrame', 'headShape', 'arms', 'legs',
] as const satisfies readonly StructuralSlotId[]
if (!LIMB_REVIEW_STRUCTURAL_SLOT_IDS.every(slotId => STRUCTURAL_SLOT_IDS.includes(slotId))) {
  throw new Error('LIMB_EVIDENCE_INVALID: limb review slots must be canonical structural slots')
}
// TASK8_STABLE_END:limb-canonical-structural-subset

export interface LimbMatrixPlanEntry {
  rigId: 'blob' | 'biped' | 'floating'
  bodyFrame: string
  headShape: string
  arms: string
  legs: string
}

function reviewHeadForBody(bodyFrame: string): string {
  return bodyFrame === 'body_biped_tall' ? 'head_mushroom_cap' : 'head_round_dome'
}

type LimbMatrixMode = 'prototype' | 'option-a-prototype' | 'full'

export function makeLimbMatrixPlan(mode: LimbMatrixMode): LimbMatrixPlanEntry[] {
  if (mode === 'prototype') return [
    ...BODIES.blob.map(bodyFrame => ({ rigId: 'blob' as const, bodyFrame, headShape: reviewHeadForBody(bodyFrame), arms: 'arms_paddle', legs: 'legs_stub_feet' })),
    { rigId: 'floating', bodyFrame: 'body_floating_drop', headShape: 'head_round_dome', arms: 'arms_long_noodle', legs: 'legs_shadow_tiptoe' },
  ]
  if (mode === 'option-a-prototype') return BODIES.blob.map(bodyFrame => ({
    rigId: 'blob' as const, bodyFrame, headShape: reviewHeadForBody(bodyFrame), arms: 'arms_short_plush', legs: 'legs_shadow_tiptoe',
  }))
  return (Object.keys(BODIES) as Array<keyof typeof BODIES>).flatMap(rigId => BODIES[rigId].flatMap(bodyFrame => (
    ARMS.flatMap(arms => LEGS.map(legs => ({ rigId, bodyFrame, headShape: reviewHeadForBody(bodyFrame), arms, legs })))
  )))
}

// TASK8_STABLE_BEGIN:limb-worker-partition-helper
export function makeLimbMatrixWorkerIndices(entryCount: number, maximumWorkers: 1 | 2 = 2): number[][] {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) throw new Error('LIMB_MATRIX_WORKER_COUNT_INVALID')
  if (maximumWorkers !== 1 && maximumWorkers !== 2) throw new Error('LIMB_MATRIX_WORKER_COUNT_INVALID')
  const workerCount = Math.min(entryCount, maximumWorkers)
  return Array.from({ length: workerCount }, (_, workerIndex) => (
    Array.from({ length: Math.ceil((entryCount - workerIndex) / workerCount) }, (_, offset) => workerIndex + offset * workerCount)
      .filter(index => index < entryCount)
  ))
}
// TASK8_STABLE_END:limb-worker-partition-helper

// TASK8_STABLE_BEGIN:limb-worker-cleanup-helper
export async function cleanupLimbMatrixHarness(input: {
  inputRoot?: string
  pages?: Array<{ close(): Promise<unknown> }>
  browser?: { close(): Promise<unknown> }
  server?: { close(): Promise<unknown> }
}): Promise<void> {
  const operations: Array<() => Promise<unknown>> = []
  for (const page of input.pages ?? []) operations.push(() => page.close())
  if (input.browser !== undefined) operations.push(() => input.browser!.close())
  if (input.server !== undefined) operations.push(() => input.server!.close())
  if (input.inputRoot !== undefined && input.inputRoot !== '') operations.push(() => rm(input.inputRoot!, { recursive: true, force: true }))
  const failures: unknown[] = []
  for (const operation of operations) {
    try { await operation() } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Limb matrix render harness cleanup failed')
}
// TASK8_STABLE_END:limb-worker-cleanup-helper

export interface RenderEvidence {
  diagnostics: Array<{ severity: string, code: string, path: string[], message: string }>
  connectorMetrics: ConnectorMetric[]
  resolvedAssetPaths: string[]
  compositionMetrics?: { visibleBounds?: { x: number; y: number; width: number; height: number } | null }
}

export function validateLimbRenderEvidence(evidence: RenderEvidence, expectedNodePaths: readonly string[]): string[] {
  const errors = evidence.diagnostics.filter(item => (
    item.severity === 'error'
      && !(item.code === 'CONNECTOR_COMPOSITE_FAILED' && item.path.join('/') === 'connectors/neck')
      && !['COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED'].includes(item.code)
  )).map(item => item.code)
  for (const expected of expectedNodePaths) {
    const calls = evidence.resolvedAssetPaths.filter(path => path === expected).length
    if (calls !== 1) errors.push(`RESOLVER_CALL_COUNT:${expected}:${calls}`)
  }
  for (const metric of evidence.connectorMetrics) {
    if (metric.connectorId === 'neck') continue
    if (metric.receiverCoverage < 0.9) errors.push(`${metric.connectorId}:receiverCoverage`)
    if (metric.plugCoverage < 0.9) errors.push(`${metric.connectorId}:plugCoverage`)
    if (metric.largestComponentRatio < 0.99) errors.push(`${metric.connectorId}:largestComponentRatio`)
    if (metric.centerlineGapPixels > 2) errors.push(`${metric.connectorId}:centerlineGapPixels`)
    if (metric.childOutsideBodyRatio !== null && metric.childOutsideBodyRatio < EXTERNAL_LIMB_ALPHA_MIN) errors.push(`${metric.connectorId}:childOutsideBodyRatio`)
  }
  if (evidence.connectorMetrics.length !== 5) errors.push(`CONNECTOR_METRIC_COUNT:${evidence.connectorMetrics.length}`)
  return errors
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return sha256(await readFile(path)) }
export function fsUrl(path: string): string { return `/@fs/${resolve(path).replaceAll('\\', '/')}` }
export function runtimeFsPath(path: string): string {
  return path.startsWith('assets/v0.3.0/') ? join('packages', 'asset-catalog', path) : join('packages', 'asset-catalog', 'assets', 'v0.2.0', path)
}

export function resolvedFsPath(path: string): string {
  if (!path.startsWith('/@fs/')) throw new Error(`LIMB_EVIDENCE_INVALID: unresolved asset path ${path}`)
  return resolve(path.slice('/@fs/'.length))
}

// TASK8_STABLE_BEGIN:limb-browser-catalog-signature
export function browserCatalog(input: Catalog, options: {
  activeStructuralSlots?: readonly VisualSlotId[]
  applyPaletteMasks?: boolean
} = {}): Catalog {
  const catalog = structuredClone(input)
// TASK8_STABLE_END:limb-browser-catalog-signature
  // TASK8_STABLE_BEGIN:limb-active-structural-slots
  const activeStructuralSlots = new Set(options.activeStructuralSlots ?? LIMB_REVIEW_STRUCTURAL_SLOT_IDS)
  // TASK8_STABLE_END:limb-active-structural-slots
  for (const part of catalog.parts) {
    part.themeIds = ['deep-sea', 'fungal', 'shadow']; part.themeWeights = { 'deep-sea': 1, fungal: 1, shadow: 1 }
    // TASK8_STABLE_BEGIN:limb-active-slot-condition
    if (part.composition !== undefined && !activeStructuralSlots.has(part.slotId)) {
    // TASK8_STABLE_END:limb-active-slot-condition
      part.composition.isNone = true
      if (part.composition.mode !== 'interface') part.composition.renderNodes = []
    }
    if (part.composition?.mode === 'interface') for (const variant of Object.values(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      for (const node of variant.renderNodes) node.assetPath = fsUrl(runtimeFsPath(node.assetPath))
      for (const connector of variant.connectors) {
        connector.contourMaskPath = fsUrl(runtimeFsPath(connector.contourMaskPath))
        connector.foregroundMaskPath = fsUrl(runtimeFsPath(connector.foregroundMaskPath))
        connector.backgroundMaskPath = fsUrl(runtimeFsPath(connector.backgroundMaskPath))
      }
    } else if (part.composition !== undefined) for (const node of part.composition.renderNodes) node.assetPath = fsUrl(runtimeFsPath(node.assetPath))
    // TASK8_STABLE_BEGIN:limb-palette-mask-paths
    if (part.rigMaskPaths !== undefined) for (const masks of Object.values(part.rigMaskPaths)) {
        if (masks === undefined) continue
        masks.primary = fsUrl(runtimeFsPath(masks.primary))
        masks.secondary = fsUrl(runtimeFsPath(masks.secondary))
        masks.accent = fsUrl(runtimeFsPath(masks.accent))
      }
    // TASK8_STABLE_END:limb-palette-mask-paths
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    bridge.neutralAssetPath = fsUrl(runtimeFsPath(bridge.neutralAssetPath)); bridge.neutralPngPath = fsUrl(runtimeFsPath(bridge.neutralPngPath))
    bridge.frontMaskPath = fsUrl(runtimeFsPath(bridge.frontMaskPath)); bridge.backMaskPath = fsUrl(runtimeFsPath(bridge.backMaskPath))
  }
  return catalog
}

export function makeSpec(catalog: Catalog, entry: LimbMatrixPlanEntry, index: number): MonsterSpec {
  const chosen: Partial<Record<VisualSlotId, string>> = { bodyFrame: entry.bodyFrame, headShape: entry.headShape, arms: entry.arms, legs: entry.legs }
  for (const slotId of ['eyes', 'mouthShape', 'oralDetail', 'headAppendage', 'tail', 'extraAppendage', 'surfaceMaterial', 'pattern', 'colorScheme', 'effect'] as const) {
    chosen[slotId] = catalog.parts.find(part => part.slotId === slotId && part.id.endsWith('_none'))?.id ?? catalog.parts.find(part => part.slotId === slotId)!.id
  }
  const semanticTraits = {} as MonsterSpec['semanticTraits']
  for (const slotId of ['frame', 'appendage', 'headAndEyes', 'mouth', 'surface', 'pattern', 'personality', 'quirk'] as SemanticSlotId[]) {
    semanticTraits[slotId] = { primaryTraitId: catalog.semanticTraits.find(trait => trait.semanticSlotId === slotId)!.id, detailTraitIds: [] }
  }
  return {
    schemaVersion: '0.1.0', catalogVersion: '0.3.0', rendererVersion: '0.3.0', seed: `limb-matrix-${index.toString().padStart(2, '0')}`,
    themeId: 'fungal', palette: { primary: '#9b72d0', secondary: '#58b9dc', accent: '#f3c66d' },
    slotRolls: Object.fromEntries(Object.keys(chosen).map(slotId => [slotId, 0])) as MonsterSpec['slotRolls'],
    visualSlots: Object.fromEntries(Object.entries(chosen).map(([slotId, partId]) => [slotId, { partId, rigId: entry.rigId }])) as MonsterSpec['visualSlots'],
    semanticTraits, mutation: null, aberrations: [],
  }
}

function escapeXml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;') }
async function cell(image: Buffer, entry: LimbMatrixPlanEntry, size: 512 | 256): Promise<Buffer> {
  const labelHeight = size === 512 ? 66 : 44; const artHeight = size - labelHeight
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${labelHeight}"><rect width="100%" height="100%" fill="#27233a"/><text x="${size === 512 ? 12 : 6}" y="${size === 512 ? 25 : 16}" fill="#fff" font-family="Arial,sans-serif" font-size="${size === 512 ? 17 : 9}">${escapeXml(entry.bodyFrame)}</text><text x="${size === 512 ? 12 : 6}" y="${size === 512 ? 50 : 34}" fill="#cfc5e8" font-family="Arial,sans-serif" font-size="${size === 512 ? 15 : 8}">${escapeXml(`${entry.arms} × ${entry.legs}`)}</text></svg>`)
  const checker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${artHeight}"><defs><pattern id="p" width="${size === 512 ? 32 : 16}" height="${size === 512 ? 32 : 16}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#f4f1e8"/><rect width="50%" height="50%" fill="#e8e4d9"/><rect x="50%" y="50%" width="50%" height="50%" fill="#e8e4d9"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`)
  const art = await sharp(image).resize(size, artHeight, { fit: 'contain' }).png(PNG).toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: '#f4f1e8' } }).composite([{ input: checker, left: 0, top: 0 }, { input: art, left: 0, top: 0 }, { input: label, left: 0, top: artHeight }]).png(PNG).toBuffer()
}

export interface LimbMatrixEvidenceEntry extends LimbMatrixPlanEntry {
  original: Buffer
  connectorMetrics: ConnectorMetric[]
  compositionMetrics: RenderEvidence['compositionMetrics']
  resolvedAssetPaths: string[]
  inputBinding: { catalogSha256: string; resolvedAssetHashes: Array<{ path: string; sha256: string }> }
  gateErrors: string[]
  diagnostics: RenderEvidence['diagnostics']
}

export async function reconstructLimbMatrixEvidence(input: {
  mode?: LimbMatrixMode
  catalogPath?: string
  planOverride?: LimbMatrixPlanEntry[]
  failOnGateError?: boolean
  writeDebugOnFailure?: boolean
  // TASK8_STABLE_BEGIN:limb-task10-catalog-projection-input
  catalogProjection?: (catalog: Catalog) => Catalog
  historicalConnectorMetrics?: boolean
  // TASK8_STABLE_END:limb-task10-catalog-projection-input
  // TASK8_STABLE_BEGIN:limb-worker-count-input
  workerCount?: 1 | 2
  // TASK8_STABLE_END:limb-worker-count-input
} = {}): Promise<{ mode: LimbMatrixMode; catalogInputSha256: string; entries: LimbMatrixEvidenceEntry[] }> {
  const mode = input.mode ?? 'full'
  const plan = input.planOverride ?? makeLimbMatrixPlan(mode)
  const catalogPath = input.catalogPath ?? join(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json')
  const sourceCatalogBytes = await readFile(catalogPath)
  const sourceCatalog = JSON.parse(sourceCatalogBytes.toString('utf8')) as Catalog
  const catalogInputSha256 = sha256(sourceCatalogBytes)
  // TASK8_STABLE_BEGIN:limb-task10-catalog-projection-apply
  const renderSourceCatalog = input.catalogProjection?.(sourceCatalog) ?? sourceCatalog
  // TASK8_STABLE_END:limb-task10-catalog-projection-apply
  // TASK8_STABLE_BEGIN:limb-structural-only-catalog
  const catalog = browserCatalog(renderSourceCatalog, { applyPaletteMasks: false })
  // TASK8_STABLE_END:limb-structural-only-catalog
  const resolvedHashCache = new Map<string, string>()
  const inputRoot = await mkdtemp(join(ROOT, '.tmp-limb-matrix-'))
  // TASK8_STABLE_BEGIN:limb-worker-pages
  const workerIndices = makeLimbMatrixWorkerIndices(plan.length, input.workerCount ?? 2)
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const pages: Array<Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>> = []
  const entries = new Array<LimbMatrixEvidenceEntry>(plan.length)
  try {
    server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await server.listen(); const baseUrl = server.resolvedUrls?.local[0]
    if (baseUrl === undefined) throw new Error('LIMB_MATRIX_RENDER_FAILED: Vite server has no local URL')
    browser = await chromium.launch({ headless: true })
    for (const _indices of workerIndices) pages.push(await browser.newPage())
  // TASK8_STABLE_END:limb-worker-pages
    // TASK8_STABLE_BEGIN:limb-worker-loop-open
    await Promise.all(workerIndices.map(async (indices, workerIndex) => {
      const page = pages[workerIndex]!
      for (const index of indices) {
    // TASK8_STABLE_END:limb-worker-loop-open
      const selection = plan[index]!
      const spec = makeSpec(catalog, selection, index)
      const inputPath = join(inputRoot, `${index.toString().padStart(2, '0')}.json`)
      // TASK8_STABLE_BEGIN:limb-structural-only-input
      await writeFile(inputPath, `${JSON.stringify({
        catalog,
        spec,
        applyPaletteMasks: false,
        ...(input.historicalConnectorMetrics === true
          ? {
              connectorMetricProjection: 'task8-task9-neutral-bridge-v1',
              bridgeRoleProjection: 'task8-task9-cross-product-v1',
            }
          : {}),
      })}\n`)
      // TASK8_STABLE_END:limb-structural-only-input
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const browserError = await page.evaluate(() => document.body.dataset.renderError)
      if (browserError !== undefined) throw new Error(`LIMB_MATRIX_RENDER_FAILED:${browserError}`)
      const evidence = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as RenderEvidence
      const expectedNodePaths = ['arms', 'legs'].flatMap(slotId => {
        const part = catalog.parts.find(item => item.id === selection[slotId as 'arms' | 'legs'])!
        return part.composition?.mode === 'interface' ? part.composition.variantsByRig[selection.rigId]!.renderNodes.map(node => node.assetPath) : []
      })
      const gateErrors = validateLimbRenderEvidence(evidence, expectedNodePaths)
      const dataUrl = await page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
      const original = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      if (gateErrors.length > 0) {
        if (input.writeDebugOnFailure === true) {
          const debugPath = join(ROOT, '.superpowers', 'sdd', '2026-08-24-qmonster-v0.3-interface-components-implementation', `task8-debug-${selection.bodyFrame}.png`)
          await mkdir(dirname(debugPath), { recursive: true }); await writeFile(debugPath, original)
        }
        if (input.failOnGateError === true) throw new Error(`LIMB_MATRIX_GATE_FAILED:${selection.bodyFrame}:${selection.arms}:${selection.legs}:${gateErrors.join(',')}:metrics=${JSON.stringify(evidence.connectorMetrics)}:diagnostics=${JSON.stringify(evidence.diagnostics)}`)
      }
      const resolvedAssetHashes = await Promise.all([...new Set(evidence.resolvedAssetPaths)].map(async path => {
        let digest = resolvedHashCache.get(path)
        if (digest === undefined) { digest = await hashFile(resolvedFsPath(path)); resolvedHashCache.set(path, digest) }
        return { path, sha256: digest }
      }))
      // TASK8_STABLE_BEGIN:limb-worker-entry-assignment
      entries[index] = { ...selection, original, connectorMetrics: evidence.connectorMetrics, compositionMetrics: evidence.compositionMetrics, resolvedAssetPaths: evidence.resolvedAssetPaths, inputBinding: { catalogSha256: catalogInputSha256, resolvedAssetHashes }, gateErrors, diagnostics: evidence.diagnostics }
      // TASK8_STABLE_END:limb-worker-entry-assignment
    // TASK8_STABLE_BEGIN:limb-worker-loop-close
      }
    }))
    // TASK8_STABLE_END:limb-worker-loop-close
  } finally {
    // TASK8_STABLE_BEGIN:limb-worker-cleanup
    await cleanupLimbMatrixHarness({ inputRoot, pages, browser, server })
    // TASK8_STABLE_END:limb-worker-cleanup
  }
  return { mode, catalogInputSha256, entries }
}

export async function renderLimbContactSheets(mode: LimbMatrixMode) {
  const auditOnly = process.argv.includes('--audit')
  const { entries } = await reconstructLimbMatrixEvidence({
    mode,
    failOnGateError: !auditOnly,
    writeDebugOnFailure: true,
  })
  const grouped = new Map<string, typeof entries>()
  for (const entry of entries) { const list = grouped.get(entry.rigId) ?? []; list.push(entry); grouped.set(entry.rigId, list) }
  const records = []
  for (const [rigId, rigEntries] of grouped) {
    const originalCells = await Promise.all(rigEntries.map(entry => cell(entry.original, entry, 512)))
    const smallCells = await Promise.all(rigEntries.map(entry => cell(entry.original, entry, 256)))
    const columns = Math.min(4, rigEntries.length); const rows = Math.ceil(rigEntries.length / columns)
    const originalSheet = await sharp({ create: { width: columns * 512, height: rows * 512, channels: 4, background: '#eee9de' } }).composite(originalCells.map((input, index) => ({ input, left: index % columns * 512, top: Math.floor(index / columns) * 512 }))).png(PNG).toBuffer()
    const smallSheet = await sharp({ create: { width: columns * 256, height: rows * 256, channels: 4, background: '#eee9de' } }).composite(smallCells.map((input, index) => ({ input, left: index % columns * 256, top: Math.floor(index / columns) * 256 }))).png(PNG).toBuffer()
    const prefix = mode === 'prototype' ? 'limb-prototype-contact-sheet' : mode === 'option-a-prototype' ? 'limb-option-a-prototype-contact-sheet' : 'limb-contact-sheet'
    const originalPath = join(REVIEW_ROOT, `${prefix}-${rigId}.png`); const review256Path = join(REVIEW_ROOT, `${prefix}-${rigId}-256.png`)
    await mkdir(dirname(originalPath), { recursive: true }); await writeFile(originalPath, originalSheet); await writeFile(review256Path, smallSheet)
    const record = {
      schemaVersion: 'limb-contact-sheet-v1', status: rigEntries.some(entry => entry.gateErrors.length > 0) ? 'machine-fail-debug-only' : 'machine-pass-awaiting-user-approval', mode, rigId, entryCount: rigEntries.length,
      legend: 'bodyFrame; arms × legs', originalPath: originalPath.replaceAll('\\', '/'), originalSha256: sha256(originalSheet),
      review256Path: review256Path.replaceAll('\\', '/'), review256Sha256: sha256(smallSheet),
      thresholds: { receiverCoverageMin: 0.9, plugCoverageMin: 0.9, largestComponentRatioMin: 0.99, centerlineGapPixelsMax: 2, childOutsideBodyRatioMin: EXTERNAL_LIMB_ALPHA_MIN },
      entries: rigEntries.map(({ original, ...entry }) => ({ ...entry, originalSha256: sha256(original) })),
    }
    const manifestPath = join(REVIEW_ROOT, `${prefix}-${rigId}-manifest.json`); await writeFile(manifestPath, `${JSON.stringify(record, null, 2)}\n`)
    records.push({ ...record, manifestPath: manifestPath.replaceAll('\\', '/') })
  }
  const indexPrefix = mode === 'prototype' ? 'limb-prototype' : mode === 'option-a-prototype' ? 'limb-option-a-prototype' : 'limb'
  const indexPath = join(REVIEW_ROOT, `${indexPrefix}-contact-sheet-index.json`)
  await writeFile(indexPath, `${JSON.stringify({ schemaVersion: 'limb-contact-sheet-index-v1', mode, entryCount: entries.length, records: records.map(record => ({ rigId: record.rigId, entryCount: record.entryCount, originalPath: record.originalPath, originalSha256: record.originalSha256, review256Path: record.review256Path, review256Sha256: record.review256Sha256, manifestPath: record.manifestPath })) }, null, 2)}\n`)
  return { mode, entryCount: entries.length, failureCount: entries.filter(entry => entry.gateErrors.length > 0).length, records }
}

type SweepLimbId = typeof ARMS[number] | typeof LEGS[number]

export function sweepCandidatePath(partId: SweepLimbId, candidateNumber: number): string {
  if (!Number.isSafeInteger(candidateNumber) || candidateNumber < 1) throw new Error('LIMB_SWEEP_FAILED: candidate revision must be a positive integer')
  return `asset-source/v0.3.0/generation/task8-candidates/blob/${partId}/candidate-${candidateNumber}.png`
}

export async function sweepBlobLimbTransforms(partId: SweepLimbId, candidateNumber: number, slotId: 'arms' | 'legs') {
  const sourceCatalogBytes = await readFile(join(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'))
  const sourceCatalog = JSON.parse(sourceCatalogBytes.toString('utf8')) as Catalog
  const scales = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const
  const rotations = [-12, -8, -4, 0, 4, 8, 12] as const
  const inputRoot = await mkdtemp(join(ROOT, '.tmp-limb-sweep-'))
  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen(); const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('LIMB_SWEEP_FAILED: Vite server has no local URL')
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  const samples: Array<Record<string, unknown>> = []
  try {
    let index = 0
    for (const scale of scales) for (const rotationDegrees of rotations) for (const bodyFrame of BODIES.blob) {
      const experiment = structuredClone(sourceCatalog)
      const limbPart = experiment.parts.find(part => part.id === partId)!
      if (limbPart.composition?.mode !== 'interface') throw new Error(`LIMB_SWEEP_FAILED: ${partId} is not interface composition`)
      const variant = limbPart.composition.variantsByRig.blob!
      for (const node of variant.renderNodes) node.transform = { scale, mirrorX: false }
      for (const connector of variant.connectors) {
        const signedRotation = connector.id.endsWith('Left') ? rotationDegrees : -rotationDegrees
        const radians = signedRotation * Math.PI / 180
        const tangent = connector.tangent
        connector.tangent = {
          x: tangent.x * Math.cos(radians) - tangent.y * Math.sin(radians),
          y: tangent.x * Math.sin(radians) + tangent.y * Math.cos(radians),
        }
      }
      const catalog = browserCatalog(experiment)
      const selection = {
        rigId: 'blob' as const, bodyFrame, headShape: 'head_round_dome',
        arms: slotId === 'arms' ? partId : 'arms_short_plush',
        legs: slotId === 'legs' ? partId : 'legs_stub_feet',
      }
      const spec = makeSpec(catalog, selection, index)
      const inputPath = join(inputRoot, `${index.toString().padStart(4, '0')}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog, spec })}\n`)
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const browserError = await page.evaluate(() => document.body.dataset.renderError)
      if (browserError !== undefined) throw new Error(`LIMB_SWEEP_FAILED:${browserError}`)
      const evidence = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as RenderEvidence
      const limbConnectors = evidence.connectorMetrics.filter(metric => metric.connectorId.startsWith(slotId === 'arms' ? 'shoulder' : 'hip'))
      samples.push({
        scale, rotationDegrees, bodyFrame,
        outside: limbConnectors.map(metric => metric.childOutsideBodyRatio),
        receiverCoverage: limbConnectors.map(metric => metric.receiverCoverage),
        plugCoverage: limbConnectors.map(metric => metric.plugCoverage),
        connectedStructuralAlpha: limbConnectors.map(metric => metric.largestComponentRatio),
        centerlineGapPx: limbConnectors.map(metric => metric.centerlineGapPixels),
        visibleBounds: evidence.compositionMetrics?.visibleBounds ?? null,
        blockingDiagnostics: evidence.diagnostics.filter(item => item.severity === 'error' && ![
          'COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED',
        ].includes(item.code)).map(item => ({ code: item.code, path: item.path })),
      })
      index += 1
    }
  } finally {
    await page.close(); await browser.close(); await server.close(); await rm(inputRoot, { recursive: true, force: true })
  }
  const paired = scales.flatMap(scale => rotations.map(rotationDegrees => {
    const cells = samples.filter(sample => sample.scale === scale && sample.rotationDegrees === rotationDegrees)
    const outside = cells.flatMap(cell => cell.outside as Array<number | null>).filter((value): value is number => value !== null)
    const eligible = cells.every(cell => (cell.blockingDiagnostics as unknown[]).every(item => (item as { code: string }).code === 'CONNECTOR_COMPOSITE_FAILED'))
      && cells.every(cell => (cell.receiverCoverage as number[]).every(value => value >= 0.9))
      && cells.every(cell => (cell.plugCoverage as number[]).every(value => value >= 0.9))
      && cells.every(cell => (cell.connectedStructuralAlpha as number[]).every(value => value >= 0.99))
      && cells.every(cell => (cell.centerlineGapPx as number[]).every(value => value <= 2))
    const worstOutside = Math.min(...outside)
    return { scale, rotationDegrees, worstOutside, bestOutside: Math.max(...outside), eligible, passesAllGates: eligible && worstOutside >= EXTERNAL_LIMB_ALPHA_MIN, cells }
  })).sort((left, right) => right.worstOutside - left.worstOutside)
  const evidencePath = join(ROOT, '.superpowers', 'sdd', '2026-08-24-qmonster-v0.3-interface-components-implementation', `task8-${partId}-blob-transform-sweep.json`)
  const armVariant = sourceCatalog.parts.find(part => part.id === partId)?.composition?.mode === 'interface'
    ? sourceCatalog.parts.find(part => part.id === partId)!.composition!.variantsByRig.blob
    : undefined
  if (armVariant === undefined) throw new Error(`LIMB_SWEEP_FAILED: missing blob ${partId} input binding`)
  const inputPaths = [...new Set([
    ...armVariant.renderNodes.flatMap(node => [node.assetPath, node.pngPath]),
    ...armVariant.connectors.flatMap(connector => [connector.contourMaskPath, connector.foregroundMaskPath, connector.backgroundMaskPath]),
  ])]
  const evidence = {
    schemaVersion: 'task8-limb-transform-sweep-v1', candidate: `blob/${partId}/candidate-${candidateNumber}`, slotId,
    inputBinding: {
      catalogSha256: sha256(sourceCatalogBytes),
      candidatePath: sweepCandidatePath(partId, candidateNumber),
      candidateSha256: await hashFile(join(ROOT, sweepCandidatePath(partId, candidateNumber))),
      runtimeAssets: await Promise.all(inputPaths.map(async path => ({ path, sha256: await hashFile(runtimeFsPath(path)) }))),
    },
    scales, rotations, sampleCount: samples.length, bestCommonTransform: paired[0], paired, samples,
  }
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  return { evidencePath, sampleCount: samples.length, bestCommonTransform: paired[0] }
}

export async function sweepBlobArmTransforms(partId: typeof ARMS[number], candidateNumber: number) {
  return sweepBlobLimbTransforms(partId, candidateNumber, 'arms')
}

export async function sweepBlobPaddleTransforms() { return sweepBlobArmTransforms('arms_paddle', 4) }

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sweep')) {
    console.log(JSON.stringify(await sweepBlobPaddleTransforms()))
  } else if (process.argv.includes('--sweep-arm')) {
    const partId = process.argv[process.argv.indexOf('--sweep-arm') + 1] as typeof ARMS[number] | undefined
    const candidateNumber = Number(process.argv[process.argv.indexOf('--sweep-arm') + 2])
    if (partId === undefined || !ARMS.includes(partId) || !Number.isSafeInteger(candidateNumber) || candidateNumber < 1) throw new Error('Usage: --sweep-arm arms_short_plush|arms_long_noodle|arms_paddle CANDIDATE_NUMBER')
    console.log(JSON.stringify(await sweepBlobArmTransforms(partId, candidateNumber)))
  } else if (process.argv.includes('--sweep-leg')) {
    const partId = process.argv[process.argv.indexOf('--sweep-leg') + 1] as typeof LEGS[number] | undefined
    const candidateNumber = Number(process.argv[process.argv.indexOf('--sweep-leg') + 2])
    if (partId === undefined || !LEGS.includes(partId) || !Number.isSafeInteger(candidateNumber) || candidateNumber < 1) throw new Error('Usage: --sweep-leg legs_stub_feet|legs_webbed|legs_mushroom|legs_shadow_tiptoe CANDIDATE_NUMBER')
    console.log(JSON.stringify(await sweepBlobLimbTransforms(partId, candidateNumber, 'legs')))
  } else {
    const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--option-a-prototype') ? 'option-a-prototype' : 'prototype'
    const result = await renderLimbContactSheets(mode); console.log(JSON.stringify({ mode: result.mode, entryCount: result.entryCount, failureCount: result.failureCount }))
  }
}
