import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { validateProductionEvidenceDependencies } from './evidence-root.js'
import {
  BRIDGE_RENDER_REVIEW_PROVENANCE_PATH,
  validateBridgeRenderReviewProvenance,
} from './bridge-render-review-provenance.js'

const REVIEW_ROOT = 'packages/asset-catalog/review/v0.3.0'
const CURRENT_INDEX_PATH = `${REVIEW_ROOT}/structural-matrix-index.json`
const CURRENT_TAIL_REVIEW_PATH = `${REVIEW_ROOT}/tail-extra-review-record.json`
const CURRENT_REWORK_PATH = `${REVIEW_ROOT}/rework-record.json`
const ARCHIVED_REVIEW_ROOT = `${REVIEW_ROOT}/superseded/task9-pre-bridge-render`
const ARCHIVED_INDEX_PATH = `${ARCHIVED_REVIEW_ROOT}/structural-matrix-index.json`
const ARCHIVED_TAIL_REVIEW_PATH = `${ARCHIVED_REVIEW_ROOT}/tail-extra-review-record.json`
const JSON_PATHS = [
  BRIDGE_RENDER_REVIEW_PROVENANCE_PATH,
  CURRENT_INDEX_PATH,
  CURRENT_TAIL_REVIEW_PATH,
  CURRENT_REWORK_PATH,
  ARCHIVED_INDEX_PATH,
  ARCHIVED_TAIL_REVIEW_PATH,
] as const
const ROUNDS = [
  { id: 'pre-bridge-render', directory: ARCHIVED_REVIEW_ROOT },
  { id: 'bridge-render-round1', directory: `${REVIEW_ROOT}/superseded/task9-bridge-round1-rejected` },
  { id: 'bridge-render-round2', directory: `${REVIEW_ROOT}/superseded/task9-bridge-round2-rejected` },
  { id: 'bridge-render-round3', directory: REVIEW_ROOT },
] as const
const RIGS = ['biped', 'blob', 'floating'] as const
const ARTIFACTS = ROUNDS.flatMap(round => RIGS.flatMap(rig => [
  { roundId: round.id, rig, field: 'originalSha256' as const, path: `${round.directory}/structural-matrix-${rig}.png` },
  { roundId: round.id, rig, field: 'review256Sha256' as const, path: `${round.directory}/structural-matrix-${rig}-256.png` },
]))

let root = ''
const baselineJson = new Map<string, Buffer>()

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson(path: string): Promise<any> {
  return JSON.parse((await readFile(join(root, path), 'utf8')) as string)
}

async function copyRepositoryFile(path: string): Promise<void> {
  const destination = join(root, path)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(join(process.cwd(), path), destination)
}

async function synchronizeProvenanceBacklinks(): Promise<void> {
  const provenanceHash = sha256(await readFile(join(root, BRIDGE_RENDER_REVIEW_PROVENANCE_PATH)))
  const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
  tail.structuralMatrixReview.bridgeRenderReviewProvenancePath = BRIDGE_RENDER_REVIEW_PROVENANCE_PATH
  tail.structuralMatrixReview.bridgeRenderReviewProvenanceSha256 = provenanceHash
  tail.structuralMatrixReview.approvedRound = 'bridge-render-round3'
  tail.structuralMatrixReview.rejectedRounds = ['bridge-render-round1', 'bridge-render-round2']
  await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
  const rework = await readJson(CURRENT_REWORK_PATH)
  rework.structuralMatrixReview.bridgeRenderReviewProvenancePath = BRIDGE_RENDER_REVIEW_PROVENANCE_PATH
  rework.structuralMatrixReview.bridgeRenderReviewProvenanceSha256 = provenanceHash
  rework.structuralMatrixReview.approvedRound = 'bridge-render-round3'
  rework.structuralMatrixReview.rejectedRounds = ['bridge-render-round1', 'bridge-render-round2']
  rework.structuralMatrixReview.tailExtraReviewRecordPath = CURRENT_TAIL_REVIEW_PATH
  rework.structuralMatrixReview.tailExtraReviewRecordSha256 = sha256(await readFile(join(root, CURRENT_TAIL_REVIEW_PATH)))
  await writeJson(CURRENT_REWORK_PATH, rework)
}

async function synchronizeTailBacklink(): Promise<void> {
  const rework = await readJson(CURRENT_REWORK_PATH)
  rework.structuralMatrixReview.tailExtraReviewRecordSha256 = sha256(await readFile(join(root, CURRENT_TAIL_REVIEW_PATH)))
  await writeJson(CURRENT_REWORK_PATH, rework)
}

async function provenanceDiagnostics() {
  return validateBridgeRenderReviewProvenance(root)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'qmonster-bridge-review-'))
  for (const path of [...JSON_PATHS, ...ARTIFACTS.map(artifact => artifact.path)]) {
    await copyRepositoryFile(path)
  }
  const archivedReview = await readJson(ARCHIVED_TAIL_REVIEW_PATH)
  archivedReview.structuralMatrixReview.indexPath = ARCHIVED_INDEX_PATH
  archivedReview.structuralMatrixReview.indexSha256 = sha256(await readFile(join(root, ARCHIVED_INDEX_PATH)))
  await writeJson(ARCHIVED_TAIL_REVIEW_PATH, archivedReview)
  for (const path of JSON_PATHS) baselineJson.set(path, await readFile(join(root, path)))
})

afterEach(async () => {
  for (const [path, bytes] of baselineJson) await writeFile(join(root, path), bytes)
})

afterAll(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true })
})

describe('bridge-render review provenance', () => {
  it('accepts the exact four-generation decision chain and all 24 committed artifact hashes', async () => {
    expect(await provenanceDiagnostics()).toEqual([])
  })

  it.each([
    ['schema version', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.schemaVersion = 'task9-bridge-render-review-provenance-v0' }],
    ['top-level status', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.status = 'round2-agent-reviewed-approved' }],
    ['reviewer identity', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.reviewer = '' }],
    ['generation order', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { [value.rounds[1], value.rounds[2]] = [value.rounds[2], value.rounds[1]] }],
    ['generation decision', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.rounds[1].decision = 'approved' }],
    ['generation directory', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.rounds[1].directory = value.rounds[2].directory }],
    ['generation reason', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { value.rounds[2].reason = '' }],
    ['rig artifact inventory', 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID', (value: any) => { delete value.rounds[3].artifacts.floating }],
    ['artifact hash shape', 'PRODUCTION_TASK9_BRIDGE_REVIEW_ARTIFACT_MISMATCH', (value: any) => { value.rounds[3].artifacts.blob.originalSha256 = 'not-a-sha' }],
  ])('rejects synchronized semantic mutation of %s', async (_label, expectedCode, mutate) => {
    const provenance = await readJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH)
    mutate(provenance)
    await writeJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH, provenance)
    await synchronizeProvenanceBacklinks()

    expect(await provenanceDiagnostics()).toContainEqual(expect.objectContaining({
      code: expectedCode,
    }))
  })

  it.each(ARTIFACTS)(
    'rejects synchronized replacement of $roundId $rig $field',
    async artifact => {
      const artifactPath = join(root, artifact.path)
      const originalBytes = await readFile(artifactPath)
      try {
        const changedBytes = Buffer.concat([originalBytes, Buffer.from('semantic-tamper')])
        await writeFile(artifactPath, changedBytes)
        const provenance = await readJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH)
        const round = provenance.rounds.find((item: any) => item.id === artifact.roundId)
        round.artifacts[artifact.rig][artifact.field] = sha256(changedBytes)
        await writeJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH, provenance)
        await synchronizeProvenanceBacklinks()

        expect(await provenanceDiagnostics()).toContainEqual(expect.objectContaining({
          code: 'PRODUCTION_TASK9_BRIDGE_REVIEW_ARTIFACT_MISMATCH',
          path: ['bridgeRenderReviewProvenance', artifact.roundId, artifact.rig, artifact.field],
        }))
      } finally {
        await writeFile(artifactPath, originalBytes)
      }
    },
  )

  it.each([
    ['current review provenance path', async () => {
      const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
      tail.structuralMatrixReview.bridgeRenderReviewProvenancePath = ARCHIVED_TAIL_REVIEW_PATH
      await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
      await synchronizeTailBacklink()
    }],
    ['current review provenance hash', async () => {
      const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
      tail.structuralMatrixReview.bridgeRenderReviewProvenanceSha256 = 'f'.repeat(64)
      await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
      await synchronizeTailBacklink()
    }],
    ['current review approved round', async () => {
      const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
      tail.structuralMatrixReview.approvedRound = 'bridge-render-round2'
      await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
      await synchronizeTailBacklink()
    }],
    ['current review rejected rounds', async () => {
      const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
      tail.structuralMatrixReview.rejectedRounds = ['bridge-render-round1']
      await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
      await synchronizeTailBacklink()
    }],
    ['current review index backlink', async () => {
      const tail = await readJson(CURRENT_TAIL_REVIEW_PATH)
      tail.structuralMatrixReview.indexPath = ARCHIVED_INDEX_PATH
      tail.structuralMatrixReview.indexSha256 = sha256(await readFile(join(root, ARCHIVED_INDEX_PATH)))
      await writeJson(CURRENT_TAIL_REVIEW_PATH, tail)
      await synchronizeTailBacklink()
    }],
    ['rework provenance path', async () => {
      const rework = await readJson(CURRENT_REWORK_PATH)
      rework.structuralMatrixReview.bridgeRenderReviewProvenancePath = ARCHIVED_TAIL_REVIEW_PATH
      await writeJson(CURRENT_REWORK_PATH, rework)
    }],
    ['rework provenance hash', async () => {
      const rework = await readJson(CURRENT_REWORK_PATH)
      rework.structuralMatrixReview.bridgeRenderReviewProvenanceSha256 = 'f'.repeat(64)
      await writeJson(CURRENT_REWORK_PATH, rework)
    }],
    ['rework approved round', async () => {
      const rework = await readJson(CURRENT_REWORK_PATH)
      rework.structuralMatrixReview.approvedRound = 'bridge-render-round2'
      await writeJson(CURRENT_REWORK_PATH, rework)
    }],
    ['rework rejected rounds', async () => {
      const rework = await readJson(CURRENT_REWORK_PATH)
      rework.structuralMatrixReview.rejectedRounds = ['bridge-render-round2']
      await writeJson(CURRENT_REWORK_PATH, rework)
    }],
    ['rework current-review backlink', async () => {
      const rework = await readJson(CURRENT_REWORK_PATH)
      rework.structuralMatrixReview.tailExtraReviewRecordPath = ARCHIVED_TAIL_REVIEW_PATH
      rework.structuralMatrixReview.tailExtraReviewRecordSha256 = sha256(await readFile(join(root, ARCHIVED_TAIL_REVIEW_PATH)))
      await writeJson(CURRENT_REWORK_PATH, rework)
    }],
    ['archived review index backlink', async () => {
      const archived = await readJson(ARCHIVED_TAIL_REVIEW_PATH)
      archived.structuralMatrixReview.indexPath = CURRENT_INDEX_PATH
      archived.structuralMatrixReview.indexSha256 = sha256(await readFile(join(root, CURRENT_INDEX_PATH)))
      await writeJson(ARCHIVED_TAIL_REVIEW_PATH, archived)
    }],
  ])('rejects synchronized semantic mutation of %s', async (_label, mutate) => {
    await mutate()
    expect(await provenanceDiagnostics()).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_TASK9_BRIDGE_REVIEW_BACKLINK_MISMATCH',
    }))
  })

  it('surfaces semantic provenance tampering through formal evidence validation after hashes are synchronized', async () => {
    const provenance = await readJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH)
    provenance.rounds[0].decision = 'rejected'
    await writeJson(BRIDGE_RENDER_REVIEW_PROVENANCE_PATH, provenance)
    await synchronizeProvenanceBacklinks()

    const diagnostics = await validateProductionEvidenceDependencies({
      task9Evidence: { dependencies: [] },
    }, root)
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PRODUCTION_TASK9_BRIDGE_REVIEW_PROVENANCE_INVALID',
    }))
  })
})
