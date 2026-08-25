import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Diagnostic } from '@qmonster/generator-core'

export interface RejectedCompositeReview {
  reviewedAt: string
  reviewer: 'user'
  decision: 'rejected'
  contactSheetSha256: string
  artifactPath: string | null
  manifestPath: string | null
  feedback: string
}

export interface CompositeRejectionRecord {
  catalogVersion: '0.2.0'
  rendererVersion: '0.2.0'
  reviews: [RejectedCompositeReview, RejectedCompositeReview]
}

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function pathWithinRoot(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
}

function validReview(value: unknown): value is RejectedCompositeReview {
  return isObject(value)
    && typeof value.reviewedAt === 'string'
    && Number.isFinite(Date.parse(value.reviewedAt))
    && value.reviewer === 'user'
    && value.decision === 'rejected'
    && isSha256(value.contactSheetSha256)
    && (value.artifactPath === null || typeof value.artifactPath === 'string')
    && (value.manifestPath === null || typeof value.manifestPath === 'string')
    && typeof value.feedback === 'string'
    && value.feedback.trim().length > 0
}

function validRecord(value: unknown): value is CompositeRejectionRecord {
  return isObject(value)
    && value.catalogVersion === '0.2.0'
    && value.rendererVersion === '0.2.0'
    && Array.isArray(value.reviews)
    && value.reviews.length === 2
    && validReview(value.reviews[0])
    && validReview(value.reviews[1])
}

async function canonicalArtifactPath(root: string, path: string): Promise<string | null> {
  if (isAbsolute(path)) return null
  const candidate = resolve(root, path)
  if (!pathWithinRoot(root, candidate)) return null
  const canonicalPath = await realpath(candidate).catch(() => null)
  return canonicalPath !== null && pathWithinRoot(root, canonicalPath) ? canonicalPath : null
}

function manifestRecordsSheetHash(bytes: Buffer, expectedHash: string): boolean {
  try {
    const manifest: unknown = JSON.parse(bytes.toString('utf8'))
    return isObject(manifest)
      && isObject(manifest.contactSheet)
      && manifest.contactSheet.sha256 === expectedHash
  } catch {
    return false
  }
}

export async function validateRejectionRecord(recordPath: string): Promise<Diagnostic[]> {
  let bytes: Buffer
  let rejectionDirectory: string
  try {
    bytes = await readFile(recordPath)
    rejectionDirectory = await realpath(dirname(recordPath))
  } catch {
    return [error('REJECTION_RECORD_INVALID', [], 'Rejection record or its directory is unavailable.')]
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    return [error('REJECTION_RECORD_INVALID', [], 'Rejection record is not valid JSON.')]
  }
  if (!validRecord(parsed)) {
    return [error('REJECTION_RECORD_INVALID', [], 'Rejection record must contain exactly two explicit user rejections.')]
  }

  const diagnostics: Diagnostic[] = []
  for (const [index, review] of parsed.reviews.entries()) {
    const path = ['reviews', String(index)]
    if ((review.artifactPath === null) !== (review.manifestPath === null)) {
      diagnostics.push(error('REJECTION_RECORD_INVALID', path, 'Archived artifact and manifest paths must be both present or both null.'))
      continue
    }
    if (review.artifactPath === null || review.manifestPath === null) continue

    const [artifactPath, manifestPath] = await Promise.all([
      canonicalArtifactPath(rejectionDirectory, review.artifactPath),
      canonicalArtifactPath(rejectionDirectory, review.manifestPath),
    ])
    if (artifactPath === null || manifestPath === null) {
      diagnostics.push(error('REJECTION_RECORD_INVALID', path, 'Archived evidence paths must resolve inside the rejection directory.'))
      continue
    }

    const [artifactBytes, manifestBytes] = await Promise.all([
      readFile(artifactPath).catch(() => null),
      readFile(manifestPath).catch(() => null),
    ])
    if (artifactBytes === null || manifestBytes === null) {
      diagnostics.push(error('REJECTION_RECORD_INVALID', path, 'Archived evidence is unavailable.'))
      continue
    }
    const actualHash = createHash('sha256').update(artifactBytes).digest('hex')
    if (actualHash !== review.contactSheetSha256) {
      diagnostics.push(error('REJECTION_ARTIFACT_HASH_MISMATCH', path.concat('artifactPath'), 'Archived contact sheet SHA-256 differs from the rejection record.'))
    }
    if (!manifestRecordsSheetHash(manifestBytes, review.contactSheetSha256)) {
      diagnostics.push(error('REJECTION_ARTIFACT_HASH_MISMATCH', path.concat('manifestPath'), 'Archived manifest does not attest to the rejected contact sheet SHA-256.'))
    }
  }
  return diagnostics
}
