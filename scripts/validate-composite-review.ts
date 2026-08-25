import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface CompositeReviewRecord {
  catalogVersion: '0.2.0'
  rendererVersion: '0.2.0'
  decision: 'approved'
  reviewedAt: string
  reviewer: 'user'
  entryCount: 21
  contactSheetSha256: string
  manifestSha256: string
  notes: string[]
}

function invalid(reason: string, cause?: unknown): Error {
  return new Error(`COMPOSITE_REVIEW_INVALID: ${reason}`, cause === undefined ? {} : { cause })
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw invalid(`${label} is not valid JSON.`, error)
  }
}

export async function validateCompositeReview(
  version: string,
  repositoryRoot = process.cwd(),
): Promise<CompositeReviewRecord> {
  if (version !== '0.2.0') throw invalid(`Unsupported composite review version ${version}.`)
  const reviewDirectory = join(repositoryRoot, 'packages', 'asset-catalog', 'review', `v${version}`)
  let contactSheetBytes: Buffer
  let manifestBytes: Buffer
  let recordBytes: Buffer
  try {
    [contactSheetBytes, manifestBytes, recordBytes] = await Promise.all([
      readFile(join(reviewDirectory, 'full-composite-contact-sheet.png')),
      readFile(join(reviewDirectory, 'full-composite-manifest.json')),
      readFile(join(reviewDirectory, 'full-composite-acceptance.json')),
    ])
  } catch (error) {
    throw invalid('Composite review evidence or approval record is missing.', error)
  }

  const manifest = parseJson(manifestBytes, 'Composite manifest')
  if (!isObject(manifest)
    || manifest.catalogVersion !== '0.2.0'
    || manifest.rendererVersion !== '0.2.0'
    || !Array.isArray(manifest.entries)
    || manifest.entries.length !== 21) {
    throw invalid('Composite manifest must describe exactly 21 v0.2.0 entries.')
  }

  const record = parseJson(recordBytes, 'Composite review record')
  if (!isObject(record)
    || record.catalogVersion !== '0.2.0'
    || record.rendererVersion !== '0.2.0'
    || record.decision !== 'approved'
    || record.reviewer !== 'user'
    || record.entryCount !== 21
    || typeof record.reviewedAt !== 'string'
    || !Number.isFinite(Date.parse(record.reviewedAt))
    || !Array.isArray(record.notes)
    || !record.notes.every(note => typeof note === 'string')
    || typeof record.contactSheetSha256 !== 'string'
    || typeof record.manifestSha256 !== 'string') {
    throw invalid('Composite review record is not an explicit valid user approval.')
  }
  if (record.contactSheetSha256 !== sha256(contactSheetBytes)
    || record.manifestSha256 !== sha256(manifestBytes)) {
    throw invalid('Composite review evidence changed after approval.')
  }
  return record as unknown as CompositeReviewRecord
}

function parseVersion(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--version' || args[1] === undefined) {
    throw invalid('Usage: validate-composite-review.ts --version 0.2.0')
  }
  return args[1]
}

const invokedModule = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedModule === import.meta.url) {
  void validateCompositeReview(parseVersion(process.argv.slice(2))).catch(error => {
    console.error(error instanceof Error ? error.message : `COMPOSITE_REVIEW_INVALID: ${String(error)}`)
    process.exitCode = 1
  })
}
