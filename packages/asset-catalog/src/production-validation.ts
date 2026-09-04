import { readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import { isAttachmentPartComposition, type Catalog, type Diagnostic, type StructuralVariantDefinition, type TransitionBridgeDefinition } from '@qmonster/generator-core'
import {
  PRODUCTION_CHROMA_GATE_PROFILE,
  PRODUCTION_CHROMA_GATE_VERSION,
  evaluateChromaQuality,
  type ChromaQualityMetrics,
} from './chroma-quality-gate.js'
import { assetPathBelowVersionRoot, validateAssetFile } from './file-validation.js'
import {
  headFaceSocketPolicyIssue,
  interfaceVariantKey,
  parseInterfaceSourceManifest,
  structuralVariants,
  validateInterfaceSourceIndex,
  type InterfaceSourceManifest,
} from './interface-source-schema.js'
import {
  applyV04InterfaceFaceZoneOverlayToManifest,
  deriveV04HeadOcclusionMaskOverride,
  parseV04InterfaceFaceZoneOverlay,
  v04InterfaceFaceZoneOverlayProvenance,
  V04_INTERFACE_FACE_ZONE_OVERLAY_PATH,
  type V04HeadOcclusionMaskDerivation,
  type V04InterfaceFaceZoneOverlay,
} from './v04-interface-face-zone-overlay.js'
import { readTrustedRepositoryFile } from './trusted-repository-file.js'

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

function isInterfaceProductionVersion(version: string): boolean {
  return version === '0.3.0' || version === '0.4.0' || version === '0.5.0' || version === '0.6.0'
}

export function validateProductionHeadFaceSocketContract(
  catalog: Catalog,
  manifest?: InterfaceSourceManifest,
): Diagnostic[] {
  if (!isInterfaceProductionVersion(catalog.version)) return []
  const diagnostics: Diagnostic[] = []
  const runtimeHeads = new Map<string, StructuralVariantDefinition>()
  for (const part of catalog.parts) {
    if (part.slotId !== 'headShape' || part.composition?.mode !== 'interface') continue
    for (const [rigId, variant] of Object.entries(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      runtimeHeads.set(`${part.id}:${rigId}`, variant)
      if (catalog.version === '0.6.0' && variant.faceSafeZones?.length !== 1) diagnostics.push(error(
        'PRODUCTION_INTERFACE_FACE_SAFE_ZONE_COUNT_INVALID',
        ['parts', part.id, rigId, 'faceSafeZones'],
        'Every v0.6 feline head variant requires exactly one face-safe zone.',
      ))
      const issue = headFaceSocketPolicyIssue(variant)
      if (issue !== null) diagnostics.push(error(
        'PRODUCTION_INTERFACE_FACE_SOCKET_INVALID',
        ['parts', part.id, rigId, 'featureSockets'],
        issue,
      ))
    }
  }
  if (manifest === undefined) return diagnostics
  for (const source of structuralVariants(manifest).filter(item => item.slotId === 'headShape')) {
    const issue = headFaceSocketPolicyIssue(source)
    if (issue !== null) diagnostics.push(error(
      'PRODUCTION_INTERFACE_MANIFEST_FACE_SOCKET_INVALID',
      ['manifest', source.partId, source.rigId, 'featureSockets'],
      issue,
    ))
    const runtime = runtimeHeads.get(interfaceVariantKey(source.partId, source.rigId)) as {
      faceSafeZones?: unknown
      featureSockets?: unknown
    } | undefined
    if (
      runtime === undefined
      || !sameJson(runtime.faceSafeZones, source.faceSafeZones)
      || !sameJson(runtime.featureSockets, source.featureSockets)
    ) diagnostics.push(error(
      'PRODUCTION_INTERFACE_MANIFEST_MISMATCH',
      ['parts', source.partId, source.rigId, 'faceSockets'],
      'Catalog face safe zones and feature sockets differ from the canonical interface manifest.',
    ))
  }
  return diagnostics
}

export async function readProductionValidationInput(trustRoot: string, inputPath: string): Promise<Buffer> {
  const lexicalRoot = resolve(trustRoot)
  const lexicalTarget = resolve(inputPath)
  const lexicalRemainder = relative(lexicalRoot, lexicalTarget)
  if (lexicalRemainder === '' || lexicalRemainder.startsWith('..') || isAbsolute(lexicalRemainder)) {
    throw new Error(`Production read escapes trust root: ${inputPath}`)
  }
  return (await readTrustedRepositoryFile(lexicalRoot, lexicalRemainder.replaceAll('\\', '/'))).bytes
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
    const resourceEmptyNone = part.composition?.isNone === true && part.assetPath === ''
    if (
      !nonemptyText(part.displayName)
      || !nonemptyText(part.flavorText)
      || !nonemptyText(part.description)
      || (!resourceEmptyNone && !nonemptyText(part.assetSha256))
      || (!resourceEmptyNone && !nonemptyText(part.pngPath))
      || (!resourceEmptyNone && !nonemptyText(part.pngSha256))
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
    if (isInterfaceProductionVersion(catalog.version) && part.composition?.mode === 'interface') {
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
    if (catalog.version === '0.6.0' && ['surfaceMaterial', 'pattern', 'colorScheme'].includes(part.slotId)) {
      const nodes = isAttachmentPartComposition(part.composition) ? part.composition.renderNodes : []
      for (const [nodeIndex, node] of nodes.entries()) {
        if (node.clipPolicy !== 'body') diagnostics.push(error(
          'PRODUCTION_FELINE_CLIP_POLICY_INVALID',
          ['parts', part.slotId, String(index), 'composition', 'renderNodes', String(nodeIndex), 'clipPolicy'],
          `v0.6 feline ${part.slotId} nodes must use body clipping.`,
        ))
      }
    }
  }

  if (isInterfaceProductionVersion(catalog.version)) {
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
  const expectedModifierCounts = catalog.version === '0.5.0'
    ? { total: 3, mutations: 1, aberrations: 2 }
    : { total: 4, mutations: 2, aberrations: 2 }
  if (
    catalog.modifiers.length !== expectedModifierCounts.total
    || mutationCount !== expectedModifierCounts.mutations
    || aberrationCount !== expectedModifierCounts.aberrations
  ) {
    diagnostics.push(error(
      'PRODUCTION_MODIFIER_COUNT_INVALID',
      ['modifiers'],
      catalog.version === '0.5.0'
        ? 'Production v0.5 requires exactly 1 mutation and 2 aberrations.'
        : 'Production requires exactly 2 mutations and 2 aberrations.',
    ))
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
      actual = JSON.parse((await readProductionValidationInput(catalogDirectory, join(catalogDirectory, file))).toString('utf8'))
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

export async function validateNoStaleRuntimeAssets(
  catalog: Catalog,
  assetRoot: string,
  sourceIndex?: ProductionSourceIndex,
  task6Integrity?: RuntimeIntegrityReview,
): Promise<Diagnostic[]> {
  if (catalog.version === '0.6.0') return []
  const expected = new Set<string>()
  const diagnostics: Diagnostic[] = []
  const runtimePath = (path: string): string => assetPathBelowVersionRoot(path.replaceAll('\\', '/'), catalog.version)
  for (const part of catalog.parts) {
    if (part.assetPath !== '') expected.add(runtimePath(part.assetPath))
    if (part.pngPath !== undefined) expected.add(runtimePath(part.pngPath))
    for (const node of (isAttachmentPartComposition(part.composition)
      ? part.composition.renderNodes
      : [])) {
      expected.add(runtimePath(node.assetPath))
      if (node.pngPath !== undefined) expected.add(runtimePath(node.pngPath))
    }
    for (const masks of Object.values(part.rigMaskPaths ?? {})) {
      if (masks === undefined) continue
      expected.add(runtimePath(masks.primary))
      expected.add(runtimePath(masks.secondary))
      expected.add(runtimePath(masks.accent))
    }
  }
  for (const rig of catalog.rigs) {
    if (rig.sourceId === undefined) continue
    expected.add(`rigs/${rig.sourceId}.png`)
    expected.add(`rigs/${rig.sourceId}.webp`)
  }
  for (const source of sourceIndex?.sources ?? []) {
    for (const resource of source.runtimeResources ?? []) {
      if (typeof resource.path === 'string') expected.add(runtimePath(resource.path))
    }
  }
  if (task6Integrity !== undefined) {
    const versionPrefix = `packages/asset-catalog/assets/v${catalog.version}/`
    if (
      task6Integrity.schemaVersion !== 'task6-approved-input-integrity-v1'
      || task6Integrity.allUnchanged !== true
      || !Array.isArray(task6Integrity.files)
    ) diagnostics.push(error('PRODUCTION_RUNTIME_REVIEW_INVALID', ['task6Integrity'], 'Task 6 runtime integrity review must use the canonical immutable schema and file inventory.'))
    for (const item of task6Integrity.files ?? []) {
      if (typeof item.path !== 'string' || !item.path.startsWith(versionPrefix)) continue
      const relativePath = item.path.slice(versionPrefix.length)
      expected.add(relativePath)
      const diagnosticPath = ['task6Integrity', item.path]
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256) || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|webp)$/u.test(relativePath)) {
        diagnostics.push(error('PRODUCTION_RUNTIME_REVIEW_INVALID', diagnosticPath, 'Task 6 runtime integrity entry needs a canonical path and SHA-256 hash.'))
        continue
      }
      try {
        const actualHash = createHash('sha256').update(
          await readProductionValidationInput(assetRoot, resolve(assetRoot, relativePath)),
        ).digest('hex')
        if (actualHash !== item.sha256) diagnostics.push(error('ASSET_HASH_MISMATCH', diagnosticPath, `Task 6 approved runtime input differs from its hashed review: ${item.path}`))
      } catch {
        diagnostics.push(error('ASSET_FILE_MISSING', diagnosticPath, `Task 6 approved runtime input cannot be read from its canonical path: ${item.path}`))
      }
    }
  }
  if (isInterfaceProductionVersion(catalog.version)) {
    for (const part of catalog.parts) {
      if (part.composition?.mode !== 'interface') continue
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const node of variant.renderNodes) {
          expected.add(runtimePath(node.assetPath))
          if (node.pngPath !== undefined) expected.add(runtimePath(node.pngPath))
        }
        for (const connector of variant.connectors) {
          expected.add(runtimePath(connector.contourMaskPath))
          expected.add(runtimePath(connector.foregroundMaskPath))
          expected.add(runtimePath(connector.backgroundMaskPath))
        }
      }
    }
    for (const bridge of catalog.transitionBridges ?? []) {
      expected.add(runtimePath(bridge.neutralAssetPath))
      expected.add(runtimePath(bridge.neutralPngPath))
      expected.add(runtimePath(bridge.frontMaskPath))
      expected.add(runtimePath(bridge.backMaskPath))
    }
  }
  const actual = (await collectFiles(assetRoot))
    .filter(path => path.endsWith('.png') || path.endsWith('.webp'))
  for (const path of actual) {
    if (expected.has(path)) continue
    if (catalog.version === '0.4.0') {
      try {
        const [retained, baseline] = await Promise.all([
          readProductionValidationInput(assetRoot, resolve(assetRoot, path)),
          readProductionValidationInput(resolve(assetRoot, '..', 'v0.3.0'), resolve(assetRoot, '..', 'v0.3.0', path)),
        ])
        if (retained.equals(baseline)) continue
      } catch {
        // Report the unreferenced file below when no exact immutable v0.3 baseline exists.
      }
    }
    diagnostics.push(error('PRODUCTION_RUNTIME_STALE', path.split('/'), `Runtime asset is not referenced by the production catalog: ${path}`))
  }
  return diagnostics
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
  promptCatalogPath?: string
  promptCatalogSha256?: string
  selectedCandidate?: number
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
  interfaceMetadataOverlay?: unknown
}

export interface ProductionSourceIndex {
  catalogVersion?: string
  extractionGate?: { gateVersion?: string; profile?: unknown }
  sources?: ProductionSourceRecord[]
  qualityGateSummary?: Record<string, unknown>
  review?: unknown
}

export interface RuntimeIntegrityReview {
  schemaVersion?: unknown
  allUnchanged?: unknown
  files?: Array<{ path?: unknown; sha256?: unknown }>
}

const CANONICAL_INTERFACE_REVIEW_PATHS = new Set([
  'packages/asset-catalog/review/v0.3.0/review-record.json',
  'packages/asset-catalog/review/v0.3.0/body-head-review-record.json',
  'packages/asset-catalog/review/v0.3.0/limb-review-record.json',
  'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json',
  'packages/asset-catalog/review/v0.5.0/long-tail-review-record.json',
  'packages/asset-catalog/review/v0.6.0/review-record.json',
])

function parseV06InterfaceSourceManifest(value: unknown): InterfaceSourceManifest | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 'interface-source-v3'
    || record.catalogVersion !== '0.6.0'
    || record.canvasSize !== 2048
    || !sameJson(record.rigIds, ['feline-sit'])
    || !Array.isArray(record.assets)
    || !Array.isArray(record.bridges)
  ) return undefined
  return value as InterfaceSourceManifest
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
    !CANONICAL_INTERFACE_REVIEW_PATHS.has(source.reviewRecordPath ?? '')
    || !isSha256(source.reviewRecordSha256)
  ) diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_MISSING', path.concat('reviewRecordPath'), 'Interface source needs an approved canonical hashed interface review record.'))
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

function validateV04InterfaceFaceZoneOverlayProvenance(
  sourceIndex: ProductionSourceIndex,
  overlay: ReturnType<typeof parseV04InterfaceFaceZoneOverlay>,
  overlaySha256: string,
  diagnostics: Diagnostic[],
): void {
  const expected = v04InterfaceFaceZoneOverlayProvenance(overlay, overlaySha256)
  const targetSourceId = `${overlay.overrides[0]!.partId}:${overlay.overrides[0]!.rigId}`
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : []
  const target = sources.find(source => source.sourceId === targetSourceId)
  if (!sameJson(target?.interfaceMetadataOverlay, expected)) {
    diagnostics.push(error(
      'PRODUCTION_V04_INTERFACE_OVERLAY_INVALID',
      ['sources', targetSourceId, 'interfaceMetadataOverlay'],
      'The v0.4 face-zone override must be explicitly attested by the exact overlay document and canonical v0.3 manifest hashes.',
    ))
  }
  for (const source of sources) {
    if (source.sourceId !== targetSourceId && source.interfaceMetadataOverlay !== undefined) {
      diagnostics.push(error(
        'PRODUCTION_V04_INTERFACE_OVERLAY_INVALID',
        ['sources', source.sourceId ?? 'unknown', 'interfaceMetadataOverlay'],
        'Only head_shadow_hood:floating may carry the explicit v0.4 face-zone override provenance.',
      ))
    }
  }
}

function validateV04InterfaceFaceZoneMaskHashes(
  catalog: Catalog,
  overlay: ReturnType<typeof parseV04InterfaceFaceZoneOverlay>,
  maskHashes: { foregroundMaskSha256: string, backgroundMaskSha256: string },
  diagnostics: Diagnostic[],
): void {
  const target = overlay.overrides[0]!
  const part = catalog.parts.find(candidate => candidate.id === target.partId)
  const variant = part?.composition?.mode === 'interface'
    ? part.composition.variantsByRig[target.rigId]
    : undefined
  const connector = variant?.connectors.find(candidate => candidate.id === 'neck' && candidate.role === 'plug')
  if (
    connector?.foregroundMaskPath !== overlay.headOcclusionMaskOverride.foreground.targetPath
    || connector.foregroundMaskSha256 !== maskHashes.foregroundMaskSha256
    || connector.backgroundMaskPath !== overlay.headOcclusionMaskOverride.background.targetPath
    || connector.backgroundMaskSha256 !== maskHashes.backgroundMaskSha256
  ) diagnostics.push(error(
    'PRODUCTION_V04_INTERFACE_OVERLAY_INVALID',
    ['parts', target.partId, target.rigId, 'connectors', 'neck'],
    'The explicit v0.4 face-zone override must carry the deterministic foreground/background head-mask hashes derived from its attested v0.3 inputs.',
  ))
}

const V04_RELEASE_REVIEW_SCHEMA = 'qmonster-catalog-release-review-v1'
const V04_REPLACEMENT_PART_IDS = [
  'surface_soft_scales',
  'pattern_gentle_stripes',
  'effect_bioluminescent_orbs',
] as const
const V04_EVIDENCE_MANIFEST_PATH = 'packages/asset-catalog/audit/v0.4.0/evidence-manifest.json'

function reviewRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function validateV04ReleaseReview(
  catalog: Catalog,
  sourceIndex: ProductionSourceIndex,
  review: unknown,
  evidenceManifestSha256: string | undefined,
  overlay: V04InterfaceFaceZoneOverlay,
  maskDerivation: V04HeadOcclusionMaskDerivation,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const invalid = (path: string[], message: string): void => {
    diagnostics.push(error('PRODUCTION_V04_REVIEW_INVALID', ['review', ...path], message))
  }
  const record = reviewRecord(review)
  if (record === undefined) {
    invalid([], 'The canonical v0.4 release review must be a JSON object.')
    return diagnostics
  }
  if (record.schemaVersion !== V04_RELEASE_REVIEW_SCHEMA) invalid(['schemaVersion'], 'Release review schemaVersion is not the approved v0.4 schema.')
  if (record.catalogVersion !== '0.4.0') invalid(['catalogVersion'], 'Release review catalogVersion must be 0.4.0.')
  if (record.basedOnCatalogVersion !== '0.3.0') invalid(['basedOnCatalogVersion'], 'Release review must identify immutable v0.3.0 as its base.')
  if (record.decision !== 'pending_user_review' || record.userApproved !== false) invalid(['decision'], 'Release review decision must remain pending and unapproved.')
  if (!sameJson(record.replacementPartIds, V04_REPLACEMENT_PART_IDS)) invalid(['replacementPartIds'], 'Release review replacement parts differ from the approved v0.4 release set.')

  const replacementHashes = reviewRecord(record.replacementHashes)
  for (const partId of V04_REPLACEMENT_PART_IDS) {
    const part = catalog.parts.find(candidate => candidate.id === partId)
    const expected = part === undefined ? undefined : { pngSha256: part.pngSha256, webpSha256: part.assetSha256 }
    if (!sameJson(replacementHashes?.[partId], expected)) {
      invalid(['replacementHashes', partId], `Release review replacement hashes differ from catalog ${partId}.`)
    }
  }
  if (replacementHashes === undefined || Object.keys(replacementHashes).length !== V04_REPLACEMENT_PART_IDS.length) {
    invalid(['replacementHashes'], 'Release review must contain exactly the approved replacement hash records.')
  }

  const target = overlay.overrides[0]!
  const expectedFaceZone = {
    partId: target.partId,
    rigId: target.rigId,
    baseFaceSafeZones: target.baseFaceSafeZones,
    faceSafeZones: target.faceSafeZones,
  }
  if (!sameJson(record.interfaceFaceZone, expectedFaceZone)) {
    invalid(['interfaceFaceZone'], 'Release review face-zone geometry differs from the exact approved overlay.')
  }
  const expectedMaskHashes = {
    derivation: overlay.headOcclusionMaskOverride.derivation,
    nodeSourcePath: overlay.headOcclusionMaskOverride.node.sourcePath,
    nodeSourceSha256: overlay.headOcclusionMaskOverride.node.sourceSha256,
    foregroundSourcePath: overlay.headOcclusionMaskOverride.foreground.sourcePath,
    foregroundSourceSha256: overlay.headOcclusionMaskOverride.foreground.sourceSha256,
    foregroundMaskPath: overlay.headOcclusionMaskOverride.foreground.targetPath,
    foregroundMaskSha256: maskDerivation.foregroundMaskSha256,
    backgroundSourcePath: overlay.headOcclusionMaskOverride.background.sourcePath,
    backgroundSourceSha256: overlay.headOcclusionMaskOverride.background.sourceSha256,
    backgroundMaskPath: overlay.headOcclusionMaskOverride.background.targetPath,
    backgroundMaskSha256: maskDerivation.backgroundMaskSha256,
  }
  if (!sameJson(record.interfaceMaskHashes, expectedMaskHashes)) {
    invalid(['interfaceMaskHashes'], 'Release review head-mask source or derived output hashes differ from the approved overlay.')
  }
  const source = (sourceIndex.sources ?? []).find(candidate => candidate.sourceId === `${target.partId}:${target.rigId}`)
  if (!sameJson(record.interfaceMetadataOverlay, source?.interfaceMetadataOverlay)) {
    invalid(['interfaceMetadataOverlay'], 'Release review overlay provenance must exactly match the source-index attestation.')
  }
  if (record.evidenceManifestPath !== V04_EVIDENCE_MANIFEST_PATH) {
    invalid(['evidenceManifestPath'], 'Release review must bind the canonical v0.4 evidence manifest path.')
  }
  if (!isSha256(evidenceManifestSha256) || record.evidenceManifestSha256 !== evidenceManifestSha256) {
    invalid(['evidenceManifestSha256'], 'Release review evidence manifest hash differs from the canonical committed bytes.')
  }
  return diagnostics
}

async function validateBinaryInterfaceMask(assetRoot: string, assetPath: string, path: string[], options: { allowUniform?: boolean } = {}): Promise<Diagnostic[]> {
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
    if (nonBinary === 0 && (options.allowUniform === true || (transparent && opaque))) return []
    return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Interface mask must contain only transparent and opaque alpha pixels; non-binary pixels: ${nonBinary}.`)]
  } catch (caught) {
    return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Interface mask bytes cannot be independently decoded: ${caught instanceof Error ? caught.message : String(caught)}`)]
  }
}

export function validateBridgeSplitAlpha(neutral: Uint8Array, front: Uint8Array, back: Uint8Array): string[] {
  if (neutral.length !== front.length || neutral.length !== back.length) return ['dimensions']
  const errors = new Set<string>()
  let splitOpaque = 0
  for (let index = 0; index < neutral.length; index += 1) {
    if ((front[index] !== 0 && front[index] !== 255) || (back[index] !== 0 && back[index] !== 255)) errors.add('non-binary')
    const neutralSupported = neutral[index]! > 0
    const frontOpaque = front[index] === 255
    const backOpaque = back[index] === 255
    if (frontOpaque || backOpaque) splitOpaque += 1
    if ((frontOpaque || backOpaque) && !neutralSupported) errors.add('outside-neutral')
    if (frontOpaque && backOpaque) errors.add('overlap')
    if (neutralSupported !== (frontOpaque || backOpaque)) errors.add('union-mismatch')
  }
  if (splitOpaque === 0) errors.add('empty-pair')
  return [...errors]
}

async function validateBridgeSplitMasks(assetRoot: string, bridge: TransitionBridgeDefinition, version: string, path: string[]): Promise<Diagnostic[]> {
  try {
    const [neutral, front, back] = await Promise.all([
      decodeCommittedRgba(assetRoot, assetPathBelowVersionRoot(bridge.neutralPngPath, version)),
      decodeCommittedRgba(assetRoot, assetPathBelowVersionRoot(bridge.frontMaskPath, version)),
      decodeCommittedRgba(assetRoot, assetPathBelowVersionRoot(bridge.backMaskPath, version)),
    ])
    if (neutral.width !== front.width || neutral.height !== front.height || neutral.width !== back.width || neutral.height !== back.height) {
      return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, 'Task 9 bridge split masks must match neutral bridge dimensions.')]
    }
    const alpha = (data: Uint8Array) => Uint8Array.from({ length: data.length / 4 }, (_, index) => data[index * 4 + 3]!)
    const failures = validateBridgeSplitAlpha(alpha(neutral.data), alpha(front.data), alpha(back.data))
    return failures.length === 0 ? [] : [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Task 9 bridge front/back masks must exactly partition neutral alpha: ${failures.join(',')}.`)]
  } catch (caught) {
    return [error('PRODUCTION_INTERFACE_MASK_PIXELS_INVALID', path, `Task 9 bridge split bytes cannot be independently decoded: ${caught instanceof Error ? caught.message : String(caught)}`)]
  }
}

async function validateHeadOcclusionSplit(
  assetRoot: string,
  nodePath: string,
  foregroundPath: string,
  backgroundPath: string,
  connector: { origin: { x: number, y: number }, outwardNormal: { x: number, y: number }, depth: number },
  faceSafeZones: readonly { x: number, y: number, width: number, height: number }[],
  path: string[],
): Promise<Diagnostic[]> {
  try {
    const decode = async (relativePath: string) => sharp(
      await readProductionValidationInput(assetRoot, resolve(assetRoot, relativePath)),
    )
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const [node, foreground, background] = await Promise.all([
      decode(nodePath), decode(foregroundPath), decode(backgroundPath),
    ])
    if ([foreground, background].some(item => item.info.width !== node.info.width || item.info.height !== node.info.height)) {
      return [error('PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID', path, 'Head occlusion masks must match the render-node dimensions.')]
    }
    let foregroundPixels = 0
    let backgroundPixels = 0
    let overlap = 0
    let uncovered = 0
    let outside = 0
    for (let pixel = 0; pixel < node.info.width * node.info.height; pixel += 1) {
      const supported = node.data[pixel * 4 + 3]! > 0
      const front = foreground.data[pixel * 4 + 3]! > 0
      const back = background.data[pixel * 4 + 3]! > 0
      foregroundPixels += Number(front)
      backgroundPixels += Number(back)
      overlap += Number(front && back)
      uncovered += Number(supported && !front && !back)
      outside += Number(!supported && (front || back))
    }
    let invalidFacePixels = 0
    for (const zone of faceSafeZones) {
      for (let y = zone.y; y < zone.y + zone.height; y += 1) for (let x = zone.x; x < zone.x + zone.width; x += 1) {
        if (x < 0 || y < 0 || x >= node.info.width || y >= node.info.height) continue
        const pixel = y * node.info.width + x
        if (node.data[pixel * 4 + 3]! > 0 && foreground.data[pixel * 4 + 3]! === 0) invalidFacePixels += 1
      }
    }
    const seedX = Math.round(connector.origin.x + connector.outwardNormal.x * connector.depth / 2)
    const seedY = Math.round(connector.origin.y + connector.outwardNormal.y * connector.depth / 2)
    const seed = seedY * node.info.width + seedX
    const invalidSeed = seedX < 0 || seedY < 0 || seedX >= node.info.width || seedY >= node.info.height
      || node.data[seed * 4 + 3]! === 0 || background.data[seed * 4 + 3]! === 0
    if (
      foregroundPixels === 0 || backgroundPixels === 0 || overlap > 0 || uncovered > 0
      || outside > 0 || invalidFacePixels > 0 || invalidSeed
    ) return [error(
      'PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID',
      path,
      `Head foreground/background masks must be nonempty, disjoint, node-alpha-complete subsets with face alpha in foreground and the outward plug seed in background; overlap=${overlap}, uncovered=${uncovered}, outside=${outside}, invalidFace=${invalidFacePixels}, invalidSeed=${invalidSeed}.`,
    )]
    return []
  } catch (caught) {
    return [error('PRODUCTION_INTERFACE_HEAD_OCCLUSION_INVALID', path, `Head occlusion masks cannot be decoded: ${caught instanceof Error ? caught.message : String(caught)}`)]
  }
}

export async function validateProductionInterfaceResources(
  catalog: Catalog,
  assetRoot: string,
  sourceIndex: ProductionSourceIndex,
  options: {
    manifestPath?: string
    v04Review?: unknown
    v04EvidenceManifestSha256?: string
  } = {},
): Promise<Diagnostic[]> {
  if (catalog.version === '0.6.0') return []
  if (!isInterfaceProductionVersion(catalog.version)) return []
  const diagnostics: Diagnostic[] = []
  const bridgeIds = new Set<string>()
  for (const [bridgeIndex, bridge] of (catalog.transitionBridges ?? []).entries()) {
    if (bridgeIds.has(bridge.id)) diagnostics.push(error('PRODUCTION_INTERFACE_BRIDGE_ID_DUPLICATE', ['transitionBridges', String(bridgeIndex), 'id'], `Duplicate transition bridge ID: ${bridge.id}`))
    bridgeIds.add(bridge.id)
  }
  const canonicalAssetRoot = await realpath(resolve(assetRoot)).catch(() => resolve(assetRoot))
  const manifestPath = options.manifestPath ?? resolve(canonicalAssetRoot, '..', '..', '..', '..', 'asset-source', 'v0.3.0', 'interface-manifest.json')
  let manifest: InterfaceSourceManifest | undefined
  let sourceManifest: InterfaceSourceManifest | undefined
  let repositoryRoot: string | undefined
  try {
    repositoryRoot = resolve(canonicalAssetRoot, '..', '..', '..', '..')
    const manifestBytes = await readProductionValidationInput(repositoryRoot, manifestPath)
    const rawManifest = JSON.parse(manifestBytes.toString('utf8')) as unknown
    const parsed = catalog.version === '0.6.0'
      ? (() => {
          const value = parseV06InterfaceSourceManifest(rawManifest)
          return value === undefined
            ? { ok: false as const, diagnostics: [error('PRODUCTION_INTERFACE_MANIFEST_INVALID', ['manifest'], 'Invalid immutable v0.6 feline interface manifest.')] }
            : { ok: true as const, value }
        })()
      : parseInterfaceSourceManifest(rawManifest)
    if (!parsed.ok) diagnostics.push(...parsed.diagnostics.map(item => ({ ...item, code: 'PRODUCTION_INTERFACE_MANIFEST_INVALID' })))
    else {
      sourceManifest = parsed.value
      manifest = parsed.value
      if (catalog.version === '0.4.0') {
        try {
          const overlayBytes = await readProductionValidationInput(
            repositoryRoot,
            resolve(repositoryRoot, V04_INTERFACE_FACE_ZONE_OVERLAY_PATH),
          )
          const overlay = parseV04InterfaceFaceZoneOverlay(
            JSON.parse(overlayBytes.toString('utf8')),
            sourceManifest,
            createHash('sha256').update(manifestBytes).digest('hex'),
          )
          const maskHashes = await deriveV04HeadOcclusionMaskOverride(
            overlay,
            path => readProductionValidationInput(
              repositoryRoot!,
              resolve(repositoryRoot!, 'packages', 'asset-catalog', path),
            ),
          )
          validateV04InterfaceFaceZoneOverlayProvenance(
            sourceIndex,
            overlay,
            createHash('sha256').update(overlayBytes).digest('hex'),
            diagnostics,
          )
          validateV04InterfaceFaceZoneMaskHashes(catalog, overlay, maskHashes, diagnostics)
          if (options.v04Review !== undefined || options.v04EvidenceManifestSha256 !== undefined) {
            diagnostics.push(...validateV04ReleaseReview(
              catalog,
              sourceIndex,
              options.v04Review,
              options.v04EvidenceManifestSha256,
              overlay,
              maskHashes,
            ))
          }
          manifest = applyV04InterfaceFaceZoneOverlayToManifest(sourceManifest, overlay)
        } catch (caught) {
          diagnostics.push(error(
            'PRODUCTION_V04_INTERFACE_OVERLAY_INVALID',
            [V04_INTERFACE_FACE_ZONE_OVERLAY_PATH],
            `Cannot validate the explicit v0.4 face-zone override: ${caught instanceof Error ? caught.message : String(caught)}`,
          ))
        }
      }
      if (catalog.version === '0.4.0') {
        manifest = JSON.parse(JSON.stringify(manifest).replaceAll('assets/v0.3.0/', 'assets/v0.4.0/')) as InterfaceSourceManifest
      }
    }
  } catch {
    diagnostics.push(error('PRODUCTION_INTERFACE_MANIFEST_MISSING', [manifestPath], 'Cannot read the canonical v0.3 interface manifest.'))
  }
  diagnostics.push(...validateProductionHeadFaceSocketContract(catalog, manifest))
  if (manifest !== undefined && sourceManifest !== undefined) {
    try {
      if (catalog.version !== '0.6.0') validateInterfaceSourceIndex(sourceManifest, catalog.version === '0.4.0'
        ? { ...sourceIndex, catalogVersion: sourceManifest.catalogVersion }
        : sourceIndex)
    } catch (caught) {
      diagnostics.push(error('PRODUCTION_INTERFACE_SOURCE_INDEX_INVALID', ['sources'], caught instanceof Error ? caught.message : String(caught)))
    }
    const catalogParts = new Map(catalog.parts.filter(part => part.composition?.mode === 'interface').map(part => [part.id, part]))
    for (const source of structuralVariants(manifest)) {
      const part = catalogParts.get(source.partId)
      const composition = part?.composition
      const variant = composition?.mode === 'interface' ? composition.variantsByRig[source.rigId] : undefined
      if (
        part === undefined || composition?.mode !== 'interface' || variant === undefined
        || variant.rigId !== source.rigId || variant.materialFamily !== source.materialFamily
        || !sameJson(variant.faceSafeZones, source.faceSafeZones)
        || !sameJson(variant.featureSockets, source.featureSockets)
        || variant.renderNodes.length !== source.renderNodes.length
        || source.renderNodes.some(node => {
          const actual = variant.renderNodes.find(candidate => candidate.id === node.id)
          return actual === undefined || actual.connectorId !== node.connectorId
            || !sameJson(actual.transform, node.transform ?? { scale: 1, mirrorX: false })
        })
        || variant.connectors.length !== source.connectors.length
        || source.connectors.some(connector => {
          const actual = variant.connectors.find(candidate => candidate.id === connector.id)
          return actual === undefined
            || actual.rigId !== source.rigId || actual.role !== connector.role || actual.connectorClass !== connector.connectorClass
            || !sameJson(actual.origin, connector.origin) || !sameJson(actual.tangent, connector.tangent)
            || !sameJson(actual.outwardNormal, connector.outwardNormal) || actual.width !== connector.width || actual.depth !== connector.depth
            || actual.contourMaskPath !== connector.contourMaskPath
            || actual.foregroundMaskPath !== connector.foregroundMaskPath
            || actual.backgroundMaskPath !== connector.backgroundMaskPath
            || !sameJson(actual.materialSampleRegion, connector.materialSampleRegion)
            || !sameJson(actual.warpLimits, connector.warpLimits)
        })
      ) diagnostics.push(error('PRODUCTION_INTERFACE_MANIFEST_MISMATCH', ['parts', source.partId, source.rigId], 'Catalog interface variant differs from the canonical manifest inventory, mapping, material, or provenance contract.'))
    }
    if (catalogParts.size !== manifest.assets.length || [...catalogParts.keys()].some(id => !manifest!.assets.some(asset => asset.id === id))) {
      diagnostics.push(error('PRODUCTION_INTERFACE_MANIFEST_MISMATCH', ['parts'], 'Catalog contains missing or extra interface structural records.'))
    }
    const catalogBridges = new Map((catalog.transitionBridges ?? []).map(bridge => [bridge.id, bridge]))
    if (catalogBridges.size !== manifest.bridges.length || manifest.bridges.some(source => {
      const bridge = catalogBridges.get(source.id)
      return bridge === undefined || bridge.neutralPngPath !== source.neutralPngPath || bridge.neutralAssetPath !== source.neutralWebpPath
        || bridge.frontMaskPath !== source.frontMaskPath || bridge.backMaskPath !== source.backMaskPath
        || !sameJson(bridge.materialFamilies, source.materialFamilies)
    })) diagnostics.push(error('PRODUCTION_INTERFACE_MANIFEST_MISMATCH', ['transitionBridges'], 'Catalog bridges differ from the canonical interface manifest.'))
  }
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : []
  const indexed = new Map(sources.flatMap(source => typeof source.sourceId === 'string' ? [[source.sourceId, source] as const] : []))
  const checks: Array<Promise<Diagnostic[]>> = []
  const maskChecks: Array<Promise<Diagnostic[]>> = []
  const reviewed = new Map<string, string>()
  const checkedRuntimePath = (path: string): string => assetPathBelowVersionRoot(path, catalog.version)
  const globalNodeIds = new Set<string>()
  const globalNodePaths = new Set<string>()
  const globalNodeHashes = new Set<string>()
  for (const [partIndex, part] of catalog.parts.entries()) {
    if (part.composition?.mode !== 'interface') continue
    for (const [rigId, variant] of Object.entries(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      const exactSourceId = `${part.id}:${rigId}`
      const source = indexed.get(exactSourceId)
      interfaceSourceEnvelope(source, 'interface-structural', ['sources', exactSourceId], diagnostics)
      const structuralRootPrefix = `assets/v${catalog.version}/structural/${rigId}/`
      const rootResources = (source?.runtimeResources ?? []).flatMap(resource => {
        const path = resource.path
        return typeof path === 'string'
          && path.startsWith(structuralRootPrefix)
          && (path.endsWith(`/${part.id}.webp`) || path.endsWith(`/${part.id}.png`))
          ? [{ ...resource, path }]
          : []
      })
      const rootWebp = rootResources.find(resource => resource.path.endsWith('.webp'))
      const rootPng = rootResources.find(resource => resource.path.endsWith('.png'))
      const expectedRuntime = [
        ...(rootWebp === undefined ? [] : [{ path: rootWebp.path!, sha256: rootWebp.sha256 }]),
        ...(rootPng === undefined ? [] : [{ path: rootPng.path!, sha256: rootPng.sha256 }]),
        ...variant.renderNodes.flatMap(node => [
          { path: node.assetPath, sha256: node.assetSha256 },
          ...(node.pngPath === undefined ? [] : [{ path: node.pngPath, sha256: node.pngSha256 }]),
        ]),
        ...variant.connectors.flatMap(connector => [
          { path: connector.contourMaskPath, sha256: connector.contourMaskSha256 },
          { path: connector.foregroundMaskPath, sha256: connector.foregroundMaskSha256 },
          { path: connector.backgroundMaskPath, sha256: connector.backgroundMaskSha256 },
        ]),
      ]
      const uniqueRuntime = [...new Map(expectedRuntime.map(item => [item.path, item])).values()]
      checkInterfaceRuntimeResources(source, uniqueRuntime, ['sources', exactSourceId], diagnostics)
      for (const rootResource of [rootWebp, rootPng]) {
        if (rootResource?.path !== undefined && typeof rootResource.sha256 === 'string') {
          checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(rootResource.path), rootResource.sha256, ['sources', exactSourceId, 'runtimeResources', rootResource.path]))
        }
      }
      if (source?.reviewRecordPath !== undefined && source.reviewRecordSha256 !== undefined) {
        const existingHash = reviewed.get(source.reviewRecordPath)
        if (existingHash !== undefined && existingHash !== source.reviewRecordSha256) diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_HASH_CONFLICT', ['sources', exactSourceId, 'reviewRecordSha256'], 'Interface sources declare conflicting hashes for the same review record.'))
        reviewed.set(source.reviewRecordPath, source.reviewRecordSha256)
      }
      for (const [nodeIndex, node] of variant.renderNodes.entries()) {
        const base = ['parts', String(partIndex), 'composition', 'variantsByRig', rigId, 'renderNodes', String(nodeIndex)]
        if (globalNodeIds.has(node.id)) diagnostics.push(error('PRODUCTION_INTERFACE_NODE_DUPLICATE', base.concat('id'), `Interface render node ID is duplicated: ${node.id}`))
        globalNodeIds.add(node.id)
        for (const [field, path, hash] of [
          ['assetPath', node.assetPath, node.assetSha256],
          ['pngPath', node.pngPath, node.pngSha256],
        ] as const) {
          if (path === undefined) continue
          if (globalNodePaths.has(path)) diagnostics.push(error('PRODUCTION_INTERFACE_NODE_RESOURCE_DUPLICATE', base.concat(field), `Interface render nodes must use distinct runtime paths: ${path}`))
          globalNodePaths.add(path)
          if (hash !== undefined && globalNodeHashes.has(hash)) diagnostics.push(error('PRODUCTION_INTERFACE_NODE_HASH_DUPLICATE', base.concat(field), 'Interface render node runtime hashes must be distinct.'))
          if (hash !== undefined) globalNodeHashes.add(hash)
          checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(path), hash, base.concat(field), { dimensions: 'trimmed-node' }))
        }
      }
      for (const [connectorIndex, connector] of variant.connectors.entries()) {
        const base = ['parts', String(partIndex), 'composition', 'variantsByRig', rigId, 'connectors', String(connectorIndex)]
        checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(connector.contourMaskPath), connector.contourMaskSha256, base.concat('contourMaskPath')))
        checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(connector.foregroundMaskPath), connector.foregroundMaskSha256, base.concat('foregroundMaskPath')))
        checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(connector.backgroundMaskPath), connector.backgroundMaskSha256, base.concat('backgroundMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, checkedRuntimePath(connector.contourMaskPath), base.concat('contourMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, checkedRuntimePath(connector.foregroundMaskPath), base.concat('foregroundMaskPath')))
        maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, checkedRuntimePath(connector.backgroundMaskPath), base.concat('backgroundMaskPath')))
        const headNode = connector.role === 'plug'
          ? variant.renderNodes.find(node => node.connectorId === connector.id && node.layer === 'head')
          : undefined
        if (headNode?.pngPath !== undefined) maskChecks.push(validateHeadOcclusionSplit(
          canonicalAssetRoot,
          checkedRuntimePath(headNode.pngPath),
          checkedRuntimePath(connector.foregroundMaskPath),
          checkedRuntimePath(connector.backgroundMaskPath),
          connector,
          variant.faceSafeZones ?? [],
          base,
        ))
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
    if (source?.reviewRecordPath !== undefined && source.reviewRecordSha256 !== undefined) {
      const existingHash = reviewed.get(source.reviewRecordPath)
      if (existingHash !== undefined && existingHash !== source.reviewRecordSha256) diagnostics.push(error('PRODUCTION_INTERFACE_REVIEW_HASH_CONFLICT', ['sources', bridge.id, 'reviewRecordSha256'], 'Interface sources declare conflicting hashes for the same review record.'))
      reviewed.set(source.reviewRecordPath, source.reviewRecordSha256)
    }
    const base = ['transitionBridges', String(bridgeIndex)]
    checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(bridge.neutralAssetPath), bridge.neutralAssetSha256, base.concat('neutralAssetPath'), { dimensions: 'transition-bridge' }))
    checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(bridge.neutralPngPath), bridge.neutralPngSha256, base.concat('neutralPngPath'), { dimensions: 'transition-bridge' }))
    checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(bridge.frontMaskPath), bridge.frontMaskSha256, base.concat('frontMaskPath'), { dimensions: 'transition-bridge' }))
    checks.push(validateAssetFile(canonicalAssetRoot, checkedRuntimePath(bridge.backMaskPath), bridge.backMaskSha256, base.concat('backMaskPath'), { dimensions: 'transition-bridge' }))
    if (bridge.connectorClass === 'tail' || bridge.connectorClass === 'extra') {
      maskChecks.push(validateBridgeSplitMasks(canonicalAssetRoot, bridge, catalog.version, base.concat('frontMaskPath', 'backMaskPath')))
    } else {
      maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, checkedRuntimePath(bridge.frontMaskPath), base.concat('frontMaskPath'), { allowUniform: true }))
      maskChecks.push(validateBinaryInterfaceMask(canonicalAssetRoot, checkedRuntimePath(bridge.backMaskPath), base.concat('backMaskPath'), { allowUniform: true }))
    }
  }
  diagnostics.push(...(await Promise.all(checks)).flat())
  diagnostics.push(...(await Promise.all(maskChecks)).flat())
  for (const [portablePath, expectedHash] of reviewed) {
    const reviewPrefix = 'packages/asset-catalog/'
    const reviewPath = CANONICAL_INTERFACE_REVIEW_PATHS.has(portablePath) && portablePath.startsWith(reviewPrefix)
      ? resolve(assetRoot, '..', '..', portablePath.slice(reviewPrefix.length))
      : ''
    try {
      if (reviewPath === '') throw new Error('noncanonical review record')
      const bytes = await readProductionValidationInput(resolve(assetRoot, '..', '..'), reviewPath)
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

function checkV06TransparentSourceEnvelope(
  source: ProductionSourceRecord,
  path: string[],
  diagnostics: Diagnostic[],
): void {
  if (
    source.kind !== 'generated-transparent-layer'
    || !nonemptyText(source.promptId)
    || !['asset-source/v0.6.0/prompts/feline-prompts.json', 'asset-source/v0.6.0/anatomy-bundles/manifest.json'].includes(source.promptCatalogPath)
    || !isSha256(source.promptCatalogSha256)
    || !Number.isInteger(source.selectedCandidate)
    || Number(source.selectedCandidate) < 1
    || !Array.isArray(source.sourceResources)
    || source.sourceResources.length < 1
    || source.sourceResources.some(resource => !nonemptyText(resource.path) || !isSha256(resource.sha256))
  ) diagnostics.push(error(
    'PRODUCTION_FELINE_SOURCE_INVALID',
    path,
    'v0.6 generated layers require immutable prompt-catalog, selected-candidate, source-file, and SHA-256 provenance.',
  ))
}

const V06_VISIBLE_ALPHA_THRESHOLD = 16
const V06_FELINE_MASK_DILATION_PIXELS = 192

function v06RuntimePath(assetPath: string): string {
  const normalized = assetPath.replaceAll('\\', '/')
  const prefix = 'assets/v0.6.0/'
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
}

function expandV06FelineStructuralMask(structuralLayers: Array<{ data: Buffer, width: number, height: number }>): Uint8Array {
  const width = structuralLayers[0]!.width
  const height = structuralLayers[0]!.height
  const pixels = width * height
  const unavailable = 0xffff
  const distance = new Uint16Array(pixels)
  distance.fill(unavailable)
  for (const layer of structuralLayers) {
    if (layer.width !== width || layer.height !== height) throw new Error('Feline structural layers have inconsistent dimensions.')
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      if (layer.data[pixel * 4 + 3]! >= V06_VISIBLE_ALPHA_THRESHOLD) distance[pixel] = 0
    }
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    let value = distance[pixel]!
    for (const candidate of [
      x > 0 ? pixel - 1 : -1,
      y > 0 ? pixel - width : -1,
      x > 0 && y > 0 ? pixel - width - 1 : -1,
      x + 1 < width && y > 0 ? pixel - width + 1 : -1,
    ]) if (candidate >= 0 && distance[candidate]! !== unavailable) value = Math.min(value, distance[candidate]! + 1)
    distance[pixel] = value
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const pixel = y * width + x
    let value = distance[pixel]!
    for (const candidate of [
      x + 1 < width ? pixel + 1 : -1,
      y + 1 < height ? pixel + width : -1,
      x + 1 < width && y + 1 < height ? pixel + width + 1 : -1,
      x > 0 && y + 1 < height ? pixel + width - 1 : -1,
    ]) if (candidate >= 0 && distance[candidate]! !== unavailable) value = Math.min(value, distance[candidate]! + 1)
    distance[pixel] = value
  }
  return Uint8Array.from(distance, value => value <= V06_FELINE_MASK_DILATION_PIXELS ? 1 : 0)
}

async function validateV06FelineMaskContainment(catalog: Catalog, assetRoot: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const structuralPngPaths = catalog.parts.flatMap(part => {
    if (!['bodyFrame', 'headShape', 'tail'].includes(part.slotId) || part.composition?.mode !== 'interface') return []
    return Object.values(part.composition.variantsByRig).flatMap(variant => variant?.renderNodes ?? [])
      .flatMap(node => node.pngPath === undefined ? [] : [v06RuntimePath(node.pngPath)])
  })
  if (structuralPngPaths.length === 0) {
    diagnostics.push(error('PRODUCTION_FELINE_MASK_CONTAINMENT_INVALID', ['parts'], 'v0.6 feline containment requires structural body, head, and tail alpha resources.'))
    return diagnostics
  }
  let mask: Uint8Array
  let width: number
  let height: number
  try {
    const structuralLayers = await Promise.all(structuralPngPaths.map(path => decodeCommittedRgba(assetRoot, path)))
    width = structuralLayers[0]!.width
    height = structuralLayers[0]!.height
    mask = expandV06FelineStructuralMask(structuralLayers)
  } catch (caught) {
    diagnostics.push(error(
      'PRODUCTION_FELINE_MASK_CONTAINMENT_INVALID',
      ['parts'],
      `Could not decode v0.6 feline structural alpha resources: ${caught instanceof Error ? caught.message : String(caught)}`,
    ))
    return diagnostics
  }
  for (const part of catalog.parts) {
    if (!['surfaceMaterial', 'pattern', 'colorScheme'].includes(part.slotId) || part.pngPath === undefined) continue
    try {
      const layer = await decodeCommittedRgba(assetRoot, v06RuntimePath(part.pngPath))
      if (layer.width !== width || layer.height !== height) throw new Error('Appearance layer dimensions differ from the feline structural mask.')
      let outsidePixels = 0
      for (let pixel = 0; pixel < mask.length; pixel += 1) {
        if (layer.data[pixel * 4 + 3]! >= V06_VISIBLE_ALPHA_THRESHOLD && mask[pixel] === 0) outsidePixels += 1
      }
      if (outsidePixels !== 0) diagnostics.push(error(
        'PRODUCTION_FELINE_MASK_CONTAINMENT_INVALID',
        ['parts', part.id, 'pngPath'],
        `v0.6 feline ${part.slotId} has ${outsidePixels} visible pixels outside the expanded structural alpha mask.`,
      ))
    } catch (caught) {
      diagnostics.push(error(
        'PRODUCTION_FELINE_MASK_CONTAINMENT_INVALID',
        ['parts', part.id, 'pngPath'],
        `Could not decode v0.6 feline ${part.slotId} alpha resource: ${caught instanceof Error ? caught.message : String(caught)}`,
      ))
    }
  }
  return diagnostics
}

function v06ConnectedComponents(data: Buffer, width: number, height: number): number {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let components = 0
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] !== 0 || data[start * 4 + 3]! < V06_VISIBLE_ALPHA_THRESHOLD) continue
    let head = 0; let tail = 1
    queue[0] = start; visited[start] = 1
    while (head < tail) {
      const pixel = queue[head++]!; const x = pixel % width; const y = Math.floor(pixel / width)
      const visit = (candidate: number): void => {
        if (visited[candidate] !== 0 || data[candidate * 4 + 3]! < V06_VISIBLE_ALPHA_THRESHOLD) return
        visited[candidate] = 1; queue[tail++] = candidate
      }
      if (x > 0) visit(pixel - 1)
      if (x + 1 < width) visit(pixel + 1)
      if (y > 0) visit(pixel - width)
      if (y + 1 < height) visit(pixel + width)
    }
    components += 1
  }
  return components
}

async function validateV06AnatomyBundles(catalog: Catalog, assetRoot: string): Promise<Diagnostic[]> {
  if (catalog.version !== '0.6.0') return []
  const diagnostics: Diagnostic[] = []
  for (const [index, bundle] of (catalog.anatomyBundles ?? []).entries()) try {
    const decodeResource = async (resource: { assetPath: string, assetSha256: string, pngPath: string, pngSha256: string }) => {
      if (!isSha256(resource.assetSha256) || !isSha256(resource.pngSha256)) throw new Error('resource hashes must be SHA-256')
      const [png, webp] = await Promise.all([
        decodeCommittedRgba(assetRoot, v06RuntimePath(resource.pngPath)),
        decodeCommittedRgba(assetRoot, v06RuntimePath(resource.assetPath)),
      ])
      if (png.sha256 !== resource.pngSha256 || webp.sha256 !== resource.assetSha256) throw new Error('PNG/WebP resource hashes must bind their committed bytes')
      return png
    }
    const [structural, alpha, clip] = await Promise.all([
      decodeResource(bundle.structural),
      decodeResource(bundle.alpha),
      decodeResource(bundle.clip),
    ])
    if ([structural, alpha, clip].some(image => image.width !== 2048 || image.height !== 2048)) throw new Error('resources must be 2048×2048')
    if (v06ConnectedComponents(structural.data, structural.width, structural.height) !== 1) throw new Error('single connected structure alpha required')
    for (let pixel = 0; pixel < structural.width * structural.height; pixel += 1) {
      if (alpha.data[pixel * 4 + 3] !== structural.data[pixel * 4 + 3] || (clip.data[pixel * 4 + 3]! > 0 && structural.data[pixel * 4 + 3] === 0)) throw new Error('alpha/clip must derive from the complete source alpha')
    }
    const rectangles = [bundle.faceSafeZone, ...Object.values(bundle.mutationAnchors)]
    if (rectangles.some(rectangle => rectangle.x < 0 || rectangle.y < 0 || rectangle.width <= 0 || rectangle.height <= 0 || rectangle.x + rectangle.width > 2048 || rectangle.y + rectangle.height > 2048)) throw new Error('face/anchor rectangle outside canvas')
  } catch (caught) {
    diagnostics.push(error('PRODUCTION_ANATOMY_BUNDLE_INVALID', ['anatomyBundles', String(index)], caught instanceof Error ? caught.message : String(caught)))
  }
  return diagnostics
}

async function decodeCommittedRgba(assetRoot: string, assetPath: string): Promise<{
  data: Buffer
  width: number
  height: number
  sha256: string
}> {
  const root = resolve(assetRoot)
  const source = await readProductionValidationInput(root, resolve(root, assetPath))
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error(`Committed palette asset did not decode to RGBA: ${assetPath}`)
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    sha256: createHash('sha256').update(source).digest('hex'),
  }
}

async function decodeRepositoryRgba(assetRoot: string, repositoryPath: string): Promise<{
  data: Buffer
  width: number
  height: number
  sha256: string
}> {
  const normalized = repositoryPath.replaceAll('\\', '/')
  if (!normalized.startsWith('asset-source/v0.3.0/')) throw new Error(`Unexpected v0.3 palette evidence path: ${repositoryPath}`)
  const repositoryRoot = resolve(assetRoot, '..', '..', '..', '..')
  const source = await readProductionValidationInput(repositoryRoot, resolve(repositoryRoot, normalized))
  const decoded = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (decoded.info.channels !== 4) throw new Error(`Committed palette evidence did not decode to RGBA: ${repositoryPath}`)
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
  const usesStructuralUnionAlpha = isInterfaceProductionVersion(version)
  if (usesStructuralUnionAlpha && audit.maskBasis !== 'v0.3-structural-union-alpha-v1') {
    diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', path.concat('paletteMaskAudit', 'maskBasis'), 'v0.3 color masks must declare structural-union alpha as their coordinate basis.'))
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
    const structuralUnionPath = `asset-source/v0.3.0/retained-v0.2/structural-union-alpha/${rigId}.png`
    const validRigEvidence = usesStructuralUnionAlpha
      ? value.rigAssetPath === structuralUnionPath && isSha256(value.rigAssetSha256)
      : runtimePathMatches(value.rigAssetPath, `rigs/${rig?.sourceId}.png`, version) && value.rigAssetSha256 === rigSource?.runtimePngSha256
    if (!validRigEvidence) {
      diagnostics.push(error('PRODUCTION_COLOR_MASK_AUDIT_INVALID', valuePath.concat('rigAssetSha256'), usesStructuralUnionAlpha
        ? 'v0.3 palette mask must identify the committed rig structural-union alpha evidence.'
        : 'Palette mask must identify the compatible rig runtime hash.'))
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
      || metrics.width !== (usesStructuralUnionAlpha ? 2048 : 1024) || metrics.height !== (usesStructuralUnionAlpha ? 2048 : 1024)
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
        usesStructuralUnionAlpha
          ? decodeRepositoryRgba(assetRoot, String(value.rigAssetPath ?? ''))
          : decodeCommittedRgba(assetRoot, `rigs/${rig?.sourceId}.png`),
        ...roles.map(maskName => decodeCommittedRgba(assetRoot, part.rigMaskPaths?.[rigId]?.[maskName] ?? '')),
      ])
      if (decodedRig.sha256 !== value.rigAssetSha256 || (!usesStructuralUnionAlpha && decodedRig.sha256 !== rigSource?.runtimePngSha256)) {
        diagnostics.push(error('PRODUCTION_COLOR_MASK_PIXELS_MISMATCH', valuePath.concat('rigAssetSha256'), usesStructuralUnionAlpha
          ? 'Decoded structural-union alpha hash differs from palette audit evidence.'
          : 'Decoded rig hash differs from palette audit and rig source evidence.'))
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
    const resourceEmptyNone = part.composition?.isNone === true && part.assetPath === ''
    if (isInterfaceProductionVersion(catalog.version) && resourceEmptyNone) continue
    if (catalog.version !== '0.6.0' && isInterfaceProductionVersion(catalog.version) && part.composition?.mode === 'interface') {
      for (const rigId of Object.keys(part.composition.variantsByRig).sort()) {
        const exactSourceId = `${part.id}:${rigId}`
        const exactSource = indexed.get(exactSourceId)
        if (exactSource === undefined) {
          diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', exactSourceId], `Missing exact-rig source-index entry for part ${part.id} on ${rigId}.`))
          continue
        }
        interfaceSourceEnvelope(exactSource, 'interface-structural', ['sources', exactSourceId], diagnostics)
      }
      continue
    }
    const source = indexed.get(part.id)
    if (source === undefined) {
      diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', part.id], `Missing source-index entry for part ${part.id}.`))
      continue
    }
    const interfaceStructural = isInterfaceProductionVersion(catalog.version)
      && part.composition?.mode === 'interface'
      && source.kind === 'interface-structural'
    if (interfaceStructural) {
      interfaceSourceEnvelope(source, 'interface-structural', ['sources', part.id], diagnostics)
    } else if (catalog.version === '0.6.0') {
      checkV06TransparentSourceEnvelope(source, ['sources', part.id], diagnostics)
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
          const reworkRecord = await readProductionValidationInput(resolve(assetRoot, '..', '..'), reworkRecordPath)
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
    if (!interfaceStructural && catalog.version !== '0.6.0') await checkColorMaskAudit(source, part, catalog, indexed, assetRoot, catalog.version, ['sources', part.id], diagnostics)
    if (!resourceEmptyNone && (!runtimePathMatches(source.runtimeWebpPath, part.assetPath, catalog.version) || source.runtimeWebpSha256 !== part.assetSha256)) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', part.id, 'runtimeWebpPath'], `Source-index WebP metadata differs for ${part.id}.`))
    }
    if (!resourceEmptyNone && (part.pngPath === undefined || !runtimePathMatches(source.runtimePngPath, part.pngPath, catalog.version) || source.runtimePngSha256 !== part.pngSha256)) {
      diagnostics.push(error('PRODUCTION_SOURCE_RUNTIME_MISMATCH', ['sources', part.id, 'runtimePngPath'], `Source-index PNG metadata differs for ${part.id}.`))
    }
    if (!resourceEmptyNone && typeof source.runtimeWebpSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, catalog.version === '0.6.0' ? v06RuntimePath(part.assetPath) : part.assetPath, source.runtimeWebpSha256, ['sources', part.id, 'runtimeWebpPath']))
    if (!resourceEmptyNone && part.pngPath !== undefined && typeof source.runtimePngSha256 === 'string') assetChecks.push(validateAssetFile(assetRoot, catalog.version === '0.6.0' ? v06RuntimePath(part.pngPath) : part.pngPath, source.runtimePngSha256, ['sources', part.id, 'runtimePngPath']))
  }

  for (const rig of catalog.rigs) {
    if (catalog.version === '0.6.0') {
      const source = rig.sourceId === undefined ? undefined : indexed.get(rig.sourceId)
      if (source === undefined) diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', rig.sourceId ?? rig.id], `Rig ${rig.id} must resolve through a feline anatomy bundle body source.`))
      else checkV06TransparentSourceEnvelope(source, ['sources', rig.sourceId!], diagnostics)
      continue
    }
    if (catalog.version !== '0.6.0' && isInterfaceProductionVersion(catalog.version)) {
      const exactBodyRoots = catalog.parts.filter(part => (
        part.slotId === 'bodyFrame'
        && part.composition?.mode === 'interface'
        && part.composition.variantsByRig[rig.id] !== undefined
      )).map(part => `${part.id}:${rig.id}`)
      if (exactBodyRoots.length === 0 || exactBodyRoots.every(sourceId => !indexed.has(sourceId))) {
        diagnostics.push(error('PRODUCTION_SOURCE_MISSING', ['sources', rig.sourceId ?? rig.id], `Rig ${rig.id} must resolve through a canonical exact body/root source.`))
      }
      continue
    }
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
  if (catalog.version === '0.6.0') diagnostics.push(...await validateV06AnatomyBundles(catalog, assetRoot))
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
