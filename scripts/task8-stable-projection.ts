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

export function task8LimbCatalogProjection(catalog: Catalog): Pick<Catalog, 'parts' | 'transitionBridges'> {
  const parts = structuredClone(catalog.parts.filter(part => TASK8_PART_IDS.has(part.id)))
  for (const part of parts) {
    if (part.composition?.mode !== 'interface') continue
    for (const variant of Object.values(part.composition.variantsByRig)) {
      if (variant === undefined) continue
      variant.connectors = variant.connectors.filter(connector => TASK8_CONNECTOR_CLASSES.has(connector.connectorClass))
      delete variant.featureSockets
    }
  }
  return {
    parts,
    transitionBridges: structuredClone((catalog.transitionBridges ?? []).filter(bridge => TASK8_CONNECTOR_CLASSES.has(bridge.connectorClass))),
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

const TASK9_BROWSER_CATALOG_EXTENSION = `export function browserCatalog(input: Catalog, options: {
  activeStructuralSlots?: readonly VisualSlotId[]
  applyPaletteMasks?: boolean
} = {}): Catalog {
  const catalog = structuredClone(input)
  const activeStructuralSlots = new Set(options.activeStructuralSlots ?? ['bodyFrame', 'headShape', 'arms', 'legs'])`

const TASK8_BROWSER_CATALOG_BASELINE = `export function browserCatalog(input: Catalog): Catalog {
  const catalog = structuredClone(input)`

const TASK9_ACTIVE_SLOT_CONDITION = `if (part.composition !== undefined && !activeStructuralSlots.has(part.slotId)) {`
const TASK8_ACTIVE_SLOT_CONDITION = `if (part.composition !== undefined && !['bodyFrame', 'headShape', 'arms', 'legs'].includes(part.slotId)) {`

function replaceExpected(text: string, extension: string, baseline: string, expectedCount = 1): string {
  const count = text.split(extension).length - 1
  if (count !== expectedCount) throw new Error(`TASK8_RENDERER_PROJECTION_CARDINALITY:${count}:${expectedCount}`)
  return text.replaceAll(extension, baseline)
}

function projectTask9DiagnosticScope(path: string, text: string): string {
  if (path === 'apps/creator-web/src/render-test.ts') {
    return replaceExpected(replaceExpected(replaceExpected(
      text,
      `  const input = await response.json() as {
    catalog: Catalog
    spec: MonsterSpec
    diagnosticScope?: {
      id: string
      activeVisualSlots: VisualSlotId[]
      activeConnectorIds: string[]
    }
  }`,
      '  const input = await response.json() as { catalog: Catalog, spec: MonsterSpec }',
    ), `    ...(input.diagnosticScope === undefined ? {} : { diagnosticScope: input.diagnosticScope }),\n`, ''), `    diagnosticScope: result.diagnosticScope,\n`, '')
  }
  if (path !== 'packages/renderer-canvas/src/render.ts') return text
  let projected = replaceExpected(text, `function interfacePaletteAssetLoadDiagnostic(
  partId: string,
  rigId: string,
  maskName: 'primary' | 'secondary' | 'accent',
  assetPath: string,
): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: ['parts', partId, 'rigMaskPaths', rigId, maskName],
    message: \`Failed to load \${assetPath} for \${partId}.\`,
  }
}

`, '')
  projected = replaceExpected(projected, `  for (const node of tree.nodes) {
    if (node.slotId === 'colorScheme') continue
`, `  for (const node of tree.nodes) {
`)
  projected = replaceExpected(projected, `    const colorSelection = spec.visualSlots.colorScheme
    const colorPart = catalog.parts.find(part => (
      part.id === colorSelection.partId && part.slotId === 'colorScheme'
    ))
    const colorMasks = colorPart?.rigMaskPaths?.[colorSelection.rigId]
    if (colorPart !== undefined && colorMasks !== undefined) {
      const palette = expandRenderLayers(spec, catalog).palette
      for (const maskName of ['primary', 'secondary', 'accent'] as const) {
        const assetPath = colorMasks[maskName]
        try {
          const mask = await resolver.resolve(assetPath)
          clearSurface(surfaces.connectorMask)
          surfaces.connectorMask.context.drawImage(mask, 0, 0)
          withSavedContext(surfaces.connectorMask.context, () => {
            surfaces.connectorMask.context.globalCompositeOperation = 'source-in'
            surfaces.connectorMask.context.fillStyle = palette[maskName]
            surfaces.connectorMask.context.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
            surfaces.connectorMask.context.globalCompositeOperation = 'destination-in'
            surfaces.connectorMask.context.drawImage(surfaces.structureAlpha.canvas, 0, 0)
          })
          withSavedContext(finalContext, () => {
            finalContext.globalCompositeOperation = 'color'
            finalContext.drawImage(surfaces.connectorMask.canvas, 0, 0)
          })
        } catch {
          diagnostics.push(interfacePaletteAssetLoadDiagnostic(
            colorPart.id, colorSelection.rigId, maskName, assetPath,
          ))
        }
      }
      if (!diagnostics.some(item => item.path[1] === colorPart.id)) drawnAssetIds.push(colorPart.id)
    }
`, '')
  projected = replaceExpected(projected, `    for (const node of nonStructural) {
      if (node.slotId === 'colorScheme') continue
`, `    for (const node of nonStructural) {
`)
  projected = replaceExpected(projected, `  const suppressedDiagnostics: Diagnostic[] = []
  const diagnosticScope = options.diagnosticScope
  const pushConnectorMetricDiagnostic = (connectorId: string, diagnostic: Diagnostic) => {
    if (diagnosticScope !== undefined && !diagnosticScope.activeConnectorIds.includes(connectorId)) {
      suppressedDiagnostics.push(diagnostic)
    } else diagnostics.push(diagnostic)
  }
  const pushFaceMetricDiagnostic = (slotId: 'eyes' | 'mouthShape', diagnostic: Diagnostic) => {
    if (diagnosticScope !== undefined && !diagnosticScope.activeVisualSlots.includes(slotId)) {
      suppressedDiagnostics.push(diagnostic)
    } else diagnostics.push(diagnostic)
  }
`, '')
  projected = replaceExpected(projected, 'pushConnectorMetricDiagnostic(item.connectorId, connectorCompositeDiagnostic(', 'diagnostics.push(connectorCompositeDiagnostic(', 2)
  projected = replaceExpected(projected, 'pushFaceMetricDiagnostic(slotId, metricDiagnostic(', 'diagnostics.push(metricDiagnostic(', 2)
  projected = replaceExpected(projected, `  return {
    drawnAssetIds, diagnostics, compositionMetrics, connectorMetrics,
    ...(diagnosticScope === undefined ? {} : {
      diagnosticScope: {
        ...diagnosticScope,
        activeVisualSlots: [...diagnosticScope.activeVisualSlots],
        activeConnectorIds: [...diagnosticScope.activeConnectorIds],
        suppressedDiagnostics,
      },
    }),
  }`, '  return { drawnAssetIds, diagnostics, compositionMetrics, connectorMetrics }')
  projected = replaceExpected(projected, `  if (
    options.diagnosticScope !== undefined
    && (
      options.diagnosticScope.id.trim() === ''
      || options.diagnosticScope.activeVisualSlots.length === 0
      || options.diagnosticScope.activeConnectorIds.length === 0
      || new Set(options.diagnosticScope.activeVisualSlots).size !== options.diagnosticScope.activeVisualSlots.length
      || new Set(options.diagnosticScope.activeConnectorIds).size !== options.diagnosticScope.activeConnectorIds.length
    )
  ) {
    return {
      drawnAssetIds: [],
      diagnostics: [{
        severity: 'error',
        code: 'RENDER_DIAGNOSTIC_SCOPE_INVALID',
        path: ['renderOptions', 'diagnosticScope'],
        message: 'A diagnostic scope needs a non-empty id and unique active visual slots and connectors.',
      }],
      compositionMetrics: null,
      connectorMetrics: catalog.version === '0.3.0' ? [] : null,
    }
  }
`, '')
  return projected
}

export function task8RendererProjectionSha256(path: string, bytes: Uint8Array): string {
  let projected = projectTask9DiagnosticScope(path, Buffer.from(bytes).toString('utf8'))
  if (path === 'scripts/render-limb-contact-sheets.ts') {
    projected = replaceExpected(projected, `    if (part.slotId === 'colorScheme' && options.applyPaletteMasks !== true) delete part.rigMaskPaths
    else if (part.rigMaskPaths !== undefined) for (const masks of Object.values(part.rigMaskPaths)) {
        if (masks === undefined) continue
        masks.primary = fsUrl(runtimeFsPath(masks.primary))
        masks.secondary = fsUrl(runtimeFsPath(masks.secondary))
        masks.accent = fsUrl(runtimeFsPath(masks.accent))
      }
`, '')
    const extensionCount = projected.split(TASK9_BROWSER_CATALOG_EXTENSION).length - 1
    const conditionCount = projected.split(TASK9_ACTIVE_SLOT_CONDITION).length - 1
    if (extensionCount === 1 && conditionCount === 1) {
      projected = projected
        .replace(TASK9_BROWSER_CATALOG_EXTENSION, TASK8_BROWSER_CATALOG_BASELINE)
        .replace(TASK9_ACTIVE_SLOT_CONDITION, TASK8_ACTIVE_SLOT_CONDITION)
    }
  }
  return createHash('sha256').update(projected).digest('hex')
}
