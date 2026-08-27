import type { Diagnostic } from '@qmonster/generator-core'
import { readTrustedRepositoryFile } from './trusted-repository-file.js'

export const BRIDGE_RENDER_REVIEW_PROVENANCE_PATH = 'packages/asset-catalog/review/v0.3.0/bridge-render-review-provenance.json'
const REVIEW_ROOT = 'packages/asset-catalog/review/v0.3.0'
const CURRENT_INDEX_PATH = `${REVIEW_ROOT}/structural-matrix-index.json`
const CURRENT_TAIL_REVIEW_PATH = `${REVIEW_ROOT}/tail-extra-review-record.json`
const CURRENT_REWORK_PATH = `${REVIEW_ROOT}/rework-record.json`
const ARCHIVED_REVIEW_ROOT = `${REVIEW_ROOT}/superseded/task9-pre-bridge-render`
const ARCHIVED_INDEX_PATH = `${ARCHIVED_REVIEW_ROOT}/structural-matrix-index.json`
const ARCHIVED_TAIL_REVIEW_PATH = `${ARCHIVED_REVIEW_ROOT}/tail-extra-review-record.json`
const APPROVED_ROUND = 'bridge-render-round3'
const REJECTED_ROUNDS = ['bridge-render-round1', 'bridge-render-round2'] as const
const RIGS = ['biped', 'blob', 'floating'] as const

const EXPECTED_ROUNDS = [
  {
    id: 'pre-bridge-render',
    decision: 'superseded',
    directory: ARCHIVED_REVIEW_ROOT,
    artifacts: {
      biped: { originalSha256: 'd9641d34dd782ec6ca434ab301da081e9d11d3bd50e0eb20af4e748174ea7746', review256Sha256: '0501ca7f54517e24b41e0f155241d2273a444a4bce90b9880861806aaf4e0b89' },
      blob: { originalSha256: '759053880da9dc0c7da7c138a81e2337ca0b846b801c13913da8cb2513161434', review256Sha256: '32390ed773b7f9d0118b441cbf7878818088f1c332b8e17defbafa25baab3fc2' },
      floating: { originalSha256: 'dfa84ab8a4d2fd6252c7b172148b095729ba074af89c95b4839954cd2fccb414', review256Sha256: 'a5d8534f92202b6b5b5215986bf0e689a21c1498f1d8d4eaf4efa986caf0ea89' },
    },
  },
  {
    id: 'bridge-render-round1',
    decision: 'rejected',
    directory: `${REVIEW_ROOT}/superseded/task9-bridge-round1-rejected`,
    artifacts: {
      biped: { originalSha256: 'ae17c1cfc729c09115aac3cbe7021f9e42e23f913566a58bc7bebed6bf1e82f9', review256Sha256: 'b5fefbbc4325af09125d9588a03f7014dc9272ea71e9d210571150256da1273a' },
      blob: { originalSha256: '9ca78000c2d09b830a1b979af1b794f4457e6aec0b433771db9f7df52c05b01b', review256Sha256: 'ba9bfebfe3d602387903170c06b4fa48e626848140d93102a427b5f59555ad4b' },
      floating: { originalSha256: 'f7d2517d3f45e9d7e6cb22ab20308fc35d4d0340f66c92258baebe8b6cd2c760', review256Sha256: '53c8783cc41a2a959c6ba99ba4feb95006ee6852b2b309aae5f6d1ee90558d92' },
    },
  },
  {
    id: 'bridge-render-round2',
    decision: 'rejected',
    directory: `${REVIEW_ROOT}/superseded/task9-bridge-round2-rejected`,
    artifacts: {
      biped: { originalSha256: '06643d365c03ff70a2523682f271e02c176c6c5c9ca210087d355899c0b91a7b', review256Sha256: '8fcfc6198412192ed0583f6ee680a8017301a683313b9161f5d264984f746374' },
      blob: { originalSha256: 'c05d8d4f5c4364622a1ac13b3f4c62fa1e30471275d8a26cd7b1b221e4470d3d', review256Sha256: '75320f77c6e709b60b26747cf96f07ce92e84301f7e86d9d526be78382d7c941' },
      floating: { originalSha256: 'a7e40d5159389a17f97eb94c81b27091c9744c9afc3e2c597c2a75ea8ea7b072', review256Sha256: '8a3c041a1e242fb4cd01d7f0a4a8757631abc93b4032eea0f19cf9c5ce640868' },
    },
  },
  {
    id: APPROVED_ROUND,
    decision: 'approved',
    directory: REVIEW_ROOT,
    artifacts: {
      biped: { originalSha256: 'cabfd512392d0594ae585dc9e6038f6c269fe862384c1a25adccf4bf4f451d25', review256Sha256: 'a7e07d003f574275a96c0ddd4f5cd60f44e3680dba18b11d5e87865788e375ea' },
      blob: { originalSha256: '68da876bfb71e515e44a65fff266e4da74e1f731e370e7e2a0a333bdd8c74ea3', review256Sha256: '017ed510a156a02c103a64aeea1a80abe10feff8355edcb94c2a083cf00ff42b' },
      floating: { originalSha256: '9e5665819a1e5612bfd938f32d9481c64c802b7535704418cfff3802cf04bf71', review256Sha256: '0226156efde49148197ce6572e98ef216fdce540281390bbcdb97c77af33a26f' },
    },
  },
] as const

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index])
}

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

async function readJson(repositoryRoot: string, path: string): Promise<{
  value: unknown
  sha256: string
}> {
  const trusted = await readTrustedRepositoryFile(repositoryRoot, path)
  return { value: JSON.parse(trusted.bytes.toString('utf8')) as unknown, sha256: trusted.sha256 }
}

function reviewFields(value: unknown): JsonRecord | undefined {
  if (!isRecord(value) || !isRecord(value.structuralMatrixReview)) return undefined
  return value.structuralMatrixReview
}

export async function validateBridgeRenderReviewProvenance(repositoryRoot: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  let provenance: unknown
  let provenanceSha256 = ''
  try {
    const read = await readJson(repositoryRoot, BRIDGE_RENDER_REVIEW_PROVENANCE_PATH)
    provenance = read.value
    provenanceSha256 = read.sha256
  } catch {
    return [diagnostic(
      'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID',
      ['bridgeRenderReviewProvenance'],
      'The canonical Task 9 bridge-render review provenance must be trusted readable JSON.',
    )]
  }
  const provenanceRecord = isRecord(provenance) ? provenance : undefined
  const rounds = provenanceRecord?.rounds
  if (
    provenanceRecord === undefined
    || !exactKeys(provenanceRecord, ['schemaVersion', 'status', 'reviewer', 'rounds'])
    || provenanceRecord.schemaVersion !== 'task9-bridge-render-review-provenance-v1'
    || provenanceRecord.status !== 'round3-agent-reviewed-approved'
    || provenanceRecord.reviewer !== 'Codex controller independent visual review'
    || !Array.isArray(rounds)
    || rounds.length !== EXPECTED_ROUNDS.length
  ) diagnostics.push(diagnostic(
    'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID',
    ['bridgeRenderReviewProvenance'],
    'Task 9 bridge-render provenance must use the exact approved four-generation schema.',
  ))

  for (const [index, expected] of EXPECTED_ROUNDS.entries()) {
    const candidate = Array.isArray(rounds) && isRecord(rounds[index]) ? rounds[index] : undefined
    if (
      candidate === undefined
      || !exactKeys(candidate, ['id', 'decision', 'directory', 'reason', 'artifacts'])
      || candidate.id !== expected.id
      || candidate.decision !== expected.decision
      || candidate.directory !== expected.directory
      || typeof candidate.reason !== 'string'
      || candidate.reason.trim() === ''
      || !isRecord(candidate.artifacts)
      || !exactKeys(candidate.artifacts, RIGS)
    ) diagnostics.push(diagnostic(
      'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID',
      ['bridgeRenderReviewProvenance', expected.id],
      `Bridge-render generation ${expected.id} must keep its ordered directory and ${expected.decision} decision.`,
    ))
    for (const rig of RIGS) {
      const claims = candidate !== undefined && isRecord(candidate.artifacts)
        && isRecord(candidate.artifacts[rig]) ? candidate.artifacts[rig] : undefined
      if (claims === undefined || !exactKeys(claims, ['originalSha256', 'review256Sha256'])) {
        diagnostics.push(diagnostic(
          'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID',
          ['bridgeRenderReviewProvenance', expected.id, rig],
          `Bridge-render generation ${expected.id} must claim exactly the original and 256px ${rig} artifacts.`,
        ))
      }
      for (const [field, suffix] of [
        ['originalSha256', ''],
        ['review256Sha256', '-256'],
      ] as const) {
        const expectedHash = expected.artifacts[rig][field]
        const path = `${expected.directory}/structural-matrix-${rig}${suffix}.png`
        let actualHash = ''
        try {
          actualHash = (await readTrustedRepositoryFile(repositoryRoot, path)).sha256
        } catch {
          // The mismatch below intentionally covers missing or untrusted artifacts.
        }
        if (claims?.[field] !== expectedHash || actualHash !== expectedHash) {
          diagnostics.push(diagnostic(
            'PRODUCTION_TASK9_BRIDGE_REVIEW_ARTIFACT_MISMATCH',
            ['bridgeRenderReviewProvenance', expected.id, rig, field],
            `Bridge-render review artifact ${path} must match its independently frozen SHA-256.`,
          ))
        }
      }
    }
  }

  const backlinkDiagnostic = (field: string, message: string): void => {
    diagnostics.push(diagnostic(
      'PRODUCTION_TASK9_BRIDGE_REVIEW_BACKLINK_MISMATCH',
      ['bridgeRenderReviewProvenance', 'backlinks', field],
      message,
    ))
  }
  try {
    const [currentIndex, archivedIndex, currentTail, currentRework, archivedTail] = await Promise.all([
      readTrustedRepositoryFile(repositoryRoot, CURRENT_INDEX_PATH),
      readTrustedRepositoryFile(repositoryRoot, ARCHIVED_INDEX_PATH),
      readJson(repositoryRoot, CURRENT_TAIL_REVIEW_PATH),
      readJson(repositoryRoot, CURRENT_REWORK_PATH),
      readJson(repositoryRoot, ARCHIVED_TAIL_REVIEW_PATH),
    ])
    const tail = reviewFields(currentTail.value)
    const rework = reviewFields(currentRework.value)
    const archived = reviewFields(archivedTail.value)
    if (
      !isRecord(currentTail.value)
      || currentTail.value.schemaVersion !== 'task9-tail-extra-agent-review-v1'
      || currentTail.value.status !== 'agent-reviewed-approved'
      || currentTail.value.decision !== 'approved for Task 9 catalog integration and structural-matrix agent part review'
      || tail === undefined
      || tail.indexPath !== CURRENT_INDEX_PATH
      || tail.indexSha256 !== currentIndex.sha256
      || tail.bridgeRenderReviewProvenancePath !== BRIDGE_RENDER_REVIEW_PROVENANCE_PATH
      || tail.bridgeRenderReviewProvenanceSha256 !== provenanceSha256
      || tail.approvedRound !== APPROVED_ROUND
      || !sameStringArray(tail.rejectedRounds, REJECTED_ROUNDS)
    ) backlinkDiagnostic('tailExtraReviewRecord', 'The current tail/extra review must back-link the approved matrix index and bridge-render decision chain.')
    if (
      !isRecord(currentRework.value)
      || currentRework.value.schemaVersion !== 'task9-agent-part-review-v1'
      || currentRework.value.status !== 'AGENT_PART_REVIEW_APPROVED'
      || rework === undefined
      || rework.indexPath !== CURRENT_INDEX_PATH
      || rework.indexSha256 !== currentIndex.sha256
      || rework.tailExtraReviewRecordPath !== CURRENT_TAIL_REVIEW_PATH
      || rework.tailExtraReviewRecordSha256 !== currentTail.sha256
      || rework.bridgeRenderReviewProvenancePath !== BRIDGE_RENDER_REVIEW_PROVENANCE_PATH
      || rework.bridgeRenderReviewProvenanceSha256 !== provenanceSha256
      || rework.approvedRound !== APPROVED_ROUND
      || !sameStringArray(rework.rejectedRounds, REJECTED_ROUNDS)
    ) backlinkDiagnostic('reworkRecord', 'The current rework review must back-link the current review, index, and bridge-render decision chain.')
    if (
      !isRecord(archivedTail.value)
      || archivedTail.value.schemaVersion !== 'task9-tail-extra-agent-review-v1'
      || archivedTail.value.status !== 'agent-reviewed-approved'
      || archivedTail.value.decision !== 'approved for Task 9 catalog integration and structural-matrix agent part review'
      || archived === undefined
      || archived.decision !== 'approved'
      || archived.indexPath !== ARCHIVED_INDEX_PATH
      || archived.indexSha256 !== archivedIndex.sha256
    ) backlinkDiagnostic('preBridgeReviewRecord', 'The superseded pre-bridge review must preserve its historical approval while back-linking its archived matrix index.')
  } catch {
    backlinkDiagnostic('records', 'Task 9 current and archived bridge-render review backlinks must be trusted readable JSON and regular files.')
  }
  return diagnostics
}
