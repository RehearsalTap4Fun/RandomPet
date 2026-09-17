import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export const coverageApprovalPath = 'docs/qa/pixel-standard-small-fangs-approved/approval.json'
const candidatePath = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round/provenance.json'
const approvedIds = ['horns', 'flame', 'horns-flame', 'horns-ears', 'horns-mane', 'ears-flame', 'mane-flame', 'horns-ears-mane', 'horns-ears-flame', 'horns-mane-flame', 'ears-mane-flame'].map(s => `standard-${s}`)

// Fixed user approval: it must never acquire newly regenerated art or a broader scope.
export async function validateCoverageApproval(bytes, { candidate, candidateBytes, provenanceBytes, read }) {
  assert.equal(sha(bytes), 'c9dc5f1953d9c83299236e82f5e83345185d0346a232815fce4724da169d371e', 'Approval evidence changed')
  const approval = JSON.parse(bytes)
  assert.equal(approval.schemaVersion, 'pixel-art-coverage-approval-v1')
  assert.equal(approval.userStatement, '通过')
  assert.equal(approval.date, '2026-09-17')
  assert.equal(approval.approvedArtVersion, '1.2.1')
  assert.equal(approval.runtimeEnabled, false)
  assert.deepEqual(approval.candidate, {
    path: candidatePath, schemaVersion: candidate.schemaVersion, artVersion: candidate.artVersion, revision: candidate.revision,
    sha256: sha(candidateBytes), provenancePath, provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.deepEqual(candidate, JSON.parse(candidateBytes), 'Approval candidate object changed')
  assert.equal(candidate.artVersion, '1.2.1-candidate.1')
  assert.equal(candidate.revision, '98db61376007d0fa62932ab0626c0b93ebcd29221e6f63182db31ca87efacc4c')
  const pending = candidate.coverage.filter(row => row.review === 'pending')
  assert.deepEqual(pending.map(row => row.id), approvedIds, 'Approval scope changed')
  assert.deepEqual(approval.samples, pending.map(({ id, phenotype, profileId, rgbaSha256 }) => ({ id, phenotype, profileId, rgbaSha256 })), 'Approval samples changed')
  assert.deepEqual(approval.profile, { id: 'standard-small-fangs-round', definition: candidate.profiles.find(p => p.id === 'standard-small-fangs-round') }, 'Approval profile changed')
  for (const [file, hash] of Object.entries(approval.evidence)) assert.equal(sha(await read(file)), hash, `Evidence changed: ${file}`)
  return { approval, sha256: sha(bytes) }
}
