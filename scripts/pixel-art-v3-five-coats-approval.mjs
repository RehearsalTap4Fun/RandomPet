import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const fiveCoatsApprovalPath = 'docs/qa/pixel-five-coats/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/five-coats-1.4.0/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/five-coats-1.4.0/provenance.json'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']

export async function validateFiveCoatsApproval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), 'd9206c25f571ba27a9ce8bdb8d1e352ec4edf494a11dd05e7a4522be61256e08', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-five-coats-sampled-approval-v1')
  assert.equal(approval.userStatement, '验收通过')
  assert.equal(approval.date, '2026-09-18')
  assert.equal(approval.approvedArtVersion, '1.4.0')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.scope, {
    coats, body: 'standard', eyes: ['round'], expressions: ['parted-mouth', 'small-fangs'],
    addedProfiles: 10, addedCoverage: 2880, addedResources: 25,
    interpretation: 'Three sampled combinations per coat approve the full recolor-only island; alpha masks, anchors and layer rules remain inherited from 1.3.1.',
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
  assert.equal(candidate.artVersion, '1.4.0-candidate.1')
  assert.equal(candidate.revision, 'cc847b7e74acc5c10c7f5a081e2b0738caa1d05e41fbba12e5fc58e8840931f0')
  assert.equal(candidate.coverage.length, 5184)
  assert.equal(candidate.coverage.filter(row => row.review === 'pending').length, 2880)
  assert.equal(report.candidate.revision, candidate.revision)
  assert.equal(report.sampling.total, 15)
  assert.equal(report.sampling.perCoat, 3)
  assert.deepEqual(approval.samples, report.sampling.rows, 'Approval sample scope changed')
  for (const coat of coats) assert.equal(approval.samples.filter(sample => sample.coat === coat).length, 3)
  for (const sample of approval.samples) {
    const row = candidate.coverage.find(item => item.id === sample.coverageId)
    assert.ok(row, `Approval sample is absent from candidate: ${sample.coverageId}`)
    assert.deepEqual({ phenotype: row.phenotype, profileId: row.profileId, rgbaSha256: row.rgbaSha256 },
      { phenotype: sample.phenotype, profileId: sample.profileId, rgbaSha256: sample.rgbaSha256 }, `Approval sample changed: ${sample.coverageId}`)
  }
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
