import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCompositionCatalogFixture } from '@qmonster/generator-core/test-fixtures'
import {
  CONNECTOR_RECEIVER_COVERAGE_MIN,
} from '@qmonster/renderer-canvas'
import {
  assertBipedSliceEntry,
  makeValidSliceEntry,
  validateBipedSliceReview,
} from './validate-biped-slice-review.js'

const temporaryDirectories: string[] = []
const compositionPolicy = makeCompositionCatalogFixture().compositionPolicy!

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('biped interface slice review validation', () => {
  it('rejects any seam metric below the interface contract', () => {
    const entry = makeValidSliceEntry()
    entry.connectorMetrics[0]!.receiverCoverage = CONNECTOR_RECEIVER_COVERAGE_MIN - 0.01

    expect(() => assertBipedSliceEntry(entry, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('rejects a centerline gap above two pixels', () => {
    const entry = makeValidSliceEntry()
    entry.connectorMetrics[0]!.centerlineGapPixels = 2.01

    expect(() => assertBipedSliceEntry(entry, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('accepts an entry exactly on every interface threshold', () => {
    const entry = makeValidSliceEntry()
    for (const metric of entry.connectorMetrics) metric.receiverCoverage = CONNECTOR_RECEIVER_COVERAGE_MIN
    entry.compositionMetrics.eyesInsideRatio = compositionPolicy.faceInsideRatio
    entry.compositionMetrics.eyesVisibleRatio = compositionPolicy.faceVisibleRatio
    entry.compositionMetrics.mouthInsideRatio = compositionPolicy.faceInsideRatio
    entry.compositionMetrics.mouthVisibleRatio = compositionPolicy.faceVisibleRatio
    entry.compositionMetrics.oralDetailInsideRatio = compositionPolicy.faceInsideRatio
    entry.compositionMetrics.oralDetailVisibleRatio = compositionPolicy.faceVisibleRatio

    expect(() => assertBipedSliceEntry(entry, compositionPolicy)).not.toThrow()
  })

  it('requires each canonical connector metric exactly once', () => {
    const metric = makeValidSliceEntry().connectorMetrics[0]!
    const missing = makeValidSliceEntry()
    missing.connectorMetrics = ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft']
      .map(connectorId => ({ ...metric, connectorId }))
    expect(() => assertBipedSliceEntry(missing, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')

    const duplicate = makeValidSliceEntry()
    duplicate.connectorMetrics = ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight', 'neck']
      .map(connectorId => ({ ...metric, connectorId }))
    expect(() => assertBipedSliceEntry(duplicate, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('rejects face ratios and visible bounds outside the catalog composition policy', () => {
    const face = makeValidSliceEntry()
    face.compositionMetrics.eyesInsideRatio = compositionPolicy.faceInsideRatio - 0.01
    expect(() => assertBipedSliceEntry(face, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')

    const bounds = makeValidSliceEntry()
    bounds.compositionMetrics.visibleBounds = {
      ...compositionPolicy.frameBounds,
      x: compositionPolicy.frameBounds.x - 1,
    }
    expect(() => assertBipedSliceEntry(bounds, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('requires the canonical sixteen-entry two-head roster', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-biped-review-roster-'))
    temporaryDirectories.push(root)
    const path = join(root, 'manifest.json')
    const entries = Array.from({ length: 16 }, (_, index) => ({
      ...makeValidSliceEntry(),
      index,
      structuralKey: `legacy-round-roster-${index}`,
    }))
    await mkdir(root, { recursive: true })
    await writeFile(path, JSON.stringify({
      catalogVersion: '0.3.0', rendererVersion: '0.3.0', rigId: 'biped',
      entryCount: 16, entries,
    }))

    const result = await validateBipedSliceReview(path, { repositoryRoot: root })

    expect(result.diagnostics).toContain('slice roster is not canonical 16 unique two-head entries')
  })

  it('requires one exact user-approved acceptance record bound to live review bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-biped-acceptance-'))
    temporaryDirectories.push(root)
    const manifestPath = join(process.cwd(), 'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-manifest.json')
    const canonicalAcceptance = join(process.cwd(), 'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json')

    const missing = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(missing.diagnostics).toContain('canonical acceptance record missing')

    const misplacedPath = join(root, 'review', 'biped-vertical-slice-acceptance.json')
    await mkdir(dirname(misplacedPath), { recursive: true })
    await copyFile(canonicalAcceptance, misplacedPath)
    const misplaced = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(misplaced.diagnostics).toContain(
      'canonical acceptance record must use exact path: packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json',
    )
    await rm(misplacedPath)

    const acceptancePath = join(
      root,
      'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json',
    )
    await mkdir(dirname(acceptancePath), { recursive: true })
    const tampered = JSON.parse(await readFile(canonicalAcceptance, 'utf8'))
    tampered.contactSheetSha256 = 'f'.repeat(64)
    tampered.catalogVersion = '0.2.0'
    tampered.rendererVersion = '0.2.0'
    tampered.reviewedAt = 'not-a-timestamp'
    await writeFile(acceptancePath, `${JSON.stringify(tampered)}\n`)
    const invalid = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(invalid.diagnostics).toContain('canonical acceptance catalogVersion must be 0.3.0')
    expect(invalid.diagnostics).toContain('canonical acceptance rendererVersion must be 0.3.0')
    expect(invalid.diagnostics).toContain('canonical acceptance reviewedAt must be a valid timestamp')
    expect(invalid.diagnostics).toContain('canonical acceptance record does not match the approved live review bytes')

    await mkdir(join(root, 'duplicate'), { recursive: true })
    await copyFile(canonicalAcceptance, acceptancePath)
    await copyFile(canonicalAcceptance, join(root, 'duplicate', 'biped-vertical-slice-acceptance.json'))
    const duplicate = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(duplicate.diagnostics).toContain('canonical acceptance record must be unique: found 2')
  }, 30_000)
})
