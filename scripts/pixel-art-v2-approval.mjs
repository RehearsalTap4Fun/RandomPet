import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const approvalPath = 'docs/qa/flat-source-trial/stage3/approval.json'
const approvalSha256 = '6a43052dcd8daffc7c745f079cbbcbf2162e02b8dbfcf1d2ff52d5f50c4a0fd4'

// This fixed approval binds user consent to exact historical bytes, not future regenerated art.
export async function validateApproval(bytes, { candidate, candidateBytes, provenanceBytes, stage3, read }) {
  assert.equal(sha(bytes), approvalSha256, 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-approval-v2')
  assert.equal(approval.userStatement, 'ok，通过')
  assert.equal(approval.date, '2026-09-17')
  assert.equal(approval.approvedArtVersion, '1.2.0')
  assert.deepEqual(approval.candidate, {
    path: 'packages/asset-catalog/pixel/v2/catalog.candidate.json',
    schemaVersion: candidate.schemaVersion, artVersion: candidate.artVersion, revision: candidate.revision,
    sha256: sha(candidateBytes), provenancePath: 'packages/asset-catalog/pixel/v2/provenance.json', provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.equal(candidate.revision, '3ba990a5dfde65b0b79dabe958c9d3c742a08a30fdb582536b85cde5b11c288d')
  assert.equal(candidate.artVersion, '1.2.0-candidate.1')
  const pending = candidate.coverage.filter(c => c.review === 'pending')
  assert.equal(pending.length, 7)
  assert.deepEqual(approval.samples, pending.map(({ id, phenotype, profileId, rgbaSha256 }) => ({ id, phenotype, profileId, rgbaSha256 })), 'Approval samples must match the exact seven pending entries')
  assert.equal(approval.report.path, 'docs/qa/flat-source-trial/stage3/report.json')
  assert.deepEqual(approval.profile, { path: stage3.profileFile, sha256: stage3.profileSha256 })
  assert.deepEqual(approval.sourceAssets, stage3.sourceAssets)
  for (const [file, expected] of Object.entries({ [approval.report.path]: approval.report.sha256, [approval.profile.path]: approval.profile.sha256, ...approval.sourceAssets })) {
    assert.equal(sha(await read(file)), expected, `Evidence hash changed: ${file}`)
  }
  return { approval, sha256: approvalSha256 }
}
