import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Catalog, Diagnostic } from '@qmonster/generator-core'
import { validateAssetFile } from './file-validation.js'

function error(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function nonemptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function sameJson(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right)
}

export function validateProductionMetadata(catalog: Catalog): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const themeIds = new Set<string>(catalog.themes.map(theme => theme.id))
  const partIds = new Set(catalog.parts.map(part => part.id))

  for (const [index, theme] of catalog.themes.entries()) {
    if (!nonemptyText(theme.displayName) || !nonemptyText(theme.flavorText)) {
      diagnostics.push(error('PRODUCTION_THEME_METADATA_MISSING', ['themes', String(index)], `Theme ${theme.id} needs Chinese displayName and flavorText.`))
    }
  }
  for (const [index, rig] of catalog.rigs.entries()) {
    if (!nonemptyText(rig.sourceId) || !nonemptyText(rig.displayName)) {
      diagnostics.push(error('PRODUCTION_RIG_METADATA_MISSING', ['rigs', String(index)], `Rig ${rig.id} needs sourceId and displayName.`))
    }
  }
  for (const [index, part] of catalog.parts.entries()) {
    if (
      !nonemptyText(part.displayName)
      || !nonemptyText(part.flavorText)
      || !nonemptyText(part.description)
      || !nonemptyText(part.assetSha256)
      || !nonemptyText(part.pngPath)
      || !nonemptyText(part.pngSha256)
    ) {
      diagnostics.push(error('PRODUCTION_PART_METADATA_MISSING', ['parts', String(index)], `Part ${part.id} needs display/flavor/description and PNG/WebP paths with hashes.`))
    }
  }

  const semanticCounts = new Map<string, number>()
  for (const [index, semantic] of catalog.semanticTraits.entries()) {
    semanticCounts.set(semantic.semanticSlotId, (semanticCounts.get(semantic.semanticSlotId) ?? 0) + 1)
    if (
      !nonemptyText(semantic.displayName)
      || !nonemptyText(semantic.flavorText)
      || semantic.rarity === undefined
      || !hasOwn(semantic, 'themeBoosts')
      || !hasOwn(semantic, 'excludes')
      || !hasOwn(semantic, 'boosts')
      || !hasOwn(semantic, 'visualMapping')
    ) {
      diagnostics.push(error('PRODUCTION_SEMANTIC_METADATA_MISSING', ['semanticTraits', String(index)], `Semantic trait ${semantic.id} lacks required rich production metadata.`))
    }
    for (const themeId of Object.keys(semantic.themeBoosts ?? {})) {
      if (!themeIds.has(themeId)) diagnostics.push(error('PRODUCTION_DANGLING_THEME_BOOST', ['semanticTraits', String(index), 'themeBoosts', themeId], `Unknown boosted theme ${themeId}.`))
    }
    const mapping = semantic.visualMapping ?? {}
    for (const field of ['suggestedParts', 'effectPartIds', 'sourcePartIds', 'assetIds']) {
      const ids = mapping[field]
      if (!Array.isArray(ids)) continue
      for (const id of ids) if (typeof id !== 'string' || !partIds.has(id)) diagnostics.push(error('PRODUCTION_DANGLING_VISUAL_MAPPING', ['semanticTraits', String(index), 'visualMapping', field], `Unknown mapped part ${String(id)}.`))
    }
  }
  if (semanticCounts.get('personality') !== 6 || semanticCounts.get('quirk') !== 6) {
    diagnostics.push(error('PRODUCTION_SEMANTIC_COUNT_INVALID', ['semanticTraits'], 'Production requires exactly 6 personalities and 6 quirks.'))
  }

  const mutationCount = catalog.modifiers.filter(item => item.kind === 'mutation').length
  const aberrationCount = catalog.modifiers.filter(item => item.kind === 'aberration').length
  for (const [index, modifier] of catalog.modifiers.entries()) {
    if (
      !nonemptyText(modifier.displayName)
      || !nonemptyText(modifier.flavorText)
      || modifier.rarity === undefined
      || !hasOwn(modifier, 'themeBoosts')
      || !hasOwn(modifier, 'excludes')
      || !hasOwn(modifier, 'boosts')
      || !hasOwn(modifier, 'visualMapping')
    ) {
      diagnostics.push(error('PRODUCTION_MODIFIER_METADATA_MISSING', ['modifiers', String(index)], `Modifier ${modifier.id} lacks required rich production metadata.`))
    }
    for (const themeId of Object.keys(modifier.themeBoosts ?? {})) {
      if (!themeIds.has(themeId)) diagnostics.push(error('PRODUCTION_DANGLING_THEME_BOOST', ['modifiers', String(index), 'themeBoosts', themeId], `Unknown boosted theme ${themeId}.`))
    }
    const assetIds = modifier.visualMapping?.assetIds
    if (Array.isArray(assetIds)) for (const id of assetIds) if (typeof id !== 'string' || !partIds.has(id)) diagnostics.push(error('PRODUCTION_DANGLING_VISUAL_MAPPING', ['modifiers', String(index), 'visualMapping', 'assetIds'], `Unknown mapped part ${String(id)}.`))
  }
  if (catalog.modifiers.length !== 4 || mutationCount !== 2 || aberrationCount !== 2) {
    diagnostics.push(error('PRODUCTION_MODIFIER_COUNT_INVALID', ['modifiers'], 'Production requires exactly 2 mutations and 2 aberrations.'))
  }
  return diagnostics
}

export async function validateProductionSplitFiles(catalog: Catalog, catalogDirectory: string): Promise<Diagnostic[]> {
  const splits: ReadonlyArray<readonly [string, unknown]> = [
    ['themes.json', catalog.themes],
    ['rigs.json', catalog.rigs],
    ['parts.json', catalog.parts],
    ['semantic-traits.json', catalog.semanticTraits],
    ['modifiers.json', catalog.modifiers],
  ]
  const diagnostics: Diagnostic[] = []
  for (const [file, expected] of splits) {
    let actual: unknown
    try {
      actual = JSON.parse(await readFile(join(catalogDirectory, file), 'utf8'))
    } catch {
      diagnostics.push(error('PRODUCTION_SPLIT_MISSING', [file], `Cannot read production split ${file}.`))
      continue
    }
    if (!sameJson(actual, expected)) diagnostics.push(error('PRODUCTION_SPLIT_MISMATCH', [file], `${file} differs from aggregate catalog.json.`))
  }
  return diagnostics
}

async function collectFiles(root: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await collectFiles(root, relativePath))
    else files.push(relativePath)
  }
  return files
}

export async function validateNoStaleRuntimeAssets(catalog: Catalog, assetRoot: string): Promise<Diagnostic[]> {
  const expected = new Set<string>()
  for (const part of catalog.parts) {
    expected.add(part.assetPath.replaceAll('\\', '/'))
    if (part.pngPath !== undefined) expected.add(part.pngPath.replaceAll('\\', '/'))
  }
  for (const rig of catalog.rigs) {
    if (rig.sourceId === undefined) continue
    expected.add(`rigs/${rig.sourceId}.png`)
    expected.add(`rigs/${rig.sourceId}.webp`)
  }
  const actual = [
    ...(await collectFiles(assetRoot, 'parts')),
    ...(await collectFiles(assetRoot, 'rigs')),
  ].filter(path => path.endsWith('.png') || path.endsWith('.webp'))
  return actual
    .filter(path => !expected.has(path))
    .map(path => error('PRODUCTION_RUNTIME_STALE', path.split('/'), `Runtime asset is not referenced by the production catalog: ${path}`))
}

interface SourceCandidateEvaluation {
  index?: number
  selected?: boolean
  machineApproved?: boolean
}

interface ProductionSourceRecord {
  sourceId?: string
  kind?: string
  postProcess?: string
  runtimePngPath?: string
  runtimePngSha256?: string
  runtimeWebpPath?: string
  runtimeWebpSha256?: string
  candidateEvaluations?: SourceCandidateEvaluation[]
  selectedExtraction?: { approved?: boolean } | null
  composition?: {
    compositionVersion?: string
    attachment?: { x?: number, y?: number }
    lurePlacement?: { left?: number, top?: number, width?: number, height?: number, scale?: number, anchor?: string }
    zOrder?: unknown
    componentProvenance?: Record<string, Record<string, unknown> | undefined>
  }
}

export interface ProductionSourceIndex {
  sources?: ProductionSourceRecord[]
  qualityGateSummary?: Record<string, unknown>
  review?: unknown
}

function checkPortableAuditPaths(value: unknown, path: string[], diagnostics: Diagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkPortableAuditPaths(item, path.concat(String(index)), diagnostics))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path.concat(key)
    if (
      typeof item === 'string'
      && key.toLowerCase().endsWith('path')
      && (isAbsolute(item) || /^[a-z]:[\\/]/iu.test(item))
    ) {
      diagnostics.push(error('PRODUCTION_SOURCE_PATH_ABSOLUTE', itemPath, `Committed production audit path must be repository-relative: ${item}`))
    }
    checkPortableAuditPaths(item, itemPath, diagnostics)
  }
}

function runtimePathMatches(recorded: unknown, expected: string): boolean {
  if (typeof recorded !== 'string') return false
  const normalized = recorded.replaceAll('\\', '/')
  return normalized === expected || normalized.endsWith(`/assets/v0.1.0/${expected}`)
}

function checkSourceSelection(source: ProductionSourceRecord, path: string[], diagnostics: Diagnostic[]): void {
  const evaluations = source.candidateEvaluations
  if (!Array.isArray(evaluations) || evaluations.length !== 4) {
    diagnostics.push(error('PRODUCTION_CANDIDATE_AUDIT_INVALID', path.concat('candidateEvaluations'), 'Source audit must contain exactly four candidate evaluations.'))
    return
  }
  const selected = evaluations.filter(candidate => candidate.selected)
  const extractionPassed = source.kind === 'explicit-none-layer' || source.selectedExtraction?.approved === true
  if (selected.length !== 1 || selected[0]?.machineApproved !== true || !extractionPassed) {
    diagnostics.push(error('PRODUCTION_SELECTION_GATE_FAILED', path, `Selected source candidate ${source.sourceId ?? '<unknown>'} is not machine-approved.`))
  }
}

function checkCompositeProvenance(source: ProductionSourceRecord, path: string[], diagnostics: Diagnostic[]): void {
  if (source.postProcess !== 'head-shell-lure-composite-v1') return
  const composition = source.composition
  const compositePath = path.concat('composition')
  if (composition?.compositionVersion !== 'head-shell-lure-composite-v1') {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('compositionVersion'), 'Composite source needs the immutable composition version.'))
  }
  if (!Number.isFinite(composition?.attachment?.x) || !Number.isFinite(composition?.attachment?.y)) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('attachment'), 'Composite source needs finite authored attachment coordinates.'))
  }
  const placement = composition?.lurePlacement
  if (
    !Number.isFinite(placement?.left)
    || !Number.isFinite(placement?.top)
    || !Number.isFinite(placement?.width)
    || !Number.isFinite(placement?.height)
    || !Number.isFinite(placement?.scale)
    || (placement?.scale ?? 0) <= 0
    || (placement?.scale ?? 0) > 1
    || placement?.anchor !== 'bottom-center'
  ) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('lurePlacement'), 'Composite source needs complete deterministic lure placement parameters.'))
  }
  if (!Array.isArray(composition?.zOrder) || composition.zOrder.join(',') !== 'head-shell,lure') {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('zOrder'), 'Composite source needs the authored component z-order.'))
  }
  const requiredText = ['sourceSheetPath', 'sourcePath', 'processedPath', 'promptPath', 'prompt'] as const
  const requiredHashes = ['sourceSheetSha256', 'sourceSha256', 'processedSha256', 'promptSha256'] as const
  for (const [key, expectedRole] of [['shell', 'head-shell'], ['lure', 'lure']] as const) {
    const component = composition?.componentProvenance?.[key]
    const componentPath = compositePath.concat('componentProvenance', key)
    if (component?.role !== expectedRole) {
      diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', componentPath.concat('role'), `Composite ${key} needs role ${expectedRole}.`))
    }
    for (const field of requiredText) {
      if (!nonemptyText(component?.[field])) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', componentPath.concat(field), `Composite ${key} is missing ${field}.`))
    }
    for (const field of requiredHashes) {
      if (typeof component?.[field] !== 'string' || !/^[a-f0-9]{64}$/.test(component[field])) {
        diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', componentPath.concat(field), `Composite ${key} has an invalid ${field}.`))
      }
    }
  }
}

export async function validateProductionSourceIndex(
  catalog: Catalog,
  assetRoot: string,
  sourceIndex: ProductionSourceIndex,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  checkPortableAuditPaths(sourceIndex, [], diagnostics)
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : []
  const indexed = new Map(sources.flatMap(source => typeof source.sourceId === 'string' ? [[source.sourceId, source] as const] : []))
  const assetChecks: Array<Promise<Diagnostic[]>> = []

  for (const part of catalog.parts) {
    const source = indexed.get(part.id)
    if (source === undefined) {
      diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', part.id], `Missing source-index entry for part ${part.id}.`))
      continue
    }
    checkSourceSelection(source, ['sources', part.id], diagnostics)
    checkCompositeProvenance(source, ['sources', part.id], diagnostics)
    if (!runtimePathMatches(source.runtimeWebpPath, part.assetPath) || source.runtimeWebpSha256 !== part.assetSha256) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', part.id, 'runtimeWebpPath'], `Source-index WebP metadata differs for ${part.id}.`))
    }
    if (part.pngPath === undefined || !runtimePathMatches(source.runtimePngPath, part.pngPath) || source.runtimePngSha256 !== part.pngSha256) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', part.id, 'runtimePngPath'], `Source-index PNG metadata differs for ${part.id}.`))
    }
    if (typeof source.runtimeWebpSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, part.assetPath, source.runtimeWebpSha256, ['sources', part.id, 'runtimeWebpPath']))
    if (part.pngPath !== undefined && typeof source.runtimePngSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, part.pngPath, source.runtimePngSha256, ['sources', part.id, 'runtimePngPath']))
  }

  for (const rig of catalog.rigs) {
    if (rig.sourceId === undefined) {
      diagnostics.push(error('PRODUCTION_RIG_METADATA_MISSING', ['rigs', rig.id], `Rig ${rig.id} has no sourceId.`))
      continue
    }
    const source = indexed.get(rig.sourceId)
    if (source === undefined) {
      diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', rig.sourceId], `Missing source-index entry for rig ${rig.sourceId}.`))
      continue
    }
    checkSourceSelection(source, ['sources', rig.sourceId], diagnostics)
    const pngPath = `rigs/${rig.sourceId}.png`
    const webpPath = `rigs/${rig.sourceId}.webp`
    if (!runtimePathMatches(source.runtimePngPath, pngPath) || !runtimePathMatches(source.runtimeWebpPath, webpPath)) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', rig.sourceId], `Rig runtime paths differ for ${rig.sourceId}.`))
    }
    if (typeof source.runtimePngSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, pngPath, source.runtimePngSha256, ['sources', rig.sourceId, 'runtimePngPath']))
    if (typeof source.runtimeWebpSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, webpPath, source.runtimeWebpSha256, ['sources', rig.sourceId, 'runtimeWebpPath']))
  }
  diagnostics.push(...(await Promise.all(assetChecks)).flat())

  const rigSources = sources.filter(source => source.kind === 'rig-base')
  const partSources = sources.filter(source => source.kind === 'generated-slot-layer')
  const summary = {
    rigCandidatesEvaluated: rigSources.reduce((count, source) => count + (source.candidateEvaluations?.length ?? 0), 0),
    rigCandidatesPassed: rigSources.flatMap(source => source.candidateEvaluations ?? []).filter(candidate => candidate.machineApproved).length,
    partCandidatesEvaluated: partSources.reduce((count, source) => count + (source.candidateEvaluations?.length ?? 0), 0),
    partCandidatesPassed: partSources.flatMap(source => source.candidateEvaluations ?? []).filter(candidate => candidate.machineApproved).length,
    approvedRigSelectionsPassing: rigSources.filter(source => source.candidateEvaluations?.some(candidate => candidate.selected && candidate.machineApproved)).length,
    approvedPartSelectionsPassing: partSources.filter(source => source.candidateEvaluations?.some(candidate => candidate.selected && candidate.machineApproved)).length,
  }
  for (const [field, expected] of Object.entries(summary)) {
    if (sourceIndex.qualityGateSummary?.[field] !== expected) diagnostics.push(error('PRODUCTION_GATE_SUMMARY_MISMATCH', ['qualityGateSummary', field], `Recorded ${field} does not equal audited value ${expected}.`))
  }
  return diagnostics
}
