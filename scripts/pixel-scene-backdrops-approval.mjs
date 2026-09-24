import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export const pixelSceneBackdropApprovalPath = 'docs/qa/pixel-scene-backdrops/approval.json'
export const pixelSceneBackdropReplayPath = 'docs/qa/pixel-scene-backdrops/nutri-replay.json'
const candidatePath = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/catalog.candidate.json'
const provenancePath = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/provenance.candidate.json'
const reportPath = 'docs/qa/pixel-scene-backdrops/report.json'
const approvalSha256 = '6b4b8d89c1197cf36d799924f22856c154fb1729717845eda68087081243c74c'
const replaySha256 = 'c7332ab974bfe624b164006260fdce8207f83eea58c9930be9461698839b4af5'
const candidateRevision = '02d81288bc74c19435e53b0cfd12a6422556ecafe0809e71f44062799cf9799c'
const subjectRevision = 'c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf'

export async function validatePixelSceneBackdropApproval(approvalBytes, replayBytes, {
  candidate, candidateBytes, provenanceBytes, report, read,
}) {
  assert.equal(sha(approvalBytes), approvalSha256, 'Approval evidence changed')
  assert.equal(sha(replayBytes), replaySha256, 'Nutri replay evidence changed')
  const approval = JSON.parse(approvalBytes)
  const replay = JSON.parse(replayBytes)

  assert.equal(approval.schemaVersion, 'pixel-scene-backdrop-approval-v1')
  assert.equal(approval.approvedAt, '2026-09-22')
  assert.equal(approval.userStatement, '通过')
  assert.deepEqual(approval.scope, {
    sceneVersion: '1.0.0-candidate.1',
    backdrops: 3,
    samples: 9,
    canvas: [96, 64],
    subjectAnchor: [16, 0],
    interpretation: 'Approve the separate scene contract and the exact nine representative outputs; do not expand the cat coverage grid.',
  })
  assert.deepEqual(approval.candidate, {
    path: candidatePath,
    version: candidate.sceneVersion,
    revision: candidate.revision,
    catalogSha256: sha(candidateBytes),
    provenancePath,
    provenanceSha256: sha(provenanceBytes),
  }, 'Approval candidate identity changed')
  assert.equal(candidate.sceneVersion, '1.0.0-candidate.1')
  assert.equal(candidate.revision, candidateRevision)
  assert.equal(candidate.validatedSubject.revision, subjectRevision)
  assert.equal(report.scene.revision, candidate.revision)
  assert.equal(report.subject.revision, subjectRevision)
  assert.equal(report.samples.length, 9)

  const evidenceFiles = [approval.evidence.report, approval.evidence.page, ...approval.evidence.sources]
  for (const item of evidenceFiles) {
    assert.equal(sha(await read(item.path)), item.sha256, `Evidence changed: ${item.path}`)
  }
  assert.equal(approval.evidence.report.path, reportPath)
  for (const item of approval.evidence.samples) {
    assert.equal(sha(await read(item.path)), item.pngSha256, `Evidence changed: ${item.path}`)
    const row = report.samples.find(sample => sample.id === item.id)
    assert.ok(row, `Approval sample missing from report: ${item.id}`)
    assert.equal(item.path, row.file)
    assert.equal(item.pngSha256, row.pngSha256)
    assert.equal(item.sceneRgbaSha256, row.sceneRgbaSha256)
  }
  assert.deepEqual(approval.evidence.noneCase, report.noneCase, 'Approval none evidence changed')

  assert.equal(replay.schemaVersion, 'pixel-scene-backdrop-nutri-replay-v1')
  assert.equal(replay.reportedAt, '2026-09-24')
  assert.equal(replay.sourceExchangePath, 'docs/integration/nutri-codex-exchange.md')
  assert.equal(replay.sourceExchangeCommit, '2a836451045cbf08d64cf4ff159e8ac23468f4e6')
  assert.equal(replay.repository, 'Nutri')
  assert.match(replay.commit, /^[0-9a-f]{7,40}$/)
  assert.equal(replay.commit, '01e5f0b')
  assert.equal(replay.sceneVersion, candidate.sceneVersion)
  assert.equal(replay.sceneRevision, candidate.revision)
  assert.equal(replay.subjectArtVersion, '1.6.1')
  assert.equal(replay.subjectRevision, subjectRevision)
  assert.equal(replay.samplesPassed, 9)
  assert.equal(replay.samplesFailed, 0)
  assert.equal(replay.nonePassed, true)
  assert.equal(replay.migrationPassed, true)
  assert.equal(replay.webRectangularExportPassed, true)
  assert.equal(replay.miniProgramRectangularExportPassed, true)
  assert.equal(replay.independentGrowthSlotPassed, true)
  assert.equal(replay.maxGrowthSteps, 18)
  assert.equal(replay.runtimeIntegrated, true)
  assert.equal(replay.runtimeDeployed, false)
  assert.equal(replay.samples.length, 9)
  assert.deepEqual(replay.samples.map(row => row.id), report.samples.map(row => row.id))
  assert.deepEqual(replay.samples.map(row => row.coverageId), report.samples.map(row => row.coverageId))
  assert.ok(replay.samples.every(row => row.catRgbaPassed && row.sceneRgbaPassed && row.pngPassed))

  return {
    approval, replay,
    approvalSha256: approvalSha256,
    replaySha256: replaySha256,
  }
}
