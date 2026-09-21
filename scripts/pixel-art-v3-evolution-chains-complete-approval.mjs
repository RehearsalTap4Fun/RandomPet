import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const evolutionChainsCompleteApprovalPath = 'docs/qa/pixel-evolution-chain-complete/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.1/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.1/provenance.json'

export async function validateEvolutionChainsCompleteApproval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), '8da1bd21ea50056b81fe323f7449b0754fe136b7b4725280b25358b7fca5939a', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-evolution-chains-complete-approval-v1')
  assert.equal(approval.userStatement, 'ok')
  assert.equal(approval.date, '2026-09-21')
  assert.equal(approval.approvedArtVersion, '1.6.1')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.scope, {
    reusedCoverage: 8077, promotedCoverage: 27763, totalCoverage: 35840, renderedPngs: 0, reviewSamples: 13,
    interpretation: 'Complete the compact-runtime coverage grid mechanically; retain the previously approved 13-image art QA without generating additional PNGs.',
  })
  assert.deepEqual(approval.candidate, {
    path: candidatePath, schemaVersion: candidate.schemaVersion, artVersion: candidate.artVersion,
    revision: candidate.revision, sha256: sha(candidateBytes), provenancePath, provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.equal(candidate.artVersion, '1.6.1-candidate.1')
  assert.equal(candidate.revision, 'd46db417f96e2821810d98d96c698607e78866a48a22b59746c71ee4a6629422')
  assert.equal(candidate.coverage.length, 35840)
  assert.equal(candidate.coverage.filter(row => row.review === 'pending').length, 27763)
  assert.deepEqual(approval.compactRuntimeContract, {
    sourceExchangeCommit: '8d357b08af26e23254997609892cced0a780e45c', explicitCoverage: 35840,
    derivedCoverage: 35840, profileProduct: 1280, profiles: 28, generatedDigests: 27763, renderedPngs: 0,
  })
  assert.equal(report.status, 'mechanical-coverage-complete')
  assert.equal(report.candidate.revision, candidate.revision)
  assert.equal(report.explicitCoverage, 35840)
  assert.equal(report.derivedCoverage, 35840)
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
