import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as evidenceRootModule from './evidence-root.js'
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

test.each([
  {
    label: 'private-use BMP before supplementary emoji',
    value: { '😀': 2, '\uE000': 1 },
    expected: '871954531859c7572c6279f90eb83a594ddc3a289e8bdc28d2a84ffb8c1a1703',
  },
  {
    label: 'shared prefix before supplementary emoji',
    value: { 'a😀': 2, 'a\uE000': 1 },
    expected: '8e725bbe3fe7031becdac84550ef75a2e9806258a6c9ef4be8e2131dbe301dc1',
  },
  {
    label: 'shared prefix with two supplementary keys',
    value: { 'x🚀': 2, 'x😀': 1 },
    expected: 'f038b7c03b59f05ef1acb4ced8e53d40c7916c74991f7c737d237c008324a23b',
  },
  {
    label: 'mixed ASCII, BMP, and supplementary keys',
    value: { '😀': 3, '\uE000': 2, z: 4, A: 1 },
    expected: '1f0a637764f8179a0c5f76bff8963fd42a5fc8f85ff25e2d10b62f6b5ef35984',
  },
])('canonicalizes $label by Unicode scalar value', ({ value, expected }) => {
  expect(computeProductionEvidenceRoot(value)).toBe(expected)
})

test('supplementary-key ordering is independent of insertion order', () => {
  const left = { '😀': 3, '\uE000': 2, z: 4, A: 1 }
  const right = { A: 1, z: 4, '\uE000': 2, '😀': 3 }
  const expected = '1f0a637764f8179a0c5f76bff8963fd42a5fc8f85ff25e2d10b62f6b5ef35984'

  expect(computeProductionEvidenceRoot(left)).toBe(expected)
  expect(computeProductionEvidenceRoot(right)).toBe(expected)
})

test.each([
  ['unpaired high surrogate key', { ['\uD800']: 1 }],
  ['unpaired low surrogate key', { ['\uDC00']: 1 }],
  ['unpaired high surrogate string value', { value: '\uD800' }],
  ['unpaired low surrogate string value', { value: '\uDC00' }],
])('rejects %s instead of hashing non-scalar Unicode', (_label, value) => {
  expect(() => computeProductionEvidenceRoot(value)).toThrow(/unpaired (?:high|low) surrogate/iu)
})

test('does not normalize canonically equivalent NFC and NFD keys', () => {
  expect(computeProductionEvidenceRoot({ 'é': 1 })).not.toBe(computeProductionEvidenceRoot({ 'e\u0301': 1 }))
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
    { ...manifest, canonicalization: 'json-object-keys-lexicographic-v1' },
    { ...manifest, catalogVersion: '9.9.9' },
    { ...manifest, sourceIndexPath: 'elsewhere/source-index.json' },
    { ...manifest, evidenceRootSha256: 'not-a-hash' },
  ]) {
    expect(validateProductionEvidenceManifest(sourceIndex, invalid)).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_EVIDENCE_MANIFEST_INVALID',
    }))
  }
})

test('requires the acyclic Task 9 production evidence block for v0.3', () => {
  const sourceIndex = { catalogVersion: '0.3.0', sources: Array.from({ length: 102 }, (_, index) => ({ sourceId: `source-${index}` })) }
  const minimal = buildProductionEvidenceManifest(sourceIndex)

  expect(validateProductionEvidenceManifest(sourceIndex, minimal)).toContainEqual(expect.objectContaining({
    code: 'PRODUCTION_TASK9_EVIDENCE_INVALID',
  }))
})

test('recomputes every Task 9 dependency hash from a contained regular file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-evidence-'))
  const bytes = Buffer.from('final production input')
  await writeFile(join(root, 'input.json'), bytes)
  const sourceIndex = { catalogVersion: '0.3.0', sources: Array.from({ length: 102 }, (_, index) => ({ sourceId: `source-${index}` })) }
  const manifest = {
    ...buildProductionEvidenceManifest(sourceIndex),
    task9Evidence: {
      schemaVersion: 'task9-production-evidence-v1',
      sourceEntryCount: 102,
      dependencyCount: 1,
      dependencies: [{ path: 'input.json', sha256: createHash('sha256').update(bytes).digest('hex'), groups: ['catalog'] }],
      compositionStatistics: {
        seedCount: 10_000,
        optionalNoneRates: { effect: 0.4, extraAppendage: 0.4, headAppendage: 0.4, tail: 0.4 },
        maximumStrongFeatures: 2,
        maximumSurpriseSlots: 3,
        surpriseLimit: 3,
      },
      structuralMatrix: {
        entryCount: 39,
        failureCount: 0,
        entryCountByRig: { blob: 15, biped: 15, floating: 9 },
        observedExtrema: { receiverCoverageMin: 0.92 },
      },
      pipelineFixedPoint: {
        sequence: ['build-runtime-assets', 'build-color-scheme-masks', 'build-interface-catalog'],
        round1Sha256: '1'.repeat(64),
        round2Sha256: '1'.repeat(64),
      },
    },
  }
  const validateDependencies = (evidenceRootModule as unknown as {
    validateProductionEvidenceDependencies: (manifest: unknown, repositoryRoot: string) => Promise<unknown[]>
  }).validateProductionEvidenceDependencies

  expect(await validateDependencies(manifest, root)).toEqual([])
  manifest.task9Evidence.dependencies[0]!.sha256 = 'f'.repeat(64)
  expect(await validateDependencies(manifest, root)).toContainEqual(expect.objectContaining({
    code: 'PRODUCTION_EVIDENCE_DEPENDENCY_HASH_MISMATCH',
    path: ['task9Evidence', 'dependencies', 'input.json'],
  }))
  await rm(join(root, 'input.json'))
  expect(await validateDependencies(manifest, root)).toContainEqual({
    severity: 'error',
    code: 'PRODUCTION_EVIDENCE_DEPENDENCY_MISSING',
    path: ['task9Evidence', 'dependencies', 'input.json'],
    message: 'Task 9 evidence dependency cannot be read from its canonical repository path: input.json',
  })
})
