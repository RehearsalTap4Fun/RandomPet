import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCompositionCatalogFixture } from '@qmonster/generator-core/test-fixtures'
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
    entry.connectorMetrics[0]!.receiverCoverage = 0.89

    expect(() => assertBipedSliceEntry(entry, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('rejects a centerline gap above two pixels', () => {
    const entry = makeValidSliceEntry()
    entry.connectorMetrics[0]!.centerlineGapPixels = 2.01

    expect(() => assertBipedSliceEntry(entry, compositionPolicy)).toThrow('BIPED_SLICE_INVALID')
  })

  it('accepts an entry exactly on every interface threshold', () => {
    expect(() => assertBipedSliceEntry(makeValidSliceEntry(), compositionPolicy)).not.toThrow()
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

  it('requires the canonical eight-entry mushroom-head roster', async () => {
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

    expect(result.diagnostics).toContain('slice roster is not canonical 8 unique mushroom-head entries')
  })

  it('requires one exact user-approved acceptance record bound to live review bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-biped-acceptance-'))
    temporaryDirectories.push(root)
    const manifestPath = join(process.cwd(), 'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-manifest.json')
    const canonicalAcceptance = join(process.cwd(), 'packages/asset-catalog/review/v0.3.0/biped-vertical-slice-acceptance.json')

    const missing = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(missing.diagnostics).toContain('canonical acceptance record missing')

    const acceptancePath = join(root, 'review', 'biped-vertical-slice-acceptance.json')
    await mkdir(join(root, 'review'), { recursive: true })
    const tampered = JSON.parse(await readFile(canonicalAcceptance, 'utf8'))
    tampered.contactSheetSha256 = 'f'.repeat(64)
    await writeFile(acceptancePath, `${JSON.stringify(tampered)}\n`)
    const invalid = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(invalid.diagnostics).toContain('canonical acceptance record does not match the approved live review bytes')

    await mkdir(join(root, 'duplicate'), { recursive: true })
    await copyFile(canonicalAcceptance, acceptancePath)
    await copyFile(canonicalAcceptance, join(root, 'duplicate', 'biped-vertical-slice-acceptance.json'))
    const duplicate = await validateBipedSliceReview(manifestPath, { repositoryRoot: root })
    expect(duplicate.diagnostics).toContain('canonical acceptance record must be unique: found 2')
  })
})
