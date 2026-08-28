import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { validateCompositeReview } from './validate-composite-review.js'

const temporaryRoots: string[] = []

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function makeEvidence(overrides: Record<string, unknown> = {}, version: '0.2.0' | '0.3.0' = '0.2.0') {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-composite-review-'))
  temporaryRoots.push(root)
  const reviewDirectory = join(root, 'packages', 'asset-catalog', 'review', `v${version}`)
  await mkdir(reviewDirectory, { recursive: true })
  const contactSheet = Buffer.from('reviewed composite sheet fixture')
  const manifest = `${JSON.stringify({
    catalogVersion: version,
    rendererVersion: version,
    entries: Array.from({ length: 21 }, (_, index) => ({ index: index + 1 })),
  })}\n`
  await writeFile(join(reviewDirectory, 'full-composite-contact-sheet.png'), contactSheet)
  await writeFile(join(reviewDirectory, 'full-composite-manifest.json'), manifest)
  const record = {
    catalogVersion: version,
    rendererVersion: version,
    decision: 'approved',
    reviewedAt: '2026-08-24T08:00:00.000Z',
    reviewer: 'user',
    entryCount: 21,
    contactSheetSha256: sha256(contactSheet),
    manifestSha256: sha256(manifest),
    notes: [],
    ...overrides,
  }
  return { root, reviewDirectory, record, contactSheet, manifest }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('composite review validation', () => {
  it('accepts an explicit user approval whose hashes match the 21-entry evidence', async () => {
    const fixture = await makeEvidence()
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      `${JSON.stringify(fixture.record)}\n`,
    )

    await expect(validateCompositeReview('0.2.0', fixture.root)).resolves.toEqual(fixture.record)
  })

  it('supports an explicit v0.3 approval contract without treating v0.2 evidence as approval', async () => {
    const fixture = await makeEvidence({}, '0.3.0')
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      `${JSON.stringify(fixture.record)}\n`,
    )

    await expect(validateCompositeReview('0.3.0', fixture.root)).resolves.toEqual(fixture.record)
  })

  it('binds release verification to the exact user-approved record bytes', async () => {
    const fixture = await makeEvidence({}, '0.3.0')
    const recordBytes = `${JSON.stringify(fixture.record)}\n`
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      recordBytes,
    )

    await expect(validateCompositeReview('0.3.0', fixture.root, {
      expectedApprovalSha256: sha256(recordBytes),
    })).resolves.toEqual(fixture.record)
    await expect(validateCompositeReview('0.3.0', fixture.root, {
      expectedApprovalSha256: sha256(`${recordBytes} `),
    })).rejects.toThrow('COMPOSITE_REVIEW_INVALID')
  })

  it('requires freshly generated evidence to reproduce the approved bytes', async () => {
    const fixture = await makeEvidence({}, '0.3.0')
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      `${JSON.stringify(fixture.record)}\n`,
    )
    const generatedDirectory = join(fixture.root, 'artifacts', 'acceptance', 'v0.3')
    await mkdir(generatedDirectory, { recursive: true })
    await writeFile(join(generatedDirectory, 'contact-sheet.png'), fixture.contactSheet)
    await writeFile(join(generatedDirectory, 'acceptance-set.json'), fixture.manifest)

    await expect(validateCompositeReview('0.3.0', fixture.root, {
      generatedEvidenceDirectory: generatedDirectory,
    })).resolves.toEqual(fixture.record)

    await writeFile(join(generatedDirectory, 'acceptance-set.json'), `${fixture.manifest} `)
    await expect(validateCompositeReview('0.3.0', fixture.root, {
      generatedEvidenceDirectory: generatedDirectory,
    })).rejects.toThrow('COMPOSITE_REVIEW_INVALID')
  })

  it('rejects a missing user decision', async () => {
    const fixture = await makeEvidence()

    await expect(validateCompositeReview('0.2.0', fixture.root))
      .rejects.toThrow('COMPOSITE_REVIEW_INVALID')
  })

  it('rejects evidence changed after approval', async () => {
    const fixture = await makeEvidence()
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      `${JSON.stringify(fixture.record)}\n`,
    )
    await writeFile(join(fixture.reviewDirectory, 'full-composite-contact-sheet.png'), 'changed sheet')

    await expect(validateCompositeReview('0.2.0', fixture.root))
      .rejects.toThrow('COMPOSITE_REVIEW_INVALID')
  })

  it.each([
    ['decision', { decision: 'pending' }],
    ['catalog version', { catalogVersion: '0.1.0' }],
    ['renderer version', { rendererVersion: '0.1.0' }],
    ['reviewer', { reviewer: 'automation' }],
    ['entry count', { entryCount: 20 }],
    ['review time', { reviewedAt: 'not-a-date' }],
    ['notes', { notes: 'not-an-array' }],
  ])('rejects an invalid %s', async (_label, overrides) => {
    const fixture = await makeEvidence(overrides)
    await writeFile(
      join(fixture.reviewDirectory, 'full-composite-acceptance.json'),
      `${JSON.stringify(fixture.record)}\n`,
    )

    await expect(validateCompositeReview('0.2.0', fixture.root))
      .rejects.toThrow('COMPOSITE_REVIEW_INVALID')
  })
})
