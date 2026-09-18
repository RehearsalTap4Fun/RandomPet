import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const profileGapApprovalPath = 'docs/qa/pixel-profile-gap/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/profile-gap-1.3.1/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/profile-gap-1.3.1/provenance.json'

export async function validateProfileGapApproval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), '9e1f2a88da96c7ca2f45f493a603190c1d3e1fd1d3168094f2fc53aa353c0594', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-profile-gap-approval-v1')
  assert.equal(approval.userStatement, '只改了面部和其他组合都不会有衔接问题，直接通过')
  assert.equal(approval.date, '2026-09-18')
  assert.equal(approval.approvedArtVersion, '1.3.1')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.scope, {
    profileId: 'standard-sleepy-almond-parted-mouth', addedProfiles: 1, addedCoverage: 288,
    interpretation: 'The new face profile is approved; existing part layering is reused without separate seam review.',
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
  assert.deepEqual(candidate, JSON.parse(candidateBytes), 'Approval candidate object changed')
  assert.equal(candidate.artVersion, '1.3.1-candidate.1')
  assert.equal(candidate.revision, '55f14fcc725ab7dc00024e1756bfe7d543ea7e2979014d573081e8aa13e4ef26')
  assert.equal(candidate.coverage.length, 2304)
  const pending = candidate.coverage.filter(row => row.review === 'pending')
  assert.equal(pending.length, 288)
  assert.ok(pending.every(row => row.profileId === approval.scope.profileId), 'Approval scope changed')
  const samples = report.samples.map(({ id, label, phenotype, rgbaSha256, file }) => ({ id, label, phenotype, rgbaSha256, file }))
  assert.deepEqual(approval.samples, samples, 'Approval samples changed')
  for (const sample of approval.samples) {
    const row = pending.find(item => item.phenotype.crown === sample.phenotype.crown && item.phenotype.ears === sample.phenotype.ears && item.phenotype.neck === sample.phenotype.neck && item.phenotype.back === sample.phenotype.back && item.phenotype.tailTip === sample.phenotype.tailTip)
    assert.ok(row, `Approval sample absent from candidate: ${sample.id}`)
    assert.deepEqual({ phenotype: row.phenotype, rgbaSha256: row.rgbaSha256 }, { phenotype: sample.phenotype, rgbaSha256: sample.rgbaSha256 }, `Approval sample changed: ${sample.id}`)
  }
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
