import { createHash } from 'node:crypto'
import type { Diagnostic } from '@qmonster/generator-core'

export const PRODUCTION_EVIDENCE_MANIFEST_VERSION = 'qmonster-production-evidence-v1' as const

export interface ProductionEvidenceManifest {
  manifestVersion: typeof PRODUCTION_EVIDENCE_MANIFEST_VERSION
  canonicalization: 'json-object-keys-lexicographic-v1'
  catalogVersion: string
  sourceIndexPath: 'packages/asset-catalog/source-index.json'
  evidenceRootSha256: string
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Production evidence contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
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
    canonicalization: 'json-object-keys-lexicographic-v1',
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
    || (manifest as Record<string, unknown>).canonicalization !== 'json-object-keys-lexicographic-v1'
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
