import { readFile, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import { isAttachmentPartComposition, type Catalog, type Diagnostic } from '@qmonster/generator-core'
import {
  PRODUCTION_CHROMA_GATE_PROFILE,
  PRODUCTION_CHROMA_GATE_VERSION,
  evaluateChromaQuality,
  type ChromaQualityMetrics,
} from './chroma-quality-gate.js'
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
    if (catalog.version === '0.2.0') {
      if (part.composition === undefined) {
        diagnostics.push(error('PRODUCTION_COMPOSITION_METADATA_MISSING', ['parts', String(index), 'composition'], `Part ${part.id} needs composition metadata in a 0.2.0 production catalog.`))
      } else if (isAttachmentPartComposition(part.composition)) {
        for (const [nodeIndex, node] of part.composition.renderNodes.entries()) {
          if (!nonemptyText(node.assetPath) || !nonemptyText(node.assetSha256) || !nonemptyText(node.pngPath) || !nonemptyText(node.pngSha256)) {
            diagnostics.push(error(
              'PRODUCTION_COMPOSITION_NODE_METADATA_MISSING',
              ['parts', String(index), 'composition', 'renderNodes', String(nodeIndex)],
              `Composition node ${node.id} needs PNG/WebP paths and hashes.`,
            ))
          }
        }
      }
    }
    if (catalog.version === '0.3.0' && part.composition?.mode === 'interface') {
      for (const [rigId, variant] of Object.entries(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const [nodeIndex, node] of variant.renderNodes.entries()) {
          if (!nonemptyText(node.assetPath) || !isSha256(node.assetSha256) || !nonemptyText(node.pngPath) || !isSha256(node.pngSha256)) {
            diagnostics.push(error('PRODUCTION_INTERFACE_NODE_METADATA_MISSING', ['parts', String(index), 'composition', 'variantsByRig', rigId, 'renderNodes', String(nodeIndex)], `Interface render node ${node.id} needs PNG/WebP paths and hashes.`))
          }
        }
        for (const [connectorIndex, connector] of variant.connectors.entries()) {
          if (
            !nonemptyText(connector.contourMaskPath) || !isSha256(connector.contourMaskSha256)
            || !nonemptyText(connector.foregroundMaskPath) || !isSha256(connector.foregroundMaskSha256)
            || !nonemptyText(connector.backgroundMaskPath) || !isSha256(connector.backgroundMaskSha256)
          ) diagnostics.push(error('PRODUCTION_INTERFACE_CONNECTOR_METADATA_MISSING', ['parts', String(index), 'composition', 'variantsByRig', rigId, 'connectors', String(connectorIndex)], `Interface connector ${connector.id} needs three PNG paths and hashes.`))
        }
      }
    }
    if (part.slotId === 'colorScheme') {
      for (const rigId of part.compatibleRigs) {
        for (const maskName of ['primary', 'secondary', 'accent'] as const) {
          if (!nonemptyText(part.rigMaskPaths?.[rigId]?.[maskName])) {
            diagnostics.push(error(
              'PRODUCTION_COLOR_MASKS_MISSING',
              ['parts', String(index), 'rigMaskPaths', rigId, maskName],
              `Color scheme ${part.id} needs an authored ${maskName} mask for compatible rig ${rigId}.`,
            ))
          }
          if (!nonemptyText(part.rigMaskSha256?.[rigId]?.[maskName])) {
            diagnostics.push(error(
              'PRODUCTION_COLOR_MASKS_MISSING',
              ['parts', String(index), 'rigMaskSha256', rigId, maskName],
              `Color scheme ${part.id} needs a hashed ${maskName} mask for compatible rig ${rigId}.`,
            ))
          }
        }
      }
    }
  }

  if (catalog.version === '0.3.0') {
    for (const [index, bridge] of (catalog.transitionBridges ?? []).entries()) {
      if (
        !nonemptyText(bridge.neutralAssetPath) || !isSha256(bridge.neutralAssetSha256)
        || !nonemptyText(bridge.neutralPngPath) || !isSha256(bridge.neutralPngSha256)
        || !nonemptyText(bridge.frontMaskPath) || !isSha256(bridge.frontMaskSha256)
        || !nonemptyText(bridge.backMaskPath) || !isSha256(bridge.backMaskSha256)
      ) diagnostics.push(error('PRODUCTION_INTERFACE_BRIDGE_METADATA_MISSING', ['transitionBridges', String(index)], `Interface bridge ${bridge.id} needs PNG/WebP and front/back mask paths with hashes.`))
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
    for (const node of (isAttachmentPartComposition(part.composition)
      ? part.composition.renderNodes
      : [])) {
      expected.add(node.assetPath.replaceAll('\\', '/'))
      if (node.pngPath !== undefined) expected.add(node.pngPath.replaceAll('\\', '/'))
    }
    for (const masks of Object.values(part.rigMaskPaths ?? {})) {
      if (masks === undefined) continue
      expected.add(masks.primary.replaceAll('\\', '/'))
      expected.add(masks.secondary.replaceAll('\\', '/'))
      expected.add(masks.accent.replaceAll('\\', '/'))
    }
  }
  for (const rig of catalog.rigs) {
    if (rig.sourceId === undefined) continue
    expected.add(`rigs/${rig.sourceId}.png`)
    expected.add(`rigs/${rig.sourceId}.webp`)
  }
  if (catalog.version === '0.3.0') {
    for (const part of catalog.parts) {
      if (part.composition?.mode !== 'interface') continue
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const connector of variant.connectors) {
          expected.add(connector.contourMaskPath.replaceAll('\\', '/'))
          expected.add(connector.foregroundMaskPath.replaceAll('\\', '/'))
          expected.add(connector.backgroundMaskPath.replaceAll('\\', '/'))
        }
      }
    }
    for (const bridge of catalog.transitionBridges ?? []) {
      expected.add(bridge.neutralAssetPath.replaceAll('\\', '/'))
      expected.add(bridge.neutralPngPath.replaceAll('\\', '/'))
      expected.add(bridge.frontMaskPath.replaceAll('\\', '/'))
      expected.add(bridge.backMaskPath.replaceAll('\\', '/'))
    }
  }
  const actual = [
    ...(await collectFiles(assetRoot, 'parts')),
    ...(await collectFiles(assetRoot, 'rigs')),
    ...(await collectFiles(assetRoot, 'masks')),
    ...(await collectFiles(assetRoot, 'connectors')),
    ...(await collectFiles(assetRoot, 'bridges')),
  ].filter(path => path.endsWith('.png') || path.endsWith('.webp'))
  return actual
    .filter(path => !expected.has(path))
    .map(path => error('PRODUCTION_RUNTIME_STALE', path.split('/'), `Runtime asset is not referenced by the production catalog: ${path}`))
}

interface SourceCandidateEvaluation {
  gateVersion?: string
  imageSize?: { width?: number; height?: number }
  sourcePath?: string
  processedPath?: string
  index?: number
  selected?: boolean
  machineApproved?: boolean
  reviewDecision?: string
  diagnostics?: unknown
  metrics?: unknown
  thresholds?: unknown
  sourceSha256?: string
  processedSha256?: string
  composition?: CompositeAudit | null
}

interface CompositeAudit {
  index?: number
  compositionVersion?: string
  outputPath?: string
  outputSha256?: string
  outputSize?: { width?: number; height?: number }
  outputBounds?: { left?: number; top?: number; width?: number; height?: number }
  attachment?: { x?: number, y?: number }
  lurePlacement?: { left?: number, top?: number, width?: number, height?: number, scale?: number, anchor?: string }
  zOrder?: unknown
  componentProvenance?: Record<string, Record<string, unknown> | undefined>
}

interface ExtractionAudit {
  gateVersion?: string
  imageSize?: { width?: number; height?: number }
  sourcePath?: string
  processedPath?: string
  approved?: boolean
  diagnostics?: unknown
  metrics?: unknown
  thresholds?: unknown
  sourceSha256?: string
  processedSha256?: string
}

interface ProductionSourceRecord {
  sourceId?: string
  kind?: string
  postProcess?: string
  prompt?: string
  promptId?: string
  promptPath?: string
  promptSha256?: string
  sheetPath?: string | null
  sheetSha256?: string | null
  masterPath?: string
  masterSha256?: string
  runtimePngPath?: string
  runtimePngSha256?: string
  runtimeWebpPath?: string
  runtimeWebpSha256?: string
  candidateEvaluations?: SourceCandidateEvaluation[]
  selectedExtraction?: ExtractionAudit | null
  composition?: CompositeAudit | null
  componentEvaluations?: unknown
  reworkRecordPath?: string
  reworkRecordSha256?: string
  sourcePngPath?: string
  sourcePngSha256?: string
  reviewRecordPath?: string
  reviewRecordSha256?: string
  runtimeResources?: Array<{ path?: string; sha256?: string }>
  sourceResources?: Array<{ path?: string; sha256?: string }>
}

export interface ProductionSourceIndex {
  catalogVersion?: string
  extractionGate?: { gateVersion?: string; profile?: unknown }
  sources?: ProductionSourceRecord[]
  qualityGateSummary?: Record<string, unknown>
  review?: unknown
}

function interfaceSourceEnvelope(
  source: ProductionSourceRecord | undefined,
  expectedKind: 'interface-structural' | 'interface-bridge',
  path: string[],
  diagnostics: Diagnostic[],
): void {
  if (source === undefined) {
    diagnostics.push(error('PRODUCTION_INTERFACE_SOURCE_MISSING', path, 'Missing interface source provenance record.'))
    return
  }
  if (
    source.kind !== expectedKind
    || !Array.isArray(source.sourceResources)
    || source.sourceResources.length === 0
    || source.sourceResources.some(resource => !nonemptyText(resource.path) || !isSha256(resource.sha256))
    || !nonemptyText(source.promptPath)
    || !isSha256(source.promptSha256)
    || !nonemptyText(source.promptId)
  ) diagnostics.push(error('PRODUCTION_INTERFACE_SOURCE_INVALID', path, 'Interface source needs source PNG and exact prompt provenance with SHA-256 hashes.'))
  if (
    source.reviewRecordPath !== 'packages/asset-catalog/review/v0.3.0/review-record.json'
    || !isSha256(source.reviewRecordSha256)
  ) diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_MISSING', path.concat('reviewRecordPath'), 'Interface source needs the canonical hashed v0.3 review record.'))
}

function checkInterfaceRuntimeResources(
  source: ProductionSourceRecord | undefined,
  expected: Array<{ path: string; sha256: string | undefined }>,
  path: string[],
  diagnostics: Diagnostic[],
): void {
  if (source === undefined) return
  const actual = Array.isArray(source.runtimeResources) ? source.runtimeResources : []
  const actualByPath = new Map(actual.flatMap(item => typeof item.path === 'string' ? [[item.path, item.sha256] as const] : []))
  const expectedPaths = new Set(expected.map(item => item.path))
  if (
    actual.length !== expected.length
    || expected.some(item => !isSha256(item.sha256) || actualByPath.get(item.path) !== item.sha256)
    || actual.some(item => typeof item.path !== 'string' || !expectedPaths.has(item.path) || !isSha256(item.sha256))
  ) diagnostics.push(error(
    'PRODUCTION_INTERFACE_RUNTIME_INDEX_MISMATCH',
    path.concat('runtimeResources'),
    `Interface source runtime resource paths and hashes must exactly match catalog metadata; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
  ))
}

async function validateBinaryInterfaceMask(assetRoot: string, assetPath: string, path: string[]): Promise<Diagnostic[]> {
  try {
    const decoded = await decodeCommittedRgba(assetRoot, assetPath)
    let transparent = false
    let opaque = false
    let nonBinary = 0
    for (let index = 3; index < decoded.data.length; index += 4) {
      const alpha = decoded.data[index]!
      if (alpha === 0) transparent = true
      else if (alpha === 255) opaque = true
      else nonBinary += 1
    }
    if (transparent && opaque && nonBinary === 0) return []
    return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Interface mask must contain only transparent and opaque alpha pixels; non-binary pixels: ${nonBinary}.`)]
  } catch (caught) {
    return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Interface mask bytes cannot be independently decoded: ${caught instanceof Error ? caught.message : String(caught)}`)]
  }
}

export async function validateProductionInterfaceResources(
  catalog: Catalog,
  assetRoot: string,
  sourceIndex: ProductionSourceIndex,
): Promise<Diagnostic[]> {
  if (catalog.version !== '0.3.0') return []
  const diagnostics: Diagnostic[] = []
  const canonicalAssetRoot = await realpath(resolve(assetRoot)).catch(() => resolve(assetRoot))
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : []
  const indexed = new Map(sources.flatMap(source => typeof source.sourceId === 'string' ? [[source.sourceId, source] as const] : []))
  const checks: Array<Promise<Diagnostic[]>> = []
  const maskChecks: Array<Promise<Diagnostic[]>> = []
  const reviewed = new Map<string, string>()
  for (const [partIndex, part] of catalog.parts.entries()) {
    if (part.composition?.mode !== 'interface') continue
    const source = indexed.get(part.id)
    interfaceSourceEnvelope(source, 'interface-structural', ['sources', part.id], diagnostics)
    const expectedRuntime = [
      { path: part.assetPath, sha256: part.assetSha256 },
      ...(part.pngPath === undefined ? [] : [{ path: part.pngPath, sha256: part.pngSha256 }]),
      ...Object.values(part.composition.variantsByRig).flatMap(variant => variant === undefined ? [] : [
        ...variant.renderNodes.flatMap(node => [
          { path: node.assetPath, sha256: node.assetSha256 },
          ...(node.pngPath === undefined ? [] : [{ path: node.pngPath, sha256: node.pngSha256 }]),
        ]),
        ...variant.connectors.flatMap(connector => [
          { path: connector.contourMaskPath, sha256: connector.contourMaskSha256 },
          { path: connector.foregroundMaskPath, sha256: connector.foregroundMaskSha256 },
          { path: connector.backgroundMaskPath, sha256: connector.backgroundMaskSha256 },
        ]),
      ]),
    ]
    const uniqueRuntime = [...new Map(expectedRuntime.map(item => [item.path, item])).values()]
    checkInterfaceRuntimeResources(source, uniqueRuntime, ['sources', part.id], diagnostics)
    if (source?.reviewRecordPath !== undefined && source.reviewRecordSha256 !== undefined) reviewed.set(source.reviewRecordPath, source.reviewRecordSha256)
    for (const [rigId, variant] of Object.entries(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      for (const [connectorIndex, connector] of variant.connectors.entries()) {
        const base = ['parts', String(partIndex), 'composition', 'variantsByRig', rigId, 'connectors', String(connectorIndex)]
        checks.push(validateAssetFile(canonicalAssetRoot, connector.contourMaskPath, connector.contourMaskSha256, base.concat('contourMaskPath')))
        checks.push(validateAssetFile(canonicalAssetRoot, connector.foregroundMaskPath, connector.foregroundMaskSha256, base.concat('foregroundMaskPath')))
        checks.push(validateAssetFile(canonicalAssetRoot, connector.backgroundMaskPath, connector.backgroundMaskSha256, base.concat('backgroundMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, connector.contourMaskPath, base.concat('contourMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, connector.foregroundMaskPath, base.concat('foregroundMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, connector.backgroundMaskPath, base.concat('backgroundMaskPath')))
      }
    }
  }
  for (const [bridgeIndex, bridge] of (catalog.transitionBridges ?? []).entries()) {
    const source = indexed.get(bridge.id)
    interfaceSourceEnvelope(source, 'interface-bridge', ['sources', bridge.id], diagnostics)
    checkInterfaceRuntimeResources(source, [
      { path: bridge.neutralAssetPath, sha256: bridge.neutralAssetSha256 },
      { path: bridge.neutralPngPath, sha256: bridge.neutralPngSha256 },
      { path: bridge.frontMaskPath, sha256: bridge.frontMaskSha256 },
      { path: bridge.backMaskPath, sha256: bridge.backMaskSha256 },
    ], ['sources', bridge.id], diagnostics)
    if (source?.reviewRecordPath !== undefined && source.reviewRecordSha256 !== undefined) reviewed.set(source.reviewRecordPath, source.reviewRecordSha256)
    const base = ['transitionBridges', String(bridgeIndex)]
    checks.push(validateAssetFile(canonicalAssetRoot, bridge.neutralAssetPath, bridge.neutralAssetSha256, base.concat('neutralAssetPath')))
    checks.push(validateAssetFile(canonicalAssetRoot, bridge.neutralPngPath, bridge.neutralPngSha256, base.concat('neutralPngPath')))
    checks.push(validateAssetFile(canonicalAssetRoot, bridge.frontMaskPath, bridge.frontMaskSha256, base.concat('frontMaskPath')))
    checks.push(validateAssetFile(canonicalAssetRoot, bridge.backMaskPath, bridge.backMaskSha256, base.concat('backMaskPath')))
    maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, bridge.frontMaskPath, base.concat('frontMaskPath')))
    maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, bridge.backMaskPath, base.concat('backMaskPath')))
  }
  diagnostics.push(...(await Promise.all(checks)).flat())
  diagnostics.push(...(await Promise.all(maskChecks)).flat())
  for (const [portablePath, expectedHash] of reviewed) {
    const reviewPath = resolve(assetRoot, '..', '..', 'review', 'v0.3.0', 'review-record.json')
    try {
      const bytes = await readFile(reviewPath)
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      if (actualHash !== expectedHash) diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_HASH_MISMATCH', [portablePath], 'Interface review record hash differs from committed bytes.'))
    } catch {
      diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_MISSING', [portablePath], 'Cannot read the canonical v0.3 review record.'))
    }
  }
  return diagnostics
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

function runtimePathMatches(recorded: unknown, expected: string, version: string): boolean {
  if (typeof recorded !== 'string') return false
  const normalized = recorded.replaceAll('\\', '/')
  return normalized === expected || normalized.endsWith(`/assets/v${version}/${expected}`)
}

async function decodeCommittedRgba(assetRoot: string, assetPath: string): Promise<{
  data: Buffer
  width: number
  height: number
  sha256: string
}> {
  const root = resolve(assetRoot)
  const path = resolve(root, assetPath)
  const remainder = relative(root, path)
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Committed palette asset escaped root: ${assetPath}`)
  const source = await readFile(path)
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error(`Committed palette asset did not decode to RGBA: ${assetPath}`)
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    sha256: createHash('sha256').update(source).digest('hex'),
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function checkExtractionGateEvidence(
  evidence: SourceCandidateEvaluation & ExtractionAudit,
  path: string[],
  diagnostics: Diagnostic[],
  invalidCode: 'PRODUCTION_CANDIDATE_AUDIT_INVALID' | 'PRODUCTION_COMPOSITE_PROVENANCE_INVALID',
  approvalField: 'machineApproved' | 'approved',
): { approved: boolean } {
  let malformed = false
  const invalid = (field: string, message: string): void => {
    malformed = true
    diagnostics.push(error(invalidCode, path.concat(field), message))
  }
  if (evidence.gateVersion !== PRODUCTION_CHROMA_GATE_VERSION) invalid('gateVersion', `Extraction must use ${PRODUCTION_CHROMA_GATE_VERSION}.`)
  const width = evidence.imageSize?.width
  const height = evidence.imageSize?.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width ?? 0) <= 0 || (height ?? 0) <= 0) invalid('imageSize', 'Extraction needs positive integer source dimensions.')
  if (!nonemptyText(evidence.sourcePath)) invalid('sourcePath', 'Extraction needs a repository-relative source path.')
  if (!nonemptyText(evidence.processedPath)) invalid('processedPath', 'Extraction needs a repository-relative processed path.')
  if (!isSha256(evidence.sourceSha256)) invalid('sourceSha256', 'Extraction source SHA-256 is invalid.')
  if (!isSha256(evidence.processedSha256)) invalid('processedSha256', 'Extraction processed SHA-256 is invalid.')
  if (evidence.metrics === null || typeof evidence.metrics !== 'object') invalid('metrics', 'Extraction needs complete chroma metrics.')
  if (!Array.isArray(evidence.diagnostics)) invalid('diagnostics', 'Extraction needs a diagnostics array.')
  if (evidence.thresholds === null || typeof evidence.thresholds !== 'object') invalid('thresholds', 'Extraction needs evaluated thresholds.')
  const recordedApproved = evidence[approvalField]
  if (typeof recordedApproved !== 'boolean') invalid(approvalField, `Extraction needs boolean ${approvalField}.`)

  const recomputed = evaluateChromaQuality({
    gateVersion: evidence.gateVersion ?? '',
    profile: PRODUCTION_CHROMA_GATE_PROFILE,
    imageSize: { width: width ?? 0, height: height ?? 0 },
    metrics: (evidence.metrics ?? {}) as ChromaQualityMetrics,
  })
  if (!isDeepStrictEqual(evidence.thresholds, recomputed.thresholds)) {
    invalid('thresholds', 'Extraction thresholds must exactly equal the immutable gate derivation.')
  }
  if (
    malformed
    || recordedApproved !== recomputed.approved
    || !isDeepStrictEqual(evidence.diagnostics, recomputed.diagnostics)
  ) {
    diagnostics.push(error(
      'PRODUCTION_CANDIDATE_GATE_MISMATCH',
      path,
      'Recorded extraction approval, diagnostics, and thresholds must exactly match the immutable gate recomputation.',
    ))
  }
  return { approved: recomputed.approved }
}

function checkSourceAuditEnvelope(source: ProductionSourceRecord, path: string[], diagnostics: Diagnostic[]): void {
  const isChromaSource = source.kind === 'generated-slot-layer' || source.kind === 'rig-base'
  if (isChromaSource) {
    if (!nonemptyText(source.prompt)) {
      diagnostics.push(error('PRODUCTION_SOURCE_AUDIT_INVALID', path.concat('prompt'), 'Chroma source needs its exact generation prompt.'))
    }
    if (!isSha256(source.promptSha256) || (typeof source.prompt === 'string' && source.promptSha256 !== sha256Text(source.prompt))) {
      diagnostics.push(error('PRODUCTION_SOURCE_AUDIT_INVALID', path.concat('promptSha256'), 'Prompt SHA-256 must be valid and match the recorded prompt.'))
    }
    for (const [field, value] of [
      ['sheetPath', source.sheetPath],
      ['masterPath', source.masterPath],
    ] as const) {
      if (!nonemptyText(value)) diagnostics.push(error('PRODUCTION_SOURCE_AUDIT_INVALID', path.concat(field), `Chroma source needs ${field}.`))
    }
    for (const [field, value] of [
      ['sheetSha256', source.sheetSha256],
      ['masterSha256', source.masterSha256],
    ] as const) {
      if (!isSha256(value)) diagnostics.push(error('PRODUCTION_SOURCE_AUDIT_INVALID', path.concat(field), `Chroma source needs a valid ${field}.`))
    }
  }
  for (const [field, value] of [
    ['runtimePngSha256', source.runtimePngSha256],
    ['runtimeWebpSha256', source.runtimeWebpSha256],
  ] as const) {
    if (!isSha256(value)) diagnostics.push(error('PRODUCTION_SOURCE_AUDIT_INVALID', path.concat(field), `Source needs a valid ${field}.`))
  }
}

function checkSourceSelection(source: ProductionSourceRecord, path: string[], diagnostics: Diagnostic[]): void {
  const evaluations = source.candidateEvaluations
  if (!Array.isArray(evaluations) || evaluations.length !== 4) {
    diagnostics.push(error('PRODUCTION_CANDIDATE_AUDIT_INVALID', path.concat('candidateEvaluations'), 'Source audit must contain exactly four candidate evaluations.'))
    return
  }
  const recomputed = source.kind === 'explicit-none-layer'
    ? evaluations.map(candidate => ({ approved: candidate.machineApproved === true }))
    : evaluations.map((candidate, index) => {
      const candidatePath = path.concat('candidateEvaluations', String(index))
      if (!Number.isInteger(candidate.index) || candidate.index !== index + 1 || typeof candidate.selected !== 'boolean' || !nonemptyText(candidate.reviewDecision)) {
        diagnostics.push(error('PRODUCTION_CANDIDATE_AUDIT_INVALID', candidatePath, 'Candidate needs deterministic index, selection, machine decision, and review decision.'))
      }
      return checkExtractionGateEvidence(candidate, candidatePath, diagnostics, 'PRODUCTION_CANDIDATE_AUDIT_INVALID', 'machineApproved')
    })
  const selected = evaluations.filter(candidate => candidate.selected)
  const selectedIndex = evaluations.findIndex(candidate => candidate.selected)
  const extractionPassed = source.kind === 'explicit-none-layer' || (selectedIndex >= 0 && recomputed[selectedIndex]?.approved === true)
  if (selected.length !== 1 || selected[0]?.machineApproved !== true || !extractionPassed) {
    diagnostics.push(error('PRODUCTION_SELECTION_GATE_FAILED', path, `Selected source candidate ${source.sourceId ?? '<unknown>'} is not machine-approved.`))
  }
  if (source.kind !== 'explicit-none-layer' && selected.length === 1) {
    const selectedCandidate = selected[0]!
    const expected = {
      gateVersion: selectedCandidate.gateVersion,
      imageSize: selectedCandidate.imageSize,
      sourcePath: selectedCandidate.sourcePath,
      processedPath: selectedCandidate.processedPath,
      approved: selectedCandidate.machineApproved,
      diagnostics: selectedCandidate.diagnostics,
      metrics: selectedCandidate.metrics,
      thresholds: selectedCandidate.thresholds,
      sourceSha256: selectedCandidate.sourceSha256,
      processedSha256: selectedCandidate.processedSha256,
    }
    if (!isDeepStrictEqual(source.selectedExtraction, expected)) {
      diagnostics.push(error('PRODUCTION_SELECTED_EXTRACTION_MISMATCH', path.concat('selectedExtraction'), 'selectedExtraction must exactly equal the selected candidate extraction audit.'))
    }
  }
}

function checkOneCompositeProvenance(
  composition: CompositeAudit | null | undefined,
  compositePath: string[],
  diagnostics: Diagnostic[],
): void {
  if (composition?.compositionVersion !== 'head-shell-lure-composite-v1') {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('compositionVersion'), 'Composite source needs the immutable composition version.'))
  }
  if (!nonemptyText(composition?.outputPath)) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('outputPath'), 'Composite source needs its repository-relative output path.'))
  }
  if (!isSha256(composition?.outputSha256)) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('outputSha256'), 'Composite output SHA-256 is missing or invalid.'))
  }
  const outputSize = composition?.outputSize
  const outputBounds = composition?.outputBounds
  const validOutputSize = Number.isInteger(outputSize?.width) && Number.isInteger(outputSize?.height)
    && (outputSize?.width ?? 0) > 0 && (outputSize?.height ?? 0) > 0
  const validBounds = Number.isInteger(outputBounds?.left) && Number.isInteger(outputBounds?.top)
    && Number.isInteger(outputBounds?.width) && Number.isInteger(outputBounds?.height)
    && (outputBounds?.left ?? -1) >= 0 && (outputBounds?.top ?? -1) >= 0
    && (outputBounds?.width ?? 0) > 0 && (outputBounds?.height ?? 0) > 0
    && (outputBounds?.left ?? 0) + (outputBounds?.width ?? 0) <= (outputSize?.width ?? -1)
    && (outputBounds?.top ?? 0) + (outputBounds?.height ?? 0) <= (outputSize?.height ?? -1)
  if (!validOutputSize) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('outputSize'), 'Composite source needs positive integer output dimensions.'))
  if (!validBounds) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', compositePath.concat('outputBounds'), 'Composite content bounds must be positive and contained by the output.'))
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
    if (typeof component?.prompt === 'string' && component.promptSha256 !== sha256Text(component.prompt)) {
      diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', componentPath.concat('promptSha256'), `Composite ${key} prompt hash does not match the recorded prompt.`))
    }
  }
}

function checkCompositeProvenance(source: ProductionSourceRecord, path: string[], diagnostics: Diagnostic[]): void {
  if (source.postProcess !== 'head-shell-lure-composite-v1') return
  checkOneCompositeProvenance(source.composition, path.concat('composition'), diagnostics)
  const evaluations = source.candidateEvaluations ?? []
  if (evaluations.length !== 4 || evaluations.some(candidate => candidate.composition === null || candidate.composition === undefined)) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', path.concat('candidateEvaluations'), 'Angler source needs four complete candidate compositions.'))
  }
  evaluations.forEach((candidate, index) => {
    checkOneCompositeProvenance(candidate.composition, path.concat('candidateEvaluations', String(index), 'composition'), diagnostics)
    if (candidate.composition?.index !== candidate.index) {
      diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', path.concat('candidateEvaluations', String(index), 'composition', 'index'), 'Composition index must match its candidate evaluation.'))
    }
  })
  const selected = evaluations.find(candidate => candidate.selected)
  if (selected !== undefined && !isDeepStrictEqual(source.composition, selected.composition)) {
    diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', path.concat('composition'), 'Top-level composition must exactly equal the selected candidate composition.'))
  }
  const componentEvaluations = source.componentEvaluations as Record<string, unknown> | null
  for (const role of ['shell', 'lure'] as const) {
    const values = componentEvaluations?.[role]
    const rolePath = path.concat('componentEvaluations', role)
    if (!Array.isArray(values) || values.length !== 4) {
      diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', rolePath, `Angler ${role} needs exactly four extraction evaluations.`))
      continue
    }
    values.forEach((value, index) => {
      const evaluation = value as Record<string, unknown>
      const extraction = evaluation.extraction as Record<string, unknown> | null
      const extractionPath = rolePath.concat(String(index), 'extraction')
      if (evaluation.index !== index + 1 || extraction === null || typeof extraction !== 'object') {
        diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', rolePath.concat(String(index)), `Angler ${role} evaluation index/extraction is invalid.`))
        return
      }
      const metrics = extraction.metrics as Record<string, unknown> | null
      if (
        metrics === null || typeof metrics !== 'object'
        || typeof metrics.detectedKeyHex !== 'string' || !/^#[a-f0-9]{6}$/u.test(metrics.detectedKeyHex)
        || typeof metrics.sampledKeyHex !== 'string' || !/^#[a-f0-9]{6}$/u.test(metrics.sampledKeyHex)
        || [
          'backgroundP95Delta', 'borderContaminationRatio', 'subjectCoverage',
          'subjectBackgroundDistanceP05', 'partialAlphaPixels', 'partialAlphaRatio',
          'edgeFringeP95', 'edgeColorDeltaP95', 'edgeNearestDistanceP95',
          'edgePixelsWithoutOpaqueCore', 'safeBorderAlphaMax', 'safeBorderForegroundPixels',
        ].some(field => !Number.isFinite(metrics[field]))
      ) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('metrics'), `Angler ${role} evaluation needs complete metrics.`))
      if (!Array.isArray(extraction.diagnostics)) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('diagnostics'), `Angler ${role} evaluation needs diagnostics.`))
      const thresholds = extraction.thresholds as Record<string, unknown> | null
      if (
        thresholds === null || typeof thresholds !== 'object'
        || [
          'safeBorderPixels', 'maxBackgroundP95Delta', 'maxBorderContaminationRatio',
          'borderContaminationDelta', 'minOpaquePixels', 'minSubjectBackgroundDistanceP05',
          'maxSafeBorderForegroundPixels', 'maxPartialAlphaRatio', 'minPartialAlphaPixels',
          'maxEdgeFringeP95', 'maxEdgeColorDeltaP95', 'maxEdgeNearestDistanceP95',
          'maxEdgePixelsWithoutOpaqueCore',
        ].some(field => !Number.isFinite(thresholds[field]))
      ) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('thresholds'), `Angler ${role} evaluation needs complete thresholds.`))
      if (!isSha256(extraction.sourceSha256)) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('sourceSha256'), `Angler ${role} source hash is invalid.`))
      if (!isSha256(extraction.processedSha256)) diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('processedSha256'), `Angler ${role} processed hash is invalid.`))
      if (typeof extraction.approved !== 'boolean') diagnostics.push(error('PRODUCTION_COMPOSITE_PROVENANCE_INVALID', extractionPath.concat('approved'), `Angler ${role} approval is missing.`))
      checkExtractionGateEvidence(
        extraction as SourceCandidateEvaluation & ExtractionAudit,
        extractionPath,
        diagnostics,
        'PRODUCTION_COMPOSITE_PROVENANCE_INVALID',
        'approved',
      )
    })
  }
}

async function checkColorMaskAudit(
  source: ProductionSourceRecord,
  part: Catalog['parts'][number],
  catalog: Catalog,
  indexed: ReadonlyMap<string, ProductionSourceRecord>,
  assetRoot: string,
  version: string,
  path: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  if (part.slotId !== 'colorScheme') return
  const audit = (source as ProductionSourceRecord & { paletteMaskAudit?: Record<string, unknown> }).paletteMaskAudit
  if (audit === undefined || audit.version !== 'rig-aware-palette-masks-v1' || audit.sourceId !== part.id) {
    diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', path.concat('paletteMaskAudit'), 'Color scheme needs its rig-aware palette-mask audit.'))
    return
  }
  if (!nonemptyText(audit.sourcePath) || !isSha256(audit.sourceSha256) || audit.sourceSha256 !== source.masterSha256) {
    diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', path.concat('paletteMaskAudit', 'sourceSha256'), 'Palette layout source path/hash must match the approved master.'))
  }
  if (
    !runtimePathMatches(audit.runtimePngPath, part.pngPath ?? '', version)
    || !runtimePathMatches(audit.runtimeWebpPath, part.assetPath, version)
    || audit.runtimePngSha256 !== part.pngSha256
    || audit.runtimeWebpSha256 !== part.assetSha256
  ) {
    diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', path.concat('paletteMaskAudit', 'runtimePngSha256'), 'Palette-mask runtime layer metadata must match the catalog.'))
  }
  const rigMasks = audit.rigMasks as Record<string, Record<string, unknown>> | null
  if (rigMasks === null || typeof rigMasks !== 'object' || Object.keys(rigMasks).sort().join(',') !== [...part.compatibleRigs].sort().join(',')) {
    diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', path.concat('paletteMaskAudit', 'rigMasks'), 'Palette-mask audit rigs must exactly match compatibleRigs.'))
    return
  }
  for (const rigId of part.compatibleRigs) {
    const value = rigMasks[rigId]
    const valuePath = path.concat('paletteMaskAudit', 'rigMasks', rigId)
    if (value === undefined) continue
    const rig = catalog.rigs.find(candidate => candidate.id === rigId)
    const rigSource = rig?.sourceId === undefined ? undefined : indexed.get(rig.sourceId)
    if (!runtimePathMatches(value.rigAssetPath, `rigs/${rig?.sourceId}.png`, version) || value.rigAssetSha256 !== rigSource?.runtimePngSha256) {
      diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', valuePath.concat('rigAssetSha256'), 'Palette mask must identify the compatible rig runtime hash.'))
    }
    const paths = value.paths as Record<string, unknown> | null
    const hashes = value.sha256 as Record<string, unknown> | null
    for (const maskName of ['primary', 'secondary', 'accent'] as const) {
      if (
        paths === null || typeof paths !== 'object'
        || !runtimePathMatches(paths[maskName], part.rigMaskPaths?.[rigId]?.[maskName] ?? '', version)
        || hashes === null || typeof hashes !== 'object'
        || hashes[maskName] !== part.rigMaskSha256?.[rigId]?.[maskName]
      ) {
        diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', valuePath.concat('sha256', maskName), `Palette ${maskName} mask path/hash differs from the catalog.`))
      }
    }
    const metrics = value.metrics as Record<string, unknown> | null
    const core = Number(metrics?.rigOpaqueCorePixels)
    const union = Number(metrics?.maskUnionPixels)
    const primary = Number(metrics?.primaryPixels)
    const secondary = Number(metrics?.secondaryPixels)
    const accent = Number(metrics?.accentPixels)
    if (
      metrics === null || typeof metrics !== 'object'
      || metrics.width !== 1024 || metrics.height !== 1024
      || !Number.isInteger(core) || core <= 0 || union !== core
      || metrics.outsideRigCorePixels !== 0 || metrics.overlappingMaskPixels !== 0
      || ![primary, secondary, accent].every(count => Number.isInteger(count) && count > 0)
      || primary + secondary + accent !== union
    ) {
      diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', valuePath.concat('metrics'), 'Palette masks must exactly partition the opaque rig core with no overlap or overflow.'))
    }
    try {
      const roles = ['primary', 'secondary', 'accent'] as const
      const [decodedRig, ...decodedMasks] = await Promise.all([
        decodeCommittedRgba(assetRoot, `rigs/${rig?.sourceId}.png`),
        ...roles.map(maskName => decodeCommittedRgba(assetRoot, part.rigMaskPaths?.[rigId]?.[maskName] ?? '')),
      ])
      if (decodedRig.sha256 !== value.rigAssetSha256 || decodedRig.sha256 !== rigSource?.runtimePngSha256) {
        diagnostics.push(error('PRODUCTION_COLOR_MASK_PIXELS_MISMATCH', valuePath.concat('rigAssetSha256'), 'Decoded rig hash differs from palette audit and rig source evidence.'))
      }
      let rigOpaqueCorePixels = 0
      let maskUnionPixels = 0
      let outsideRigCorePixels = 0
      let overlappingMaskPixels = 0
      const roleCounts = [0, 0, 0]
      let nonBinaryMaskAlphaPixels = 0
      const pixelCount = decodedRig.width * decodedRig.height
      if (decodedMasks.some(mask => mask.width !== decodedRig.width || mask.height !== decodedRig.height)) {
        throw new Error('Palette masks and compatible rig have different dimensions.')
      }
      decodedMasks.forEach((mask, index) => {
        const maskName = roles[index]!
        if (mask.sha256 !== hashes?.[maskName] || mask.sha256 !== part.rigMaskSha256?.[rigId]?.[maskName]) {
          diagnostics.push(error('PRODUCTION_COLOR_MASK_PIXELS_MISMATCH', valuePath.concat('sha256', maskName), `Decoded ${maskName} hash differs from catalog/audit evidence.`))
        }
      })
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const rigCore = decodedRig.data[pixel * 4 + 3] === 255
        if (rigCore) rigOpaqueCorePixels += 1
        let active = 0
        decodedMasks.forEach((mask, index) => {
          const alpha = mask.data[pixel * 4 + 3]!
          if (alpha !== 0 && alpha !== 255) nonBinaryMaskAlphaPixels += 1
          if (alpha === 0) return
          active += 1
          roleCounts[index] = roleCounts[index]! + 1
        })
        if (active > 0) {
          maskUnionPixels += 1
          if (!rigCore) outsideRigCorePixels += 1
        }
        if (active > 1) overlappingMaskPixels += 1
      }
      const decodedMetrics = {
        width: decodedRig.width,
        height: decodedRig.height,
        rigOpaqueCorePixels,
        maskUnionPixels,
        outsideRigCorePixels,
        overlappingMaskPixels,
        primaryPixels: roleCounts[0]!,
        secondaryPixels: roleCounts[1]!,
        accentPixels: roleCounts[2]!,
      }
      if (nonBinaryMaskAlphaPixels !== 0 || !isDeepStrictEqual(metrics, decodedMetrics)) {
        diagnostics.push(error(
          'PRODUCTION_COLOR_MASK_PIXELS_MISMATCH',
          valuePath.concat('metrics'),
          `Recorded palette arithmetic differs from decoded committed pixels; non-binary alpha pixels: ${nonBinaryMaskAlphaPixels}.`,
        ))
      }
    } catch (caught) {
      diagnostics.push(error(
        'PRODUCTION_COLOR_MASK_PIXELS_MISMATCH',
        valuePath.concat('metrics'),
        `Could not independently decode palette rig/masks: ${caught instanceof Error ? caught.message : String(caught)}`,
      ))
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
  if (sourceIndex.catalogVersion !== catalog.version) {
    diagnostics.push(error('PRODUCTION_EVIDENCE_VERSION_MISMATCH', ['catalogVersion'], `Source-index version must equal catalog version ${catalog.version}.`))
  }
  if (
    sourceIndex.extractionGate?.gateVersion !== PRODUCTION_CHROMA_GATE_VERSION
    || !isDeepStrictEqual(sourceIndex.extractionGate.profile, PRODUCTION_CHROMA_GATE_PROFILE)
  ) {
    diagnostics.push(error(
      'PRODUCTION_CANDIDATE_GATE_MISMATCH',
      ['extractionGate'],
      `Production source-index must use immutable gate ${PRODUCTION_CHROMA_GATE_VERSION} and its fixed profile.`,
    ))
  }
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : []
  const indexed = new Map(sources.flatMap(source => typeof source.sourceId === 'string' ? [[source.sourceId, source] as const] : []))
  const assetChecks: Array<Promise<Diagnostic[]>> = []

  for (const part of catalog.parts) {
    const source = indexed.get(part.id)
    if (source === undefined) {
      diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', part.id], `Missing source-index entry for part ${part.id}.`))
      continue
    }
    const interfaceStructural = catalog.version === '0.3.0'
      && part.composition?.mode === 'interface'
      && source.kind === 'interface-structural'
    if (interfaceStructural) {
      interfaceSourceEnvelope(source, 'interface-structural', ['sources', part.id], diagnostics)
    } else {
      checkSourceAuditEnvelope(source, ['sources', part.id], diagnostics)
      checkSourceSelection(source, ['sources', part.id], diagnostics)
      checkCompositeProvenance(source, ['sources', part.id], diagnostics)
    }
    if (!interfaceStructural && catalog.version === '0.2.0') {
      const expectedReworkPath = 'packages/asset-catalog/review/v0.2.0/rework-record.json'
      if (source.reworkRecordPath !== expectedReworkPath || !isSha256(source.reworkRecordSha256)) {
        diagnostics.push(error('PRODUCTION_REWORK_RECORD_MISSING', ['sources', part.id, 'reworkRecordPath'], `Part ${part.id} needs the hashed 0.2.0 rework-record.json.`))
      } else {
        const reworkRecordPath = resolve(assetRoot, '..', '..', 'review', 'v0.2.0', 'rework-record.json')
        try {
          const reworkRecord = await readFile(reworkRecordPath)
          const actualHash = createHash('sha256').update(reworkRecord).digest('hex')
          if (actualHash !== source.reworkRecordSha256) {
            diagnostics.push(error('PRODUCTION_REWORK_RECORD_HASH_MISMATCH', ['sources', part.id, 'reworkRecordSha256'], `Part ${part.id} rework-record SHA-256 differs from the committed file.`))
          }
        } catch {
          diagnostics.push(error('PRODUCTION_REWORK_RECORD_MISSING', ['sources', part.id, 'reworkRecordPath'], `Part ${part.id} rework-record.json cannot be read from ${reworkRecordPath}.`))
        }
      }
      for (const [nodeIndex, node] of (isAttachmentPartComposition(part.composition)
        ? part.composition.renderNodes
        : []).entries()) {
        if (node.assetSha256 !== undefined) assetChecks.push(validateAssetFile(assetRoot, node.assetPath, node.assetSha256, ['parts', part.id, 'composition', 'renderNodes', String(nodeIndex), 'assetPath'], { dimensions: 'trimmed-node' }))
        if (node.pngPath !== undefined && node.pngSha256 !== undefined) assetChecks.push(validateAssetFile(assetRoot, node.pngPath, node.pngSha256, ['parts', part.id, 'composition', 'renderNodes', String(nodeIndex), 'pngPath'], { dimensions: 'trimmed-node' }))
      }
    }
    if (!interfaceStructural) await checkColorMaskAudit(source, part, catalog, indexed, assetRoot, catalog.version, ['sources', part.id], diagnostics)
    if (!runtimePathMatches(source.runtimeWebpPath, part.assetPath, catalog.version) || source.runtimeWebpSha256 !== part.assetSha256) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', part.id, 'runtimeWebpPath'], `Source-index WebP metadata differs for ${part.id}.`))
    }
    if (part.pngPath === undefined || !runtimePathMatches(source.runtimePngPath, part.pngPath, catalog.version) || source.runtimePngSha256 !== part.pngSha256) {
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
    checkSourceAuditEnvelope(source, ['sources', rig.sourceId], diagnostics)
    checkSourceSelection(source, ['sources', rig.sourceId], diagnostics)
    const pngPath = `rigs/${rig.sourceId}.png`
    const webpPath = `rigs/${rig.sourceId}.webp`
    if (!runtimePathMatches(source.runtimePngPath, pngPath, catalog.version) || !runtimePathMatches(source.runtimeWebpPath, webpPath, catalog.version)) {
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
