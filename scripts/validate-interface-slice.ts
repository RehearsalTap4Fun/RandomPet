import { readFile, readdir, stat, realpath, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parseCatalog, validateCatalogStructure, type Diagnostic } from '@qmonster/generator-core'
import {
  BIPED_SLICE,
  canonicalBipedGuideFiles,
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
import { reconstructLimbMatrixEvidence, type LimbMatrixEvidenceEntry } from './render-limb-contact-sheets.js'
import { validateStoredTailExtraMatrixEvidence } from './render-tail-extra-structural-matrices.js'
import {
  TASK8_APPROVED_EVIDENCE_BINDINGS,
  TASK8_APPROVED_LEGACY_CATALOG_SHA256,
  TASK8_APPROVED_RENDERER_BINDINGS,
  TASK8_LIMB_CATALOG_PROJECTION_SHA256,
  TASK8_LIMB_SOURCE_PROJECTION_SHA256,
  task8LimbCatalogProjectionSha256,
  task8LimbSourceProjectionSha256,
  task8RendererProjectionSha256,
} from './task8-stable-projection.js'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

const TASK7_BODY_HEAD_REVIEW_RECORD_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json'
const TASK7_BODY_HEAD_AMENDMENT_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-connector-amendment.json'
const TASK7_BODY_HEAD_LIVE_ACCEPTANCE_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-contact-sheets-acceptance.json'

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
      const promptCatalog = JSON.parse(bytes.toString('utf8')) as {
        schemaVersion?: unknown
        prompts?: Array<{ id?: unknown }>
        sharedContract?: unknown
        variants?: Record<string, unknown>
      }
      const catalogIds = new Set((promptCatalog.prompts ?? []).flatMap(prompt => typeof prompt.id === 'string' ? [prompt.id] : []))
      if (
        promptCatalog.schemaVersion === 'task8-imagegen-prompts-v1'
        && typeof promptCatalog.sharedContract === 'string'
        && promptCatalog.variants !== undefined
        && Object.keys(promptCatalog.variants).length > 0
      ) catalogIds.add('task8-exact-rig-limbs')
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
  const expected = new Set(canonicalBipedGuideFiles(parsed.value))
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
  let validTask7ReviewBoundary = false
  try {
    const review = JSON.parse(await readFile(resolve(root, TASK7_BODY_HEAD_REVIEW_RECORD_PATH), 'utf8')) as Record<string, unknown>
    const approvedTask7Review = review.status === 'APPROVED'
      && review.decision === 'approved'
      && review.reviewer === 'user'
      && review.userApproved === true
      && review.approvalResponse === 'A'
    const amendment = await readFile(resolve(root, TASK7_BODY_HEAD_AMENDMENT_PATH), 'utf8')
      .then(bytes => JSON.parse(bytes) as Record<string, unknown>)
      .catch(() => null)
    const liveAcceptanceExists = await stat(resolve(root, TASK7_BODY_HEAD_LIVE_ACCEPTANCE_PATH))
      .then(item => item.isFile())
      .catch(() => false)
    const pendingAmendedTask7Review = review.status === 'WAITING_FOR_USER_REAPPROVAL'
      && review.decision === 'pending'
      && review.reviewer === 'Codex visual self-review'
      && review.userApproved === false
      && amendment?.status === 'WAITING_FOR_USER_REAPPROVAL'
      && amendment.userApproved === false
      && amendment.scope !== undefined
      && !liveAcceptanceExists
    validTask7ReviewBoundary = approvedTask7Review || pendingAmendedTask7Review
  } catch {
    validTask7ReviewBoundary = false
  }
  for (const head of naturalNeckHeads) {
    if (head.promptEvidence.reviewRecordPath !== TASK7_BODY_HEAD_REVIEW_RECORD_PATH || !validTask7ReviewBoundary) {
      diagnostics.push(error(
        'INTERFACE_NATURAL_NECK_REVIEW_INVALID',
        ['productionAssets', `${head.partId}:${head.rigId}`, 'reviewRecordPath'],
        'Every Task 7 natural-neck head must bind to the canonical approved or amendment-pending Task 7 body/head review boundary.',
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

const LIMB_ROSTER = {
  blob: {
    bodies: ['body_blob_round', 'body_blob_wide'],
    arms: ['arms_short_plush', 'arms_long_noodle', 'arms_paddle'],
    legs: ['legs_stub_feet', 'legs_webbed', 'legs_mushroom', 'legs_shadow_tiptoe'],
  },
  biped: {
    bodies: ['body_biped_peanut', 'body_biped_tall'],
    arms: ['arms_short_plush', 'arms_long_noodle', 'arms_paddle'],
    legs: ['legs_stub_feet', 'legs_webbed', 'legs_mushroom', 'legs_shadow_tiptoe'],
  },
  floating: {
    bodies: ['body_floating_drop'],
    arms: ['arms_short_plush', 'arms_long_noodle', 'arms_paddle'],
    legs: ['legs_stub_feet', 'legs_webbed', 'legs_mushroom', 'legs_shadow_tiptoe'],
  },
} as const

function reviewAssetPath(repositoryRoot: string, portablePath: string): string {
  const withoutFsPrefix = portablePath.startsWith('/@fs/') ? portablePath.slice('/@fs/'.length) : portablePath
  const normalized = withoutFsPrefix.replaceAll('\\', '/')
  const catalogMarker = '/packages/asset-catalog/'
  const catalogIndex = normalized.toLowerCase().indexOf(catalogMarker)
  if (catalogIndex >= 0) return resolve(repositoryRoot, normalized.slice(catalogIndex + 1))
  return isAbsolute(withoutFsPrefix) ? withoutFsPrefix : resolve(repositoryRoot, withoutFsPrefix)
}

function portableResolverPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const marker = '/packages/asset-catalog/'
  const index = normalized.toLowerCase().indexOf(marker)
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export async function validateLimbReview(input: { repositoryRoot: string; reviewRoot: string }): Promise<{
  diagnostics: Diagnostic[]
  entryCountByRig: Record<InterfaceRigId, number>
}> {
  const diagnostics: Diagnostic[] = []
  const entryCountByRig: Record<InterfaceRigId, number> = { blob: 0, biped: 0, floating: 0 }
  const fileHashes = new Map<string, Promise<string>>()
  const liveHash = (path: string) => {
    const absolute = reviewAssetPath(input.repositoryRoot, path)
    const pending = fileHashes.get(absolute) ?? readFile(absolute).then(sha256Bytes)
    fileHashes.set(absolute, pending)
    return pending
  }
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    let review: any
    try {
      review = JSON.parse(await readFile(join(input.reviewRoot, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))
    } catch {
      diagnostics.push(error('LIMB_REVIEW_MISSING', [rigId], 'Cannot read the canonical limb contact-sheet manifest.'))
      continue
    }
    const roster = LIMB_ROSTER[rigId]
    const expected = new Set(roster.bodies.flatMap(body => roster.arms.flatMap(arms => roster.legs.map(legs => `${body}:${arms}:${legs}`))))
    const entries = Array.isArray(review.entries) ? review.entries : []
    const actual = entries.map((entry: any) => `${entry.bodyFrame}:${entry.arms}:${entry.legs}`)
    entryCountByRig[rigId] = entries.length
    if (review.rigId !== rigId || review.mode !== 'full' || review.entryCount !== expected.size || entries.length !== expected.size || new Set(actual).size !== expected.size || actual.some((key: string) => !expected.has(key))) {
      diagnostics.push(error('LIMB_REVIEW_ROSTER_INVALID', [rigId, 'entries'], 'Review must contain every exact body × arms × legs cell once.'))
    }
    if (review.status !== 'machine-pass-awaiting-user-approval') {
      diagnostics.push(error('LIMB_REVIEW_STATUS_INVALID', [rigId, 'status'], 'Canonical limb review must remain machine-pass awaiting user approval.'))
    }
    const thresholds = review.thresholds ?? {}
    if (thresholds.receiverCoverageMin !== 0.9 || thresholds.plugCoverageMin !== 0.9 || thresholds.largestComponentRatioMin !== 0.99 || thresholds.centerlineGapPixelsMax !== 2 || thresholds.childOutsideBodyRatioMin !== 0.614) {
      diagnostics.push(error('LIMB_REVIEW_THRESHOLD_INVALID', [rigId, 'thresholds', 'childOutsideBodyRatioMin'], 'The global visible-limb outside-alpha minimum must be exactly 0.614 with the canonical connector gates.'))
    }
    for (const [index, entry] of entries.entries()) {
      if (!Array.isArray(entry.gateErrors) || entry.gateErrors.length !== 0) {
        diagnostics.push(error('LIMB_REVIEW_GATE_FAILED', [rigId, 'entries', String(index)], 'Every canonical limb cell must have zero gate errors.'))
      }
      const metrics = Array.isArray(entry.connectorMetrics) ? entry.connectorMetrics.filter((metric: any) => /^(shoulder|hip)/.test(metric.connectorId)) : []
      if (metrics.length !== 4 || metrics.some((metric: any) => (
        !Number.isFinite(metric.receiverCoverage) || metric.receiverCoverage < 0.9
        || !Number.isFinite(metric.plugCoverage) || metric.plugCoverage < 0.9
        || !Number.isFinite(metric.largestComponentRatio) || metric.largestComponentRatio < 0.99
        || !Number.isFinite(metric.centerlineGapPixels) || metric.centerlineGapPixels > 2
        || !Number.isFinite(metric.childOutsideBodyRatio) || metric.childOutsideBodyRatio < 0.614
      ))) diagnostics.push(error('LIMB_REVIEW_METRIC_FAILED', [rigId, 'entries', String(index)], 'Every visible arm and leg must satisfy the global causal gates.'))
      const bounds = entry.compositionMetrics?.visibleBounds
      if (bounds === undefined || bounds.x < 96 || bounds.y < 64 || bounds.x + bounds.width > 1952 || bounds.y + bounds.height > 1952) {
        diagnostics.push(error('LIMB_REVIEW_BOUNDS_FAILED', [rigId, 'entries', String(index)], 'Visible alpha must remain inside the canonical safe frame.'))
      }
      const hashes = entry.inputBinding?.resolvedAssetHashes
      if (!Array.isArray(hashes) || hashes.length === 0) {
        diagnostics.push(error('LIMB_REVIEW_INPUT_BINDING_INVALID', [rigId, 'entries', String(index)], 'Every cell must bind its resolved input bytes.'))
      } else {
        for (const [assetIndex, asset] of hashes.entries()) {
          try {
            if (await liveHash(asset.path) !== asset.sha256) diagnostics.push(error('LIMB_REVIEW_INPUT_HASH_INVALID', [rigId, 'entries', String(index), 'resolvedAssetHashes', String(assetIndex)], 'Resolved input bytes differ from the hash-bound review evidence.'))
          } catch {
            diagnostics.push(error('LIMB_REVIEW_INPUT_MISSING', [rigId, 'entries', String(index), 'resolvedAssetHashes', String(assetIndex)], 'A hash-bound review input is missing.'))
          }
        }
      }
    }
    for (const [pathKey, hashKey, code] of [
      ['originalPath', 'originalSha256', 'original'],
      ['review256Path', 'review256Sha256', '256'],
    ] as const) {
      try {
        if (await liveHash(review[pathKey]) !== review[hashKey]) diagnostics.push(error('LIMB_REVIEW_SHEET_INVALID', [rigId, code], 'Contact-sheet bytes differ from the declared SHA-256.'))
      } catch {
        diagnostics.push(error('LIMB_REVIEW_SHEET_MISSING', [rigId, code], 'Cannot read the declared limb contact sheet.'))
      }
    }
  }
  return { diagnostics, entryCountByRig }
}

const LIMB_CAUSAL_METRIC_TOLERANCE = 1e-12
const LIMB_METRIC_FIELDS = ['receiverCoverage', 'plugCoverage', 'largestComponentRatio', 'centerlineGapPixels', 'childOutsideBodyRatio'] as const
export const LIMB_RENDERER_EVIDENCE_PATHS = [
  'scripts/render-limb-contact-sheets.ts',
  'apps/creator-web/src/render-test.ts',
  'packages/renderer-canvas/src/render.ts',
  'packages/renderer-canvas/src/connector-metrics.ts',
] as const

type LimbReviewManifest = { rigId: InterfaceRigId; entries: any[] }
type LimbCausalAggregate = {
  entryCount: number
  receiverCoverageMin: number
  plugCoverageMin: number
  largestComponentRatioMin: number
  centerlineGapPixelsMax: number
  childOutsideBodyRatioMin: number
}

function limbEntryKey(entry: { rigId: string; bodyFrame: string; arms: string; legs: string }): string {
  return `${entry.rigId}:${entry.bodyFrame}:${entry.arms}:${entry.legs}`
}

function comparableDiagnostics(value: unknown): unknown {
  return Array.isArray(value) ? value.map((item: any) => ({ severity: item.severity, code: item.code, path: item.path, message: item.message })) : value
}

function comparableResolverPaths(paths: unknown): unknown {
  return Array.isArray(paths) ? paths.map(path => typeof path === 'string' ? portableResolverPath(path) : path) : paths
}

function comparableResolvedHashes(value: unknown): unknown {
  return Array.isArray(value) ? value.map((item: any) => ({ path: portableResolverPath(item.path), sha256: item.sha256 })) : value
}

function limbCausalAggregate(entries: Array<{ connectorMetrics: any[] }>): LimbCausalAggregate {
  const metrics = entries.flatMap(entry => entry.connectorMetrics.filter(metric => /^(shoulder|hip)/u.test(metric.connectorId)))
  return {
    entryCount: entries.length,
    receiverCoverageMin: Math.min(...metrics.map(metric => metric.receiverCoverage)),
    plugCoverageMin: Math.min(...metrics.map(metric => metric.plugCoverage)),
    largestComponentRatioMin: Math.min(...metrics.map(metric => metric.largestComponentRatio)),
    centerlineGapPixelsMax: Math.max(...metrics.map(metric => metric.centerlineGapPixels)),
    childOutsideBodyRatioMin: Math.min(...metrics.map(metric => metric.childOutsideBodyRatio)),
  }
}

function sameNumber(left: unknown, right: unknown): boolean {
  return typeof left === 'number' && typeof right === 'number' && Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= LIMB_CAUSAL_METRIC_TOLERANCE
}

export function compareLimbCausalMetricEvidence(input: {
  liveEntries: LimbMatrixEvidenceEntry[]
  manifests: LimbReviewManifest[]
}): { diagnostics: Diagnostic[]; aggregate: LimbCausalAggregate } {
  const diagnostics: Diagnostic[] = []
  const storedEntries = input.manifests.flatMap(manifest => manifest.entries)
  const storedByKey = new Map(storedEntries.map(entry => [limbEntryKey(entry), entry]))
  if (input.liveEntries.length !== 60 || storedEntries.length !== 60 || storedByKey.size !== 60) {
    diagnostics.push(error('LIMB_CAUSAL_ROSTER_DRIFT', ['causalMetrics', 'entries'], 'Live and stored exact-rig matrices must each contain the same 60 unique cells.'))
  }
  for (const [index, live] of input.liveEntries.entries()) {
    const path = ['causalMetrics', live.rigId, String(index)]
    const stored = storedByKey.get(limbEntryKey(live))
    if (stored === undefined) {
      diagnostics.push(error('LIMB_CAUSAL_ROSTER_DRIFT', path, 'A live exact-rig cell has no matching stored review entry.'))
      continue
    }
    const liveMetrics = new Map(live.connectorMetrics.filter(metric => /^(shoulder|hip)/u.test(metric.connectorId)).map(metric => [metric.connectorId, metric]))
    const storedMetrics = new Map((Array.isArray(stored.connectorMetrics) ? stored.connectorMetrics : []).filter((metric: any) => /^(shoulder|hip)/u.test(metric.connectorId)).map((metric: any) => [metric.connectorId, metric]))
    if (liveMetrics.size !== 4 || storedMetrics.size !== 4) diagnostics.push(error('LIMB_CAUSAL_METRIC_DRIFT', [...path, 'connectorMetrics'], 'Every live/stored cell must contain four limb connector metrics.'))
    for (const connectorId of ['shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']) {
      const liveMetric: any = liveMetrics.get(connectorId)
      const storedMetric: any = storedMetrics.get(connectorId)
      for (const field of LIMB_METRIC_FIELDS) if (!sameNumber(liveMetric?.[field], storedMetric?.[field])) {
        diagnostics.push(error('LIMB_CAUSAL_METRIC_DRIFT', [...path, connectorId, field], `Stored ${field} differs from live renderer reconstruction.`))
      }
    }
    if (JSON.stringify(live.compositionMetrics?.visibleBounds ?? null) !== JSON.stringify(stored.compositionMetrics?.visibleBounds ?? null)) {
      diagnostics.push(error('LIMB_CAUSAL_BOUNDS_DRIFT', [...path, 'visibleBounds'], 'Stored visible bounds differ from live renderer reconstruction.'))
    }
    if (JSON.stringify(live.gateErrors) !== JSON.stringify(stored.gateErrors)) diagnostics.push(error('LIMB_CAUSAL_DIAGNOSTIC_DRIFT', [...path, 'gateErrors'], 'Stored gate diagnostics differ from live renderer reconstruction.'))
    if (JSON.stringify(comparableDiagnostics(live.diagnostics)) !== JSON.stringify(comparableDiagnostics(stored.diagnostics))) diagnostics.push(error('LIMB_CAUSAL_DIAGNOSTIC_DRIFT', [...path, 'diagnostics'], 'Stored renderer diagnostics differ from live renderer reconstruction.'))
    if (JSON.stringify(comparableResolverPaths(live.resolvedAssetPaths)) !== JSON.stringify(comparableResolverPaths(stored.resolvedAssetPaths))) diagnostics.push(error('LIMB_CAUSAL_INPUT_DRIFT', [...path, 'resolvedAssetPaths'], 'Stored resolver call inputs differ from live renderer reconstruction.'))
    const catalogBindingMatches = stored.inputBinding?.catalogSha256 === TASK8_APPROVED_LEGACY_CATALOG_SHA256
      && live.inputBinding.catalogSha256 === TASK8_LIMB_CATALOG_PROJECTION_SHA256
    if (!catalogBindingMatches || JSON.stringify(comparableResolvedHashes(live.inputBinding.resolvedAssetHashes)) !== JSON.stringify(comparableResolvedHashes(stored.inputBinding?.resolvedAssetHashes))) {
      diagnostics.push(error('LIMB_CAUSAL_INPUT_DRIFT', [...path, 'inputBinding'], 'Stored catalog or resolved-asset hashes differ from live renderer inputs.'))
    }
  }
  return { diagnostics, aggregate: limbCausalAggregate(input.liveEntries) }
}

export async function validateLimbCausalMetricEvidence(input: {
  repositoryRoot: string
  reviewRoot: string
  catalogPath?: string
  manifestOverrides?: Partial<Record<InterfaceRigId, LimbReviewManifest>>
  liveEvidence?: { entries: LimbMatrixEvidenceEntry[] }
}): Promise<{ entryCount: number; diagnostics: Diagnostic[]; aggregate: LimbCausalAggregate; liveEvidence: { entries: LimbMatrixEvidenceEntry[] } }> {
  const manifests = await Promise.all((['blob', 'biped', 'floating'] as const).map(async rigId => input.manifestOverrides?.[rigId] ?? JSON.parse(await readFile(resolve(input.reviewRoot, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
  const reconstructed = input.liveEvidence ?? await reconstructLimbMatrixEvidence({ mode: 'full', catalogPath: input.catalogPath })
  const catalogPath = input.catalogPath ?? resolve(input.repositoryRoot, 'packages/asset-catalog/catalog/v0.3.0/catalog.json')
  const catalogProjectionSha256 = task8LimbCatalogProjectionSha256(JSON.parse(await readFile(catalogPath, 'utf8')))
  const liveEvidence = {
    entries: reconstructed.entries.map(entry => ({
      ...entry,
      inputBinding: { ...entry.inputBinding, catalogSha256: catalogProjectionSha256 },
    })),
  }
  const compared = compareLimbCausalMetricEvidence({ liveEntries: liveEvidence.entries, manifests })
  return { entryCount: liveEvidence.entries.length, diagnostics: compared.diagnostics, aggregate: compared.aggregate, liveEvidence }
}

export async function validateLimbAcceptanceDocument(input: {
  document: any
  repositoryRoot: string
  reviewRoot: string
  liveAggregate?: LimbCausalAggregate
}): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const evidenceRoot = input.document?.evidenceRoot
  if (evidenceRoot?.schemaVersion !== 'task8-evidence-root-v1' || evidenceRoot?.closurePrinciple !== 'acceptance-to-inputs; indexes-never-reference-acceptance') {
    diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot'], 'Acceptance must declare the stable, non-self-referential Task 8 evidence root.'))
    return diagnostics
  }
  let sourceIndex: unknown
  let processedIndex: unknown
  let productionEvidence: unknown
  for (const [field, expectedBinding] of Object.entries(TASK8_APPROVED_EVIDENCE_BINDINGS)) {
    const binding = evidenceRoot[field]
    try {
      const bytes = await readFile(resolve(input.repositoryRoot, expectedBinding.path))
      if (binding?.path !== expectedBinding.path || binding?.sha256 !== expectedBinding.sha256) {
        diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', field], `Evidence-root ${field} no longer matches the frozen Task 8 binding.`))
      }
      if (field === 'sourceIndex') sourceIndex = JSON.parse(bytes.toString('utf8'))
      if (field === 'processedIndex') processedIndex = JSON.parse(bytes.toString('utf8'))
      if (field === 'productionEvidence') {
        productionEvidence = JSON.parse(bytes.toString('utf8'))
        if (sha256Bytes(bytes) !== expectedBinding.sha256) diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', field], 'Task 8 production evidence differs from its frozen bytes.'))
      }
    } catch { diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', field], `Evidence-root ${field} is missing.`)) }
  }
  try {
    const sourceProjection = task8LimbSourceProjectionSha256(sourceIndex, productionEvidence)
    const processedProjection = task8LimbSourceProjectionSha256((processedIndex as { sourceIndex?: unknown })?.sourceIndex, productionEvidence)
    if (sourceProjection !== TASK8_LIMB_SOURCE_PROJECTION_SHA256 || processedProjection !== TASK8_LIMB_SOURCE_PROJECTION_SHA256) {
      diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', 'indexClosure'], 'Task 8 source records differ from the stable approved projection.'))
    }
  } catch {
    diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', 'indexClosure'], 'Cannot validate the stable Task 8 source-index projection.'))
  }
  const renderers = Array.isArray(evidenceRoot.rendererInputs) ? evidenceRoot.rendererInputs : []
  if (renderers.length !== LIMB_RENDERER_EVIDENCE_PATHS.length || new Set(renderers.map((item: any) => item.path)).size !== LIMB_RENDERER_EVIDENCE_PATHS.length) {
    diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', 'rendererInputs'], 'Evidence root must bind every canonical renderer input exactly once.'))
  }
  for (const expectedPath of LIMB_RENDERER_EVIDENCE_PATHS) {
    const binding = renderers.find((item: any) => item.path === expectedPath)
    try {
      const expectedHash = TASK8_APPROVED_RENDERER_BINDINGS[expectedPath]
      const liveHash = task8RendererProjectionSha256(expectedPath, await readFile(resolve(input.repositoryRoot, expectedPath)))
      if (binding?.sha256 !== expectedHash || liveHash !== expectedHash) diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', 'rendererInputs', expectedPath], 'Renderer input differs from the stable Task 8 source projection.'))
    } catch { diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'evidenceRoot', 'rendererInputs', expectedPath], 'Renderer input is missing.')) }
  }
  if (input.document.productionEvidence?.path !== evidenceRoot.productionEvidence?.path || input.document.productionEvidence?.sha256 !== evidenceRoot.productionEvidence?.sha256) {
    diagnostics.push(error('LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID', ['limbAcceptance', 'productionEvidence'], 'Top-level production evidence must equal its evidence-root binding.'))
  }
  let expectedAggregate = input.liveAggregate
  if (expectedAggregate === undefined) {
    const manifests = await Promise.all((['blob', 'biped', 'floating'] as const).map(async rigId => JSON.parse(await readFile(resolve(input.reviewRoot, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
    expectedAggregate = limbCausalAggregate(manifests.flatMap(manifest => manifest.entries))
  }
  const actualAggregate = input.document.causalMetrics?.results
  for (const field of ['entryCount', 'receiverCoverageMin', 'plugCoverageMin', 'largestComponentRatioMin', 'centerlineGapPixelsMax', 'childOutsideBodyRatioMin'] as const) {
    if (!sameNumber(actualAggregate?.[field], expectedAggregate[field])) diagnostics.push(error('LIMB_ACCEPTANCE_AGGREGATE_DRIFT', ['limbAcceptance', 'causalMetrics', 'results', field], `Acceptance aggregate ${field} differs from reconstructed matrix evidence.`))
  }
  return diagnostics
}

export async function validateLimbApproval(input: { repositoryRoot: string; reviewRoot: string }): Promise<{
  diagnostics: Diagnostic[]
  entryCount: number
}> {
  const diagnostics: Diagnostic[] = []
  const path = resolve(input.reviewRoot, 'limb-contact-sheets-acceptance.json')
  let document: any
  try { document = JSON.parse(await readFile(path, 'utf8')) } catch {
    return { diagnostics: [error('LIMB_ACCEPTANCE_MISSING', ['limbAcceptance'], 'Canonical Task 8 limb acceptance is missing.')], entryCount: 0 }
  }
  const causal = await validateLimbCausalMetricEvidence(input)
  diagnostics.push(...causal.diagnostics)
  if (document.schemaVersion !== 'limb-acceptance-v1' || document.decision !== 'approved' || document.reviewer !== 'user' || document.userApproved !== true || document.approvalResponse !== 'A' || document.entryCount !== 60 || document.entryCountByRig?.blob !== 24 || document.entryCountByRig?.biped !== 24 || document.entryCountByRig?.floating !== 12) {
    diagnostics.push(error('LIMB_ACCEPTANCE_FIELDS_INVALID', ['limbAcceptance'], 'Task 8 acceptance must record the exact user A approval and 24/24/12 matrix.'))
  }
  const expectedArtifacts = new Set((['blob', 'biped', 'floating'] as const).flatMap(rigId => {
    const stem = `packages/asset-catalog/review/v0.3.0/limb-contact-sheet-${rigId}`
    return [`${stem}.png`, `${stem}-256.png`, `${stem}-manifest.json`]
  }))
  const artifacts = Array.isArray(document.artifacts) ? document.artifacts : []
  const declared = artifacts.flatMap((item: any) => [
    [item.originalPath, item.originalSha256], [item.review256Path, item.review256Sha256], [item.manifestPath, item.manifestSha256],
  ] as Array<[string, string]>)
  if (artifacts.length !== 3 || declared.length !== 9 || new Set(declared.map(([item]) => item)).size !== 9 || declared.some(([item]) => !expectedArtifacts.has(item))) {
    diagnostics.push(error('LIMB_ACCEPTANCE_ARTIFACT_SET_INVALID', ['limbAcceptance', 'artifacts'], 'Task 8 acceptance must bind the exact six sheets and three manifests.'))
  } else for (const [index, [portablePath, expectedHash]] of declared.entries()) {
    try {
      if (sha256Bytes(await readFile(resolve(input.repositoryRoot, portablePath))) !== expectedHash) diagnostics.push(error('LIMB_ACCEPTANCE_ARTIFACT_HASH_INVALID', ['limbAcceptance', 'artifacts', String(index)], 'Approved limb artifact hash differs from live bytes.'))
    } catch { diagnostics.push(error('LIMB_ACCEPTANCE_ARTIFACT_MISSING', ['limbAcceptance', 'artifacts', String(index)], 'Approved limb artifact is missing.')) }
  }
  for (const [field, expectedPath] of [
    ['reviewRecord', 'packages/asset-catalog/review/v0.3.0/limb-review-record.json'],
    ['thresholdContract', 'packages/asset-catalog/review/v0.3.0/visible-limb-threshold-amendment.json'],
    ['connectorAmendment', 'packages/asset-catalog/review/v0.3.0/body-head-connector-amendment.json'],
    ['task7Reapproval', 'packages/asset-catalog/review/v0.3.0/body-head-contact-sheets-acceptance.json'],
  ] as const) {
    const binding = document[field]
    try {
      if (binding?.path !== expectedPath || sha256Bytes(await readFile(resolve(input.repositoryRoot, expectedPath))) !== binding.sha256) diagnostics.push(error('LIMB_ACCEPTANCE_BINDING_INVALID', ['limbAcceptance', field], `Task 8 acceptance ${field} binding differs from live bytes.`))
    } catch { diagnostics.push(error('LIMB_ACCEPTANCE_BINDING_INVALID', ['limbAcceptance', field], `Task 8 acceptance ${field} binding is missing.`)) }
  }
  if (document.thresholdContract?.activeMinimum !== 0.614 || document.thresholdContract?.rejects !== 0.613999 || document.thresholdContract?.noOverrides !== true || document.connectorAmendment?.shoulderOrigins?.left !== 490 || document.connectorAmendment?.shoulderOrigins?.right !== 1558 || document.causalMetrics?.results?.childOutsideBodyRatioMin < 0.614) {
    diagnostics.push(error('LIMB_ACCEPTANCE_CONTRACT_INVALID', ['limbAcceptance', 'contract'], 'Acceptance must bind the exact global 0.614 contract and x490/1558 connector amendment.'))
  }
  try {
    const review = JSON.parse(await readFile(resolve(input.repositoryRoot, document.reviewRecord.path), 'utf8'))
    if (review.status !== 'APPROVED' || review.userApproved !== true || review.approvalResponse !== 'A') diagnostics.push(error('LIMB_ACCEPTANCE_REVIEW_INVALID', ['limbAcceptance', 'reviewRecord'], 'Canonical limb review record is not approved by user A.'))
  } catch { diagnostics.push(error('LIMB_ACCEPTANCE_REVIEW_INVALID', ['limbAcceptance', 'reviewRecord'], 'Cannot read the canonical limb review record.')) }
  diagnostics.push(...await validateLimbAcceptanceDocument({
    document,
    repositoryRoot: input.repositoryRoot,
    reviewRoot: input.reviewRoot,
    liveAggregate: causal.aggregate,
  }))
  return { diagnostics, entryCount: diagnostics.length === 0 ? 60 : 0 }
}

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
  if (document.reapproval === undefined) {
    diagnostics.push(error('BODY_HEAD_REAPPROVAL_BINDING_INVALID', ['acceptance', 'reapproval'], 'Current Task 7 acceptance must bind the approved connector amendment and unchanged review evidence.'))
  } else {
    try {
      const amendmentBytes = await readFile(resolve(input.repositoryRoot, document.reapproval.amendmentPath))
      const reviewBytes = await readFile(resolve(input.repositoryRoot, document.reapproval.reviewRecordPath))
      if (
        document.reapproval.reason !== 'body_blob_wide-shoulder-connector-amendment'
        || sha256Bytes(amendmentBytes) !== document.reapproval.amendmentSha256
        || sha256Bytes(reviewBytes) !== document.reapproval.reviewRecordSha256
        || document.reapproval.visualArtifactsByteIdentical !== true
      ) diagnostics.push(error('BODY_HEAD_REAPPROVAL_BINDING_INVALID', ['acceptance', 'reapproval'], 'Task 7 reapproval must bind the exact connector amendment, review record, and unchanged visual evidence.'))
    } catch { diagnostics.push(error('BODY_HEAD_REAPPROVAL_BINDING_INVALID', ['acceptance', 'reapproval'], 'Task 7 reapproval binding is missing.')) }
  }
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
  if (records.length === 0) {
    const diagnostics: Diagnostic[] = []
    try {
      const [reviewBytes, amendmentBytes] = await Promise.all([
        readFile(resolve(input.repositoryRoot, BODY_HEAD_REVIEW_RECORD_PATH)),
        readFile(resolve(input.repositoryRoot, TASK7_BODY_HEAD_AMENDMENT_PATH)),
      ])
      const review = JSON.parse(reviewBytes.toString('utf8')) as Record<string, any>
      const amendment = JSON.parse(amendmentBytes.toString('utf8')) as Record<string, any>
      if (
        review.status !== 'WAITING_FOR_USER_REAPPROVAL'
        || review.decision !== 'pending'
        || review.userApproved !== false
        || review.entryCount !== 20
        || amendment.status !== 'WAITING_FOR_USER_REAPPROVAL'
        || amendment.userApproved !== false
        || amendment.newOrigins?.left?.x !== 490
        || amendment.newOrigins?.right?.x !== 1558
        || amendment.unchangedBody?.beforeSha256 !== amendment.unchangedBody?.afterSha256
      ) diagnostics.push(error('BODY_HEAD_AMENDMENT_PENDING_INVALID', ['amendment'], 'The live Task 7 boundary must be an explicit, unappproved x490/1558 connector amendment.'))
      const artifacts = Array.isArray(amendment.reviewArtifacts) ? amendment.reviewArtifacts : []
      const expectedPaths = new Set((['blob', 'biped', 'floating'] as const).flatMap(rigId => Object.values(bodyHeadArtifactPaths(rigId))))
      if (artifacts.length !== 9 || new Set(artifacts.map((item: any) => item.path)).size !== 9 || artifacts.some((item: any) => !expectedPaths.has(item.path))) {
        diagnostics.push(error('BODY_HEAD_AMENDMENT_REVIEW_INVALID', ['amendment', 'reviewArtifacts'], 'Pending amendment must bind the exact nine canonical Task 7 review artifacts.'))
      } else {
        for (const [index, artifact] of artifacts.entries()) {
          try {
            if (sha256Bytes(await readFile(resolve(input.repositoryRoot, artifact.path))) !== artifact.sha256) diagnostics.push(error('BODY_HEAD_AMENDMENT_REVIEW_INVALID', ['amendment', 'reviewArtifacts', String(index)], 'Pending amendment review artifact hash differs from live bytes.'))
          } catch {
            diagnostics.push(error('BODY_HEAD_AMENDMENT_REVIEW_INVALID', ['amendment', 'reviewArtifacts', String(index)], 'Pending amendment review artifact is missing.'))
          }
        }
      }
      try {
        if (sha256Bytes(await readFile(resolve(input.repositoryRoot, amendment.preAmendmentEvidence.path))) !== amendment.preAmendmentEvidence.sha256) diagnostics.push(error('BODY_HEAD_AMENDMENT_HISTORY_INVALID', ['amendment', 'preAmendmentEvidence'], 'Pre-amendment evidence hash differs from the preserved history.'))
      } catch {
        diagnostics.push(error('BODY_HEAD_AMENDMENT_HISTORY_INVALID', ['amendment', 'preAmendmentEvidence'], 'Pre-amendment evidence is missing.'))
      }
      diagnostics.push(...await validateBodyHeadCausalMetricEvidence({ repositoryRoot: input.repositoryRoot, reviewRoot: input.reviewRoot }))
      return { diagnostics, entryCount: diagnostics.length === 0 ? 20 : 0 }
    } catch {
      return { diagnostics: [error('BODY_HEAD_AMENDMENT_PENDING_INVALID', ['amendment'], 'Canonical acceptance is absent and the pending Task 7 amendment cannot be read.')], entryCount: 0 }
    }
  }
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

export async function validatePublishedInterfaceApprovals(input: {
  repositoryRoot: string
  production: boolean
  scope?: 'body-head' | 'limbs'
}): Promise<{
  diagnostics: Diagnostic[]
  bodyHeadEntriesChecked: Record<InterfaceRigId, number> | undefined
  bodyHeadApprovalEntriesChecked: number
  limbEntriesChecked: Record<InterfaceRigId, number> | undefined
  limbApprovalEntriesChecked: number
}> {
  const diagnostics: Diagnostic[] = []
  const reviewRoot = join(input.repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0')
  let bodyHeadEntriesChecked: Record<InterfaceRigId, number> | undefined
  let bodyHeadApprovalEntriesChecked = 0
  let limbEntriesChecked: Record<InterfaceRigId, number> | undefined
  let limbApprovalEntriesChecked = 0

  if (input.production || input.scope === 'body-head') {
    const review = await validateBodyHeadReview({ repositoryRoot: input.repositoryRoot, reviewRoot })
    bodyHeadEntriesChecked = review.entryCountByRig
    diagnostics.push(...review.diagnostics)
    if (diagnostics.length === 0) {
      const approval = await validateBodyHeadApproval({ repositoryRoot: input.repositoryRoot, reviewRoot })
      bodyHeadApprovalEntriesChecked = approval.entryCount
      diagnostics.push(...approval.diagnostics)
    }
  }

  if (diagnostics.length === 0 && (input.production || input.scope === 'limbs')) {
    const review = await validateLimbReview({ repositoryRoot: input.repositoryRoot, reviewRoot })
    limbEntriesChecked = review.entryCountByRig
    diagnostics.push(...review.diagnostics)
    if (diagnostics.length === 0) {
      const approval = await validateLimbApproval({ repositoryRoot: input.repositoryRoot, reviewRoot })
      limbApprovalEntriesChecked = approval.entryCount
      diagnostics.push(...approval.diagnostics)
    }
  }

  return { diagnostics, bodyHeadEntriesChecked, bodyHeadApprovalEntriesChecked, limbEntriesChecked, limbApprovalEntriesChecked }
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
  if (version !== '0.3.0' || (scope !== undefined && scope !== 'body-head' && scope !== 'limbs')) throw new Error('Usage: tsx scripts/validate-interface-slice.ts --version 0.3.0 [--production] [--scope body-head|limbs]')
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
  if (diagnostics.length === 0 && (production || scope === 'body-head' || scope === 'limbs')) {
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
  let limbEntriesChecked: Record<InterfaceRigId, number> | undefined
  let limbApprovalEntriesChecked = 0
  let tailExtraEntriesChecked = 0
  if (diagnostics.length === 0) {
    const approvals = await validatePublishedInterfaceApprovals({ repositoryRoot, production, scope: scope as 'body-head' | 'limbs' | undefined })
    bodyHeadEntriesChecked = approvals.bodyHeadEntriesChecked
    bodyHeadApprovalEntriesChecked = approvals.bodyHeadApprovalEntriesChecked
    limbEntriesChecked = approvals.limbEntriesChecked
    limbApprovalEntriesChecked = approvals.limbApprovalEntriesChecked
    diagnostics.push(...approvals.diagnostics)
  }
  if (diagnostics.length === 0 && production) {
    const tailExtra = await validateStoredTailExtraMatrixEvidence({ repositoryRoot })
    tailExtraEntriesChecked = tailExtra.entryCount
    for (const message of tailExtra.diagnostics) diagnostics.push(error('TAIL_EXTRA_MATRIX_LIVE_MISMATCH', ['review', 'tail-extra'], message))
  }
  for (const diagnostic of diagnostics) console.error(`ERROR ${diagnostic.code} ${diagnostic.path.join('.')}: ${diagnostic.message}`)
  console.log(JSON.stringify({ version, rig, scope, sliceGuides: slice.ok, productionAssetsChecked, bipedEntriesChecked, bodyHeadEntriesChecked, bodyHeadApprovalEntriesChecked, limbEntriesChecked, limbApprovalEntriesChecked, tailExtraEntriesChecked, diagnostics: diagnostics.length }))
  if (diagnostics.length > 0) process.exitCode = 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main()
