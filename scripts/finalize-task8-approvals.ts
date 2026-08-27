import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REVIEW_ROOT = 'packages/asset-catalog/review/v0.3.0'
const BODY_REVIEW = `${REVIEW_ROOT}/body-head-review-record.json`
const BODY_AMENDMENT = `${REVIEW_ROOT}/body-head-connector-amendment.json`
const BODY_ACCEPTANCE = `${REVIEW_ROOT}/body-head-contact-sheets-acceptance.json`
const LIMB_REVIEW = `${REVIEW_ROOT}/limb-review-record.json`
const LIMB_ACCEPTANCE = `${REVIEW_ROOT}/limb-contact-sheets-acceptance.json`
const THRESHOLD_AMENDMENT = `${REVIEW_ROOT}/visible-limb-threshold-amendment.json`
const PROCESSED_INDEX = 'asset-source/v0.3.0/production/processed-index.json'
const SOURCE_INDEX = 'packages/asset-catalog/source-index-v0.3.0.json'

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hash(path: string): Promise<string> { return sha256(await readFile(resolve(ROOT, path))) }
async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(resolve(ROOT, path), 'utf8')) }
async function writeJson(path: string, value: unknown): Promise<void> { await writeFile(resolve(ROOT, path), `${JSON.stringify(value, null, 2)}\n`) }

function artifactPaths(prefix: 'body-head' | 'limb', rigId: string) {
  const stem = `${REVIEW_ROOT}/${prefix}-contact-sheet-${rigId}`
  return { originalPath: `${stem}.png`, review256Path: `${stem}-256.png`, manifestPath: `${stem}-manifest.json` }
}

async function artifacts(prefix: 'body-head' | 'limb') {
  return Promise.all(['blob', 'biped', 'floating'].map(async rigId => {
    const paths = artifactPaths(prefix, rigId)
    return {
      rigId, ...paths,
      originalSha256: await hash(paths.originalPath),
      review256Sha256: await hash(paths.review256Path),
      manifestSha256: await hash(paths.manifestPath),
    }
  }))
}

export async function finalizeTask8Approvals(reviewedAt = new Date().toISOString()) {
  const imagePaths = [...['blob', 'biped', 'floating'].flatMap(rigId => {
    const body = artifactPaths('body-head', rigId); const limb = artifactPaths('limb', rigId)
    return [body.originalPath, body.review256Path, body.manifestPath, limb.originalPath, limb.review256Path, limb.manifestPath]
  })]
  const before = new Map(await Promise.all(imagePaths.map(async path => [path, await hash(path)] as const)))
  const [bodyReview, limbReview, bodyAmendment, threshold, oldAcceptance, production] = await Promise.all([
    readJson(BODY_REVIEW), readJson(LIMB_REVIEW), readJson(BODY_AMENDMENT), readJson(THRESHOLD_AMENDMENT),
    readJson(`${REVIEW_ROOT}/superseded/task7-pre-wide-shoulder-amendment/body-head-contact-sheets-acceptance.pre-amendment.json`),
    readJson('asset-source/v0.3.0/generation/task8-limb-production.json'),
  ])
  if (bodyReview.status !== 'WAITING_FOR_USER_REAPPROVAL' || limbReview.status !== 'WAITING_FOR_USER_APPROVAL' || bodyAmendment.status !== 'WAITING_FOR_USER_REAPPROVAL' || threshold.status !== 'WAITING_FOR_USER_REAPPROVAL') {
    throw new Error('APPROVAL_FINALIZE_INVALID: expected pending review boundaries')
  }
  if (threshold.activeMinimum !== 0.614 || threshold.boundaryBehavior?.rejects !== 0.613999 || bodyAmendment.newOrigins?.left?.x !== 490 || bodyAmendment.newOrigins?.right?.x !== 1558) {
    throw new Error('APPROVAL_FINALIZE_INVALID: active amendment contract differs')
  }

  Object.assign(bodyReview, {
    status: 'APPROVED', decision: 'approved', reviewer: 'user', userApproved: true,
    approvalResponse: 'A', reviewedAt, latestUserDecision: 'A',
    latestUserFeedback: 'Approved the unchanged Task 7 visual matrices under the body_blob_wide x490/1558 shoulder connector amendment.',
  })
  Object.assign(limbReview, {
    status: 'APPROVED', decision: 'approved', reviewer: 'user', userApproved: true,
    approvalResponse: 'A', reviewedAt, entryCount: 60, entryCountByRig: { blob: 24, biped: 24, floating: 12 },
  })
  Object.assign(bodyAmendment, { status: 'APPROVED', userApproved: true, reapprovalDecision: 'A', reapprovedAt: reviewedAt })
  Object.assign(threshold, { status: 'APPROVED', userApproved: true, approvalResponse: 'A', approvedAt: reviewedAt })
  await Promise.all([
    writeJson(BODY_REVIEW, bodyReview), writeJson(LIMB_REVIEW, limbReview),
    writeJson(BODY_AMENDMENT, bodyAmendment), writeJson(THRESHOLD_AMENDMENT, threshold),
  ])

  const [bodyReviewSha256, limbReviewSha256, amendmentSha256, thresholdSha256, bodyArtifacts, limbArtifacts] = await Promise.all([
    hash(BODY_REVIEW), hash(LIMB_REVIEW), hash(BODY_AMENDMENT), hash(THRESHOLD_AMENDMENT), artifacts('body-head'), artifacts('limb'),
  ])
  const bodyAcceptance = {
    ...oldAcceptance, schemaVersion: 'body-head-acceptance-v1', decision: 'approved', reviewedAt,
    reviewer: 'user', userApproved: true, approvalResponse: 'A', artifacts: bodyArtifacts,
    reapproval: {
      reason: 'body_blob_wide-shoulder-connector-amendment', amendmentPath: BODY_AMENDMENT, amendmentSha256,
      reviewRecordPath: BODY_REVIEW, reviewRecordSha256: bodyReviewSha256,
      supersededApprovalPath: `${REVIEW_ROOT}/superseded/task7-pre-wide-shoulder-amendment/body-head-contact-sheets-acceptance.pre-amendment.json`,
      supersededApprovalSha256: await hash(`${REVIEW_ROOT}/superseded/task7-pre-wide-shoulder-amendment/body-head-contact-sheets-acceptance.pre-amendment.json`),
      preAmendmentEvidence: bodyAmendment.preAmendmentEvidence,
      visualArtifactsByteIdentical: true,
    },
    notes: [
      'User selected A and reapproved the unchanged Task 7 body/head matrices under the x490/1558 shoulder connector amendment.',
      'All nine canonical visual/manifest artifacts remain byte-identical to the archived pre-amendment evidence.',
      'Approval is exact to the amendment, review-record, artifact, rejection, and Task 6 integrity hashes recorded here.',
    ],
  }
  await writeJson(BODY_ACCEPTANCE, bodyAcceptance)

  const manifests = await Promise.all(['blob', 'biped', 'floating'].map(rigId => readJson(artifactPaths('limb', rigId).manifestPath)))
  const limbMetrics = manifests.flatMap(item => item.entries).flatMap((entry: any) => entry.connectorMetrics.filter((metric: any) => /^(shoulder|hip)/.test(metric.connectorId)))
  const limbAcceptance = {
    schemaVersion: 'limb-acceptance-v1', catalogVersion: '0.3.0', rendererVersion: '0.3.0', decision: 'approved', reviewedAt,
    reviewer: 'user', userApproved: true, approvalResponse: 'A', entryCount: 60, entryCountByRig: { blob: 24, biped: 24, floating: 12 },
    artifacts: limbArtifacts,
    reviewRecord: { path: LIMB_REVIEW, sha256: limbReviewSha256 },
    thresholdContract: { path: THRESHOLD_AMENDMENT, sha256: thresholdSha256, activeMinimum: 0.614, rejects: 0.613999, noOverrides: true },
    connectorAmendment: { path: BODY_AMENDMENT, sha256: amendmentSha256, bodyId: 'body_blob_wide', shoulderOrigins: { left: 490, right: 1558 } },
    task7Reapproval: { path: BODY_ACCEPTANCE, sha256: await hash(BODY_ACCEPTANCE) },
    productionEvidence: { path: 'asset-source/v0.3.0/generation/task8-limb-production.json', sha256: await hash('asset-source/v0.3.0/generation/task8-limb-production.json'), imageGenCalls: production.imageGenCalls, targetedRegenerationCalls: production.targetedRegenerationCalls },
    causalMetrics: {
      thresholds: { receiverCoverageMin: 0.9, plugCoverageMin: 0.9, largestComponentRatioMin: 0.99, centerlineGapPixelsMax: 2, childOutsideBodyRatioMin: 0.614 },
      results: {
        entryCount: 60,
        receiverCoverageMin: Math.min(...limbMetrics.map((item: any) => item.receiverCoverage)),
        plugCoverageMin: Math.min(...limbMetrics.map((item: any) => item.plugCoverage)),
        largestComponentRatioMin: Math.min(...limbMetrics.map((item: any) => item.largestComponentRatio)),
        centerlineGapPixelsMax: Math.max(...limbMetrics.map((item: any) => item.centerlineGapPixels)),
        childOutsideBodyRatioMin: Math.min(...limbMetrics.map((item: any) => item.childOutsideBodyRatio)),
      },
    },
    notes: ['User selected A and approved all 60 exact-rig limb matrix cells.', 'Approval is exact to the six sheets, three manifests, review record, global threshold, connector amendment, and Task 7 reapproval hashes recorded here.'],
  }
  await writeJson(LIMB_ACCEPTANCE, limbAcceptance)

  const processed = await readJson(PROCESSED_INDEX)
  for (const source of processed.sourceIndex.sources) {
    if (source.reviewRecordPath === BODY_REVIEW) source.reviewRecordSha256 = bodyReviewSha256
    if (source.reviewRecordPath === LIMB_REVIEW) source.reviewRecordSha256 = limbReviewSha256
  }
  await writeJson(PROCESSED_INDEX, processed)
  await writeJson(SOURCE_INDEX, processed.sourceIndex)
  for (const [path, expected] of before) if (await hash(path) !== expected) throw new Error(`APPROVAL_FINALIZE_INVALID: review artifact changed: ${path}`)
  return { reviewedAt, bodyAcceptanceSha256: await hash(BODY_ACCEPTANCE), limbAcceptanceSha256: await hash(LIMB_ACCEPTANCE), bodyReviewSha256, limbReviewSha256, amendmentSha256, thresholdSha256 }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await finalizeTask8Approvals()))
