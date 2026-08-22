import { expect, test } from 'vitest'
import {
  PRODUCTION_EVIDENCE_MANIFEST_VERSION,
  buildProductionEvidenceManifest,
  computeProductionEvidenceRoot,
  validateProductionEvidenceManifest,
} from './evidence-root.js'

test('canonical evidence root is stable across object insertion order', () => {
  const left = { b: 2, a: { z: true, y: ['x', 1] } }
  const right = { a: { y: ['x', 1], z: true }, b: 2 }

  expect(PRODUCTION_EVIDENCE_MANIFEST_VERSION).toBe('qmonster-production-evidence-v1')
  expect(computeProductionEvidenceRoot(left)).toBe('63ffbfc4aa8e33972ece865ea7e34abb39c27b65af147f3c836fbe2a58ad96bd')
  expect(computeProductionEvidenceRoot(right)).toBe('63ffbfc4aa8e33972ece865ea7e34abb39c27b65af147f3c836fbe2a58ad96bd')
})

test('canonical key order is Unicode code-point order rather than host locale order', () => {
  expect(computeProductionEvidenceRoot({ 'ä': 2, z: 1 })).toBe(
    '7832a5d6150a56da1a4f0c8fa00c26a7350389b0fc8696707cd2abbbd32be0c1',
  )
})

test('independent manifest rejects a synchronized source-index forgery', () => {
  const sourceIndex = { catalogVersion: '0.1.0', prompt: 'original', promptSha256: '1'.repeat(64) }
  const manifest = buildProductionEvidenceManifest(sourceIndex)
  expect(validateProductionEvidenceManifest(sourceIndex, manifest)).toEqual([])

  const forged = { ...sourceIndex, prompt: 'forged', promptSha256: '2'.repeat(64) }
  expect(validateProductionEvidenceManifest(forged, manifest)).toContainEqual(expect.objectContaining({
    code: 'PRODUCTION_EVIDENCE_ROOT_MISMATCH',
  }))
})

test('rejects malformed or unsupported evidence manifests', () => {
  const sourceIndex = { catalogVersion: '0.1.0' }
  const manifest = buildProductionEvidenceManifest(sourceIndex)
  for (const invalid of [
    { ...manifest, manifestVersion: 'unknown' },
    { ...manifest, canonicalization: 'attacker-json-v1' },
    { ...manifest, catalogVersion: '9.9.9' },
    { ...manifest, sourceIndexPath: 'elsewhere/source-index.json' },
    { ...manifest, evidenceRootSha256: 'not-a-hash' },
  ]) {
    expect(validateProductionEvidenceManifest(sourceIndex, invalid)).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_EVIDENCE_MANIFEST_INVALID',
    }))
  }
})
