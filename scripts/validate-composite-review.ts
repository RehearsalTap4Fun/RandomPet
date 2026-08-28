import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface CompositeReviewRecord {
  catalogVersion: '0.2.0' | '0.3.0'
  rendererVersion: '0.2.0' | '0.3.0'
  decision: 'approved'
  reviewedAt: string
  reviewer: 'user'
  entryCount: 21
  contactSheetSha256: string
  manifestSha256: string
  notes: string[]
}

export interface CompositeReviewValidationOptions {
  expectedApprovalSha256?: string
  generatedEvidenceDirectory?: string
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
  options: CompositeReviewValidationOptions = {},
): Promise<CompositeReviewRecord> {
  if (version !== '0.2.0' && version !== '0.3.0') {
    throw invalid(`Unsupported composite review version ${version}.`)
  }
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
    || manifest.catalogVersion !== version
    || manifest.rendererVersion !== version
    || !Array.isArray(manifest.entries)
    || manifest.entries.length !== 21) {
    throw invalid(`Composite manifest must describe exactly 21 v${version} entries.`)
  }

  const record = parseJson(recordBytes, 'Composite review record')
  if (!isObject(record)
    || record.catalogVersion !== version
    || record.rendererVersion !== version
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
  if (options.expectedApprovalSha256 !== undefined
    && sha256(recordBytes) !== options.expectedApprovalSha256) {
    throw invalid('Composite review approval bytes do not match the user-approved release record.')
  }
  if (record.contactSheetSha256 !== sha256(contactSheetBytes)
    || record.manifestSha256 !== sha256(manifestBytes)) {
    throw invalid('Composite review evidence changed after approval.')
  }
  if (options.generatedEvidenceDirectory !== undefined) {
    let generatedContactSheetBytes: Buffer
    let generatedManifestBytes: Buffer
    try {
      [generatedContactSheetBytes, generatedManifestBytes] = await Promise.all([
        readFile(join(options.generatedEvidenceDirectory, 'contact-sheet.png')),
        readFile(join(options.generatedEvidenceDirectory, 'acceptance-set.json')),
      ])
    } catch (error) {
      throw invalid('Freshly generated composite evidence is missing.', error)
    }
    if (sha256(generatedContactSheetBytes) !== record.contactSheetSha256
      || sha256(generatedManifestBytes) !== record.manifestSha256) {
      throw invalid('Freshly generated composite evidence does not reproduce the approved bytes.')
    }
  }
  return record as unknown as CompositeReviewRecord
}

function parseArguments(args: readonly string[]): {
  version: string
  options: CompositeReviewValidationOptions
} {
  let version: string | undefined
  let expectedApprovalSha256: string | undefined
  let generatedEvidenceDirectory: string | undefined
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (value === undefined) throw invalid('Composite review validation arguments must be flag-value pairs.')
    if (flag === '--version') version = value
    else if (flag === '--approval-sha256') expectedApprovalSha256 = value
    else if (flag === '--generated-evidence-dir') generatedEvidenceDirectory = resolve(value)
    else throw invalid(`Unknown composite review validation argument ${flag}.`)
  }
  if (version === undefined) {
    throw invalid('Usage: validate-composite-review.ts --version 0.2.0|0.3.0')
  }
  if (expectedApprovalSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(expectedApprovalSha256)) {
    throw invalid('--approval-sha256 must be a lowercase SHA-256 digest.')
  }
  return {
    version,
    options: {
      ...(expectedApprovalSha256 === undefined ? {} : { expectedApprovalSha256 }),
      ...(generatedEvidenceDirectory === undefined ? {} : { generatedEvidenceDirectory }),
    },
  }
}

const invokedModule = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedModule === import.meta.url) {
  const parsed = parseArguments(process.argv.slice(2))
  void validateCompositeReview(parsed.version, process.cwd(), parsed.options).catch(error => {
    console.error(error instanceof Error ? error.message : `COMPOSITE_REVIEW_INVALID: ${String(error)}`)
    process.exitCode = 1
  })
}
