import { readFile, readdir, stat, realpath, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parseCatalog, validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import {
  BIPED_SLICE,
  parseInterfaceSourceManifest,
  structuralVariants,
  type InterfaceRigId,
  type InterfaceSourceManifest,
} from './interface-source-schema.js'
import { productionPaths } from './production-paths.js'
import { renderInterfaceGuides } from './render-interface-guides.js'
import { tmpdir } from 'node:os'
import { validateBipedSliceReview } from './validate-biped-slice-review.js'
import { measureBodyHeadCausalMetrics } from './body-head-contact-metrics.js'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

const TASK7_BODY_HEAD_REVIEW_RECORD_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json'

export async function validateInterfacePromptEvidence(input: {
  manifest: InterfaceSourceManifest
  repositoryRoot?: string
}): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const lexicalRepositoryRoot = resolve(input.repositoryRoot ?? process.cwd())
  const repositoryRoot = await realpath(lexicalRepositoryRoot).catch(() => lexicalRepositoryRoot)
  const promptClaims = new Map<string, { hashes: Set<string>; ids: Set<string> }>()
  for (const evidence of [
    ...structuralVariants(input.manifest).map(asset => asset.promptEvidence),
    ...input.manifest.bridges.map(bridge => bridge.promptEvidence),
  ]) {
    const claim = promptClaims.get(evidence.promptPath) ?? { hashes: new Set<string>(), ids: new Set<string>() }
    claim.hashes.add(evidence.promptSha256)
    claim.ids.add(evidence.promptId)
    promptClaims.set(evidence.promptPath, claim)
  }
  for (const [portablePath, claim] of promptClaims) {
    const target = resolve(repositoryRoot, portablePath)
    let canonicalTarget: string
    try {
      canonicalTarget = await realpath(target)
    } catch {
      diagnostics.push(error('INTERFACE_PROMPT_MISSING', [portablePath], 'Cannot read the declared prompt evidence file.'))
      continue
    }
    const remainder = relative(repositoryRoot, canonicalTarget)
    if (remainder.startsWith('..') || isAbsolute(remainder)) {
      diagnostics.push(error('INTERFACE_PROMPT_PATH_INVALID', [portablePath], 'Prompt evidence path escapes the repository root.'))
      continue
    }
    try {
      const bytes = await readFile(canonicalTarget)
      const canonicalBytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      const actualHash = createHash('sha256').update(canonicalBytes).digest('hex')
      if (claim.hashes.size !== 1 || !claim.hashes.has(actualHash)) {
        diagnostics.push(error('INTERFACE_PROMPT_HASH_MISMATCH', [portablePath], 'Prompt evidence SHA-256 differs from the actual committed prompt catalog bytes.'))
      }
      const promptCatalog = JSON.parse(bytes.toString('utf8')) as { prompts?: Array<{ id?: unknown }> }
      const catalogIds = new Set((promptCatalog.prompts ?? []).flatMap(prompt => typeof prompt.id === 'string' ? [prompt.id] : []))
      for (const promptId of claim.ids) {
        if (!catalogIds.has(promptId)) diagnostics.push(error('INTERFACE_PROMPT_ID_MISSING', [portablePath, promptId], `Prompt catalog does not contain declared prompt ID ${promptId}.`))
      }
    } catch {
      diagnostics.push(error('INTERFACE_PROMPT_MISSING', [portablePath], 'Cannot read the declared prompt evidence file.'))
    }
  }
  return diagnostics
}

function canonicalBipedGuideVariants(manifest: InterfaceSourceManifest) {
  const idsBySlot = new Map(Object.entries(BIPED_SLICE).map(([slotId, ids]) => [slotId, new Set<string>(ids)]))
  return structuralVariants(manifest).filter(asset => asset.rigId === 'biped' && idsBySlot.get(asset.slotId)?.has(asset.partId))
}

async function inspectPng(path: string, mask: boolean): Promise<string | null> {
  try {
    const bytes = await readFile(path)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'must have the native PNG signature'
    const metadata = await sharp(bytes).metadata()
    if (metadata.format !== 'png' || metadata.hasAlpha !== true) return 'must be a native PNG with an alpha channel'
    const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== 2048 || decoded.info.height !== 2048 || decoded.info.channels !== 4) return 'must be a 2048x2048 RGBA PNG'
    const alphas = new Set<number>()
    for (let index = 3; index < decoded.data.length; index += 4) alphas.add(decoded.data[index]!)
    if (mask && ([...alphas].some(alpha => alpha !== 0 && alpha !== 255) || !alphas.has(0) || !alphas.has(255))) return 'machine mask alpha must be binary and contain transparent and opaque pixels'
    if (!mask && (!alphas.has(0) || ![...alphas].some(alpha => alpha > 0))) return 'guide must contain meaningful transparent and visible pixels'
    return null
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught)
  }
}

export async function validateInterfaceSlice(input: { manifestPath: string; guideRoot: string; repositoryRoot?: string }): Promise<{
  ok: boolean
  diagnostics: Diagnostic[]
  productionAssetsChecked: 0
}> {
  const diagnostics: Diagnostic[] = []
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(input.manifestPath, 'utf8'))
  } catch {
    return { ok: false, diagnostics: [error('INTERFACE_MANIFEST_MISSING', [input.manifestPath], 'Cannot read interface source manifest.')], productionAssetsChecked: 0 }
  }
  const parsed = parseInterfaceSourceManifest(raw)
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics, productionAssetsChecked: 0 }
  diagnostics.push(...await validateInterfacePromptEvidence({ manifest: parsed.value, repositoryRoot: input.repositoryRoot }))
  const expected = new Set<string>()
  const regeneratedRoot = await mkdtemp(join(tmpdir(), 'qmonster-interface-guides-'))
  const guideVariants = canonicalBipedGuideVariants(parsed.value)
  const regenerated = await renderInterfaceGuides({
    outputRoot: regeneratedRoot,
    rigId: 'biped',
    profiles: guideVariants.flatMap(asset => asset.connectors.map(profile => ({ ...profile, assetId: asset.partId }))),
  })
  const regeneratedByName = new Map(regenerated.files.flatMap(file => [file.guidePath, file.maskPath].map(path => [path.split(/[\\/]/u).at(-1)!, path] as const)))
  for (const asset of guideVariants) {
    for (const connector of asset.connectors) {
      const stem = `${asset.partId}-${connector.id}-${connector.role}`
      for (const [suffix, mask] of [['guide', false], ['mask', true]] as const) {
        const file = `${stem}-${suffix}.png`
        expected.add(file)
        const invalid = await inspectPng(join(input.guideRoot, file), mask)
        if (invalid !== null) diagnostics.push(error('INTERFACE_GUIDE_INVALID', [file], invalid))
        try {
          const expectedBytes = await readFile(regeneratedByName.get(file)!)
          const actualBytes = await readFile(join(input.guideRoot, file))
          if (!actualBytes.equals(expectedBytes)) diagnostics.push(error('INTERFACE_GUIDE_DRIFT', [file], 'Committed guide bytes and SHA-256 differ from deterministic regeneration.'))
        } catch {
          // The format/missing diagnostic above remains the primary failure.
        }
      }
    }
  }
  let actual: string[] = []
  try {
    actual = await readdir(input.guideRoot)
  } catch {
    diagnostics.push(error('INTERFACE_GUIDE_MISSING', [input.guideRoot], 'Cannot read interface guide directory.'))
  }
  for (const file of actual.filter(file => file.endsWith('.png'))) {
    if (!expected.has(file)) diagnostics.push(error('INTERFACE_GUIDE_STALE', [file], `Guide is not declared by the interface source manifest: ${file}`))
  }
  await rm(regeneratedRoot, { recursive: true, force: true })
  return { ok: diagnostics.length === 0, diagnostics, productionAssetsChecked: 0 }
}

export async function validateInterfaceProductionReadiness(input: {
  repositoryRoot: string
  manifest: InterfaceSourceManifest
}): Promise<{ ok: boolean; diagnostics: Diagnostic[]; productionAssetsChecked: number }> {
  const diagnostics: Diagnostic[] = []
  const paths = productionPaths(input.manifest.catalogVersion)
  const lexicalRoot = resolve(input.repositoryRoot)
  const root = await realpath(lexicalRoot).catch(() => lexicalRoot)
  const lexicalSourceRoot = resolve(root, paths.sourceRoot)
  const sourceRoot = await realpath(lexicalSourceRoot).catch(() => lexicalSourceRoot)
  const sourceRootRemainder = relative(root, sourceRoot)
  const sourceRootEscapesRepository = sourceRootRemainder.startsWith('..') || isAbsolute(sourceRootRemainder)
  let productionAssetsChecked = 0
  const productionSources = [...new Set([
    ...structuralVariants(input.manifest).flatMap(asset => [asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)]),
    ...input.manifest.bridges.map(bridge => bridge.sourcePngPath),
  ])]
  const naturalNeckHeads = structuralVariants(input.manifest).filter(asset => (
    asset.slotId === 'headShape'
    && [asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)]
      .some(path => path.replaceAll('\\', '/').includes('/task7-natural-neck/'))
  ))
  let approvedTask7Review = false
  try {
    const review = JSON.parse(await readFile(resolve(root, TASK7_BODY_HEAD_REVIEW_RECORD_PATH), 'utf8')) as Record<string, unknown>
    approvedTask7Review = review.status === 'APPROVED'
      && review.decision === 'approved'
      && review.reviewer === 'user'
      && review.userApproved === true
      && review.approvalResponse === 'A'
  } catch {
    approvedTask7Review = false
  }
  for (const head of naturalNeckHeads) {
    if (head.promptEvidence.reviewRecordPath !== TASK7_BODY_HEAD_REVIEW_RECORD_PATH || !approvedTask7Review) {
      diagnostics.push(error(
        'INTERFACE_NATURAL_NECK_REVIEW_INVALID',
        ['productionAssets', `${head.partId}:${head.rigId}`, 'reviewRecordPath'],
        'Every Task 7 natural-neck head must bind to the canonical approved Task 7 body/head review record.',
      ))
    }
  }
  for (const [index, path] of productionSources.entries()) {
    const target = resolve(root, path)
    const remainder = relative(root, target)
    const portable = path.replaceAll('\\', '/')
    if (remainder.startsWith('..') || isAbsolute(remainder) || !portable.startsWith(`${paths.sourceRoot}/`)) {
      diagnostics.push(error('INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', ['productionAssets', String(index)], `Production source must stay below ${paths.sourceRoot}: ${path}`))
      continue
    }
    try {
      const canonicalTarget = await realpath(target)
      const canonicalRemainder = relative(sourceRoot, canonicalTarget)
      if (sourceRootEscapesRepository || canonicalRemainder.startsWith('..') || isAbsolute(canonicalRemainder)) {
        diagnostics.push(error('INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', ['productionAssets', String(index)], `Production source resolves outside ${paths.sourceRoot}: ${path}`))
        continue
      }
      const metadata = await stat(canonicalTarget)
      if (!metadata.isFile()) throw new Error('not a file')
      productionAssetsChecked += 1
    } catch {
      diagnostics.push(error('INTERFACE_PRODUCTION_ASSET_MISSING', ['productionAssets', String(index)], `Required v0.3 production source asset is missing: ${path}`))
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, productionAssetsChecked }
}

interface BodyHeadReviewEntry {
  rigId: InterfaceRigId
  bodyId: string
  headId: string
  largestComponentRatio: number
  centerlineGapPx: number
  visibleTongueDepthRatio: number
  visibleTongueAreaRatio: number
  centralLobeDepthRatio: number
}

interface BodyHeadReviewManifest {
  rigId: InterfaceRigId
  entries: BodyHeadReviewEntry[]
  thresholds: {
    largestComponentRatio: number
    centerlineGapPx: number
    visibleTongueDepthRatio: number
    visibleTongueAreaRatio: number
    centralLobeDepthRatio: number
  }
  sheetSha256: string
  sheet256Sha256: string
  status: string
}

const BODY_HEAD_ROSTER = {
  blob: { bodies: ['body_blob_round', 'body_blob_wide'], heads: ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood'] },
  biped: { bodies: ['body_biped_peanut', 'body_biped_tall'], heads: ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood'] },
  floating: { bodies: ['body_floating_drop'], heads: ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood'] },
} as const

function sha256Bytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

export async function validateBodyHeadReview(input: { repositoryRoot: string; reviewRoot: string }): Promise<{
  diagnostics: Diagnostic[]
  entryCountByRig: Record<InterfaceRigId, number>
}> {
  const diagnostics: Diagnostic[] = []
  const entryCountByRig: Record<InterfaceRigId, number> = { blob: 0, biped: 0, floating: 0 }
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const stem = `body-head-contact-sheet-${rigId}`
    let review: BodyHeadReviewManifest
    try {
      review = JSON.parse(await readFile(join(input.reviewRoot, `${stem}-manifest.json`), 'utf8')) as BodyHeadReviewManifest
    } catch {
      diagnostics.push(error('BODY_HEAD_REVIEW_MISSING', [rigId], 'Cannot read the body/head review manifest.'))
      continue
    }
    const roster = BODY_HEAD_ROSTER[rigId]
    const expectedKeys = new Set(roster.bodies.flatMap(bodyId => roster.heads.map(headId => `${bodyId}:${headId}`)))
    const actualKeys = review.entries.map(entry => `${entry.bodyId}:${entry.headId}`)
    entryCountByRig[rigId] = review.entries.length
    if (review.rigId !== rigId || review.entries.some(entry => entry.rigId !== rigId) || actualKeys.length !== expectedKeys.size || new Set(actualKeys).size !== expectedKeys.size || actualKeys.some(key => !expectedKeys.has(key))) {
      diagnostics.push(error('BODY_HEAD_REVIEW_ROSTER_INVALID', [rigId, 'entries'], 'Review must contain every exact body × head pair once.'))
    }
    if (
      review.thresholds?.largestComponentRatio !== 0.99
      || review.thresholds?.centerlineGapPx !== 2
      || review.thresholds?.visibleTongueDepthRatio !== 0.1
      || review.thresholds?.visibleTongueAreaRatio !== 0.1
      || review.thresholds?.centralLobeDepthRatio !== 0.2
      || review.entries.some(entry => (
        !Number.isFinite(entry.largestComponentRatio)
        || entry.largestComponentRatio < 0.99
        || !Number.isFinite(entry.centerlineGapPx)
        || entry.centerlineGapPx < 0
        || entry.centerlineGapPx > 2
        || !Number.isFinite(entry.visibleTongueDepthRatio)
        || entry.visibleTongueDepthRatio < 0
        || entry.visibleTongueDepthRatio > 0.1
        || !Number.isFinite(entry.visibleTongueAreaRatio)
        || entry.visibleTongueAreaRatio < 0
        || entry.visibleTongueAreaRatio > 0.1
        || !Number.isFinite(entry.centralLobeDepthRatio)
        || entry.centralLobeDepthRatio < 0
        || entry.centralLobeDepthRatio > 0.2
      ))
      || review.status !== 'machine-pass-awaiting-user-approval'
    ) {
      diagnostics.push(error('BODY_HEAD_REVIEW_METRICS_INVALID', [rigId, 'entries'], 'Every pair must pass continuity metrics while remaining awaiting user approval.'))
    }
    const rows = Math.ceil(expectedKeys.size / 4)
    for (const [suffix, declaredHash, width, height] of [
      ['', review.sheetSha256, 4 * 512, rows * 512],
      ['-256', review.sheet256Sha256, 4 * 256, rows * 256],
    ] as const) {
      try {
        const sheet = await readFile(join(input.reviewRoot, `${stem}${suffix}.png`))
        const metadata = await sharp(sheet).metadata()
        if (sha256Bytes(sheet) !== declaredHash || metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) {
          diagnostics.push(error('BODY_HEAD_REVIEW_SHEET_INVALID', [rigId, suffix || 'original'], 'Sheet bytes, declared SHA-256, or dimensions differ.'))
        }
      } catch {
        diagnostics.push(error('BODY_HEAD_REVIEW_SHEET_MISSING', [rigId, suffix || 'original'], 'Cannot read the declared body/head contact sheet.'))
      }
    }
  }
  return { diagnostics, entryCountByRig }
}

const BODY_HEAD_CAUSAL_METRIC_TOLERANCE = 1e-12

export async function validateBodyHeadCausalMetricEvidence(input: {
  repositoryRoot: string
  reviewRoot: string
}): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  let manifest: InterfaceSourceManifest
  try {
    const parsed = parseInterfaceSourceManifest(JSON.parse(await readFile(
      resolve(input.repositoryRoot, 'asset-source/v0.3.0/interface-manifest.json'),
      'utf8',
    )))
    if (!parsed.ok) return [error('BODY_HEAD_CAUSAL_METRIC_SOURCE_INVALID', ['causalMetrics', 'manifest'], 'Cannot parse the live interface source manifest.')]
    manifest = parsed.value
  } catch {
    return [error('BODY_HEAD_CAUSAL_METRIC_SOURCE_INVALID', ['causalMetrics', 'manifest'], 'Cannot read the live interface source manifest.')]
  }
  const variants = structuralVariants(manifest)
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    let review: BodyHeadReviewManifest
    try {
      review = JSON.parse(await readFile(
        join(input.reviewRoot, `body-head-contact-sheet-${rigId}-manifest.json`),
        'utf8',
      )) as BodyHeadReviewManifest
    } catch {
      diagnostics.push(error('BODY_HEAD_CAUSAL_METRIC_SOURCE_INVALID', ['causalMetrics', rigId], 'Cannot read the approved body/head review manifest.'))
      continue
    }
    for (const entry of review.entries) {
      const body = variants.find(item => item.rigId === rigId && item.partId === entry.bodyId && item.slotId === 'bodyFrame')
      const head = variants.find(item => item.rigId === rigId && item.partId === entry.headId && item.slotId === 'headShape')
      if (body === undefined || head === undefined) {
        diagnostics.push(error('BODY_HEAD_CAUSAL_METRIC_SOURCE_INVALID', ['causalMetrics', rigId, entry.bodyId, entry.headId], 'Approved pair lacks a live exact-rig body or head source.'))
        continue
      }
      try {
        const actual = await measureBodyHeadCausalMetrics({ root: input.repositoryRoot, body, head })
        for (const metric of [
          'largestComponentRatio',
          'centerlineGapPx',
          'visibleTongueDepthRatio',
          'visibleTongueAreaRatio',
          'centralLobeDepthRatio',
        ] as const) {
          const stored = entry[metric]
          if (!Number.isFinite(stored) || Math.abs(actual[metric] - stored) > BODY_HEAD_CAUSAL_METRIC_TOLERANCE) {
            diagnostics.push(error(
              'BODY_HEAD_CAUSAL_METRIC_DRIFT',
              ['causalMetrics', rigId, entry.bodyId, entry.headId, metric],
              `Stored ${metric}=${stored} differs from live recomputation ${actual[metric]}.`,
            ))
          }
        }
      } catch (caught) {
        diagnostics.push(error(
          'BODY_HEAD_CAUSAL_METRIC_SOURCE_INVALID',
          ['causalMetrics', rigId, entry.bodyId, entry.headId],
          caught instanceof Error ? caught.message : 'Cannot recompute causal metrics from live sources.',
        ))
      }
    }
  }
  return diagnostics
}

const BODY_HEAD_ACCEPTANCE_FILENAME = 'body-head-contact-sheets-acceptance.json'
const BODY_HEAD_ACCEPTANCE_PATH = `packages/asset-catalog/review/v0.3.0/${BODY_HEAD_ACCEPTANCE_FILENAME}`
const BODY_HEAD_REVIEW_RECORD_PATH = TASK7_BODY_HEAD_REVIEW_RECORD_PATH
const BODY_HEAD_REJECTION_PATH = 'packages/asset-catalog/review/v0.3.0/rejected/task7-visible-tongue-round-1/rejection-record.json'
const TASK6_INTEGRITY_PATH = 'packages/asset-catalog/review/v0.3.0/task6-approved-input-integrity.json'

function bodyHeadRejectedArtifactPaths(rigId: InterfaceRigId): {
  originalPath: string
  review256Path: string
  manifestPath: string
} {
  const stem = 'packages/asset-catalog/review/v0.3.0/rejected/task7-visible-tongue-round-1/body-head-contact-sheet-'
  return {
    originalPath: `${stem}${rigId}.png`,
    review256Path: `${stem}${rigId}-256.png`,
    manifestPath: `${stem}${rigId}-manifest.json`,
  }
}

export async function validateBodyHeadRejectionEvidence(input: { repositoryRoot: string }): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const repositoryRoot = await realpath(resolve(input.repositoryRoot)).catch(() => resolve(input.repositoryRoot))
  const recordPath = resolve(repositoryRoot, BODY_HEAD_REJECTION_PATH)
  const rejectionDirectory = resolve(recordPath, '..')
  let record: Record<string, any>
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, any>
  } catch {
    return [error('BODY_HEAD_REJECTION_RECORD_INVALID', ['rejection'], 'Cannot read the canonical Task 7 rejected-round record.')]
  }
  if (
    record.schemaVersion !== 'body-head-user-rejection-v1'
    || record.status !== 'REJECTED'
    || record.userDecision !== 'B'
    || record.userApproved !== false
  ) diagnostics.push(error('BODY_HEAD_REJECTION_FIELDS_INVALID', ['rejection'], 'Rejected-round decision and user fields must remain rejected/B/false.'))

  const rigs = ['blob', 'biped', 'floating'] as const
  const declarations = record.artifacts !== null && typeof record.artifacts === 'object' && !Array.isArray(record.artifacts)
    ? record.artifacts as Record<string, Record<string, unknown>>
    : {}
  if (Object.keys(declarations).length !== rigs.length || Object.keys(declarations).some(rigId => !rigs.includes(rigId as InterfaceRigId))) {
    diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_SET_INVALID', ['rejection', 'artifacts'], 'Rejected evidence must declare each exact rig once.'))
  }

  const expectedPaths = new Set<string>()
  for (const rigId of rigs) {
    const paths = bodyHeadRejectedArtifactPaths(rigId)
    const declaration = declarations[rigId] ?? {}
    for (const [kind, portablePath, declaredHash] of [
      ['original', paths.originalPath, declaration.originalSha256],
      ['256', paths.review256Path, declaration.downsample256Sha256],
      ['manifest', paths.manifestPath, declaration.manifestSha256],
    ] as const) {
      const relativePath = relative(rejectionDirectory, resolve(repositoryRoot, portablePath)).replaceAll('\\', '/')
      expectedPaths.add(relativePath)
      try {
        const target = await realpath(resolve(repositoryRoot, portablePath))
        const repositoryRemainder = relative(repositoryRoot, target)
        const rejectionRemainder = relative(rejectionDirectory, target)
        if (
          repositoryRemainder.startsWith('..') || isAbsolute(repositoryRemainder)
          || rejectionRemainder.startsWith('..') || isAbsolute(rejectionRemainder)
          || rejectionRemainder.replaceAll('\\', '/') !== relativePath
        ) {
          diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_PATH_INVALID', ['rejection', 'artifacts', rigId, kind], 'Rejected artifact must resolve to its exact contained canonical path.'))
          continue
        }
        const bytes = await readFile(target)
        if (typeof declaredHash !== 'string' || sha256Bytes(bytes) !== declaredHash) {
          diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_HASH_INVALID', ['rejection', 'artifacts', rigId, kind], 'Rejected artifact SHA-256 must match the live immutable bytes.'))
        }
      } catch {
        diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_MISSING', ['rejection', 'artifacts', rigId, kind], 'Rejected artifact is missing from its canonical path.'))
      }
    }
  }

  const actualPaths: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name !== 'rejection-record.json') {
        actualPaths.push(relative(rejectionDirectory, target).replaceAll('\\', '/'))
      }
    }
  }
  try {
    await visit(rejectionDirectory)
  } catch {
    diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_PATH_INVALID', ['rejection', 'artifacts'], 'Cannot enumerate the canonical rejected artifact directory.'))
  }
  if (
    actualPaths.length !== expectedPaths.size
    || new Set(actualPaths).size !== expectedPaths.size
    || actualPaths.some(path => !expectedPaths.has(path))
    || [...expectedPaths].some(path => !actualPaths.includes(path))
  ) diagnostics.push(error('BODY_HEAD_REJECTION_ARTIFACT_PATH_INVALID', ['rejection', 'artifacts'], 'Rejected evidence must contain exactly the canonical three-rig original/256/manifest set with no misplaced or duplicate files.'))
  return diagnostics
}

function bodyHeadArtifactPaths(rigId: InterfaceRigId): { originalPath: string, review256Path: string, manifestPath: string } {
  const stem = `packages/asset-catalog/review/v0.3.0/body-head-contact-sheet-${rigId}`
  return { originalPath: `${stem}.png`, review256Path: `${stem}-256.png`, manifestPath: `${stem}-manifest.json` }
}

export function validateBodyHeadAcceptanceLocations(records: string[], canonicalPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (records.length === 0) return [error('BODY_HEAD_ACCEPTANCE_MISSING', ['acceptance'], 'Canonical Task 7 body/head acceptance record is missing.')]
  if (records.length !== 1) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_NOT_UNIQUE', ['acceptance'], `Canonical Task 7 body/head acceptance record must be unique; found ${records.length}.`))
  if (!records.some(path => resolve(path) === resolve(canonicalPath))) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_PATH_INVALID', ['acceptance'], `Acceptance record must use exact path ${BODY_HEAD_ACCEPTANCE_PATH}.`))
  return diagnostics
}

async function findBodyHeadAcceptanceRecords(repositoryRoot: string): Promise<string[]> {
  const records: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') await visit(join(directory, entry.name))
      } else if (entry.isFile() && entry.name === BODY_HEAD_ACCEPTANCE_FILENAME) records.push(join(directory, entry.name))
    }
  }
  await visit(repositoryRoot)
  return records
}

export async function validateBodyHeadAcceptanceDocument(input: {
  document: unknown
  repositoryRoot: string
  reviewRoot: string
}): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const document = input.document !== null && typeof input.document === 'object' && !Array.isArray(input.document)
    ? input.document as Record<string, any>
    : {}
  if (
    document.schemaVersion !== 'body-head-acceptance-v1'
    || document.catalogVersion !== '0.3.0'
    || document.rendererVersion !== '0.3.0'
    || document.decision !== 'approved'
    || document.reviewer !== 'user'
    || document.userApproved !== true
    || document.approvalResponse !== 'A'
    || document.entryCount !== 20
    || document.entryCountByRig?.blob !== 8
    || document.entryCountByRig?.biped !== 8
    || document.entryCountByRig?.floating !== 4
  ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_FIELDS_INVALID', ['acceptance'], 'Approval fields, versions, decision, or canonical entry counts are invalid.'))
  if (typeof document.reviewedAt !== 'string' || !Number.isFinite(Date.parse(document.reviewedAt))) {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TIME_INVALID', ['acceptance', 'reviewedAt'], 'reviewedAt must be a valid timestamp.'))
  }

  const artifacts = Array.isArray(document.artifacts) ? document.artifacts as Array<Record<string, any>> : []
  const exactArtifactPaths = new Set<string>()
  const allEntries: BodyHeadReviewEntry[] = []
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const expectedPaths = bodyHeadArtifactPaths(rigId)
    const artifact = artifacts.find(item => item.rigId === rigId)
    if (artifact === undefined
      || artifact.originalPath !== expectedPaths.originalPath
      || artifact.review256Path !== expectedPaths.review256Path
      || artifact.manifestPath !== expectedPaths.manifestPath) {
      diagnostics.push(error('BODY_HEAD_ACCEPTANCE_ARTIFACT_PATH_INVALID', ['acceptance', 'artifacts', rigId], 'Every rig must declare the exact canonical original, 256, and manifest paths.'))
      continue
    }
    exactArtifactPaths.add(artifact.originalPath)
    exactArtifactPaths.add(artifact.review256Path)
    exactArtifactPaths.add(artifact.manifestPath)
    try {
      const [originalBytes, review256Bytes, manifestBytes] = await Promise.all([
        readFile(resolve(input.repositoryRoot, artifact.originalPath)),
        readFile(resolve(input.repositoryRoot, artifact.review256Path)),
        readFile(resolve(input.repositoryRoot, artifact.manifestPath)),
      ])
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as BodyHeadReviewManifest
      allEntries.push(...manifest.entries)
      if (
        artifact.originalSha256 !== sha256Bytes(originalBytes)
        || artifact.review256Sha256 !== sha256Bytes(review256Bytes)
        || artifact.manifestSha256 !== sha256Bytes(manifestBytes)
        || artifact.originalSha256 !== manifest.sheetSha256
        || artifact.review256Sha256 !== manifest.sheet256Sha256
      ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_HASH_INVALID', ['acceptance', 'artifacts', rigId], 'Acceptance hashes must match all live canonical review bytes and manifest declarations.'))
    } catch {
      diagnostics.push(error('BODY_HEAD_ACCEPTANCE_ARTIFACT_MISSING', ['acceptance', 'artifacts', rigId], 'Cannot read one or more approved canonical review artifacts.'))
    }
  }
  if (artifacts.length !== 3 || new Set(artifacts.map(item => item.rigId)).size !== 3 || exactArtifactPaths.size !== 9) {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_ARTIFACTS_INVALID', ['acceptance', 'artifacts'], 'Acceptance must bind exactly three rigs and nine unique canonical artifacts.'))
  }

  const thresholds = document.causalMetrics?.thresholds
  const results = document.causalMetrics?.results
  const calculated = {
    entryCount: allEntries.length,
    largestComponentRatioMin: allEntries.length === 0 ? null : Math.min(...allEntries.map(item => item.largestComponentRatio)),
    centerlineGapPxMax: allEntries.length === 0 ? null : Math.max(...allEntries.map(item => item.centerlineGapPx)),
    visibleTongueDepthRatioMax: allEntries.length === 0 ? null : Math.max(...allEntries.map(item => item.visibleTongueDepthRatio)),
    visibleTongueAreaRatioMax: allEntries.length === 0 ? null : Math.max(...allEntries.map(item => item.visibleTongueAreaRatio)),
    centralLobeDepthRatioMax: allEntries.length === 0 ? null : Math.max(...allEntries.map(item => item.centralLobeDepthRatio ?? Number.POSITIVE_INFINITY)),
  }
  if (
    thresholds?.largestComponentRatioMin !== 0.99
    || thresholds?.centerlineGapPxMax !== 2
    || thresholds?.visibleTongueDepthRatioMax !== 0.1
    || thresholds?.visibleTongueAreaRatioMax !== 0.1
    || thresholds?.centralLobeDepthRatioMax !== 0.2
    || results?.entryCount !== calculated.entryCount
    || results?.largestComponentRatioMin !== calculated.largestComponentRatioMin
    || results?.centerlineGapPxMax !== calculated.centerlineGapPxMax
    || results?.visibleTongueDepthRatioMax !== calculated.visibleTongueDepthRatioMax
    || results?.visibleTongueAreaRatioMax !== calculated.visibleTongueAreaRatioMax
    || results?.centralLobeDepthRatioMax !== calculated.centralLobeDepthRatioMax
  ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_METRICS_INVALID', ['acceptance', 'causalMetrics'], 'Causal thresholds and results must exactly match the 20 live matrix entries.'))

  try {
    const rejectionBytes = await readFile(resolve(input.repositoryRoot, BODY_HEAD_REJECTION_PATH))
    if (
      document.rejectionRound?.recordPath !== BODY_HEAD_REJECTION_PATH
      || document.rejectionRound?.recordSha256 !== sha256Bytes(rejectionBytes)
    ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_REJECTION_INVALID', ['acceptance', 'rejectionRound'], 'Acceptance must retain the exact hash-bound rejected round reference.'))
  } catch {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_REJECTION_INVALID', ['acceptance', 'rejectionRound'], 'Cannot read the rejected round evidence.'))
  }
  diagnostics.push(...await validateBodyHeadRejectionEvidence({ repositoryRoot: input.repositoryRoot }))

  try {
    const integrityBytes = await readFile(resolve(input.repositoryRoot, TASK6_INTEGRITY_PATH))
    const integrity = JSON.parse(integrityBytes.toString('utf8')) as { files?: Array<{ path?: unknown, sha256?: unknown }> }
    const files = Array.isArray(integrity.files) ? integrity.files : []
    if (
      document.task6Integrity?.manifestPath !== TASK6_INTEGRITY_PATH
      || document.task6Integrity?.manifestSha256 !== sha256Bytes(integrityBytes)
      || document.task6Integrity?.fileCount !== 132
      || files.length !== 132
    ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TASK6_INTEGRITY_INVALID', ['acceptance', 'task6Integrity'], 'Task 6 integrity manifest path, hash, and 132-file count must be exact.'))
    for (const [index, item] of files.entries()) {
      if (typeof item.path !== 'string' || typeof item.sha256 !== 'string') {
        diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TASK6_INTEGRITY_INVALID', ['acceptance', 'task6Integrity', String(index)], 'Task 6 integrity entry is malformed.'))
        continue
      }
      try {
        if (sha256Bytes(await readFile(resolve(input.repositoryRoot, item.path))) !== item.sha256) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TASK6_INPUT_CHANGED', ['acceptance', 'task6Integrity', item.path], 'Frozen Task 6 input bytes changed.'))
      } catch {
        diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TASK6_INPUT_CHANGED', ['acceptance', 'task6Integrity', item.path], 'Frozen Task 6 input is missing.'))
      }
    }
  } catch {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_TASK6_INTEGRITY_INVALID', ['acceptance', 'task6Integrity'], 'Cannot read the Task 6 integrity manifest.'))
  }

  try {
    const review = JSON.parse(await readFile(resolve(input.repositoryRoot, BODY_HEAD_REVIEW_RECORD_PATH), 'utf8')) as Record<string, unknown>
    if (
      review.status !== 'APPROVED'
      || review.reviewer !== 'user'
      || review.userApproved !== true
      || review.approvalResponse !== 'A'
      || review.entryCount !== 20
    ) diagnostics.push(error('BODY_HEAD_ACCEPTANCE_REVIEW_RECORD_INVALID', ['acceptance', 'reviewRecord'], 'Canonical body/head review record must reflect the same user approval.'))
  } catch {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_REVIEW_RECORD_INVALID', ['acceptance', 'reviewRecord'], 'Cannot read the canonical body/head review record.'))
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...await validateBodyHeadCausalMetricEvidence({
      repositoryRoot: input.repositoryRoot,
      reviewRoot: input.reviewRoot,
    }))
  }
  return diagnostics
}

export async function validateBodyHeadApproval(input: { repositoryRoot: string, reviewRoot: string }): Promise<{
  diagnostics: Diagnostic[]
  entryCount: number
}> {
  const canonicalPath = resolve(input.repositoryRoot, BODY_HEAD_ACCEPTANCE_PATH)
  const records = await findBodyHeadAcceptanceRecords(input.repositoryRoot)
  const diagnostics = validateBodyHeadAcceptanceLocations(records, canonicalPath)
  if (!records.some(path => resolve(path) === canonicalPath)) return { diagnostics, entryCount: 0 }
  try {
    const document = JSON.parse(await readFile(canonicalPath, 'utf8'))
    diagnostics.push(...await validateBodyHeadAcceptanceDocument({ document, repositoryRoot: input.repositoryRoot, reviewRoot: input.reviewRoot }))
    return { diagnostics, entryCount: document.entryCount === 20 ? 20 : 0 }
  } catch {
    diagnostics.push(error('BODY_HEAD_ACCEPTANCE_INVALID', ['acceptance'], 'Cannot parse the canonical Task 7 acceptance record.'))
    return { diagnostics, entryCount: 0 }
  }
}

async function main(): Promise<void> {
  const versionIndex = process.argv.indexOf('--version')
  const version = versionIndex === -1 ? undefined : process.argv[versionIndex + 1]
  const production = process.argv.includes('--production')
  const scopeIndex = process.argv.indexOf('--scope')
  const scope = scopeIndex === -1 ? undefined : process.argv[scopeIndex + 1]
  const rigIndex = process.argv.indexOf('--rig')
  const rig = rigIndex === -1 ? undefined : process.argv[rigIndex + 1]
  const catalogIndex = process.argv.indexOf('--catalog-if-present')
  const catalogPath = catalogIndex === -1 ? undefined : process.argv[catalogIndex + 1]
  if (version !== '0.3.0' || (scope !== undefined && scope !== 'body-head')) throw new Error('Usage: tsx scripts/validate-interface-slice.ts --version 0.3.0 [--production] [--scope body-head]')
  const paths = productionPaths(version)
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const manifestPath = join(repositoryRoot, paths.sourceRoot, 'interface-manifest.json')
  const slice = await validateInterfaceSlice({ manifestPath, guideRoot: join(repositoryRoot, paths.sourceRoot, 'guides'), repositoryRoot })
  const diagnostics = [...slice.diagnostics]
  if (catalogPath !== undefined) {
    try {
      const parsedCatalog = parseCatalog(JSON.parse(await readFile(resolve(catalogPath), 'utf8')))
      if (!parsedCatalog.ok) diagnostics.push(...parsedCatalog.diagnostics)
      else diagnostics.push(...validateCatalogStructure(parsedCatalog.value))
    } catch (caught: any) {
      if (caught?.code !== 'ENOENT') diagnostics.push(error('INTERFACE_CATALOG_INVALID', [catalogPath], 'Cannot parse the optional built v0.3 catalog.'))
    }
  }
  let productionAssetsChecked = 0
  if (diagnostics.length === 0 && (production || scope === 'body-head')) {
    const parsed = parseInterfaceSourceManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
    if (parsed.ok) {
      const readiness = await validateInterfaceProductionReadiness({ repositoryRoot, manifest: parsed.value })
      diagnostics.push(...readiness.diagnostics)
      productionAssetsChecked = readiness.productionAssetsChecked
    }
  }
  let bipedEntriesChecked = 0
  if (diagnostics.length === 0 && rig === 'biped') {
    const review = await validateBipedSliceReview(join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0', 'biped-vertical-slice-manifest.json'))
    bipedEntriesChecked = review.entryCount
    for (const message of review.diagnostics) diagnostics.push(error('BIPED_SLICE_INVALID', ['review'], message))
  }
  let bodyHeadEntriesChecked: Record<InterfaceRigId, number> | undefined
  let bodyHeadApprovalEntriesChecked = 0
  if (diagnostics.length === 0 && scope === 'body-head') {
    const review = await validateBodyHeadReview({ repositoryRoot, reviewRoot: join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0') })
    bodyHeadEntriesChecked = review.entryCountByRig
    diagnostics.push(...review.diagnostics)
    if (diagnostics.length === 0) {
      const approval = await validateBodyHeadApproval({ repositoryRoot, reviewRoot: join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0') })
      bodyHeadApprovalEntriesChecked = approval.entryCount
      diagnostics.push(...approval.diagnostics)
    }
  }
  for (const diagnostic of diagnostics) console.error(`ERROR ${diagnostic.code} ${diagnostic.path.join('.')}: ${diagnostic.message}`)
  console.log(JSON.stringify({ version, rig, scope, sliceGuides: slice.ok, productionAssetsChecked, bipedEntriesChecked, bodyHeadEntriesChecked, bodyHeadApprovalEntriesChecked, diagnostics: diagnostics.length }))
  if (diagnostics.length > 0) process.exitCode = 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main()
