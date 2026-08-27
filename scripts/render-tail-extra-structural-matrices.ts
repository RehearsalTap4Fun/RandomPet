import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import type { Catalog } from '@qmonster/generator-core'
import { EXTERNAL_LIMB_ALPHA_MIN, type ConnectorMetric } from '@qmonster/renderer-canvas'
import sharp from 'sharp'
import { createServer } from 'vite'
import {
  BODIES,
  browserCatalog,
  fsUrl,
  makeSpec,
  resolvedFsPath,
  type RenderEvidence,
} from './render-limb-contact-sheets.js'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'packages', 'asset-catalog', 'review', 'v0.3.0')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const TAILS = ['tail_fish_fan', 'tail_soft_curl', 'tail_mushroom_cluster'] as const
const EXTRAS = ['extra_moth_wings', 'extra_soft_tentacles', 'extra_side_fins'] as const
const MIXED = [
  ['tail_fish_fan', 'extra_soft_tentacles'],
  ['tail_soft_curl', 'extra_side_fins'],
  ['tail_mushroom_cluster', 'extra_moth_wings'],
] as const

type MatrixRigId = keyof typeof BODIES
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
  if (mode === 'prototype') return (['blob', 'biped', 'floating'] as const).map((rigId, index) => (
    fixedEntry(rigId, BODIES[rigId][0], MIXED[index]![0], MIXED[index]![1], 'mixed')
  ))
  return (['blob', 'biped', 'floating'] as const).flatMap(rigId => [
    ...BODIES[rigId].flatMap(bodyFrame => [
      ...TAILS.map(tail => fixedEntry(rigId, bodyFrame, tail, 'extra_appendage_none', 'tail-only')),
      ...EXTRAS.map(extra => fixedEntry(rigId, bodyFrame, 'tail_none', extra, 'extra-only')),
    ]),
    ...MIXED.map(([tail, extra], index) => fixedEntry(
      rigId,
      BODIES[rigId][index % BODIES[rigId].length],
      tail,
      extra,
      'mixed',
    )),
  ])
}

export function validateTailExtraRenderEvidence(
  evidence: Pick<RenderEvidence, 'diagnostics' | 'connectorMetrics' | 'resolvedAssetPaths'>,
  expectedNodePaths: readonly string[],
  targetConnectors: readonly string[],
): string[] {
  const errors = evidence.diagnostics.filter(item => (
    item.severity === 'error'
    && !(item.code === 'CONNECTOR_COMPOSITE_FAILED' && item.path.join('/') === 'connectors/neck')
    && !['COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED'].includes(item.code)
  )).map(item => item.code)
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

interface MatrixEvidenceEntry extends TailExtraMatrixPlanEntry {
  original: Buffer
  connectorMetrics: ConnectorMetric[]
  compositionMetrics?: RenderEvidence['compositionMetrics']
  resolvedAssetPaths: string[]
  diagnostics: RenderEvidence['diagnostics']
  gateErrors: string[]
  inputBinding: { catalogSha256: string, resolvedAssetHashes: Array<{ path: string, sha256: string }> }
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

function portableMatrixPath(path: string): string {
  const fsPath = path.startsWith('/@fs/') ? resolvedFsPath(path) : path
  if (!isAbsolute(fsPath)) return fsPath.replaceAll('\\', '/')
  const portable = relative(ROOT, resolve(fsPath))
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
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const manifestPath = join(REVIEW_ROOT, `structural-matrix-${rigId}-manifest.json`)
    const manifest = normalizeMatrixManifestPaths(JSON.parse((await readFile(manifestPath)).toString('utf8')))
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
  const index = buildTailExtraMatrixIndex(artifacts)
  const indexPath = join(REVIEW_ROOT, 'structural-matrix-index.json')
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`)
  await writeFile(indexPath, indexBytes)
  return { index, indexPath: portableMatrixPath(indexPath), indexSha256: sha256(indexBytes) }
}

export async function reconstructTailExtraMatrixEvidence(input: {
  mode?: MatrixMode
  failOnGateError?: boolean
} = {}): Promise<{ mode: MatrixMode, catalogInputSha256: string, entries: MatrixEvidenceEntry[] }> {
  const mode = input.mode ?? 'full'
  const plan = makeTailExtraMatrixPlan(mode)
  const catalogPath = join(ROOT, 'packages', 'asset-catalog', 'catalog', 'v0.3.0', 'catalog.json')
  const catalogBytes = await readFile(catalogPath)
  const sourceCatalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog
  const catalogInputSha256 = sha256(catalogBytes)
  const catalog = browserCatalog(sourceCatalog, { activeStructuralSlots: ['bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage'] })
  const tempRoot = await mkdtemp(join(ROOT, '.tmp-tail-extra-matrix-'))
  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('TAIL_EXTRA_MATRIX_RENDER_FAILED: Vite server has no local URL')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const hashCache = new Map<string, string>()
  const entries: MatrixEvidenceEntry[] = []
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const selection = plan[index]!
      const spec = makeSpec(catalog, selection, index)
      spec.visualSlots.tail = { partId: selection.tail, rigId: selection.rigId }
      spec.visualSlots.extraAppendage = { partId: selection.extraAppendage, rigId: selection.rigId }
      const inputPath = join(tempRoot, `${index.toString().padStart(3, '0')}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog, spec })}\n`)
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      const browserError = await page.evaluate(() => document.body.dataset.renderError)
      if (browserError !== undefined) throw new Error(`TAIL_EXTRA_MATRIX_RENDER_FAILED:${browserError}`)
      const evidence = await page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as RenderEvidence
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
        if (digest === undefined) { digest = await hashFile(resolvedFsPath(path)); hashCache.set(path, digest) }
        return { path: portableMatrixPath(path), sha256: digest }
      }))
      entries.push({ ...selection, original, connectorMetrics: evidence.connectorMetrics, compositionMetrics: evidence.compositionMetrics, resolvedAssetPaths: evidence.resolvedAssetPaths.map(portableMatrixPath), diagnostics: evidence.diagnostics, gateErrors, inputBinding: { catalogSha256: catalogInputSha256, resolvedAssetHashes } })
    }
  } finally {
    await page.close(); await browser.close(); await server.close(); await rm(tempRoot, { recursive: true, force: true })
  }
  return { mode, catalogInputSha256, entries }
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
  const { entries, catalogInputSha256 } = await reconstructTailExtraMatrixEvidence({ mode, failOnGateError: true })
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
      entryCount: rigEntries.length, catalogInputSha256,
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
