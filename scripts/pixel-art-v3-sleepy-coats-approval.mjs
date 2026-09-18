import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const sleepyCoatsApprovalPath = 'docs/qa/pixel-sleepy-coats/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/sleepy-coats-1.5.0/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/sleepy-coats-1.5.0/provenance.json'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']

export async function validateSleepyCoatsApproval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), '037b1859c5066914862d9a15fbc7bf5c2f89e090c4674bcb2262c8191da71483', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-sleepy-coats-sampled-approval-v1')
  assert.equal(approval.userStatement, 'ok，通过')
  assert.equal(approval.date, '2026-09-18')
  assert.equal(approval.approvedArtVersion, '1.5.0')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.scope, {
    coats, body: 'standard', eyes: ['sleepy-almond'], expressions: ['parted-mouth', 'small-fangs'],
    addedProfiles: 10, addedCoverage: 2880, addedResources: 10,
    interpretation: 'Three sampled combinations per coat approve both sleepy-almond expressions; RGB outside the bounded eye patch remains unchanged and alpha inherits approved sleepy templates.',
  })
  assert.deepEqual(approval.candidate, {
    path: candidatePath, schemaVersion: candidate.schemaVersion, artVersion: candidate.artVersion,
    revision: candidate.revision, sha256: sha(candidateBytes), provenancePath, provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.deepEqual(candidate, JSON.parse(candidateBytes), 'Approval candidate object changed')
  assert.equal(candidate.artVersion, '1.5.0-candidate.1')
  assert.equal(candidate.revision, '01c9df8e7a85b08c897614c4c97c886bf63aa8b0cfb80d5fe8d6055c0ceb96fc')
  assert.equal(candidate.coverage.length, 8064)
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
