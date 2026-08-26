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

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

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
}

interface BodyHeadReviewManifest {
  rigId: InterfaceRigId
  entries: BodyHeadReviewEntry[]
  thresholds: {
    largestComponentRatio: number
    centerlineGapPx: number
    visibleTongueDepthRatio: number
    visibleTongueAreaRatio: number
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
  if (diagnostics.length === 0 && scope === 'body-head') {
    const review = await validateBodyHeadReview({ repositoryRoot, reviewRoot: join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0') })
    bodyHeadEntriesChecked = review.entryCountByRig
    diagnostics.push(...review.diagnostics)
  }
  for (const diagnostic of diagnostics) console.error(`ERROR ${diagnostic.code} ${diagnostic.path.join('.')}: ${diagnostic.message}`)
  console.log(JSON.stringify({ version, rig, scope, sliceGuides: slice.ok, productionAssetsChecked, bipedEntriesChecked, bodyHeadEntriesChecked, diagnostics: diagnostics.length }))
  if (diagnostics.length > 0) process.exitCode = 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main()
