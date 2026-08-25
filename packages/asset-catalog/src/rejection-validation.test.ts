import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateRejectionRecord } from './rejection-validation.js'

const temporaryRoots: string[] = []

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function makeRejectionFixture(options: {
  decision?: 'approved' | 'rejected'
  tamperAvailableSheet?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-rejection-record-'))
  temporaryRoots.push(root)
  const rejectionDirectory = join(root, 'audit', 'v0.2.0', 'rejections', '2026-08-24')
  await mkdir(rejectionDirectory, { recursive: true })

  const sheet = Buffer.from('position-correct seams still rejected')
  const manifest = JSON.stringify({ contactSheet: { sha256: sha256(sheet) } })
  await writeFile(join(rejectionDirectory, 'position-correct-seams-rejected.png'), sheet)
  await writeFile(join(rejectionDirectory, 'position-correct-seams-manifest.json'), manifest)
  if (options.tamperAvailableSheet) {
    await writeFile(join(rejectionDirectory, 'position-correct-seams-rejected.png'), 'changed artifact')
  }

  const record = {
    catalogVersion: '0.2.0',
    rendererVersion: '0.2.0',
    reviews: [
      {
        reviewedAt: '2026-08-24T08:00:00.000Z',
        reviewer: 'user',
        decision: 'rejected',
        contactSheetSha256: '7cad7a5c551fcd7e1f510fd84fd1f46b47e921e36e9a4ae5822000155ea6b3bc',
        artifactPath: null,
        manifestPath: null,
        feedback: 'The positioning is correct, but the parts overlap.',
      },
      {
        reviewedAt: '2026-08-24T09:00:00.000Z',
        reviewer: 'user',
        decision: options.decision ?? 'rejected',
        contactSheetSha256: sha256(sheet),
        artifactPath: 'position-correct-seams-rejected.png',
        manifestPath: 'position-correct-seams-manifest.json',
        feedback: 'There are no designed seams between the parts.',
      },
    ],
  }
  const path = join(rejectionDirectory, 'rejection-record.json')
  await writeFile(path, `${JSON.stringify(record)}\n`)
  return { path }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('rejection record validation', () => {
  it('accepts two rejected reviews and verifies every available artifact hash', async () => {
    const record = await makeRejectionFixture({ tamperAvailableSheet: false })

    await expect(validateRejectionRecord(record.path)).resolves.toEqual([])
  })

  it('rejects an approved decision or changed available artifact', async () => {
    const approved = await makeRejectionFixture({ decision: 'approved' })
    expect((await validateRejectionRecord(approved.path)).map(item => item.code))
      .toContain('REJECTION_RECORD_INVALID')
    const tampered = await makeRejectionFixture({ tamperAvailableSheet: true })
    expect((await validateRejectionRecord(tampered.path)).map(item => item.code))
      .toContain('REJECTION_ARTIFACT_HASH_MISMATCH')
  })
})
