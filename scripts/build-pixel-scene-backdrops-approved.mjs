import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { writeImmutableOutputs } from './build-pixel-scene-backdrops.mjs'
import {
  pixelSceneBackdropApprovalPath,
  pixelSceneBackdropReplayPath,
  validatePixelSceneBackdropApproval,
} from './pixel-scene-backdrops-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const packageRoot = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0'
const distRoot = 'dist/pixel-scene/backdrop-approved-1.0.0'
const candidatePath = `${packageRoot}/catalog.candidate.json`
const candidateProvenancePath = `${packageRoot}/provenance.candidate.json`
const reportPath = 'docs/qa/pixel-scene-backdrops/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

export async function buildPixelSceneBackdropsApproved() {
  const [candidateBytes, provenanceBytes, approvalBytes, replayBytes, reportBytes] = await Promise.all([
    read(candidatePath), read(candidateProvenancePath), read(pixelSceneBackdropApprovalPath),
    read(pixelSceneBackdropReplayPath), read(reportPath),
  ])
  const candidate = JSON.parse(candidateBytes)
  const candidateProvenance = JSON.parse(provenanceBytes)
  const report = JSON.parse(reportBytes)
  const validated = await validatePixelSceneBackdropApproval(approvalBytes, replayBytes, {
    candidate, candidateBytes, provenanceBytes, report, read,
  })

  const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-scene-backdrops-approved')
  await fs.mkdir(temp, { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-scene-sdk.ts' },
    outdir: temp,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { canonicalJson, requirePixelSceneCatalogV1 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
  requirePixelSceneCatalogV1(candidate)

  const { revision: _candidateRevision, ...candidateContent } = candidate
  const approvedContent = {
    ...candidateContent,
    sceneVersion: '1.0.0',
    backdrops: Object.fromEntries(Object.entries(candidate.backdrops)
      .map(([id, entry]) => [id, { ...entry, review: 'approved' }])),
    generatable: [...candidate.growth.order],
    evidence: {
      ...candidate.evidence,
      [pixelSceneBackdropApprovalPath]: validated.approvalSha256,
      [pixelSceneBackdropReplayPath]: validated.replaySha256,
    },
  }
  const approved = requirePixelSceneCatalogV1({
    ...approvedContent,
    revision: sha(canonicalJson(approvedContent)),
  })
  assert.equal(approved.sceneVersion, '1.0.0')
  assert.deepEqual(approved.generatable, candidate.growth.order)
  assert.ok(Object.values(approved.backdrops).every(entry => entry.review === 'approved'))
  const approvedBytes = Buffer.from(serialized(approved))

  const resourceOutputs = new Map()
  for (const resource of Object.values(candidate.resources)) {
    const bytes = await read(`${packageRoot}/${resource.path}`)
    assert.equal(sha(bytes), resource.sha256, `Candidate asset changed: ${resource.path}`)
    resourceOutputs.set(resource.path, bytes)
  }

  const evidenceFiles = {
    ...candidateProvenance.files,
    [candidatePath]: sha(candidateBytes),
    [candidateProvenancePath]: sha(provenanceBytes),
    [reportPath]: sha(reportBytes),
    [validated.approval.evidence.page.path]: validated.approval.evidence.page.sha256,
    [pixelSceneBackdropApprovalPath]: validated.approvalSha256,
    [pixelSceneBackdropReplayPath]: validated.replaySha256,
  }
  for (const item of validated.approval.evidence.sources) evidenceFiles[item.path] = item.sha256
  for (const item of validated.approval.evidence.samples) evidenceFiles[item.path] = item.pngSha256

  const provenance = {
    schemaVersion: 'pixel-scene-backdrop-approved-provenance-v1',
    status: 'approved',
    runtimeEnabled: false,
    validationMode: 'representative-scene-samples',
    candidate: {
      path: candidatePath,
      sceneVersion: candidate.sceneVersion,
      revision: candidate.revision,
      sha256: sha(candidateBytes),
      provenancePath: candidateProvenancePath,
      provenanceSha256: sha(provenanceBytes),
    },
    approval: {
      path: pixelSceneBackdropApprovalPath,
      sha256: validated.approvalSha256,
      statement: validated.approval.userStatement,
    },
    replay: {
      path: pixelSceneBackdropReplayPath,
      sha256: validated.replaySha256,
      repository: validated.replay.repository,
      commit: validated.replay.commit,
      sceneRevision: validated.replay.sceneRevision,
      subjectRevision: validated.replay.subjectRevision,
      samplesPassed: validated.replay.samplesPassed,
      samplesFailed: validated.replay.samplesFailed,
      nonePassed: validated.replay.nonePassed,
      migrationPassed: validated.replay.migrationPassed,
      webRectangularExportPassed: validated.replay.webRectangularExportPassed,
      miniProgramRectangularExportPassed: validated.replay.miniProgramRectangularExportPassed,
      maxGrowthSteps: validated.replay.maxGrowthSteps,
    },
    approved: {
      packagePath: packageRoot,
      sceneVersion: approved.sceneVersion,
      revision: approved.revision,
      sha256: sha(approvedBytes),
      rendererVersion: approved.rendererVersion,
      resources: Object.keys(approved.resources).length,
      backdrops: Object.keys(approved.backdrops).length,
      generatable: approved.generatable.length,
    },
    backdrops: candidateProvenance.backdrops,
    files: evidenceFiles,
  }
  const provenanceApprovedBytes = Buffer.from(serialized(provenance))
  const outputs = new Map([
    [`${packageRoot}/catalog.approved.json`, approvedBytes],
    [`${packageRoot}/provenance.approved.json`, provenanceApprovedBytes],
    [`${distRoot}/catalog.json`, approvedBytes],
    [`${distRoot}/provenance.json`, provenanceApprovedBytes],
  ])
  for (const [resourcePath, bytes] of resourceOutputs) {
    outputs.set(`${distRoot}/${resourcePath}`, bytes)
  }
  await writeImmutableOutputs(outputs)
  return { approved, provenance, outputs }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const { approved } = await buildPixelSceneBackdropsApproved()
  console.log(`Approved scene ${approved.sceneVersion}: 3 approved+generatable / ${approved.revision}`)
}
