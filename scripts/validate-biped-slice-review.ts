import {
  CONNECTOR_COVERAGE_MIN,
  CONNECTOR_GAP_MAX_1024,
  EXTERNAL_LIMB_ALPHA_MIN,
  STRUCTURE_ALPHA_MASS_MIN,
  type ConnectorMetric,
} from '@qmonster/renderer-canvas'
import type { BipedSliceEntry } from './render-biped-interface-slice.js'
import type { BipedSliceManifest } from './render-biped-interface-slice.js'
import {
  BIPED_SLICE_COLUMNS,
  BIPED_SLICE_ENTRY_COUNT,
  BIPED_SLICE_OPTIONS,
  BIPED_SLICE_ROWS,
} from './render-biped-interface-slice.js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

export function makeValidSliceEntry(): BipedSliceEntry {
  const metric: ConnectorMetric = {
    connectorId: 'neck',
    receiverCoverage: CONNECTOR_COVERAGE_MIN,
    plugCoverage: CONNECTOR_COVERAGE_MIN,
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
    connectorMetrics: [metric],
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

export function assertBipedSliceEntry(entry: BipedSliceEntry): void {
  const invalid = entry.diagnostics.length > 0
    || entry.connectorMetrics.length === 0
    || entry.connectorMetrics.some(metric => (
      metric.receiverCoverage < CONNECTOR_COVERAGE_MIN
      || metric.plugCoverage < CONNECTOR_COVERAGE_MIN
      || metric.largestComponentRatio < STRUCTURE_ALPHA_MASS_MIN
      || metric.centerlineGapPixels > CONNECTOR_GAP_MAX_1024
      || (metric.childOutsideBodyRatio !== null && metric.childOutsideBodyRatio < EXTERNAL_LIMB_ALPHA_MIN)
    ))
  if (invalid) throw new Error(`BIPED_SLICE_INVALID: ${entry.structuralKey}`)
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function validateBipedSliceReview(manifestPath: string): Promise<{ entryCount: number, diagnostics: string[] }> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BipedSliceManifest
  const diagnostics: string[] = []
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
    || manifest.entries.some(entry => entry.selections.headShape !== BIPED_SLICE_OPTIONS.headShape[0])
  ) diagnostics.push(`slice roster is not canonical ${BIPED_SLICE_ENTRY_COUNT} unique mushroom-head entries`)
  for (const entry of manifest.entries) {
    try { assertBipedSliceEntry(entry) } catch (caught) { diagnostics.push(caught instanceof Error ? caught.message : String(caught)) }
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
