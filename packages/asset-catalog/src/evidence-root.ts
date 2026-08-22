import { createHash } from 'node:crypto'
import type { Diagnostic } from '@qmonster/generator-core'

export const PRODUCTION_EVIDENCE_MANIFEST_VERSION = 'qmonster-production-evidence-v1' as const
export const PRODUCTION_EVIDENCE_CANONICALIZATION = 'json-object-keys-unicode-code-point-v1' as const

export interface ProductionEvidenceManifest {
  manifestVersion: typeof PRODUCTION_EVIDENCE_MANIFEST_VERSION
  canonicalization: typeof PRODUCTION_EVIDENCE_CANONICALIZATION
  catalogVersion: string
  sourceIndexPath: 'packages/asset-catalog/source-index.json'
  evidenceRootSha256: string
}

function unicodeScalarValues(value: string): number[] {
  const scalars: number[] = []
  for (let offset = 0; offset < value.length;) {
    const first = value.charCodeAt(offset)
    if (first >= 0xD800 && first <= 0xDBFF) {
      const second = value.charCodeAt(offset + 1)
      if (!(second >= 0xDC00 && second <= 0xDFFF)) {
        throw new Error(`Unpaired high surrogate at UTF-16 offset ${offset}.`)
      }
      scalars.push(0x10000 + (first - 0xD800) * 0x400 + (second - 0xDC00))
      offset += 2
      continue
    }
    if (first >= 0xDC00 && first <= 0xDFFF) {
      throw new Error(`Unpaired low surrogate at UTF-16 offset ${offset}.`)
    }
    scalars.push(first)
    offset += 1
  }
  return scalars
}

function compareUnicodeScalarSequences(left: readonly number[], right: readonly number[]): number {
  const commonLength = Math.min(left.length, right.length)
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') {
    unicodeScalarValues(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Production evidence contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => ({ key, item, scalars: unicodeScalarValues(key) }))
      .sort((left, right) => compareUnicodeScalarSequences(left.scalars, right.scalars))
    return `{${entries.map(({ key, item }) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new Error(`Production evidence contains unsupported ${typeof value}.`)
}

export function computeProductionEvidenceRoot(sourceIndex: unknown): string {
  return createHash('sha256').update(canonicalJson(sourceIndex)).digest('hex')
}

export function buildProductionEvidenceManifest(sourceIndex: { catalogVersion?: unknown }): ProductionEvidenceManifest {
  if (typeof sourceIndex.catalogVersion !== 'string' || sourceIndex.catalogVersion === '') {
    throw new Error('Production source-index needs catalogVersion before evidence-root generation.')
  }
  return {
    manifestVersion: PRODUCTION_EVIDENCE_MANIFEST_VERSION,
    canonicalization: PRODUCTION_EVIDENCE_CANONICALIZATION,
    catalogVersion: sourceIndex.catalogVersion,
    sourceIndexPath: 'packages/asset-catalog/source-index.json',
    evidenceRootSha256: computeProductionEvidenceRoot(sourceIndex),
  }
}

export function validateProductionEvidenceManifest(
  sourceIndex: { catalogVersion?: unknown },
  manifest: unknown,
): Diagnostic[] {
  const path = ['audit', 'v0.1.0', 'evidence-manifest.json']
  if (
    manifest === null
    || typeof manifest !== 'object'
    || (manifest as Record<string, unknown>).manifestVersion !== PRODUCTION_EVIDENCE_MANIFEST_VERSION
    || (manifest as Record<string, unknown>).canonicalization !== PRODUCTION_EVIDENCE_CANONICALIZATION
    || (manifest as Record<string, unknown>).catalogVersion !== sourceIndex.catalogVersion
    || (manifest as Record<string, unknown>).sourceIndexPath !== 'packages/asset-catalog/source-index.json'
    || !/^[a-f0-9]{64}$/u.test(String((manifest as Record<string, unknown>).evidenceRootSha256 ?? ''))
  ) {
    return [{
      severity: 'error',
      code: 'PRODUCTION_EVIDENCE_MANIFEST_INVALID',
      path,
      message: `Production evidence manifest must use ${PRODUCTION_EVIDENCE_MANIFEST_VERSION} and the canonical source-index anchor.`,
    }]
  }
  const expected = computeProductionEvidenceRoot(sourceIndex)
  if ((manifest as ProductionEvidenceManifest).evidenceRootSha256 !== expected) {
    return [{
      severity: 'error',
      code: 'PRODUCTION_EVIDENCE_ROOT_MISMATCH',
      path: [...path, 'evidenceRootSha256'],
      message: 'Committed source-index differs from the independently anchored production evidence root.',
    }]
  }
  return []
}
