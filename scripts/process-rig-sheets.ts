import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import sharp from 'sharp'
import type { RigId } from '@qmonster/generator-core'
import { buildRuntimeAsset } from './build-runtime-assets.js'
import {
  normalizeApprovedMaster,
  processCandidateSheet,
  type CandidateSheetVariant,
  type NormalizedMasterResult,
} from './process-candidate-sheet.js'
import { pruneStaleFiles, resolveOutputPath } from './safe-output.js'

export interface RigCandidateAudit {
  index: number
  selected: boolean
  machineApproved: boolean
  extraction: CandidateSheetVariant['extraction']
}

export interface RigSheetAudit {
  rigId: RigId
  sourceId: string
  sheetPath: string
  sheetSha256: string
  selected: number
  candidateEvaluations: RigCandidateAudit[]
  selectedExtraction: CandidateSheetVariant['extraction']
  master: NormalizedMasterResult
  runtimePngPath: string
  runtimePngSha256: string
  runtimeWebpPath: string
  runtimeWebpSha256: string
}

export interface RigManifestEntry {
  rigId: RigId
  sourceId: string
  selected: 1 | 2 | 3 | 4
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function processRigSheet(input: {
  rigId: RigId
  sourceId: string
  sheetPath: string
  selected: 1 | 2 | 3 | 4
  sourceRoot: string
  runtimeRoot: string
}): Promise<RigSheetAudit> {
  const candidateDirectory = resolveOutputPath(input.sourceRoot, 'generation', 'rig-candidates', input.sourceId)
  const candidates = await processCandidateSheet({
    sourcePath: input.sheetPath,
    outputDirectory: candidateDirectory,
    sourceId: input.sourceId,
  })
  const chosen = candidates.find(candidate => candidate.index === input.selected)!
  if (!chosen.extraction.approved) {
    throw new Error(`Selected rig candidate ${input.sourceId}#${input.selected} failed chroma extraction.`)
  }

  const masterPath = resolveOutputPath(input.sourceRoot, 'rigs', `${input.sourceId}.png`)
  const master = await normalizeApprovedMaster({
    rgbaPath: chosen.rgbaPath,
    masterPath,
    maximumSubjectSize: 1792,
  })
  const runtimeDirectory = resolveOutputPath(input.runtimeRoot, 'rigs')
  await mkdir(runtimeDirectory, { recursive: true })
  const runtimePngPath = join(runtimeDirectory, `${input.sourceId}.png`)
  const runtimeWebpPath = join(runtimeDirectory, `${input.sourceId}.webp`)
  await sharp(masterPath)
    .resize(1024, 1024, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(runtimePngPath)
  await buildRuntimeAsset({ sourcePath: masterPath, runtimePath: runtimeWebpPath, sourceId: input.sourceId })

  return {
    rigId: input.rigId,
    sourceId: input.sourceId,
    sheetPath: input.sheetPath,
    sheetSha256: await sha256File(input.sheetPath),
    selected: input.selected,
    candidateEvaluations: candidates.map(candidate => ({
      index: candidate.index,
      selected: candidate.index === input.selected,
      machineApproved: candidate.extraction.approved,
      extraction: candidate.extraction,
    })),
    selectedExtraction: chosen.extraction,
    master,
    runtimePngPath,
    runtimePngSha256: await sha256File(runtimePngPath),
    runtimeWebpPath,
    runtimeWebpSha256: await sha256File(runtimeWebpPath),
  }
}

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

export async function processRigManifest(input: {
  sourceRoot: string
  runtimeRoot: string
  auditPath: string
  rigs: RigManifestEntry[]
}): Promise<RigSheetAudit[]> {
  const resolvedAuditPath = resolveOutputPath(input.sourceRoot, relative(input.sourceRoot, input.auditPath))
  const expectedRuntime = new Set(input.rigs.flatMap(rig => [`rigs/${rig.sourceId}.png`, `rigs/${rig.sourceId}.webp`]))
  await pruneStaleFiles({ root: input.runtimeRoot, directory: 'rigs', expected: expectedRuntime, extensions: new Set(['.png', '.webp']) })
  await pruneStaleFiles({ root: input.sourceRoot, directory: 'rigs', expected: new Set(input.rigs.map(rig => `rigs/${rig.sourceId}.png`)), extensions: new Set(['.png']) })
  const audits: RigSheetAudit[] = []
  for (const rig of input.rigs) {
    const audit = await processRigSheet({
      ...rig,
      sourceRoot: input.sourceRoot,
      runtimeRoot: input.runtimeRoot,
      sheetPath: resolveOutputPath(input.sourceRoot, 'generation', 'rig-sheets', `${rig.sourceId}-sheet.png`),
    })
    audits.push({
      ...audit,
      sheetPath: portable(relative(input.sourceRoot, audit.sheetPath)),
      master: { ...audit.master, masterPath: portable(relative(input.sourceRoot, audit.master.masterPath)) },
      runtimePngPath: portable(relative(input.runtimeRoot, audit.runtimePngPath)),
      runtimeWebpPath: portable(relative(input.runtimeRoot, audit.runtimeWebpPath)),
    })
  }
  await mkdir(dirname(resolvedAuditPath), { recursive: true })
  await writeFile(resolvedAuditPath, `${JSON.stringify(audits, null, 2)}\n`)
  return audits
}

const productionRigs: RigManifestEntry[] = [
  { rigId: 'blob', sourceId: 'base_blob_v1', selected: 1 },
  { rigId: 'biped', sourceId: 'base_biped_v1', selected: 2 },
  { rigId: 'floating', sourceId: 'base_floating_v1', selected: 4 },
]

if (process.argv[1]?.endsWith('process-rig-sheets.ts')) {
  const sourceRoot = process.argv[2] ?? 'asset-source/v0.1.0'
  const audits = await processRigManifest({
    sourceRoot,
    runtimeRoot: 'packages/asset-catalog/assets/v0.1.0',
    auditPath: join(sourceRoot, 'generation', 'rig-audit.json'),
    rigs: productionRigs,
  })
  console.log(JSON.stringify({ rigs: audits.length, candidates: audits.reduce((count, audit) => count + audit.candidateEvaluations.length, 0) }))
}
