import {
  compositionMetricsMeetThresholds,
  CONNECTOR_PLUG_COVERAGE_MIN,
  CONNECTOR_RECEIVER_COVERAGE_MIN,
  CONNECTOR_GAP_MAX_1024,
  connectorMetricMeetsThresholds,
  EXTERNAL_LIMB_ALPHA_MIN,
  STRUCTURE_ALPHA_MASS_MIN,
  structureMetricMeetsThreshold,
  type ConnectorMetric,
} from '@qmonster/renderer-canvas'
import type { Catalog } from '@qmonster/generator-core'
import type { BipedSliceEntry } from './render-biped-interface-slice.js'
import type { BipedSliceManifest } from './render-biped-interface-slice.js'
import {
  BIPED_SLICE_COLUMNS,
  BIPED_SLICE_ENTRY_COUNT,
  BIPED_SLICE_OPTIONS,
  BIPED_SLICE_ROWS,
} from './render-biped-interface-slice.js'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

export function makeValidSliceEntry(): BipedSliceEntry {
  const metric: ConnectorMetric = {
    connectorId: 'neck',
    receiverCoverage: CONNECTOR_RECEIVER_COVERAGE_MIN,
    plugCoverage: CONNECTOR_PLUG_COVERAGE_MIN,
    largestComponentRatio: STRUCTURE_ALPHA_MASS_MIN,
    centerlineGapPixels: CONNECTOR_GAP_MAX_1024,
    childOutsideBodyRatio: EXTERNAL_LIMB_ALPHA_MIN,
  }
  return {
    index: 0,
    structuralKey: 'body_biped_peanut|head_mushroom_cap|arms_short_plush|legs_webbed',
    selections: {
      bodyFrame: 'body_biped_peanut',
      headShape: 'head_mushroom_cap',
      arms: 'arms_short_plush',
      legs: 'legs_webbed',
    },
    originalPngPath: 'entries/00.png',
    review256PngPath: 'entries-256/00.png',
    diagnostics: [],
    connectorMetrics: ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']
      .map(connectorId => ({ ...metric, connectorId })),
    compositionMetrics: {
      eyesInsideRatio: 1,
      eyesVisibleRatio: 1,
      mouthInsideRatio: 1,
      mouthVisibleRatio: 1,
      visibleBounds: { x: 128, y: 128, width: 1792, height: 1792 },
    },
    originalSha256: 'a'.repeat(64),
    review256Sha256: 'b'.repeat(64),
  }
}

const REQUIRED_CONNECTOR_IDS = ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight'] as const

export function assertBipedSliceEntry(
  entry: BipedSliceEntry,
  compositionPolicy: NonNullable<Catalog['compositionPolicy']>,
): void {
  const connectorIds = entry.connectorMetrics.map(metric => metric.connectorId)
  const connectorIdSet = new Set(connectorIds)
  const invalid = entry.diagnostics.length > 0
    || connectorIds.length !== REQUIRED_CONNECTOR_IDS.length
    || connectorIdSet.size !== REQUIRED_CONNECTOR_IDS.length
    || REQUIRED_CONNECTOR_IDS.some(connectorId => !connectorIdSet.has(connectorId))
    || entry.connectorMetrics.some(metric => (
      !connectorMetricMeetsThresholds(metric, /^(shoulder|hip)/u.test(metric.connectorId))
      || !structureMetricMeetsThreshold(metric)
    ))
    || !compositionMetricsMeetThresholds(entry.compositionMetrics, compositionPolicy)
  if (invalid) throw new Error(`BIPED_SLICE_INVALID: ${entry.structuralKey}`)
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const ACCEPTANCE_FILENAME = 'biped-vertical-slice-acceptance.json'
const CANONICAL_ACCEPTANCE_PATH = 'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json'

async function findAcceptanceRecords(root: string): Promise<string[]> {
  const records: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') await visit(join(directory, entry.name))
      } else if (entry.isFile() && entry.name === ACCEPTANCE_FILENAME) records.push(join(directory, entry.name))
    }
  }
  await visit(root)
  return records
}

export async function validateBipedSliceReview(
  manifestPath: string,
  options: { repositoryRoot?: string, catalogPath?: string } = {},
): Promise<{ entryCount: number, diagnostics: string[] }> {
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as BipedSliceManifest
  const diagnostics: string[] = []
  const catalog = JSON.parse(await readFile(resolve(
    options.catalogPath ?? 'packages/asset-catalog/catalog/v0.3.0/catalog.json',
  ), 'utf8')) as Catalog
  const compositionPolicy = catalog.compositionPolicy
  if (compositionPolicy === undefined) diagnostics.push('canonical catalog composition policy missing')
  if (manifest.catalogVersion !== '0.3.0' || manifest.rendererVersion !== '0.3.0' || manifest.rigId !== 'biped') diagnostics.push('version/rig mismatch')
  const canonicalKeys = new Set<string>()
  for (const bodyFrame of BIPED_SLICE_OPTIONS.bodyFrame) {
    for (const headShape of BIPED_SLICE_OPTIONS.headShape) {
      for (const arms of BIPED_SLICE_OPTIONS.arms) {
        for (const legs of BIPED_SLICE_OPTIONS.legs) canonicalKeys.add([bodyFrame, headShape, arms, legs].join('|'))
      }
    }
  }
  const actualKeys = new Set(manifest.entries.map(entry => entry.structuralKey))
  if (
    manifest.entryCount !== BIPED_SLICE_ENTRY_COUNT
    || manifest.entries.length !== BIPED_SLICE_ENTRY_COUNT
    || actualKeys.size !== BIPED_SLICE_ENTRY_COUNT
    || [...canonicalKeys].some(key => !actualKeys.has(key))
  ) diagnostics.push(`slice roster is not canonical ${BIPED_SLICE_ENTRY_COUNT} unique two-head entries`)
  for (const entry of manifest.entries) {
    if (compositionPolicy !== undefined) {
      try { assertBipedSliceEntry(entry, compositionPolicy) } catch (caught) { diagnostics.push(caught instanceof Error ? caught.message : String(caught)) }
    }
    for (const [path, expected, size] of [
      [entry.originalPngPath, entry.originalSha256, 2048],
      [entry.review256PngPath, entry.review256Sha256, 256],
    ] as const) {
      try {
        const bytes = await readFile(resolve(path))
        const metadata = await sharp(bytes).metadata()
        if (hash(bytes) !== expected || metadata.width !== size || metadata.height !== size || metadata.hasAlpha !== true) diagnostics.push(`entry bytes invalid: ${path}`)
      } catch { diagnostics.push(`entry missing: ${path}`) }
    }
  }
  for (const [path, expected, width, height] of [
    [manifest.sheetPath, manifest.sheetSha256, BIPED_SLICE_COLUMNS * 512, BIPED_SLICE_ROWS * 512],
    [manifest.review256SheetPath, manifest.review256SheetSha256, BIPED_SLICE_COLUMNS * 256, BIPED_SLICE_ROWS * 256],
  ] as const) {
    if (path === undefined || expected === undefined) { diagnostics.push('contact sheet declaration missing'); continue }
    try {
      const bytes = await readFile(resolve(path))
      const metadata = await sharp(bytes).metadata()
      if (hash(bytes) !== expected || metadata.width !== width || metadata.height !== height || metadata.hasAlpha !== true) diagnostics.push(`contact sheet bytes invalid: ${path}`)
    } catch { diagnostics.push(`contact sheet missing: ${path}`) }
  }
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const canonicalAcceptancePath = resolve(repositoryRoot, CANONICAL_ACCEPTANCE_PATH)
  const acceptanceRecords = await findAcceptanceRecords(repositoryRoot)
  if (acceptanceRecords.length === 0) {
    diagnostics.push('canonical acceptance record missing')
  } else {
    if (acceptanceRecords.length !== 1) diagnostics.push(`canonical acceptance record must be unique: found ${acceptanceRecords.length}`)
    const hasCanonicalAcceptance = acceptanceRecords.some(record => resolve(record) === canonicalAcceptancePath)
    if (!hasCanonicalAcceptance) {
      diagnostics.push(`canonical acceptance record must use exact path: ${CANONICAL_ACCEPTANCE_PATH}`)
    } else {
      try {
        const acceptance = JSON.parse(await readFile(canonicalAcceptancePath, 'utf8')) as Record<string, unknown>
        const sheetBytes = manifest.sheetPath === undefined ? null : await readFile(resolve(manifest.sheetPath))
        const review256Bytes = manifest.review256SheetPath === undefined ? null : await readFile(resolve(manifest.review256SheetPath))
        if (acceptance.catalogVersion !== '0.3.0') diagnostics.push('canonical acceptance catalogVersion must be 0.3.0')
        if (acceptance.rendererVersion !== '0.3.0') diagnostics.push('canonical acceptance rendererVersion must be 0.3.0')
        if (typeof acceptance.reviewedAt !== 'string' || !Number.isFinite(Date.parse(acceptance.reviewedAt))) {
          diagnostics.push('canonical acceptance reviewedAt must be a valid timestamp')
        }
        if (
          acceptance.decision !== 'approved'
          || acceptance.reviewer !== 'user'
          || acceptance.userApproved !== true
          || acceptance.approvalResponse !== 'A'
          || acceptance.entryCount !== BIPED_SLICE_ENTRY_COUNT
          || sheetBytes === null
          || review256Bytes === null
          || acceptance.contactSheetSha256 !== hash(sheetBytes)
          || acceptance.contactSheetSha256 !== manifest.sheetSha256
          || acceptance.review256ContactSheetSha256 !== hash(review256Bytes)
          || acceptance.review256ContactSheetSha256 !== manifest.review256SheetSha256
          || acceptance.manifestSha256 !== hash(manifestBytes)
        ) diagnostics.push('canonical acceptance record does not match the approved live review bytes')
      } catch {
        diagnostics.push('canonical acceptance record does not match the approved live review bytes')
      }
    }
  }
  return { entryCount: manifest.entries.length, diagnostics }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/validate-biped-slice-review.ts')) {
  const args = process.argv.slice(2).join(' ')
  if (args !== '--version 0.3.0') throw new Error('Usage: tsx scripts/validate-biped-slice-review.ts --version 0.3.0')
  const result = await validateBipedSliceReview(resolve('packages/asset-catalog/review/v0.3.0/biped-vertical-slice-manifest.json'))
  for (const diagnostic of result.diagnostics) console.error(`ERROR BIPED_SLICE_INVALID: ${diagnostic}`)
  console.log(JSON.stringify({ version: '0.3.0', entryCount: result.entryCount, diagnostics: result.diagnostics.length }))
  if (result.diagnostics.length > 0) process.exitCode = 1
}
