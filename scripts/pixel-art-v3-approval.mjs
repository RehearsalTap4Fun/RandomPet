import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const pixelArtV3ApprovalPath = 'docs/qa/pixel-parts-coverage/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0/provenance.json'

export async function validatePixelArtV3Approval(bytes, { candidate, candidateBytes, provenanceBytes, report, read }) {
  assert.equal(sha(bytes), 'a6034cac531ccc081f72b0d8c04e68b7c4274c1fcdfdf14e52f86f16716a47e2', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-v3-sampled-approval-v1')
  assert.equal(approval.userStatement, '抽样过了就行，其他的默认不需要验收了')
  assert.equal(approval.date, '2026-09-19')
  assert.equal(approval.approvedArtVersion, '1.3.0')
  assert.equal(approval.runtimeEnabled, false)
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
  assert.equal(candidate.artVersion, '1.3.0-candidate.1')
  assert.equal(candidate.revision, 'e2e18cb39bcbcb53aabb714289f19669bbae616188fb240e246487b186be5796')
  assert.equal(candidate.coverage.length, 2016)
  assert.equal(report.candidate.revision, candidate.revision)
  assert.equal(report.sampling.total, 34)
  assert.deepEqual(report.sampling.sections, { 'neck-back': 12, 'crown-ears': 8, profiles: 14 })
  const samples = report.sampling.rows.map(({ coverageId, phenotype, profileId, rgbaSha256, file }) => ({ coverageId, phenotype, profileId, rgbaSha256, file }))
  assert.deepEqual(approval.samples, samples, 'Approval sample scope changed')
  for (const sample of approval.samples) {
    const row = candidate.coverage.find(item => item.id === sample.coverageId)
    assert.ok(row, `Approval sample is absent from candidate: ${sample.coverageId}`)
    assert.deepEqual({ phenotype: row.phenotype, profileId: row.profileId, rgbaSha256: row.rgbaSha256 },
      { phenotype: sample.phenotype, profileId: sample.profileId, rgbaSha256: sample.rgbaSha256 }, `Approval sample changed: ${sample.coverageId}`)
  }
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
