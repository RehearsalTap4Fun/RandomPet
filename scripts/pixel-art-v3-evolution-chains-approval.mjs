import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const evolutionChainsPromotionApprovalPath = 'docs/qa/pixel-evolution-chain-registration/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0/provenance.json'

export async function validateEvolutionChainsPromotionApproval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), '860ae95a595167d15c02d4369555212caff742cdc1ecc438915a7311faadebe7', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-evolution-chains-sampled-approval-v1')
  assert.equal(approval.userStatement, '回放通过了')
  assert.equal(approval.date, '2026-09-21')
  assert.equal(approval.approvedArtVersion, '1.6.0')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.scope, {
    baseCoverage: 8064,
    sampledCoverage: 13,
    theoreticalCoverage: 35840,
    interpretation: 'Promote the 13 replayed pending rows and preserve the 8,064 approved base rows; do not enumerate the theoretical Cartesian product.',
  })
  assert.deepEqual(approval.candidate, {
    path: candidatePath,
    schemaVersion: candidate.schemaVersion,
    artVersion: candidate.artVersion,
    revision: candidate.revision,
    sha256: sha(candidateBytes),
    provenancePath,
    provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.equal(candidate.artVersion, '1.6.0-candidate.1')
  assert.equal(candidate.revision, 'abe1961efcfa45d94f826adfbb93be0c88db1cba7caf6238ecfefa73c73b7166')
  assert.equal(candidate.coverage.length, 8077)
  assert.equal(candidate.coverage.filter(row => row.review === 'pending').length, 13)
  assert.deepEqual(approval.consumerReplay, {
    sourceExchangeCommit: 'aeb8b581d9dd4f3d2038f6ef0fcf640e1f1254e9',
    nutriCommit: 'b5dd350', replayed: 8077, matched: 8077, sampled: 13,
    oldCoverageUnchanged: 8064, oldResourcesUnchanged: 58, oldStepsUnchanged: 168,
    profileMappings: 140, sunburstBodyMasks: 3,
  })
  assert.equal(report.candidate.revision, candidate.revision)
  assert.equal(report.sampling.total, 13)
  assert.deepEqual(approval.samples, report.sampling.rows, 'Approved sample scope changed')
  assert.deepEqual(approval.samples.map(row => row.coverageId), candidate.coverage.filter(row => row.review === 'pending').map(row => row.id))
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
