import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { STRUCTURAL_SLOT_IDS, type Catalog } from '@qmonster/generator-core'
import { EXTERNAL_LIMB_ALPHA_MIN, type ConnectorMetric } from '@qmonster/renderer-canvas'
import sharp from 'sharp'
import { createServer } from 'vite'
import {
  browserCatalog,
  fsUrl,
  makeSpec,
  resolvedFsPath,
  type RenderEvidence,
} from './render-limb-contact-sheets.js'
import { TASK9_BODIES_BY_RIG, TASK9_EXTRA_IDS, TASK9_RIG_IDS, TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE, TASK9_TAIL_IDS, type Task9RigId } from './task9-structural-identities.js'
import { resolveExistingContainedPath } from './safe-output.js'
import { task8Task9HistoricalNeckWarpProjection } from './task8-stable-projection.js'

export { TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE } from './task9-structural-identities.js'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'packages', 'asset-catalog', 'review', 'v0.3.0')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const MIXED = [
  ['tail_fish_fan', 'extra_soft_tentacles'],
  ['tail_soft_curl', 'extra_side_fins'],
  ['tail_mushroom_cluster', 'extra_moth_wings'],
] as const

type MatrixRigId = Task9RigId
type MatrixMode = 'prototype' | 'full'
export interface TailExtraMatrixPlanEntry {
  rigId: MatrixRigId
  bodyFrame: string
  headShape: string
  arms: string
  legs: string
  tail: string
  extraAppendage: string
  mode: 'tail-only' | 'extra-only' | 'mixed'
}

function headForBody(bodyFrame: string): string {
  return bodyFrame === 'body_biped_tall' ? 'head_mushroom_cap' : 'head_round_dome'
}

function fixedEntry(
  rigId: MatrixRigId,
  bodyFrame: string,
  tail: string,
  extraAppendage: string,
  mode: TailExtraMatrixPlanEntry['mode'],
): TailExtraMatrixPlanEntry {
  return { rigId, bodyFrame, headShape: headForBody(bodyFrame), arms: 'arms_short_plush', legs: 'legs_stub_feet', tail, extraAppendage, mode }
}

export function makeTailExtraMatrixPlan(mode: MatrixMode): TailExtraMatrixPlanEntry[] {
  if (mode === 'prototype') return TASK9_RIG_IDS.map((rigId, index) => (
    fixedEntry(rigId, TASK9_BODIES_BY_RIG[rigId][0]!, MIXED[index]![0], MIXED[index]![1], 'mixed')
  ))
  return TASK9_RIG_IDS.flatMap(rigId => [
    ...TASK9_BODIES_BY_RIG[rigId].flatMap(bodyFrame => [
      ...TASK9_TAIL_IDS.map(tail => fixedEntry(rigId, bodyFrame, tail, 'extra_appendage_none', 'tail-only')),
      ...TASK9_EXTRA_IDS.map(extra => fixedEntry(rigId, bodyFrame, 'tail_none', extra, 'extra-only')),
    ]),
    ...MIXED.map(([tail, extra], index) => fixedEntry(
      rigId,
      TASK9_BODIES_BY_RIG[rigId][index % TASK9_BODIES_BY_RIG[rigId].length]!,
      tail,
      extra,
      'mixed',
    )),
  ])
}

export function validateTailExtraRenderEvidence(
  evidence: Pick<RenderEvidence, 'diagnostics' | 'connectorMetrics' | 'resolvedAssetPaths'> & {
    diagnosticScope?: {
      id: string
      activeVisualSlots: string[]
      activeConnectorIds: string[]
      suppressedDiagnostics: RenderEvidence['diagnostics']
    }
  },
  expectedNodePaths: readonly string[],
  targetConnectors: readonly string[],
): string[] {
  const errors = evidence.diagnostics.filter(item => item.severity === 'error').map(item => item.code)
  const scope = evidence.diagnosticScope
  if (
    scope?.id !== TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE.id
    || JSON.stringify(scope.activeVisualSlots) !== JSON.stringify(TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE.activeVisualSlots)
    || JSON.stringify(scope.activeConnectorIds) !== JSON.stringify(TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE.activeConnectorIds)
  ) errors.push('TASK9_DIAGNOSTIC_SCOPE_INVALID')
  for (const diagnostic of scope?.suppressedDiagnostics ?? []) {
    const isInactiveFace = ['COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED'].includes(diagnostic.code)
      && ['eyes', 'mouthShape'].includes(diagnostic.path[1] ?? '')
    const isInactiveNeck = diagnostic.code === 'CONNECTOR_COMPOSITE_FAILED'
      && diagnostic.path.join('/') === 'connectors/neck'
    if (!isInactiveFace && !isInactiveNeck) errors.push(`TASK9_DIAGNOSTIC_SCOPE_OVERREACH:${diagnostic.code}`)
  }
  for (const path of expectedNodePaths) {
    const calls = evidence.resolvedAssetPaths.filter(value => value === path).length
    if (calls !== 1) errors.push(`RESOLVER_CALL_COUNT:${path}:${calls}`)
  }
  for (const connectorId of targetConnectors) {
    if (!evidence.connectorMetrics.some(metric => metric.connectorId === connectorId)) errors.push(`TARGET_METRIC_MISSING:${connectorId}`)
  }
  for (const metric of evidence.connectorMetrics) {
    if (metric.connectorId === 'neck') continue
    if (metric.receiverCoverage < 0.9) errors.push(`${metric.connectorId}:receiverCoverage`)
    if (metric.plugCoverage < 0.9) errors.push(`${metric.connectorId}:plugCoverage`)
    if (metric.largestComponentRatio < 0.99) errors.push(`${metric.connectorId}:largestComponentRatio`)
    if (metric.centerlineGapPixels > 2) errors.push(`${metric.connectorId}:centerlineGapPixels`)
    if (metric.childOutsideBodyRatio !== null && metric.childOutsideBodyRatio < EXTERNAL_LIMB_ALPHA_MIN) errors.push(`${metric.connectorId}:childOutsideBodyRatio`)
  }
  const expectedMetricCount = 5 + targetConnectors.length
  if (evidence.connectorMetrics.length !== expectedMetricCount) errors.push(`CONNECTOR_METRIC_COUNT:${evidence.connectorMetrics.length}:${expectedMetricCount}`)
  return errors
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return sha256(await readFile(path)) }

const TASK9_APPROVED_FACE_SOCKET_Y = {
  head_mushroom_cap: {
    biped: { eyes: 1160, mouth: 1273 },
    blob: { eyes: 1072, mouth: 1128 },
    floating: { eyes: 1109, mouth: 1165 },
  },
  head_round_dome: {
    biped: { eyes: 1096, mouth: 1152 },
    blob: { eyes: 1033, mouth: 1089 },
    floating: { eyes: 1098, mouth: 1154 },
  },
  head_angler_bulb: {
    biped: { eyes: 1160, mouth: 1224 },
    blob: { eyes: 1144, mouth: 1200 },
    floating: { eyes: 1160, mouth: 1229 },
  },
  head_shadow_hood: {
    biped: { eyes: 1106, mouth: 1162 },
    blob: { eyes: 1045, mouth: 1101 },
    floating: { eyes: 1078, mouth: 1134 },
  },
} as const

export function task9HistoricalCausalCatalog(catalog: Catalog): Catalog {
  const projected = task8Task9HistoricalNeckWarpProjection(catalog)
  for (const [partId, rigs] of Object.entries(TASK9_APPROVED_FACE_SOCKET_Y)) {
    const part = projected.parts.find(candidate => candidate.id === partId)
    if (part?.composition?.mode !== 'interface') throw new Error(`TASK9_HISTORICAL_PROJECTION_INVALID:${partId}`)
    for (const [rigId, sockets] of Object.entries(rigs)) {
      const variant = part.composition.variantsByRig[rigId]
      if (variant?.featureSockets?.eyes === undefined || variant.featureSockets.mouth === undefined) {
        throw new Error(`TASK9_HISTORICAL_PROJECTION_INVALID:${partId}:${rigId}`)
      }
      variant.featureSockets.eyes.y = sockets.eyes
      variant.featureSockets.mouth.y = sockets.mouth
    }
  }
  if (projected.compositionPolicy === undefined) throw new Error('TASK9_HISTORICAL_PROJECTION_INVALID:compositionPolicy')
  projected.compositionPolicy.frameBounds = { x: 96, y: 64, width: 1856, height: 1888 }
  projected.compositionPolicy.faceInsideRatio = 0.8
  projected.compositionPolicy.faceVisibleRatio = 0.85
  return projected
}

export function task9StructuralCatalogProjectionSha256(catalog: Catalog): string {
  const historical = task9HistoricalCausalCatalog(catalog)
  const task9Slots = new Set(STRUCTURAL_SLOT_IDS)
  const projection = {
    version: historical.version,
    rigs: historical.rigs,
    parts: historical.parts.filter(part => task9Slots.has(part.slotId)),
    compositionPolicy: historical.compositionPolicy,
    transitionBridges: historical.transitionBridges,
  }
  return sha256(Buffer.from(JSON.stringify(projection)))
}

export async function cleanupTailExtraRenderHarness(input: {
  tempRoot?: string
  page?: { close(): Promise<unknown> }
  browser?: { close(): Promise<unknown> }
  server?: { close(): Promise<unknown> }
}): Promise<void> {
  const operations: Array<() => Promise<unknown>> = []
  if (input.page !== undefined) operations.push(() => input.page!.close())
  if (input.browser !== undefined) operations.push(() => input.browser!.close())
  if (input.server !== undefined) operations.push(() => input.server!.close())
  if (input.tempRoot !== undefined && input.tempRoot !== '') operations.push(() => rm(input.tempRoot!, { recursive: true, force: true }))
  const failures: unknown[] = []
  for (const operation of operations) {
    try { await operation() } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Tail/extra render harness cleanup failed')
}

export async function resolveMatrixResourcePath(repositoryRoot: string, browserPath: string): Promise<string> {
  if (!browserPath.startsWith('/@fs/')) throw new Error(`TAIL_EXTRA_MATRIX_EVIDENCE_INVALID: unresolved asset path ${browserPath}`)
  return resolveExistingContainedPath(repositoryRoot, resolvedFsPath(browserPath))
}

interface MatrixEvidenceEntry extends TailExtraMatrixPlanEntry {
  original: Buffer
  connectorMetrics: ConnectorMetric[]
  compositionMetrics?: RenderEvidence['compositionMetrics']
  resolvedAssetPaths: string[]
  diagnostics: RenderEvidence['diagnostics']
  diagnosticScope?: {
    id: string
    activeVisualSlots: string[]
    activeConnectorIds: string[]
    suppressedDiagnostics: RenderEvidence['diagnostics']
  }
  gateErrors: string[]
  inputBinding: { catalogSha256: string, resolvedAssetHashes: Array<{ path: string, sha256: string }> }
}

type Task9RenderEvidence = RenderEvidence & { diagnosticScope?: MatrixEvidenceEntry['diagnosticScope'] }

export function task9HistoricalDiagnosticProjection(
  evidence: Task9RenderEvidence,
  rigId: MatrixRigId,
): Task9RenderEvidence {
  const projected = structuredClone(evidence)
  const neckMetric = projected.connectorMetrics?.find(metric => metric.connectorId === 'neck')
  const needsApprovedNeckDiagnostic = neckMetric !== undefined && (
    neckMetric.receiverCoverage < 0.9
    || neckMetric.plugCoverage < 0.9
    || neckMetric.centerlineGapPixels > 2
  )
  const isThresholdNeckDiagnostic = (diagnostic: RenderEvidence['diagnostics'][number]) => (
    diagnostic.code === 'CONNECTOR_COMPOSITE_FAILED'
    && diagnostic.path.join('/') === 'connectors/neck'
    && diagnostic.message.startsWith('Bridge ')
    && diagnostic.message.includes(' is below ')
  )
  const projectDiagnostics = (diagnostics: RenderEvidence['diagnostics']) => [
    ...(needsApprovedNeckDiagnostic ? [{
      severity: 'error' as const,
      code: 'CONNECTOR_COMPOSITE_FAILED' as const,
      path: ['connectors', 'neck'],
      message: `Bridge ${rigId}-neck-bridge is below 0.9 contour coverage or above a 2px gap.`,
    }] : []),
    ...diagnostics.filter(diagnostic => !isThresholdNeckDiagnostic(diagnostic)),
  ]
  if (projected.diagnosticScope === undefined) {
    projected.diagnostics = projectDiagnostics(projected.diagnostics)
  } else {
    projected.diagnostics = projected.diagnostics.filter(diagnostic => !isThresholdNeckDiagnostic(diagnostic))
    projected.diagnosticScope.suppressedDiagnostics = projectDiagnostics(projected.diagnosticScope.suppressedDiagnostics)
  }
  return projected
}

interface TailExtraMatrixArtifactBinding {
  rigId: MatrixRigId
  entryCount: number
  originalPath: string
  originalSha256: string
  review256Path: string
  review256Sha256: string
  manifestPath: string
  manifestSha256: string
}

export function buildTailExtraMatrixIndex(artifacts: TailExtraMatrixArtifactBinding[]) {
  const expectedRigs: MatrixRigId[] = ['blob', 'biped', 'floating']
  if (artifacts.length !== expectedRigs.length || expectedRigs.some(rigId => artifacts.filter(artifact => artifact.rigId === rigId).length !== 1)) {
    throw new Error('TAIL_EXTRA_MATRIX_INDEX_INVALID: expected exactly one artifact binding per rig')
  }
  const ordered = expectedRigs.map(rigId => artifacts.find(artifact => artifact.rigId === rigId)!)
  return {
    schemaVersion: 'task9-tail-extra-structural-matrix-index-v1',
    status: 'agent-part-review-machine-pass',
    entryCount: ordered.reduce((sum, artifact) => sum + artifact.entryCount, 0),
    entryCountByRig: Object.fromEntries(ordered.map(artifact => [artifact.rigId, artifact.entryCount])),
    artifacts: ordered,
  }
}

function portableMatrixPath(path: string, repositoryRoot = ROOT): string {
  const fsPath = path.startsWith('/@fs/') ? resolvedFsPath(path) : path
  if (!isAbsolute(fsPath)) return fsPath.replaceAll('\\', '/')
  const portable = relative(repositoryRoot, resolve(fsPath))
  if (portable === '..' || portable.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(portable)) {
    throw new Error(`TAIL_EXTRA_MATRIX_EVIDENCE_INVALID: path escapes repository: ${path}`)
  }
  return portable.replaceAll('\\', '/')
}

function normalizeMatrixManifestPaths(manifest: any): any {
  const normalized = structuredClone(manifest)
  normalized.originalPath = portableMatrixPath(normalized.originalPath)
  normalized.review256Path = portableMatrixPath(normalized.review256Path)
  for (const entry of normalized.entries) {
    entry.resolvedAssetPaths = entry.resolvedAssetPaths.map(portableMatrixPath)
    entry.inputBinding.resolvedAssetHashes = entry.inputBinding.resolvedAssetHashes.map((binding: { path: string, sha256: string }) => ({
      ...binding,
      path: portableMatrixPath(binding.path),
    }))
  }
  return normalized
}

export async function writeTailExtraMatrixIndexFromExistingManifests() {
  const artifacts: TailExtraMatrixArtifactBinding[] = []
  const catalogPath = await resolveExistingContainedPath(ROOT, join(ROOT, 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json'))
  const structuralProjectionSha256 = task9StructuralCatalogProjectionSha256(JSON.parse(await readFile(catalogPath, 'utf8')) as Catalog)
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const manifestPath = join(REVIEW_ROOT, `structural-matrix-${rigId}-manifest.json`)
    const manifestInput = await resolveExistingContainedPath(ROOT, manifestPath)
    const manifest = normalizeMatrixManifestPaths(JSON.parse((await readFile(manifestInput)).toString('utf8')))
    manifest.structuralProjectionSha256 = structuralProjectionSha256
    manifest.renderScope = { paletteMasks: false }
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(manifestPath, manifestBytes)
    artifacts.push({
      rigId,
      entryCount: manifest.entryCount,
      originalPath: manifest.originalPath,
      originalSha256: manifest.originalSha256,
      review256Path: manifest.review256Path,
      review256Sha256: manifest.review256Sha256,
      manifestPath: portableMatrixPath(manifestPath),
      manifestSha256: sha256(manifestBytes),
    })
  }
  const index = { ...buildTailExtraMatrixIndex(artifacts), structuralProjectionSha256, renderScope: { paletteMasks: false } }
  const indexPath = join(REVIEW_ROOT, 'structural-matrix-index.json')
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`)
  await writeFile(indexPath, indexBytes)
  return { index, indexPath: portableMatrixPath(indexPath), indexSha256: sha256(indexBytes) }
}

export async function reconstructTailExtraMatrixEvidence(input: {
  mode?: MatrixMode
  failOnGateError?: boolean
  repositoryRoot?: string
  catalogPath?: string
  plan?: TailExtraMatrixPlanEntry[]
  diagnosticScope?: false
  catalogProjection?: (catalog: Catalog) => Catalog
  historicalDiagnostics?: boolean
} = {}): Promise<{ mode: MatrixMode, catalogInputSha256: string, structuralProjectionSha256: string, entries: MatrixEvidenceEntry[] }> {
  const mode = input.mode ?? 'full'
  const repositoryRoot = resolve(input.repositoryRoot ?? ROOT)
  const plan = input.plan ?? makeTailExtraMatrixPlan(mode)
  const catalogPath = await resolveExistingContainedPath(
    repositoryRoot,
    resolve(input.catalogPath ?? join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json')),
  )
  const catalogBytes = await readFile(catalogPath)
  const sourceCatalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog
  const catalogInputSha256 = sha256(catalogBytes)
  const structuralProjectionSha256 = task9StructuralCatalogProjectionSha256(sourceCatalog)
  const renderSourceCatalog = input.catalogProjection?.(sourceCatalog) ?? sourceCatalog
  const catalog = browserCatalog(renderSourceCatalog, {
    activeStructuralSlots: STRUCTURAL_SLOT_IDS,
    applyPaletteMasks: false,
  })
  const tempRoot = await mkdtemp(join(repositoryRoot, '.tmp-tail-extra-matrix-'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>> | undefined
  const hashCache = new Map<string, string>()
  const entries: MatrixEvidenceEntry[] = []
  try {
    server = await createServer({ root: join(repositoryRoot, 'apps', 'creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await server.listen()
    const baseUrl = server.resolvedUrls?.local[0]
    if (baseUrl === undefined) throw new Error('TAIL_EXTRA_MATRIX_RENDER_FAILED: Vite server has no local URL')
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    for (let index = 0; index < plan.length; index += 1) {
      const selection = plan[index]!
      const spec = makeSpec(catalog, selection, index)
      spec.visualSlots.tail = { partId: selection.tail, rigId: selection.rigId }
      spec.visualSlots.extraAppendage = { partId: selection.extraAppendage, rigId: selection.rigId }
      const inputPath = join(tempRoot, `${index.toString().padStart(3, '0')}.json`)
      await writeFile(inputPath, `${JSON.stringify({
        catalog,
        spec,
        applyPaletteMasks: false,
        ...(input.historicalDiagnostics === true
          ? {
              connectorMetricProjection: 'task8-task9-neutral-bridge-v1',
              bridgeRoleProjection: 'task8-task9-cross-product-v1',
            }
          : {}),
        ...(input.diagnosticScope === false ? {} : { diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE }),
      })}\n`)
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const browserError = await page.evaluate(() => document.body.dataset.renderError)
      if (browserError !== undefined) throw new Error(`TAIL_EXTRA_MATRIX_RENDER_FAILED:${browserError}`)
      const browserEvidence = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as RenderEvidence & {
        diagnosticScope?: MatrixEvidenceEntry['diagnosticScope']
      }
      const evidence = input.historicalDiagnostics === true
        ? task9HistoricalDiagnosticProjection(browserEvidence, selection.rigId)
        : browserEvidence
      const targetParts = [selection.tail, selection.extraAppendage]
        .map(id => catalog.parts.find(part => part.id === id)!)
        .filter(part => part.composition?.mode === 'interface')
      const expectedNodePaths = targetParts.flatMap(part => (
        part.composition?.mode === 'interface'
          ? part.composition.variantsByRig[selection.rigId]!.renderNodes.map(node => node.assetPath)
          : []
      ))
      const targetConnectors = targetParts.flatMap(part => (
        part.composition?.mode === 'interface'
          ? part.composition.variantsByRig[selection.rigId]!.connectors.map(connector => connector.id)
          : []
      ))
      const gateErrors = validateTailExtraRenderEvidence(evidence, expectedNodePaths, targetConnectors)
      if (input.failOnGateError === true && gateErrors.length > 0) {
        throw new Error(`TAIL_EXTRA_MATRIX_GATE_FAILED:${selection.rigId}:${selection.bodyFrame}:${selection.tail}:${selection.extraAppendage}:${gateErrors.join(',')}:metrics=${JSON.stringify(evidence.connectorMetrics)}:diagnostics=${JSON.stringify(evidence.diagnostics)}`)
      }
      const dataUrl = await page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
      const original = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      const resolvedAssetHashes = await Promise.all([...new Set(evidence.resolvedAssetPaths)].map(async path => {
        let digest = hashCache.get(path)
        if (digest === undefined) { digest = await hashFile(await resolveMatrixResourcePath(repositoryRoot, path)); hashCache.set(path, digest) }
        return { path: portableMatrixPath(path, repositoryRoot), sha256: digest }
      }))
      entries.push({ ...selection, original, connectorMetrics: evidence.connectorMetrics, compositionMetrics: evidence.compositionMetrics, resolvedAssetPaths: evidence.resolvedAssetPaths.map(path => portableMatrixPath(path, repositoryRoot)), diagnostics: evidence.diagnostics, diagnosticScope: evidence.diagnosticScope, gateErrors, inputBinding: { catalogSha256: catalogInputSha256, resolvedAssetHashes } })
    }
  } finally {
    await cleanupTailExtraRenderHarness({ tempRoot, page, browser, server })
  }
  return { mode, catalogInputSha256, structuralProjectionSha256, entries }
}

export async function validateStoredTailExtraMatrixEvidence(input: {
  repositoryRoot: string
  catalogPath?: string
  reviewRoot?: string
  plan?: TailExtraMatrixPlanEntry[]
}): Promise<{
  diagnostics: string[]
  entryCount: number
  entryCountByRig: Record<MatrixRigId, number>
}> {
  const repositoryRoot = resolve(input.repositoryRoot)
  const reviewRoot = resolve(input.reviewRoot ?? join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0'))
  const live = await reconstructTailExtraMatrixEvidence({
    mode: 'full',
    failOnGateError: false,
    repositoryRoot,
    catalogPath: input.catalogPath,
    plan: input.plan,
    catalogProjection: task9HistoricalCausalCatalog,
    historicalDiagnostics: true,
  })
  const fullRoster = input.plan === undefined
  const diagnostics: string[] = []
  const entryCountByRig = { blob: 0, biped: 0, floating: 0 }

  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const manifestPath = await resolveExistingContainedPath(repositoryRoot, join(reviewRoot, `structural-matrix-${rigId}-manifest.json`))
    let manifest: any
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch {
      diagnostics.push(`TAIL_EXTRA_MATRIX_MANIFEST_INVALID:${rigId}`)
      continue
    }
    const liveEntries = live.entries.filter(entry => entry.rigId === rigId)
    entryCountByRig[rigId] = liveEntries.length
    if (manifest.schemaVersion !== 'task9-tail-extra-structural-matrix-v1' || manifest.mode !== 'full' || manifest.rigId !== rigId) {
      diagnostics.push(`TAIL_EXTRA_MATRIX_MANIFEST_HEADER_MISMATCH:${rigId}`)
    }
    if (manifest.structuralProjectionSha256 !== live.structuralProjectionSha256) {
      diagnostics.push(`TAIL_EXTRA_MATRIX_STRUCTURAL_PROJECTION_MISMATCH:${rigId}`)
    }
    if (manifest.renderScope?.paletteMasks !== false) {
      diagnostics.push(`TAIL_EXTRA_MATRIX_RENDER_SCOPE_MISMATCH:${rigId}`)
    }
    if (!Array.isArray(manifest.entries) || (fullRoster && (manifest.entryCount !== liveEntries.length || manifest.entries.length !== liveEntries.length))) {
      diagnostics.push(`TAIL_EXTRA_MATRIX_ENTRY_COUNT_MISMATCH:${rigId}`)
      continue
    }
    if (manifest.entries.some((entry: any) => entry.inputBinding?.catalogSha256 !== manifest.catalogInputSha256)) {
      diagnostics.push(`TAIL_EXTRA_MATRIX_HISTORIC_CATALOG_BINDING_MISMATCH:${rigId}`)
    }
    for (const liveEntryWithFrame of liveEntries) {
      const { original, ...liveEntry } = liveEntryWithFrame
      const identityKeys: Array<keyof TailExtraMatrixPlanEntry> = ['rigId', 'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage', 'mode']
      const stored = manifest.entries.find((entry: any) => identityKeys.every(key => entry[key] === liveEntry[key]))
      const identity = `${liveEntry.bodyFrame}:${liveEntry.tail}:${liveEntry.extraAppendage}`
      if (stored === undefined) {
        diagnostics.push(`TAIL_EXTRA_MATRIX_IDENTITY_MISSING:${rigId}:${identity}`)
        continue
      }
      const { inputBinding: liveBinding, ...liveComparable } = liveEntry
      const { inputBinding: storedBinding, originalSha256: storedOriginalSha256, ...storedComparable } = stored
      if (
        JSON.stringify(storedComparable) !== JSON.stringify(liveComparable)
        || JSON.stringify(storedBinding?.resolvedAssetHashes) !== JSON.stringify(liveBinding.resolvedAssetHashes)
        || storedOriginalSha256 !== sha256(original)
      ) {
        diagnostics.push(`TAIL_EXTRA_MATRIX_ENTRY_MISMATCH:${rigId}:${identity}`)
      }
    }
  }

  return { diagnostics, entryCount: live.entries.length, entryCountByRig }
}

function escapeXml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;') }
async function cell(image: Buffer, entry: TailExtraMatrixPlanEntry, size: 512 | 256): Promise<Buffer> {
  const labelHeight = size === 512 ? 70 : 46
  const artHeight = size - labelHeight
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${labelHeight}"><rect width="100%" height="100%" fill="#253039"/><text x="${size === 512 ? 12 : 6}" y="${size === 512 ? 25 : 16}" fill="#fff" font-family="Arial,sans-serif" font-size="${size === 512 ? 17 : 9}">${escapeXml(`${entry.bodyFrame} · ${entry.mode}`)}</text><text x="${size === 512 ? 12 : 6}" y="${size === 512 ? 52 : 35}" fill="#c9dae2" font-family="Arial,sans-serif" font-size="${size === 512 ? 14 : 7}">${escapeXml(`${entry.tail} × ${entry.extraAppendage}`)}</text></svg>`)
  const checker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${artHeight}"><defs><pattern id="p" width="${size === 512 ? 32 : 16}" height="${size === 512 ? 32 : 16}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#f4f1e8"/><rect width="50%" height="50%" fill="#e8e4d9"/><rect x="50%" y="50%" width="50%" height="50%" fill="#e8e4d9"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`)
  const art = await sharp(image).resize(size, artHeight, { fit: 'contain' }).png(PNG).toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: '#f4f1e8' } }).composite([{ input: checker, left: 0, top: 0 }, { input: art, left: 0, top: 0 }, { input: label, left: 0, top: artHeight }]).png(PNG).toBuffer()
}

export async function renderTailExtraStructuralMatrices(mode: MatrixMode): Promise<{ mode: MatrixMode, entryCount: number, failureCount: number, records: any[] }> {
  const { entries, catalogInputSha256, structuralProjectionSha256 } = await reconstructTailExtraMatrixEvidence({ mode, failOnGateError: true })
  const records = []
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const rigEntries = entries.filter(entry => entry.rigId === rigId)
    const originals = await Promise.all(rigEntries.map(entry => cell(entry.original, entry, 512)))
    const smalls = await Promise.all(rigEntries.map(entry => cell(entry.original, entry, 256)))
    const columns = Math.min(3, rigEntries.length)
    const rows = Math.ceil(rigEntries.length / columns)
    const buildSheet = (cells: Buffer[], size: 512 | 256) => sharp({ create: { width: columns * size, height: rows * size, channels: 4, background: '#eee9de' } }).composite(cells.map((input, index) => ({ input, left: index % columns * size, top: Math.floor(index / columns) * size }))).png(PNG).toBuffer()
    const original = await buildSheet(originals, 512)
    const review256 = await buildSheet(smalls, 256)
    const suffix = mode === 'prototype' ? '-prototype' : ''
    const originalPath = join(REVIEW_ROOT, `structural-matrix-${rigId}${suffix}.png`)
    const review256Path = join(REVIEW_ROOT, `structural-matrix-${rigId}${suffix}-256.png`)
    await mkdir(dirname(originalPath), { recursive: true })
    await writeFile(originalPath, original); await writeFile(review256Path, review256)
    const manifest = {
      schemaVersion: 'task9-tail-extra-structural-matrix-v1', status: 'agent-part-review-machine-pass', mode, rigId,
      entryCount: rigEntries.length, catalogInputSha256, structuralProjectionSha256, renderScope: { paletteMasks: false },
      originalPath: portableMatrixPath(originalPath), originalSha256: sha256(original),
      review256Path: portableMatrixPath(review256Path), review256Sha256: sha256(review256),
      thresholds: { receiverCoverageMin: 0.9, plugCoverageMin: 0.9, largestComponentRatioMin: 0.99, centerlineGapPixelsMax: 2, childOutsideBodyRatioMin: EXTERNAL_LIMB_ALPHA_MIN },
      entries: rigEntries.map(({ original: frame, ...entry }) => ({ ...entry, originalSha256: sha256(frame) })),
    }
    const manifestPath = join(REVIEW_ROOT, `structural-matrix-${rigId}${suffix}-manifest.json`)
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(manifestPath, manifestBytes)
    records.push({ ...manifest, manifestPath: portableMatrixPath(manifestPath), manifestSha256: sha256(manifestBytes) })
  }
  if (mode === 'full') await writeTailExtraMatrixIndexFromExistingManifests()
  return { mode, entryCount: entries.length, failureCount: entries.filter(entry => entry.gateErrors.length > 0).length, records }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--index-only')) console.log(JSON.stringify(await writeTailExtraMatrixIndexFromExistingManifests()))
  else {
    const mode: MatrixMode = process.argv.includes('--full') ? 'full' : 'prototype'
    console.log(JSON.stringify(await renderTailExtraStructuralMatrices(mode)))
  }
}
