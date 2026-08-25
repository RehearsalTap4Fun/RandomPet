import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertBipedSliceEntry,
  makeValidSliceEntry,
  validateBipedSliceReview,
} from './validate-biped-slice-review.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('biped interface slice review validation', () => {
  it('rejects any seam metric below the interface contract', () => {
    const entry = makeValidSliceEntry()
    entry.connectorMetrics[0]!.receiverCoverage = 0.89

    expect(() => assertBipedSliceEntry(entry)).toThrow('BIPED_SLICE_INVALID')
  })

  it('rejects a centerline gap above two pixels', () => {
    const entry = makeValidSliceEntry()
    entry.connectorMetrics[0]!.centerlineGapPixels = 2.01

    expect(() => assertBipedSliceEntry(entry)).toThrow('BIPED_SLICE_INVALID')
  })

  it('accepts an entry exactly on every interface threshold', () => {
    expect(() => assertBipedSliceEntry(makeValidSliceEntry())).not.toThrow()
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

    const result = await validateBipedSliceReview(path)

    expect(result.diagnostics).toContain('slice roster is not canonical 8 unique mushroom-head entries')
  })
})
