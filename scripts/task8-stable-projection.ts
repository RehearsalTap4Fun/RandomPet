import { createHash } from 'node:crypto'
import type { Catalog } from '@qmonster/generator-core'

export const TASK8_APPROVED_LEGACY_CATALOG_SHA256 = 'e1cad73dc7132c8a128fd252d40f206632ed6feb1b6b8e73735280b75e81708f'
export const TASK8_LIMB_CATALOG_PROJECTION_SHA256 = 'c1bbd0ce474a720032152790a962752abd5f84d01f28a16039695361d86a36fa'
export const TASK8_LIMB_SOURCE_PROJECTION_SHA256 = '15c1ce44aefc742d921ceab883b7044f03cce1edbf770a2e2958b8812ec790bc'

export const TASK8_APPROVED_EVIDENCE_BINDINGS = {
  sourceIndex: {
    path: 'packages/asset-catalog/source-index-v0.3.0.json',
    sha256: 'ac53d826815886acfb97b6d3756b775fb4c3d1df739c96f3722ff336318e7a6b',
  },
  processedIndex: {
    path: 'asset-source/v0.3.0/production/processed-index.json',
    sha256: 'cf4dc31e36a5f5fab595310643b1053767872f4f80209a0b8afd5d6f26d84484',
  },
  productionEvidence: {
    path: 'asset-source/v0.3.0/generation/task8-limb-production.json',
    sha256: '20ddbe969532e752d5d97d979fd3e02455b371bb975c269fa1ac668c83e15993',
  },
} as const

export const TASK8_APPROVED_RENDERER_BINDINGS = {
  'scripts/render-limb-contact-sheets.ts': '03d364a4895ebdbb49561d138de115ae344c291cf3aaf7e4ea1f33a9bcf4b0c8',
  'apps/creator-web/src/render-test.ts': '12dd6962a7b089e98e9ff5ba966364d8a4c99073cc51d9e5e2777c410e4f7392',
  'packages/renderer-canvas/src/render.ts': '919e3ffdb33c0d45bc6c13c9f0969cb2e3b3391da69af02a7c17fb53fffb0f01',
  'packages/renderer-canvas/src/connector-metrics.ts': '45ea8dd58a5977588f563ff48beb8596839beb5eca8970995e5cd428a5f15c5b',
} as const

const TASK8_PART_IDS = new Set([
  'body_blob_round',
  'body_blob_wide',
  'body_biped_peanut',
  'body_biped_tall',
  'body_floating_drop',
  'head_round_dome',
  'head_mushroom_cap',
  'arms_short_plush',
  'arms_long_noodle',
  'arms_paddle',
  'legs_stub_feet',
  'legs_webbed',
  'legs_mushroom',
  'legs_shadow_tiptoe',
])
const TASK8_CONNECTOR_CLASSES = new Set(['neck', 'shoulder', 'hip'])

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function task8Task9HistoricalNeckWarpProjection(catalog: Catalog): Catalog {
  const projected = structuredClone(catalog)
  for (const partId of ['body_biped_tall', 'head_round_dome']) {
    const part = projected.parts.find(candidate => candidate.id === partId)
    const variant = part?.composition?.mode === 'interface'
      ? part.composition.variantsByRig.biped
      : undefined
    const neck = variant?.connectors.find(connector => connector.id === 'neck')
    if (neck?.warpLimits.depthRatio.max !== 1.3) {
      throw new Error(`TASK8_TASK9_HISTORICAL_NECK_WARP_INVALID:${partId}`)
    }
    neck.warpLimits.depthRatio.max = 1.2
  }
  return projected
}

const TASK8_FULL_TRACE_BINDING = {
  path: '.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-blob-joint-shoulder-search.json',
  sha256: 'fc538e40d78dd72c6b6ac4daf2883e753d0fe1a47aa3d3be76a1ca035431b295',
} as const
const TASK8_COMPACT_PROOF_BINDING = {
  path: 'packages/asset-catalog/audit/v0.3.0/task8-blob-joint-shoulder-selection-proof.json',
  sha256: '52310279085ebff1fe94821d5581b5119881d435b859799baf4bdbc554fbc459',
} as const
const TASK8_PROVENANCE_MIGRATED_AMENDMENTS = new Set([
  'packages/asset-catalog/review/v0.3.0/body-head-connector-amendment.json',
  'packages/asset-catalog/review/v0.3.0/visible-limb-threshold-amendment.json',
])

function exactOccurrenceCount(text: string, value: string): number {
  return text.split(value).length - 1
}

export function task8HistoricalAmendmentSha256(path: string, bytes: Uint8Array): string {
  if (!TASK8_PROVENANCE_MIGRATED_AMENDMENTS.has(path)) {
    throw new Error(`TASK8_AMENDMENT_PROJECTION_PATH_INVALID:${path}`)
  }
  const text = Buffer.from(bytes).toString('utf8')
  if (
    exactOccurrenceCount(text, TASK8_COMPACT_PROOF_BINDING.path) !== 1
    || exactOccurrenceCount(text, TASK8_COMPACT_PROOF_BINDING.sha256) !== 1
  ) throw new Error(`TASK8_AMENDMENT_PROJECTION_BINDING_INVALID:${path}`)
  const historical = text
    .replace(TASK8_COMPACT_PROOF_BINDING.path, TASK8_FULL_TRACE_BINDING.path)
    .replace(TASK8_COMPACT_PROOF_BINDING.sha256, TASK8_FULL_TRACE_BINDING.sha256)
  return createHash('sha256').update(historical).digest('hex')
}

export function task8LimbCatalogProjection(catalog: Catalog): Pick<Catalog, 'parts' | 'transitionBridges'> {
  const historical = task8Task9HistoricalNeckWarpProjection(catalog)
  const parts = historical.parts.filter(part => TASK8_PART_IDS.has(part.id))
  for (const part of parts) {
    if (part.composition?.mode !== 'interface') continue
    for (const variant of Object.values(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      variant.connectors = variant.connectors.filter(connector => TASK8_CONNECTOR_CLASSES.has(connector.connectorClass))
      delete variant.featureSockets
    }
  }
  const transitionBridges = structuredClone((historical.transitionBridges ?? []).filter(bridge => TASK8_CONNECTOR_CLASSES.has(bridge.connectorClass)))
  for (const bridge of transitionBridges) {
    bridge.materialFamilies = bridge.materialFamilies.filter(family => family !== 'soft-skin')
  }
  return {
    parts,
    transitionBridges,
  }
}

export function task8LimbCatalogProjectionSha256(catalog: Catalog): string {
  return sha256Json(task8LimbCatalogProjection(catalog))
}

type SourceRecord = { sourceId?: unknown; runtimeResources?: unknown; [key: string]: unknown }

export function task8LimbSourceProjection(sourceIndex: unknown, productionEvidence: unknown): SourceRecord[] {
  const sources = (sourceIndex as { sources?: unknown })?.sources
  const assets = (productionEvidence as { assets?: unknown })?.assets
  if (!Array.isArray(sources) || assets === null || typeof assets !== 'object' || Array.isArray(assets)) {
    throw new Error('TASK8_SOURCE_PROJECTION_INVALID')
  }
  const records = sources as SourceRecord[]
  return Object.keys(assets).sort().map(sourceId => {
    const matches = records.filter(record => record.sourceId === sourceId)
    if (matches.length !== 1) throw new Error(`TASK8_SOURCE_PROJECTION_CARDINALITY:${sourceId}:${matches.length}`)
    const { runtimeResources: _task9RuntimeResources, ...stable } = matches[0]!
    return stable
  }).sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)))
}

export function task8LimbSourceProjectionSha256(sourceIndex: unknown, productionEvidence: unknown): string {
  return sha256Json(task8LimbSourceProjection(sourceIndex, productionEvidence))
}

const TASK8_MARKER_REPLACEMENTS: Record<string, Record<string, string>> = {
  'apps/creator-web/src/render-test.ts': {
    'render-test-interface-variant': "type InterfaceVariant = 'baseline' | 'foreground-hole' | 'background-hole' | 'shifted-contour' | 'curved-head-split' | 'misaligned-occlusion-masks'\n\n",
    'render-test-transition-hole-bridge': "          if (variant === 'misaligned-occlusion-masks') {\n",
    'render-test-diagnostic-input': '  const input = await response.json() as { catalog: Catalog, spec: MonsterSpec }\n',
    'render-test-diagnostic-option': '',
    'render-test-diagnostic-result': '',
    'render-test-transition-hole-route': '',
  },
  'packages/renderer-canvas/src/render.ts': {
    'renderer-v04-composition-surface-fields': '',
    'renderer-v04-composition-surface-factory': "  const surfaces = [\n    factory(MASTER_SIZE, MASTER_SIZE, context),\n    factory(MASTER_SIZE, MASTER_SIZE, context),\n    factory(METRIC_SIZE, METRIC_SIZE, context),\n    factory(METRIC_SIZE, METRIC_SIZE, context),\n    factory(METRIC_SIZE, METRIC_SIZE, context),\n    factory(METRIC_SIZE, METRIC_SIZE, context),\n    factory(METRIC_SIZE, METRIC_SIZE, context),\n  ]\n  if (surfaces.some(surface => surface === null)) return null\n  const result: CompositionSurfaces = {\n    nodeLayer: surfaces[0]!,\n    bodyAlpha: surfaces[1]!,\n    eyesAlpha: surfaces[2]!,\n    mouthAlpha: surfaces[3]!,\n    outputAlpha: surfaces[4]!,\n    eyesOccluderAlpha: surfaces[5]!,\n    mouthOccluderAlpha: surfaces[6]!,\n  }\n",
    'renderer-v04-metric-diagnostic-slot': "  slotId: 'eyes' | 'mouthShape',\n",
    'renderer-v04-composition-oral-surface-clear': '',
    'renderer-v04-composition-oral-start': '',
    'renderer-v04-composition-oral-occlusion': '',
    'renderer-v04-composition-oral-metrics': '',
    'renderer-v04-composition-oral-metric-fields': '',
    'renderer-v04-interface-surface-fields': '',
    'renderer-v04-interface-surface-factory': "  const list = Array.from({ length: 18 }, () => factory(MASTER_SIZE, MASTER_SIZE, context))\n  if (list.some(item => item === null)) return null\n  return {\n    nodeLayer: list[0]!, bodyAlpha: list[1]!, childAlpha: list[2]!,\n    structureAlpha: list[3]!, bridgeWarp: list[4]!, bridgeMask: list[5]!,\n    bridgePass: list[6]!, materialSample: list[7]!, eyesAlpha: list[8]!,\n    mouthAlpha: list[9]!, outputAlpha: list[10]!, eyesOccluderAlpha: list[11]!,\n    mouthOccluderAlpha: list[12]!, connectorMask: list[13]!, bridgeAlpha: list[14]!,\n    receiverContour: list[15]!, plugContour: list[16]!, finalOutput: list[17]!,\n  }\n",
    'renderer-v04-oral-asset-tolerance-helper': '',
    'renderer-v04-oral-asset-tolerance-registration': '',
    'renderer-v04-preflight-gate-1': "  if (diagnostics.some(item => item.severity === 'error')) {\n",
    'renderer-v04-preflight-gate-2': "  if (diagnostics.some(item => item.severity === 'error')) {\n",
    'renderer-v04-interface-oral-surface-clear': '',
    'renderer-v04-interface-oral-start': '',
    'renderer-v04-interface-face-metrics': "    compositionMetrics = {\n      eyesInsideRatio: eyes.insideRatio, eyesVisibleRatio: eyes.visibleRatio,\n      mouthInsideRatio: mouth.insideRatio, mouthVisibleRatio: mouth.visibleRatio,\n      visibleBounds: scaleMetricBounds(measureVisibleBounds(\n        imageData(surfaces.outputAlpha, METRIC_SIZE), METRIC_SIZE, METRIC_SIZE,\n      )),\n    }\n    const policy = catalog.compositionPolicy!\n    for (const [slotId, metric] of [['eyes', eyes], ['mouthShape', mouth]] as const) {\n      if (metric.insideRatio < policy.faceInsideRatio) {\n        diagnostics.push(metricDiagnostic(\n          'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, policy.faceInsideRatio,\n        ))\n      }\n      if (metric.visibleRatio < policy.faceVisibleRatio) {\n        diagnostics.push(metricDiagnostic(\n          'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, policy.faceVisibleRatio,\n        ))\n      }\n    }\n",
    'renderer-v04-interface-pair-helper': '',
    'renderer-v04-invalid-interface-pair': "      connectorMetrics: spec.rendererVersion === '0.3.0' ? [] : null,\n",
    'renderer-v04-interface-route': "  if (catalog.version === '0.3.0' && spec.rendererVersion === '0.3.0') {\n",
    'renderer-structural-slot-helper-import': '',
    'renderer-composition-policy-import': '',
    'renderer-task10-face-occlusion-policy': '',
    'renderer-task10-face-metric-thresholds': '',
    'renderer-task10-composition-face-thresholds': "  for (const [slotId, metric] of [\n    ['eyes', eyes], ['mouthShape', mouth],\n  ] as const) {\n    if (metric.insideRatio < policy.faceInsideRatio) {\n      diagnostics.push(metricDiagnostic(\n        'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, policy.faceInsideRatio,\n      ))\n    }\n    if (metric.visibleRatio < policy.faceVisibleRatio) {\n      diagnostics.push(metricDiagnostic(\n        'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, policy.faceVisibleRatio,\n      ))\n    }\n  }\n",
    'renderer-task10-connector-threshold-message': '        item.connectorId, `Bridge ${item.bridge.id} is below 0.9 contour coverage or above a 2px gap.`,\n',
    'renderer-role-masked-bridge-metrics': '      // Structural continuity is measured from the solved bridge geometry.\n      // Foreground/background masks are visual occlusion data and may use\n      // intentionally different organic splits on the two connected parts.\n      drawBridgeMesh(surfaces.bridgeAlpha.context, assets.neutral, mesh)\n',
    'renderer-role-mask-gap-preservation': "      surfaces.bridgePass.context.globalCompositeOperation = 'destination-in'\n      surfaces.bridgePass.context.drawImage(surfaces.bridgeMask.canvas, 0, 0)\n      surfaces.bridgePass.context.drawImage(surfaces.connectorMask.canvas, 0, 0)\n",
    'renderer-shared-bounds-helper': "function boundsInside(\n  bounds: NonNullable<CompositionMetrics['visibleBounds']>,\n  frame: NonNullable<Catalog['compositionPolicy']>['frameBounds'],\n): boolean {\n  return bounds.x >= frame.x\n    && bounds.y >= frame.y\n    && bounds.x + bounds.width <= frame.x + frame.width\n    && bounds.y + bounds.height <= frame.y + frame.height\n}\n\n",
    'renderer-shared-composition-bounds-call': '  if (visibleBounds !== null && !boundsInside(visibleBounds, policy.frameBounds)) {\n',
    'renderer-structural-slot-set': "const STRUCTURAL_SLOTS = new Set([\n  'bodyFrame', 'headShape', 'arms', 'legs', 'tail', 'extraAppendage',\n])\n\n",
    'renderer-structural-load-check': '      diagnostics.push(STRUCTURAL_SLOTS.has(node.slotId)\n',
    'renderer-structural-metric-filter': '    for (const node of tree.nodes.filter(item => STRUCTURAL_SLOTS.has(item.slotId))) {\n',
    'renderer-structural-final-filter': '  const structural = nodes.filter(node => STRUCTURAL_SLOTS.has(node.slotId))\n',
    'renderer-nonstructural-final-filter': '  const nonStructural = nodes.filter(node => !STRUCTURAL_SLOTS.has(node.slotId)).sort((left, right) => (\n',
    'renderer-shared-interface-bounds-call': '      && !boundsInside(compositionMetrics.visibleBounds, policy.frameBounds)\n',
    'renderer-task10-face-occluder-routing': "      if (node.slotId === 'eyes') {\n        drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer, 'destination-out')\n        drawMetricAlpha(surfaces.eyesAlpha, surfaces.nodeLayer)\n        eyesStarted = true\n      } else if (eyesStarted) drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer)\n      if (node.slotId === 'mouthShape') {\n        drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer, 'destination-out')\n        drawMetricAlpha(surfaces.mouthAlpha, surfaces.nodeLayer)\n        mouthStarted = true\n      } else if (mouthStarted) drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer)\n",
    'renderer-palette-load-diagnostic': '',
    'renderer-palette-missing-diagnostic': '',
    'renderer-palette-preflight': '',
    'renderer-diagnostic-scope-helpers': '',
    'renderer-skip-palette-source': '',
    'renderer-connector-diagnostic-call-1': '      diagnostics.push(connectorCompositeDiagnostic(\n',
    'renderer-connector-diagnostic-call-2': '      diagnostics.push(connectorCompositeDiagnostic(\n',
    'renderer-bridge-end-center-helper': '',
    'renderer-bridge-receiver-source-param': '',
    'renderer-bridge-mesh-endpoints': '',
    'renderer-bridge-gradient-endpoints': '        bridge.solved.receiverOrigin.x, bridge.solved.receiverOrigin.y,\n        bridge.solved.plugOrigin.x, bridge.solved.plugOrigin.y,\n',
    'renderer-bridge-front-receiver-overlap': '',
    'renderer-bridge-seam-envelope-comment': '',
    'renderer-bridge-draw-setup': '    // Bridge alpha remains part of structural validation, but normalized roots\n    // overlap fully and occlude the tissue in the final art. Drawing the warp\n    // before a transparent child still exposes its rectangular mesh bounds.\n',
    'renderer-bridge-back-call': '',
    'renderer-bridge-front-call': '',
    'renderer-pre-face-bridge-comment': '    // Structural roots are normalized to overlap. Keep transition tissue\n    // behind them so no mask boundary or mesh frontier reads as hardware.\n',
    'renderer-palette-pass': '',
    'renderer-skip-palette-node': '',
    'renderer-diagnostic-return': '  return { drawnAssetIds, diagnostics, compositionMetrics, connectorMetrics }\n',
    'renderer-diagnostic-scope-validation': '',
  },
  'packages/renderer-canvas/src/connector-metrics.ts': {
    'connector-task10-coverage-thresholds': 'export const CONNECTOR_COVERAGE_MIN = 0.9\n',
    'connector-task10-role-threshold-gate': '  return metric.receiverCoverage >= CONNECTOR_COVERAGE_MIN\n    && metric.plugCoverage >= CONNECTOR_COVERAGE_MIN\n',
  },
  'scripts/render-limb-contact-sheets.ts': {
    'limb-canonical-structural-import': "import type { Catalog, MonsterSpec, SemanticSlotId, VisualSlotId } from '@qmonster/generator-core'\n",
    'limb-canonical-structural-subset': '\n',
    'limb-worker-partition-helper': '',
    'limb-worker-cleanup-helper': '',
    'limb-worker-count-input': '',
    'limb-task10-catalog-projection-input': '',
    'limb-task10-catalog-projection-apply': '',
    'limb-browser-catalog-signature': 'export function browserCatalog(input: Catalog): Catalog {\n  const catalog = structuredClone(input)\n',
    'limb-active-structural-slots': '',
    'limb-active-slot-condition': "    if (part.composition !== undefined && !['bodyFrame', 'headShape', 'arms', 'legs'].includes(part.slotId)) {\n",
    'limb-palette-mask-paths': '',
    'limb-structural-only-catalog': '  const catalog = browserCatalog(sourceCatalog)\n',
    'limb-structural-only-input': '      await writeFile(inputPath, `${JSON.stringify({ catalog, spec })}\\n`)\n',
    'limb-worker-pages': "  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })\n  await server.listen(); const baseUrl = server.resolvedUrls?.local[0]\n  if (baseUrl === undefined) throw new Error('LIMB_MATRIX_RENDER_FAILED: Vite server has no local URL')\n  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()\n  const entries: LimbMatrixEvidenceEntry[] = []\n  try {\n",
    'limb-worker-loop-open': '    for (let index = 0; index < plan.length; index += 1) {\n',
    'limb-worker-entry-assignment': '      entries.push({ ...selection, original, connectorMetrics: evidence.connectorMetrics, compositionMetrics: evidence.compositionMetrics, resolvedAssetPaths: evidence.resolvedAssetPaths, inputBinding: { catalogSha256: catalogInputSha256, resolvedAssetHashes }, gateErrors, diagnostics: evidence.diagnostics })\n',
    'limb-worker-loop-close': '    }\n',
    'limb-worker-cleanup': '    await page.close(); await browser.close(); await server.close(); await rm(inputRoot, { recursive: true, force: true })\n',
  },
}

export function task8StableMarkerProjection(path: string, text: string): string {
  const replacements = TASK8_MARKER_REPLACEMENTS[path]
  if (replacements === undefined) return text
  const observed = new Set<string>()
  const pattern = /^(?<indent>[ \t]*)\/\/ TASK8_STABLE_BEGIN:(?<id>[a-z0-9-]+)\r?\n[\s\S]*?^\k<indent>\/\/ TASK8_STABLE_END:\k<id>\r?\n(?:\r?\n)?/gmu
  const projected = text.replace(pattern, (...args: unknown[]) => {
    const groups = args.at(-1) as { id?: string } | undefined
    const id = groups?.id
    if (id === undefined || !(id in replacements) || observed.has(id)) {
      throw new Error(`TASK8_RENDERER_PROJECTION_MARKER_INVALID:${String(id)}`)
    }
    observed.add(id)
    return replacements[id]!
  })
  const expected = Object.keys(replacements)
  if (observed.size !== expected.length) {
    throw new Error(`TASK8_RENDERER_PROJECTION_CARDINALITY:${observed.size}:${expected.length}`)
  }
  return projected
}

export function task8RendererProjectionSha256(path: string, bytes: Uint8Array): string {
  return createHash('sha256').update(task8StableMarkerProjection(path, Buffer.from(bytes).toString('utf8'))).digest('hex')
}
