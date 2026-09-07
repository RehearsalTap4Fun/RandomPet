// TASK8_STABLE_BEGIN:renderer-structural-slot-helper-import
import { isAttachmentPartComposition, isStructuralSlot } from '@qmonster/generator-core'
// TASK8_STABLE_END:renderer-structural-slot-helper-import
import {
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type Palette,
} from '@qmonster/generator-core'
import { resolveAttachmentTree } from './attachment-tree.js'
import { resolveAnatomyBundleRenderPlan } from './anatomy-bundle.js'
import { buildBridgeMesh, type BridgeMesh } from './bridge-mesh.js'
import {
  connectorMetricMeetsThresholds,
  EXTERNAL_LIMB_ALPHA_MIN,
  measureConnectorAlpha,
  structureMetricMeetsThreshold,
} from './connector-metrics.js'
import { measureFeatureAlpha, measureVisibleBounds } from './composition-metrics.js'
// TASK8_STABLE_BEGIN:renderer-composition-policy-import
import { boundsInsideFrame, faceMetricThresholds } from './composition-policy.js'
// TASK8_STABLE_END:renderer-composition-policy-import
import { resolveInterfaceTree } from './interface-tree.js'
import { rgbaInsideTransformedRegion } from './material-sampling.js'
import { resolvePartPlacement } from './layout.js'
import { expandRenderLayers, RENDER_LAYER_ORDER } from './layers.js'
import type {
  AttachmentTreeResult,
  CompositionMetrics,
  ConnectorMetric,
  InterfaceRenderResult,
  ImageResolver,
  Placement,
  RenderLayerInstance,
  RenderOptions,
  RenderResult,
  RenderSurface,
  RenderSurfaceFactory,
  ResolvedRenderNode,
  ResolvedBridge,
} from './types.js'

const MASTER_SIZE = 2048
const METRIC_SIZE = 512
const PLACEHOLDER_CELL = 32
const PLACEHOLDER_CELLS = 8

interface CompositeSurfaces {
  layer: RenderSurface
  mask: RenderSurface
}

interface CompositionSurfaces {
  nodeLayer: RenderSurface
  bodyAlpha: RenderSurface
  eyesAlpha: RenderSurface
  mouthAlpha: RenderSurface
  outputAlpha: RenderSurface
  eyesOccluderAlpha: RenderSurface
  mouthOccluderAlpha: RenderSurface
  // TASK8_STABLE_BEGIN:renderer-v04-composition-surface-fields
  oralDetailAlpha: RenderSurface
  oralDetailOccluderAlpha: RenderSurface
  // TASK8_STABLE_END:renderer-v04-composition-surface-fields
}

const browserCompositeCache = new WeakMap<object, CompositeSurfaces>()
const browserCompositionCache = new WeakMap<object, CompositionSurfaces>()
const compositionLayerRank = new Map(
  RENDER_LAYER_ORDER.map((layer, index) => [layer, index]),
)

// TASK8_STABLE_BEGIN:renderer-task10-face-occlusion-policy
export function faceMetricOcclusionTargets(
  slotId: ResolvedRenderNode['slotId'],
  started: Readonly<{ eyes: boolean; mouth: boolean }>,
): { eyes: boolean; mouth: boolean } {
  return {
    eyes: started.eyes && slotId !== 'eyes',
    mouth: started.mouth && slotId !== 'mouthShape' && slotId !== 'oralDetail',
  }
}
// TASK8_STABLE_END:renderer-task10-face-occlusion-policy

// TASK8_STABLE_BEGIN:renderer-task10-face-metric-thresholds
export { faceMetricThresholds } from './composition-policy.js'
// TASK8_STABLE_END:renderer-task10-face-metric-thresholds

function assetLoadDiagnostic(
  layer: RenderLayerInstance,
  assetPath: string,
  maskName?: 'primary' | 'secondary' | 'accent',
  rigMask = false,
): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: maskName === undefined
      ? ['parts', layer.part.id]
      : rigMask
        ? ['parts', layer.part.id, 'rigMaskPaths', layer.rig.id, maskName]
        : ['parts', layer.part.id, 'maskPaths', maskName],
    message: `Failed to load ${assetPath} for ${layer.part.id}.`,
  }
}

function drawMissingPlaceholder(context: CanvasRenderingContext2D, assetId: string): void {
  for (let row = 0; row < PLACEHOLDER_CELLS; row += 1) {
    for (let column = 0; column < PLACEHOLDER_CELLS; column += 1) {
      context.fillStyle = (row + column) % 2 === 0 ? '#ff00ff' : '#2b0030'
      context.fillRect(
        column * PLACEHOLDER_CELL,
        row * PLACEHOLDER_CELL,
        PLACEHOLDER_CELL,
        PLACEHOLDER_CELL,
      )
    }
  }
  context.fillStyle = '#ffffff'
  context.font = '24px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const middle = PLACEHOLDER_CELL * PLACEHOLDER_CELLS / 2
  context.fillText(assetId, middle, middle)
}

export const browserSurfaceFactory: RenderSurfaceFactory = (width, height, context) => {
  const targetCanvas = context.canvas as HTMLCanvasElement | undefined
  const ownerDocument = targetCanvas?.ownerDocument
  let canvas: HTMLCanvasElement | OffscreenCanvas
  if (ownerDocument !== undefined) {
    canvas = ownerDocument.createElement('canvas')
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(MASTER_SIZE, MASTER_SIZE)
  } else {
    return null
  }
  canvas.width = width
  canvas.height = height
  const surfaceContext = canvas.getContext('2d')
  if (surfaceContext === null) return null
  return {
    canvas: canvas as CanvasImageSource,
    context: surfaceContext as CanvasRenderingContext2D,
  }
}

function createCompositeSurfaces(
  context: CanvasRenderingContext2D,
  factory: RenderSurfaceFactory,
): CompositeSurfaces | null {
  const cacheKey = context.canvas as unknown as object
  if (factory === browserSurfaceFactory) {
    const cached = browserCompositeCache.get(cacheKey)
    if (cached !== undefined) return cached
  }
  const layer = factory(MASTER_SIZE, MASTER_SIZE, context)
  const mask = factory(MASTER_SIZE, MASTER_SIZE, context)
  if (layer === null || mask === null) return null
  const surfaces = { layer, mask }
  if (factory === browserSurfaceFactory) browserCompositeCache.set(cacheKey, surfaces)
  return surfaces
}

function createCompositionSurfaces(
  context: CanvasRenderingContext2D,
  factory: RenderSurfaceFactory,
): CompositionSurfaces | null {
  const cacheKey = context.canvas as unknown as object
  if (factory === browserSurfaceFactory) {
    const cached = browserCompositionCache.get(cacheKey)
    if (cached !== undefined) return cached
  }
  // TASK8_STABLE_BEGIN:renderer-v04-composition-surface-factory
  const surfaces = [
    factory(MASTER_SIZE, MASTER_SIZE, context),
    factory(MASTER_SIZE, MASTER_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
    factory(METRIC_SIZE, METRIC_SIZE, context),
  ]
  if (surfaces.some(surface => surface === null)) return null
  const result: CompositionSurfaces = {
    nodeLayer: surfaces[0]!,
    bodyAlpha: surfaces[1]!,
    eyesAlpha: surfaces[2]!,
    mouthAlpha: surfaces[3]!,
    outputAlpha: surfaces[4]!,
    eyesOccluderAlpha: surfaces[5]!,
    mouthOccluderAlpha: surfaces[6]!,
    oralDetailAlpha: surfaces[7]!,
    oralDetailOccluderAlpha: surfaces[8]!,
  }
  // TASK8_STABLE_END:renderer-v04-composition-surface-factory
  if (factory === browserSurfaceFactory) browserCompositionCache.set(cacheKey, result)
  return result
}

function surfaceUnavailableDiagnostic(layer: RenderLayerInstance): Diagnostic {
  return {
    severity: 'error',
    code: 'RENDER_SURFACE_UNAVAILABLE',
    path: ['parts', layer.part.id, 'maskPaths'],
    message: `An isolated render surface is required to composite masks for ${layer.part.id}.`,
  }
}

function hasMasks(layer: RenderLayerInstance): boolean {
  return layer.part.rigMaskPaths?.[layer.rig.id] !== undefined
    || layer.part.maskPaths.primary !== undefined
    || layer.part.maskPaths.secondary !== undefined
}

async function drawRigPaletteMasks(
  context: CanvasRenderingContext2D,
  surfaces: CompositeSurfaces,
  layer: RenderLayerInstance,
  placement: Placement,
  palette: Palette,
  resolver: ImageResolver,
  drawnAssetIds: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const paths = layer.part.rigMaskPaths?.[layer.rig.id]
  if (paths === undefined) return
  const maskContext = surfaces.mask.context
  for (const maskName of ['primary', 'secondary', 'accent'] as const) {
    const assetPath = paths[maskName]
    try {
      const mask = await resolver.resolve(assetPath)
      maskContext.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      withSavedContext(maskContext, () => {
        maskContext.translate(placement.x, placement.y)
        maskContext.scale(placement.scaleX, placement.scaleY)
        maskContext.drawImage(mask, 0, 0)
      })
      withSavedContext(maskContext, () => {
        maskContext.globalCompositeOperation = 'source-in'
        maskContext.fillStyle = palette[maskName]
        maskContext.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      })
      withSavedContext(context, () => {
        context.globalCompositeOperation = 'color'
        context.drawImage(surfaces.mask.canvas, 0, 0)
      })
    } catch {
      diagnostics.push(assetLoadDiagnostic(layer, assetPath, maskName, true))
    }
  }
  if (!diagnostics.some(item => item.path[1] === layer.part.id)) drawnAssetIds.push(layer.part.id)
}

function placementFor(layer: RenderLayerInstance): { placement?: Placement; diagnostic?: Diagnostic } {
  const part = layer.socketName === layer.part.socket
    ? layer.part
    : { ...layer.part, socket: layer.socketName }
  const result = resolvePartPlacement(part, layer.rig, layer.transform)
  return result.ok ? { placement: result.value } : { diagnostic: result.diagnostic }
}

async function drawLayerDirect(
  context: CanvasRenderingContext2D,
  layer: RenderLayerInstance,
  resolver: ImageResolver,
  drawnAssetIds: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const resolved = placementFor(layer)
  if (resolved.diagnostic !== undefined) {
    diagnostics.push({
      ...resolved.diagnostic,
      path: ['parts', layer.part.id, ...resolved.diagnostic.path],
    })
    return
  }

  const placement = resolved.placement!
  await withSavedContextAsync(context, async () => {
    context.translate(placement.x, placement.y)
    context.scale(placement.scaleX, placement.scaleY)
    try {
      const base = await resolver.resolve(layer.part.assetPath)
      context.drawImage(base, 0, 0)
      drawnAssetIds.push(layer.part.id)
    } catch {
      diagnostics.push(assetLoadDiagnostic(layer, layer.part.assetPath))
      drawMissingPlaceholder(context, layer.part.id)
    }
  })
}

async function drawLayerBuffered(
  context: CanvasRenderingContext2D,
  surfaces: CompositeSurfaces,
  layer: RenderLayerInstance,
  palette: Palette,
  resolver: ImageResolver,
  drawnAssetIds: string[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const resolved = placementFor(layer)
  if (resolved.diagnostic !== undefined) {
    diagnostics.push({
      ...resolved.diagnostic,
      path: ['parts', layer.part.id, ...resolved.diagnostic.path],
    })
    return
  }
  const placement = resolved.placement!
  const layerContext = surfaces.layer.context
  const maskContext = surfaces.mask.context
  if (layer.part.rigMaskPaths?.[layer.rig.id] !== undefined) {
    await drawRigPaletteMasks(
      context, surfaces, layer, placement, palette, resolver, drawnAssetIds, diagnostics,
    )
    return
  }
  layerContext.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)

  await withSavedContextAsync(layerContext, async () => {
    layerContext.translate(placement.x, placement.y)
    layerContext.scale(placement.scaleX, placement.scaleY)
    try {
      const base = await resolver.resolve(layer.part.assetPath)
      layerContext.drawImage(base, 0, 0)
      drawnAssetIds.push(layer.part.id)
    } catch {
      diagnostics.push(assetLoadDiagnostic(layer, layer.part.assetPath))
      drawMissingPlaceholder(layerContext, layer.part.id)
    }
  })

  for (const maskName of ['primary', 'secondary'] as const) {
    const assetPath = layer.part.maskPaths[maskName]
    if (assetPath === undefined) continue
    try {
      const mask = await resolver.resolve(assetPath)
      maskContext.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      withSavedContext(maskContext, () => {
        maskContext.translate(placement.x, placement.y)
        maskContext.scale(placement.scaleX, placement.scaleY)
        maskContext.drawImage(mask, 0, 0)
      })
      withSavedContext(maskContext, () => {
        maskContext.globalCompositeOperation = 'source-in'
        maskContext.fillStyle = palette[maskName]
        maskContext.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      })
      layerContext.drawImage(surfaces.mask.canvas, 0, 0)
    } catch {
      diagnostics.push(assetLoadDiagnostic(layer, assetPath, maskName))
      withSavedContext(layerContext, () => {
        layerContext.translate(placement.x, placement.y)
        layerContext.scale(placement.scaleX, placement.scaleY)
        drawMissingPlaceholder(layerContext, assetPath)
      })
    }
  }
  context.drawImage(surfaces.layer.canvas, 0, 0)
}

function compositionSurfaceUnavailableDiagnostic(): Diagnostic {
  return {
    severity: 'error',
    code: 'RENDER_SURFACE_UNAVAILABLE',
    path: ['visualSlots'],
    message: 'Composition rendering requires isolated alpha surfaces.',
  }
}

function compositionAssetLoadDiagnostic(node: ResolvedRenderNode): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: ['parts', node.part.id, 'composition', 'renderNodes', node.node.id],
    message: `Failed to load ${node.node.assetPath} for ${node.node.id}.`,
  }
}

// TASK8_STABLE_BEGIN:renderer-palette-load-diagnostic
function interfacePaletteAssetLoadDiagnostic(
  partId: string,
  rigId: string,
  maskName: 'primary' | 'secondary' | 'accent',
  assetPath: string,
): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: ['parts', partId, 'rigMaskPaths', rigId, maskName],
    message: `Failed to load ${assetPath} for ${partId}.`,
  }
}
// TASK8_STABLE_END:renderer-palette-load-diagnostic

// TASK8_STABLE_BEGIN:renderer-palette-missing-diagnostic
function interfacePaletteMaskMissingDiagnostic(partId: string, rigId: string): Diagnostic {
  return {
    severity: 'error',
    code: 'INTERFACE_PALETTE_MASK_MISSING',
    path: ['parts', partId, 'rigMaskPaths', rigId],
    message: `Selected v0.3 color scheme ${partId} has no exact ${rigId} palette masks.`,
  }
}
// TASK8_STABLE_END:renderer-palette-missing-diagnostic

function clearSurface(surface: RenderSurface): void {
  surface.context.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)
}

function withSavedContext<T>(context: CanvasRenderingContext2D, action: () => T): T {
  context.save()
  try {
    return action()
  } finally {
    context.restore()
  }
}

async function withSavedContextAsync<T>(
  context: CanvasRenderingContext2D,
  action: () => Promise<T>,
): Promise<T> {
  context.save()
  try {
    return await action()
  } finally {
    context.restore()
  }
}

function applyCompositionClip(
  surface: RenderSurface,
  node: ResolvedRenderNode,
  bodyAlpha: RenderSurface,
  faceSafeZones: AttachmentTreeResult['faceSafeZones'],
): void {
  const layerContext = surface.context
  switch (node.node.clipPolicy) {
    case 'body':
      withSavedContext(layerContext, () => {
        layerContext.globalCompositeOperation = 'destination-in'
        layerContext.drawImage(bodyAlpha.canvas, 0, 0)
      })
      break
    case 'protect-face':
      withSavedContext(layerContext, () => {
        layerContext.globalCompositeOperation = 'destination-out'
        for (const face of faceSafeZones) {
          layerContext.fillRect(face.x, face.y, face.width, face.height)
        }
      })
      break
    case 'none':
      break
  }
}

function drawCompositionNodeToSurface(
  surface: RenderSurface,
  node: ResolvedRenderNode,
  source: CanvasImageSource,
  bodyAlpha: RenderSurface,
  faceSafeZones: AttachmentTreeResult['faceSafeZones'],
): void {
  clearSurface(surface)
  const layerContext = surface.context
  withSavedContext(layerContext, () => {
    layerContext.translate(node.placement.x, node.placement.y)
    if (node.placement.rotationDegrees !== undefined) {
      layerContext.rotate(node.placement.rotationDegrees * Math.PI / 180)
    }
    layerContext.scale(node.placement.scaleX, node.placement.scaleY)
    layerContext.drawImage(source, 0, 0)
  })
  applyCompositionClip(surface, node, bodyAlpha, faceSafeZones)
}

function imageData(surface: RenderSurface, size = MASTER_SIZE): Uint8ClampedArray {
  return surface.context.getImageData(0, 0, size, size).data
}

function drawMetricAlpha(
  destination: RenderSurface,
  source: RenderSurface,
  operation: GlobalCompositeOperation = 'source-over',
): void {
  const metricContext = destination.context
  withSavedContext(metricContext, () => {
    metricContext.globalCompositeOperation = operation
    metricContext.drawImage(source.canvas, 0, 0, METRIC_SIZE, METRIC_SIZE)
  })
}

function scaleFaceSafeZones(
  zones: AttachmentTreeResult['faceSafeZones'],
): AttachmentTreeResult['faceSafeZones'] {
  const scale = METRIC_SIZE / MASTER_SIZE
  return zones.map(zone => ({
    x: zone.x * scale,
    y: zone.y * scale,
    width: zone.width * scale,
    height: zone.height * scale,
  }))
}

function scaleMetricBounds(
  bounds: NonNullable<CompositionMetrics['visibleBounds']> | null,
): CompositionMetrics['visibleBounds'] {
  if (bounds === null) return null
  const scale = MASTER_SIZE / METRIC_SIZE
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  }
}

function metricDiagnostic(
  code: 'COMPOSITION_FACE_OUT_OF_ZONE' | 'COMPOSITION_FACE_OCCLUDED',
  // TASK8_STABLE_BEGIN:renderer-v04-metric-diagnostic-slot
  slotId: 'eyes' | 'mouthShape' | 'oralDetail',
  // TASK8_STABLE_END:renderer-v04-metric-diagnostic-slot
  ratio: number,
  threshold: number,
): Diagnostic {
  return {
    severity: 'error',
    code,
    path: ['visualSlots', slotId],
    message: `${slotId} alpha ratio ${ratio.toFixed(3)} is below ${threshold.toFixed(2)}.`,
  }
}

function boundsExceededDiagnostic(): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPOSITION_BOUNDS_EXCEEDED',
    path: ['visualSlots', 'bodyFrame'],
    message: 'Visible composition pixels exceed the catalog frame bounds.',
  }
}

// TASK8_STABLE_BEGIN:renderer-shared-bounds-helper
// v0.3 live rendering and acceptance reuse boundsInsideFrame.
// TASK8_STABLE_END:renderer-shared-bounds-helper

async function renderCompositionMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const attachment = resolveAttachmentTree(spec, catalog)
  if (attachment.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return {
      drawnAssetIds: [],
      diagnostics: attachment.diagnostics,
      compositionMetrics: null,
      connectorMetrics: null,
    }
  }
  const surfaces = createCompositionSurfaces(
    context,
    options.surfaceFactory ?? browserSurfaceFactory,
  )
  if (surfaces === null) {
    return {
      drawnAssetIds: [],
      diagnostics: [compositionSurfaceUnavailableDiagnostic()],
      compositionMetrics: null,
      connectorMetrics: null,
    }
  }

  const nodes = [...attachment.nodes].sort((left, right) => (
    compositionLayerRank.get(left.node.layer)! - compositionLayerRank.get(right.node.layer)!
      || left.sequence - right.sequence
  )).filter(node => options.includeGroundShadow || node.node.layer !== 'groundShadow')
  const diagnostics: Diagnostic[] = []
  const drawnAssetIds: string[] = []
  const sources = new Map<string, CanvasImageSource>()
  for (const node of nodes) {
    if (sources.has(node.key)) continue
    try {
      sources.set(node.key, await resolver.resolve(node.node.assetPath))
    } catch {
      diagnostics.push(compositionAssetLoadDiagnostic(node))
    }
  }

  clearSurface(surfaces.nodeLayer)
  clearSurface(surfaces.bodyAlpha)
  surfaces.eyesAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  surfaces.mouthAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  surfaces.outputAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  surfaces.eyesOccluderAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  surfaces.mouthOccluderAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  // TASK8_STABLE_BEGIN:renderer-v04-composition-oral-surface-clear
  surfaces.oralDetailAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  surfaces.oralDetailOccluderAlpha.context.clearRect(0, 0, METRIC_SIZE, METRIC_SIZE)
  // TASK8_STABLE_END:renderer-v04-composition-oral-surface-clear
  const bodyNode = nodes.find(node => node.slotId === 'bodyFrame')
  const bodySource = bodyNode === undefined ? undefined : sources.get(bodyNode.key)
  if (bodyNode !== undefined && bodySource !== undefined) {
    const bodyContext = surfaces.bodyAlpha.context
    withSavedContext(bodyContext, () => {
      bodyContext.translate(bodyNode.placement.x, bodyNode.placement.y)
      bodyContext.scale(bodyNode.placement.scaleX, bodyNode.placement.scaleY)
      bodyContext.drawImage(bodySource, 0, 0)
    })
  }

  withSavedContext(context, () => {
    context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
    let eyesStarted = false
    let mouthStarted = false
    // TASK8_STABLE_BEGIN:renderer-v04-composition-oral-start
    let oralDetailStarted = false
    // TASK8_STABLE_END:renderer-v04-composition-oral-start
    for (const node of nodes) {
      const source = sources.get(node.key)
      if (source === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, node, source, surfaces.bodyAlpha, attachment.faceSafeZones,
      )
      context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
      drawMetricAlpha(surfaces.outputAlpha, surfaces.nodeLayer)
      if (node.slotId === 'eyes') {
        drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.eyesAlpha, surfaces.nodeLayer)
        eyesStarted = true
      } else if (eyesStarted) {
        drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer)
      }
      if (node.slotId === 'mouthShape') {
        drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.mouthAlpha, surfaces.nodeLayer)
        mouthStarted = true
      } else if (mouthStarted) {
        drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer)
      }
      // TASK8_STABLE_BEGIN:renderer-v04-composition-oral-occlusion
      if (node.slotId === 'oralDetail') {
        drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.oralDetailAlpha, surfaces.nodeLayer)
        oralDetailStarted = true
      } else if (oralDetailStarted) {
        drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer)
      }
      // TASK8_STABLE_END:renderer-v04-composition-oral-occlusion
      drawnAssetIds.push(node.key)
    }
  })

  const policy = catalog.compositionPolicy!
  const metricFaceSafeZones = scaleFaceSafeZones(attachment.faceSafeZones)
  const eyes = measureFeatureAlpha(
    imageData(surfaces.eyesAlpha, METRIC_SIZE),
    imageData(surfaces.eyesOccluderAlpha, METRIC_SIZE),
    METRIC_SIZE,
    METRIC_SIZE,
    metricFaceSafeZones,
  )
  const mouth = measureFeatureAlpha(
    imageData(surfaces.mouthAlpha, METRIC_SIZE),
    imageData(surfaces.mouthOccluderAlpha, METRIC_SIZE),
    METRIC_SIZE,
    METRIC_SIZE,
    metricFaceSafeZones,
  )
  // TASK8_STABLE_BEGIN:renderer-v04-composition-oral-metrics
  const selectedOralDetail = catalog.parts.find(part => (
    part.slotId === 'oralDetail' && part.id === spec.visualSlots.oralDetail.partId
  ))
  const oralDetail = selectedOralDetail?.composition?.isNone === true
    ? null
    : measureFeatureAlpha(
      imageData(surfaces.oralDetailAlpha, METRIC_SIZE),
      imageData(surfaces.oralDetailOccluderAlpha, METRIC_SIZE),
      METRIC_SIZE,
      METRIC_SIZE,
      metricFaceSafeZones,
    )
  // TASK8_STABLE_END:renderer-v04-composition-oral-metrics
  const visibleBounds = scaleMetricBounds(measureVisibleBounds(
    imageData(surfaces.outputAlpha, METRIC_SIZE), METRIC_SIZE, METRIC_SIZE,
  ))
  const compositionMetrics: CompositionMetrics = {
    eyesInsideRatio: eyes.insideRatio,
    eyesVisibleRatio: eyes.visibleRatio,
    mouthInsideRatio: mouth.insideRatio,
    mouthVisibleRatio: mouth.visibleRatio,
    // TASK8_STABLE_BEGIN:renderer-v04-composition-oral-metric-fields
    oralDetailInsideRatio: oralDetail?.insideRatio ?? null,
    oralDetailVisibleRatio: oralDetail?.visibleRatio ?? null,
    // TASK8_STABLE_END:renderer-v04-composition-oral-metric-fields
    visibleBounds,
  }
  // TASK8_STABLE_BEGIN:renderer-task10-composition-face-thresholds
  const faceMetrics: Array<readonly [
    'eyes' | 'mouthShape' | 'oralDetail',
    typeof eyes,
  ]> = [['eyes', eyes], ['mouthShape', mouth]]
  if (oralDetail !== null) faceMetrics.push(['oralDetail', oralDetail])
  for (const [slotId, metric] of faceMetrics) {
    const thresholds = faceMetricThresholds(policy, slotId)!
    if (metric.insideRatio < thresholds.inside) {
      diagnostics.push(metricDiagnostic(
        'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, thresholds.inside,
      ))
    }
    if (metric.visibleRatio < thresholds.visible) {
      diagnostics.push(metricDiagnostic(
        'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, thresholds.visible,
      ))
    }
  }
  // TASK8_STABLE_END:renderer-task10-composition-face-thresholds
  // TASK8_STABLE_BEGIN:renderer-shared-composition-bounds-call
  if (visibleBounds !== null && !boundsInsideFrame(visibleBounds, policy.frameBounds)) {
  // TASK8_STABLE_END:renderer-shared-composition-bounds-call
    diagnostics.push(boundsExceededDiagnostic())
  }
  return { drawnAssetIds, diagnostics, compositionMetrics, connectorMetrics: null }
}

interface InterfaceSurfaces {
  nodeLayer: RenderSurface
  bodyAlpha: RenderSurface
  childAlpha: RenderSurface
  structureAlpha: RenderSurface
  bridgeWarp: RenderSurface
  bridgeMask: RenderSurface
  bridgePass: RenderSurface
  connectorMask: RenderSurface
  bridgeAlpha: RenderSurface
  receiverContour: RenderSurface
  plugContour: RenderSurface
  finalOutput: RenderSurface
  materialSample: RenderSurface
  eyesAlpha: RenderSurface
  mouthAlpha: RenderSurface
  outputAlpha: RenderSurface
  eyesOccluderAlpha: RenderSurface
  mouthOccluderAlpha: RenderSurface
  // TASK8_STABLE_BEGIN:renderer-v04-interface-surface-fields
  oralDetailAlpha: RenderSurface
  oralDetailOccluderAlpha: RenderSurface
  // TASK8_STABLE_END:renderer-v04-interface-surface-fields
}

interface ResolvedBridgeAssets {
  neutral: CanvasImageSource
  frontMask: CanvasImageSource
  backMask: CanvasImageSource
  receiverContour: CanvasImageSource
  receiverForeground: CanvasImageSource
  receiverBackground: CanvasImageSource
  plugContour: CanvasImageSource
  plugForeground: CanvasImageSource
  plugBackground: CanvasImageSource
}

const decodedBridgeAssets = new WeakMap<ImageResolver, Map<string, Promise<CanvasImageSource>>>()
const derivedInterfaceFrames = new Map<string, Map<string, BridgeMesh>>()
const interfaceResolverIds = new WeakMap<ImageResolver, number>()
let nextInterfaceResolverId = 1
const INTERFACE_FRAME_CACHE_LIMIT = 16
// TASK8_STABLE_BEGIN:renderer-structural-slot-set
// Structural slot membership is sourced from generator-core.
// TASK8_STABLE_END:renderer-structural-slot-set

export function interfaceRenderCacheSize(): number {
  return derivedInterfaceFrames.size
}

function interfaceFrameKey(
  spec: MonsterSpec,
  tree: InterfaceRenderResult,
  resolver: ImageResolver,
): string {
  const { slotRolls: _slotRolls, ...visualSpec } = spec
  let resolverId = interfaceResolverIds.get(resolver)
  if (resolverId === undefined) {
    resolverId = nextInterfaceResolverId
    nextInterfaceResolverId += 1
    interfaceResolverIds.set(resolver, resolverId)
  }
  return JSON.stringify({
    resolverId,
    visualSpec,
    contours: tree.bridges.map(item => [
      item.key,
      item.receiver.contourMaskPath,
      item.receiver.contourMaskSha256,
      item.plug.contourMaskPath,
      item.plug.contourMaskSha256,
    ]),
  })
}

function interfaceFrameMeshes(
  spec: MonsterSpec,
  tree: InterfaceRenderResult,
  resolver: ImageResolver,
): Map<string, BridgeMesh> {
  const key = interfaceFrameKey(spec, tree, resolver)
  const cached = derivedInterfaceFrames.get(key)
  if (cached !== undefined) {
    derivedInterfaceFrames.delete(key)
    derivedInterfaceFrames.set(key, cached)
    return cached
  }
  const created = new Map<string, BridgeMesh>()
  derivedInterfaceFrames.set(key, created)
  while (derivedInterfaceFrames.size > INTERFACE_FRAME_CACHE_LIMIT) {
    const oldest = derivedInterfaceFrames.keys().next().value as string | undefined
    if (oldest === undefined) break
    derivedInterfaceFrames.delete(oldest)
  }
  return created
}

function resolveDecodedBridge(
  resolver: ImageResolver,
  catalogVersion: string,
  path: string,
): Promise<CanvasImageSource> {
  let assets = decodedBridgeAssets.get(resolver)
  if (assets === undefined) {
    assets = new Map()
    decodedBridgeAssets.set(resolver, assets)
  }
  const key = `${catalogVersion}\u0000${path}`
  const cached = assets.get(key)
  if (cached !== undefined) return cached
  const pending = resolver.resolve(path).catch(error => {
    if (assets?.get(key) === pending) assets.delete(key)
    throw error
  })
  assets.set(key, pending)
  return pending
}

function createInterfaceSurfaces(
  context: CanvasRenderingContext2D,
  factory: RenderSurfaceFactory,
): InterfaceSurfaces | null {
  // TASK8_STABLE_BEGIN:renderer-v04-interface-surface-factory
  const list = Array.from({ length: 20 }, () => factory(MASTER_SIZE, MASTER_SIZE, context))
  if (list.some(item => item === null)) return null
  return {
    nodeLayer: list[0]!, bodyAlpha: list[1]!, childAlpha: list[2]!,
    structureAlpha: list[3]!, bridgeWarp: list[4]!, bridgeMask: list[5]!,
    bridgePass: list[6]!, materialSample: list[7]!, eyesAlpha: list[8]!,
    mouthAlpha: list[9]!, outputAlpha: list[10]!, eyesOccluderAlpha: list[11]!,
    mouthOccluderAlpha: list[12]!, connectorMask: list[13]!, bridgeAlpha: list[14]!,
    receiverContour: list[15]!, plugContour: list[16]!, finalOutput: list[17]!,
    oralDetailAlpha: list[18]!, oralDetailOccluderAlpha: list[19]!,
  }
  // TASK8_STABLE_END:renderer-v04-interface-surface-factory
}

function connectorCompositeDiagnostic(connectorId: string, message: string): Diagnostic {
  return {
    severity: 'error', code: 'CONNECTOR_COMPOSITE_FAILED',
    path: ['connectors', connectorId], message,
  }
}

function structureDisconnectedDiagnostic(ratio: number): Diagnostic {
  return {
    severity: 'error', code: 'STRUCTURE_DISCONNECTED',
    path: ['visualSlots', 'bodyFrame'],
    message: `Largest connected structural alpha ratio ${ratio.toFixed(3)} is below 0.99.`,
  }
}

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as unknown as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
  return {
    width: candidate.naturalWidth ?? candidate.width ?? MASTER_SIZE,
    height: candidate.naturalHeight ?? candidate.height ?? MASTER_SIZE,
  }
}

function affine(
  source: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  destination: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
): [number, number, number, number, number, number] | null {
  const [s0, s1, s2] = source
  const [d0, d1, d2] = destination
  const determinant = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / determinant
  const c = ((s1.x - s0.x) * (d2.x - d0.x) - (s2.x - s0.x) * (d1.x - d0.x)) / determinant
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / determinant
  const d = ((s1.x - s0.x) * (d2.y - d0.y) - (s2.x - s0.x) * (d1.y - d0.y)) / determinant
  return [a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y]
}

function drawBridgeMesh(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  mesh: BridgeMesh,
): void {
  const { width, height } = sourceDimensions(source)
  if (
    context.beginPath === undefined || context.moveTo === undefined
    || context.lineTo === undefined || context.clip === undefined
    || context.transform === undefined || context.closePath === undefined
  ) {
    throw new Error('Bridge mesh requires affine canvas APIs.')
  }
  for (const triangle of mesh.triangles) {
    const normalized = triangle.source.map(point => ({ x: point.x * width, y: point.y * height })) as [
      { x: number; y: number }, { x: number; y: number }, { x: number; y: number },
    ]
    const transform = affine(normalized, triangle.destination)
    if (transform === null) throw new Error('Bridge mesh contains a degenerate affine triangle.')
    withSavedContext(context, () => {
      const center = {
        x: (triangle.destination[0].x + triangle.destination[1].x + triangle.destination[2].x) / 3,
        y: (triangle.destination[0].y + triangle.destination[1].y + triangle.destination[2].y) / 3,
      }
      const clipPoints = triangle.destination.map(point => {
        const dx = point.x - center.x
        const dy = point.y - center.y
        const length = Math.max(1, Math.hypot(dx, dy))
        return { x: point.x + dx / length, y: point.y + dy / length }
      })
      context.beginPath()
      context.moveTo(clipPoints[0]!.x, clipPoints[0]!.y)
      context.lineTo(clipPoints[1]!.x, clipPoints[1]!.y)
      context.lineTo(clipPoints[2]!.x, clipPoints[2]!.y)
      context.closePath()
      context.clip()
      context.transform(...transform)
      context.drawImage(source, 0, 0)
    })
  }
}

function sampleMaterial(
  surface: RenderSurface,
  source: CanvasImageSource,
  node: ResolvedRenderNode,
  region: { x: number; y: number; width: number; height: number },
): string | null {
  clearSurface(surface)
  const context = surface.context
  withSavedContext(context, () => {
    context.translate(node.placement.x, node.placement.y)
    if (node.placement.rotationDegrees !== undefined) {
      context.rotate(node.placement.rotationDegrees * Math.PI / 180)
    }
    context.scale(node.placement.scaleX, node.placement.scaleY)
    context.drawImage(source, 0, 0)
  })
  const radians = (node.placement.rotationDegrees ?? 0) * Math.PI / 180
  const placed = (localX: number, localY: number) => {
    const scaledX = localX * node.placement.scaleX
    const scaledY = localY * node.placement.scaleY
    return {
      x: node.placement.x + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
      y: node.placement.y + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
    }
  }
  const corners = [
    placed(region.x, region.y),
    placed(region.x + region.width, region.y),
    placed(region.x, region.y + region.height),
    placed(region.x + region.width, region.y + region.height),
  ]
  const first = {
    x: Math.min(...corners.map(point => point.x)),
    y: Math.min(...corners.map(point => point.y)),
  }
  const second = {
    x: Math.max(...corners.map(point => point.x)),
    y: Math.max(...corners.map(point => point.y)),
  }
  const x = Math.floor(Math.min(first.x, second.x))
  const y = Math.floor(Math.min(first.y, second.y))
  const width = Math.max(1, Math.ceil(Math.max(first.x, second.x)) - x)
  const height = Math.max(1, Math.ceil(Math.max(first.y, second.y)) - y)
  try {
    return rgbaInsideTransformedRegion(
      context.getImageData(x, y, width, height).data,
      width,
      height,
      { x, y },
      node.placement,
      region,
    )
  } catch {
    return null
  }
}

function nodeSource(
  bridge: ResolvedBridge,
  key: 'parentNodeKey' | 'childNodeKey',
  tree: InterfaceRenderResult,
  sources: ReadonlyMap<string, CanvasImageSource>,
) {
  const node = tree.nodes.find(item => item.key === bridge[key])
  return node === undefined ? undefined : { node, source: sources.get(node.key) }
}

function drawPlacedSource(
  context: CanvasRenderingContext2D,
  node: ResolvedRenderNode,
  source: CanvasImageSource,
): void {
  withSavedContext(context, () => {
    context.translate(node.placement.x, node.placement.y)
    if (node.placement.rotationDegrees !== undefined) {
      context.rotate(node.placement.rotationDegrees * Math.PI / 180)
    }
    context.scale(node.placement.scaleX, node.placement.scaleY)
    context.drawImage(source, 0, 0)
  })
}

// TASK8_STABLE_BEGIN:renderer-bridge-end-center-helper
function bridgeEndCenter(row: readonly { x: number; y: number }[]): { x: number; y: number } {
  if (row.length === 0) throw new Error('Bridge mesh end row is empty.')
  return row.reduce((center, point) => ({
    x: center.x + point.x / row.length,
    y: center.y + point.y / row.length,
  }), { x: 0, y: 0 })
}
// TASK8_STABLE_END:renderer-bridge-end-center-helper

function drawBridgePass(
  destination: CanvasRenderingContext2D,
  surfaces: InterfaceSurfaces,
  bridge: ResolvedBridge,
  assets: ResolvedBridgeAssets,
  mesh: BridgeMesh,
  tree: InterfaceRenderResult,
  // TASK8_STABLE_BEGIN:renderer-bridge-receiver-source-param
  receiverSource: CanvasImageSource,
  bridgeRoleProjection: RenderOptions['bridgeRoleProjection'],
  // TASK8_STABLE_END:renderer-bridge-receiver-source-param
  receiverColor: string,
  plugColor: string,
  pass: 'back' | 'front' | 'union',
): void {
  clearSurface(surfaces.bridgeWarp)
  drawBridgeMesh(surfaces.bridgeWarp.context, assets.neutral, mesh)
  const warp = surfaces.bridgeWarp.context
  // TASK8_STABLE_BEGIN:renderer-bridge-mesh-endpoints
  const receiverEnd = bridgeEndCenter(mesh.rows[0]!)
  const plugEnd = bridgeEndCenter(mesh.rows[mesh.rows.length - 1]!)
  // TASK8_STABLE_END:renderer-bridge-mesh-endpoints
  withSavedContext(warp, () => {
    warp.globalCompositeOperation = 'source-atop'
    // Preserve neutral bridge luminance/fur detail beneath the two-material
    // tint; a fully opaque tint turns organic bridge art into a flat sticker.
    warp.globalAlpha = 0.95
    if (warp.createLinearGradient !== undefined) {
      const gradient = warp.createLinearGradient(
        // TASK8_STABLE_BEGIN:renderer-bridge-gradient-endpoints
        receiverEnd.x, receiverEnd.y,
        plugEnd.x, plugEnd.y,
        // TASK8_STABLE_END:renderer-bridge-gradient-endpoints
      )
      gradient.addColorStop(0, receiverColor)
      gradient.addColorStop(1, plugColor)
      warp.fillStyle = gradient
    } else {
      warp.fillStyle = receiverColor
    }
    warp.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
  })

  const parentNode = tree.nodes.find(node => node.key === bridge.parentNodeKey)
  const childNode = tree.nodes.find(node => node.key === bridge.childNodeKey)
  if (parentNode === undefined || childNode === undefined) {
    throw new Error('Bridge connector mask nodes are unavailable.')
  }
  // TASK8_STABLE_BEGIN:renderer-bridge-front-receiver-overlap
  if (pass === 'front') {
    // A plug is commonly tucked under receiver alpha (hips, shoulders and
    // tail roots). Preserve receiver material throughout that overlap so the
    // plug endpoint cannot paint a collar across the visible body edge. The
    // connector-only and gap portions retain the receiver-to-plug gradient.
    clearSurface(surfaces.materialSample)
    drawPlacedSource(surfaces.materialSample.context, parentNode, receiverSource)
    withSavedContext(surfaces.materialSample.context, () => {
      surfaces.materialSample.context.globalCompositeOperation = 'source-in'
      surfaces.materialSample.context.fillStyle = receiverColor
      surfaces.materialSample.context.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
    })
    withSavedContext(warp, () => {
      warp.globalCompositeOperation = 'source-atop'
      warp.globalAlpha = 0.95
      warp.drawImage(surfaces.materialSample.canvas, 0, 0)
    })
  }
  // TASK8_STABLE_END:renderer-bridge-front-receiver-overlap
  const masks = pass === 'union'
    ? [
        [assets.backMask, assets.receiverBackground, assets.plugBackground],
        [assets.frontMask, assets.receiverForeground, assets.plugForeground],
      ] as const
    : [pass === 'back'
        ? [assets.backMask, assets.receiverBackground, assets.plugBackground]
        : [assets.frontMask, assets.receiverForeground, assets.plugForeground]] as const
  for (const [transitionMask, receiverMask, plugMask] of masks) {
    clearSurface(surfaces.bridgeMask)
    drawBridgeMesh(surfaces.bridgeMask.context, transitionMask, mesh)
    clearSurface(surfaces.connectorMask)
    drawPlacedSource(surfaces.connectorMask.context, parentNode, receiverMask)
    drawPlacedSource(surfaces.connectorMask.context, childNode, plugMask)
    clearSurface(surfaces.bridgePass)
    surfaces.bridgePass.context.drawImage(surfaces.bridgeWarp.canvas, 0, 0)
    withSavedContext(surfaces.bridgePass.context, () => {
      // TASK8_STABLE_BEGIN:renderer-bridge-seam-envelope-comment
      // Transition roles partition the open bridge span. Connector roles
      // partition only the receiver/plug endpoint contours. These two masks
      // are independently authored, so multiplying them at the endpoints
      // would erase valid seam alpha whenever their split lines differ.
      // TASK8_STABLE_END:renderer-bridge-seam-envelope-comment
      // TASK8_STABLE_BEGIN:renderer-role-mask-gap-preservation
      surfaces.bridgePass.context.globalCompositeOperation = 'destination-in'
      if (bridgeRoleProjection === 'task8-task9-cross-product-v1') {
        // Task 8/9 frame approvals bind the original cross-product compositor.
        // This explicit audit-only path never participates in live preview.
        surfaces.bridgePass.context.drawImage(surfaces.bridgeMask.canvas, 0, 0)
        surfaces.bridgePass.context.drawImage(surfaces.connectorMask.canvas, 0, 0)
      } else {
        // effectiveRole = (transitionRole - endpointContours)
        //               + (connectorRole intersect endpointContours)
        clearSurface(surfaces.receiverContour)
        drawPlacedSource(surfaces.receiverContour.context, parentNode, assets.receiverContour)
        drawPlacedSource(surfaces.receiverContour.context, childNode, assets.plugContour)
        clearSurface(surfaces.plugContour)
        surfaces.plugContour.context.drawImage(surfaces.connectorMask.canvas, 0, 0)
        withSavedContext(surfaces.plugContour.context, () => {
          surfaces.plugContour.context.globalCompositeOperation = 'destination-in'
          surfaces.plugContour.context.drawImage(surfaces.receiverContour.canvas, 0, 0)
        })
        withSavedContext(surfaces.bridgeMask.context, () => {
          surfaces.bridgeMask.context.globalCompositeOperation = 'destination-out'
          surfaces.bridgeMask.context.drawImage(surfaces.receiverContour.canvas, 0, 0)
          surfaces.bridgeMask.context.globalCompositeOperation = 'source-over'
          surfaces.bridgeMask.context.drawImage(surfaces.plugContour.canvas, 0, 0)
        })
        surfaces.bridgePass.context.drawImage(surfaces.bridgeMask.canvas, 0, 0)
      }
      // TASK8_STABLE_END:renderer-role-mask-gap-preservation
    })
    destination.drawImage(surfaces.bridgePass.canvas, 0, 0)
  }
}

function alphaCentroid(pixels: Uint8ClampedArray, width: number): { x: number; y: number } | null {
  let mass = 0
  let weightedX = 0
  let weightedY = 0
  for (let offset = 3; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset] ?? 0
    if (alpha === 0) continue
    const index = (offset - 3) / 4
    weightedX += (index % width) * alpha
    weightedY += Math.floor(index / width) * alpha
    mass += alpha
  }
  return mass === 0 ? null : { x: weightedX / mass, y: weightedY / mass }
}

function rasterLine(from: { x: number; y: number }, to: { x: number; y: number }) {
  let x = Math.round(from.x)
  let y = Math.round(from.y)
  const endX = Math.round(to.x)
  const endY = Math.round(to.y)
  const deltaX = Math.abs(endX - x)
  const deltaY = Math.abs(endY - y)
  const stepX = x < endX ? 1 : -1
  const stepY = y < endY ? 1 : -1
  let error = deltaX - deltaY
  const points = []
  for (;;) {
    points.push({ x, y })
    if (x === endX && y === endY) break
    const twiceError = 2 * error
    if (twiceError > -deltaY) { error -= deltaY; x += stepX }
    if (twiceError < deltaX) { error += deltaX; y += stepY }
  }
  return points
}

async function renderInterfaceMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const tree = resolveInterfaceTree(spec, catalog)
  if (tree.diagnostics.some(item => item.severity === 'error')) {
    return {
      drawnAssetIds: [], diagnostics: tree.diagnostics, compositionMetrics: null,
      connectorMetrics: [],
    }
  }
  // TASK8_STABLE_BEGIN:renderer-palette-preflight
  const colorSelection = spec.visualSlots.colorScheme
  const colorPart = catalog.parts.find(part => (
    part.id === colorSelection.partId && part.slotId === 'colorScheme'
  ))
  if (
    options.applyPaletteMasks !== false
    && colorPart !== undefined
    && colorPart.rigMaskPaths?.[colorSelection.rigId] === undefined
  ) {
    return {
      drawnAssetIds: [],
      diagnostics: [interfacePaletteMaskMissingDiagnostic(colorPart.id, colorSelection.rigId)],
      compositionMetrics: null,
      connectorMetrics: [],
    }
  }
  // TASK8_STABLE_END:renderer-palette-preflight
  const surfaces = createInterfaceSurfaces(context, options.surfaceFactory ?? browserSurfaceFactory)
  if (surfaces === null) {
    return {
      drawnAssetIds: [], diagnostics: [compositionSurfaceUnavailableDiagnostic()],
      compositionMetrics: null, connectorMetrics: [],
    }
  }
  const diagnostics: Diagnostic[] = []
  // TASK8_STABLE_BEGIN:renderer-diagnostic-scope-helpers
  const suppressedDiagnostics: Diagnostic[] = []
  const diagnosticScope = options.diagnosticScope
  const pushConnectorMetricDiagnostic = (connectorId: string, diagnostic: Diagnostic) => {
    if (diagnosticScope !== undefined && !diagnosticScope.activeConnectorIds.includes(connectorId)) {
      suppressedDiagnostics.push(diagnostic)
    } else diagnostics.push(diagnostic)
  }
  const pushFaceMetricDiagnostic = (slotId: 'eyes' | 'mouthShape' | 'oralDetail', diagnostic: Diagnostic) => {
    if (diagnosticScope !== undefined && !diagnosticScope.activeVisualSlots.includes(slotId)) {
      suppressedDiagnostics.push(diagnostic)
    } else diagnostics.push(diagnostic)
  }
  // TASK8_STABLE_END:renderer-diagnostic-scope-helpers
  // TASK8_STABLE_BEGIN:renderer-v04-oral-asset-tolerance-helper
  const toleratedOralAssetLoadDiagnostics = new Set<Diagnostic>()
  const hasBlockingPreflightDiagnostic = () => diagnostics.some(item => (
    item.severity === 'error' && !toleratedOralAssetLoadDiagnostics.has(item)
  ))
  // TASK8_STABLE_END:renderer-v04-oral-asset-tolerance-helper
  const sources = new Map<string, CanvasImageSource>()
  for (const node of tree.nodes) {
    // TASK8_STABLE_BEGIN:renderer-skip-palette-source
    if (node.slotId === 'colorScheme') continue
    // TASK8_STABLE_END:renderer-skip-palette-source
    try {
      sources.set(node.key, await resolver.resolve(node.node.assetPath))
    } catch {
      // TASK8_STABLE_BEGIN:renderer-structural-load-check
      diagnostics.push(isStructuralSlot(node.slotId)
      // TASK8_STABLE_END:renderer-structural-load-check
        ? connectorCompositeDiagnostic(node.key, `Structural asset ${node.node.assetPath} is unavailable.`)
        : compositionAssetLoadDiagnostic(node))
      // TASK8_STABLE_BEGIN:renderer-v04-oral-asset-tolerance-registration
      const diagnostic = diagnostics.at(-1)
      if (
        diagnostic !== undefined
        && node.slotId === 'oralDetail'
        && node.part.id === spec.visualSlots.oralDetail.partId
        && node.part.composition?.isNone !== true
      ) toleratedOralAssetLoadDiagnostics.add(diagnostic)
      // TASK8_STABLE_END:renderer-v04-oral-asset-tolerance-registration
    }
  }
  const bridgeAssets = new Map<string, ResolvedBridgeAssets>()
  for (const item of tree.bridges) {
    try {
      const [
        neutral, frontMask, backMask,
        receiverContour, receiverForeground, receiverBackground,
        plugContour, plugForeground, plugBackground,
      ] = await Promise.all([
        resolveDecodedBridge(resolver, catalog.version, item.bridge.neutralAssetPath),
        resolver.resolve(item.bridge.frontMaskPath),
        resolver.resolve(item.bridge.backMaskPath),
        resolver.resolve(item.receiver.contourMaskPath),
        resolver.resolve(item.receiver.foregroundMaskPath),
        resolver.resolve(item.receiver.backgroundMaskPath),
        resolver.resolve(item.plug.contourMaskPath),
        resolver.resolve(item.plug.foregroundMaskPath),
        resolver.resolve(item.plug.backgroundMaskPath),
      ])
      bridgeAssets.set(item.key, {
        neutral, frontMask, backMask,
        receiverContour, receiverForeground, receiverBackground,
        plugContour, plugForeground, plugBackground,
      })
    } catch {
      diagnostics.push(connectorCompositeDiagnostic(
        item.connectorId, `Bridge resources for ${item.bridge.id} are unavailable or invalid.`,
      ))
    }
  }
  // TASK8_STABLE_BEGIN:renderer-v04-preflight-gate-1
  if (hasBlockingPreflightDiagnostic()) {
  // TASK8_STABLE_END:renderer-v04-preflight-gate-1
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }

  const frameMeshes = interfaceFrameMeshes(spec, tree, resolver)
  const meshes = new Map<string, BridgeMesh>()
  const colors = new Map<string, readonly [string, string]>()
  const receiverContours = new Map<string, Uint8ClampedArray>()
  const plugContours = new Map<string, Uint8ClampedArray>()
  for (const item of tree.bridges) {
    try {
      const assets = bridgeAssets.get(item.key)!
      const receiver = nodeSource(item, 'parentNodeKey', tree, sources)
      const plug = nodeSource(item, 'childNodeKey', tree, sources)
      if (receiver === undefined || plug === undefined) throw new Error('invalid connector nodes')
      clearSurface(surfaces.receiverContour)
      clearSurface(surfaces.plugContour)
      drawPlacedSource(surfaces.receiverContour.context, receiver.node, assets.receiverContour)
      drawPlacedSource(surfaces.plugContour.context, plug.node, assets.plugContour)
      const receiverContour = imageData(surfaces.receiverContour)
      const plugContour = imageData(surfaces.plugContour)
      if (
        receiverContour.length !== MASTER_SIZE * MASTER_SIZE * 4
        || plugContour.length !== receiverContour.length
      ) throw new Error('invalid connector contours')
      receiverContours.set(item.key, receiverContour)
      plugContours.set(item.key, plugContour)
      let mesh = frameMeshes.get(item.key)
      if (mesh === undefined) {
        mesh = buildBridgeMesh(item.solved, {
          receiver: { pixels: receiverContour, width: MASTER_SIZE, height: MASTER_SIZE },
          plug: { pixels: plugContour, width: MASTER_SIZE, height: MASTER_SIZE },
        })
        frameMeshes.set(item.key, mesh)
      }
      meshes.set(item.key, mesh)
      const receiverColor = receiver?.source === undefined ? null : sampleMaterial(
        surfaces.materialSample, receiver.source, receiver.node, item.receiver.materialSampleRegion,
      )
      const plugColor = plug?.source === undefined ? null : sampleMaterial(
        surfaces.materialSample, plug.source, plug.node, item.plug.materialSampleRegion,
      )
      if (receiverColor === null || plugColor === null) throw new Error('invalid material mask')
      colors.set(item.key, [receiverColor, plugColor])
    } catch {
      diagnostics.push(connectorCompositeDiagnostic(
        item.connectorId, `Bridge mesh or material samples for ${item.bridge.id} are invalid.`,
      ))
    }
  }
  // TASK8_STABLE_BEGIN:renderer-v04-preflight-gate-2
  if (hasBlockingPreflightDiagnostic()) {
  // TASK8_STABLE_END:renderer-v04-preflight-gate-2
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }

  const bridgePixels = new Map<string, Uint8ClampedArray>()
  try {
    clearSurface(surfaces.bodyAlpha)
    clearSurface(surfaces.structureAlpha)
    const bodyNode = tree.nodes.find(node => node.slotId === 'bodyFrame')
    const bodySource = bodyNode === undefined ? undefined : sources.get(bodyNode.key)
    if (bodyNode !== undefined && bodySource !== undefined) {
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, bodyNode, bodySource, surfaces.bodyAlpha, tree.faceSafeZones,
      )
      surfaces.bodyAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
    for (const item of tree.bridges) {
      const mesh = meshes.get(item.key)!
      const assets = bridgeAssets.get(item.key)!
      clearSurface(surfaces.bridgeAlpha)
      // TASK8_STABLE_BEGIN:renderer-role-masked-bridge-metrics
      if (options.connectorMetricProjection === 'task8-task9-neutral-bridge-v1') {
        // Task 8/9 approvals bind the pre-F005 neutral-bridge metric. This
        // explicit audit-only projection never participates in live preview.
        drawBridgeMesh(surfaces.bridgeAlpha.context, assets.neutral, mesh)
      } else {
        const receiverSource = sources.get(item.parentNodeKey)
        const sampledColors = colors.get(item.key)
        if (receiverSource === undefined || sampledColors === undefined) {
          throw new Error('invalid bridge metric inputs')
        }
        // Measure the same foreground/background role-masked union that is
        // composited into the final image. A neutral bridge can span both
        // contours even when mismatched role masks leave the visible seam open.
        drawBridgePass(
          surfaces.bridgeAlpha.context,
          surfaces,
          item,
          assets,
          mesh,
          tree,
          receiverSource,
          options.bridgeRoleProjection,
          sampledColors[0],
          sampledColors[1],
          'union',
        )
      }
      // TASK8_STABLE_END:renderer-role-masked-bridge-metrics
      const pixels = imageData(surfaces.bridgeAlpha)
      if (pixels.length !== MASTER_SIZE * MASTER_SIZE * 4) throw new Error('invalid bridge alpha')
      bridgePixels.set(item.key, pixels)
      surfaces.structureAlpha.context.drawImage(surfaces.bridgeAlpha.canvas, 0, 0)
    }
    // TASK8_STABLE_BEGIN:renderer-structural-metric-filter
    for (const node of tree.nodes.filter(item => isStructuralSlot(item.slotId))) {
    // TASK8_STABLE_END:renderer-structural-metric-filter
      const source = sources.get(node.key)
      if (source === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, node, source, surfaces.bodyAlpha, tree.faceSafeZones,
      )
      surfaces.structureAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
  } catch (error) {
    diagnostics.push(connectorCompositeDiagnostic(
      'structure', error instanceof Error && error.message.includes('affine')
        ? 'A bridge mesh requires affine canvas APIs.'
        : 'A bridge mesh or catalog seam mask could not be drawn.',
    ))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }

  let structurePixels: Uint8ClampedArray
  try {
    structurePixels = imageData(surfaces.structureAlpha)
    if (structurePixels.length !== MASTER_SIZE * MASTER_SIZE * 4) throw new Error('invalid alpha mask')
  } catch {
    diagnostics.push(connectorCompositeDiagnostic('structure', 'Structural alpha mask is unreadable.'))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }
  let bodyPixels: Uint8ClampedArray
  try {
    bodyPixels = imageData(surfaces.bodyAlpha)
    if (bodyPixels.length !== structurePixels.length) throw new Error('invalid body mask')
  } catch {
    diagnostics.push(connectorCompositeDiagnostic('structure', 'Structural body mask is unreadable.'))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }
  const connectorMetrics: ConnectorMetric[] = []
  for (const item of tree.bridges) {
    const child = tree.nodes.find(node => node.key === item.childNodeKey)
    const childSource = child === undefined ? undefined : sources.get(child.key)
    clearSurface(surfaces.childAlpha)
    if (child !== undefined && childSource !== undefined) {
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, child, childSource, surfaces.bodyAlpha, tree.faceSafeZones,
      )
      surfaces.childAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
    let metric: ConnectorMetric
    try {
      const receiverContour = receiverContours.get(item.key)!
      const plugContour = plugContours.get(item.key)!
      const receiverCenter = alphaCentroid(receiverContour, MASTER_SIZE)
      const plugCenter = alphaCentroid(plugContour, MASTER_SIZE)
      if (receiverCenter === null || plugCenter === null) throw new Error('empty contour')
      const measuresExternalAlpha = child?.slotId === 'arms' || child?.slotId === 'legs'
      metric = measureConnectorAlpha({
        connectorId: item.connectorId,
        bridge: bridgePixels.get(item.key)!,
        receiverContour,
        plugContour,
        structure: structurePixels,
        ...(measuresExternalAlpha ? {
          body: bodyPixels,
          child: imageData(surfaces.childAlpha),
        } : {}),
        width: MASTER_SIZE,
        height: MASTER_SIZE,
        centerline: rasterLine(receiverCenter, plugCenter),
      })
    } catch {
      diagnostics.push(connectorCompositeDiagnostic(
        item.connectorId, `Connector alpha mask for ${item.bridge.id} is unreadable.`,
      ))
      continue
    }
    connectorMetrics.push(metric)
    const measuresExternalAlpha = child?.slotId === 'arms' || child?.slotId === 'legs'
    if (!connectorMetricMeetsThresholds(metric, false)) {
      // TASK8_STABLE_BEGIN:renderer-connector-diagnostic-call-1
      pushConnectorMetricDiagnostic(item.connectorId, connectorCompositeDiagnostic(
      // TASK8_STABLE_END:renderer-connector-diagnostic-call-1
        // TASK8_STABLE_BEGIN:renderer-task10-connector-threshold-message
        item.connectorId, `Bridge ${item.bridge.id} is below 0.62 receiver coverage, below 0.90 plug coverage, or above a 2px gap.`,
        // TASK8_STABLE_END:renderer-task10-connector-threshold-message
      ))
    }
    if (
      measuresExternalAlpha
      && (metric.childOutsideBodyRatio ?? 0) < EXTERNAL_LIMB_ALPHA_MIN
    ) {
      // TASK8_STABLE_BEGIN:renderer-connector-diagnostic-call-2
      pushConnectorMetricDiagnostic(item.connectorId, connectorCompositeDiagnostic(
      // TASK8_STABLE_END:renderer-connector-diagnostic-call-2
        item.connectorId, `Structural child alpha outside the body is below ${EXTERNAL_LIMB_ALPHA_MIN}.`,
      ))
    }
  }
  const structureMetric = connectorMetrics[0]
  const connectedRatio = structureMetric?.largestComponentRatio ?? 0
  if (structureMetric === undefined || !structureMetricMeetsThreshold(structureMetric)) {
    diagnostics.push(structureDisconnectedDiagnostic(connectedRatio))
  }

  const nodes = tree.nodes.filter(node => options.includeGroundShadow || node.node.layer !== 'groundShadow')
  // TASK8_STABLE_BEGIN:renderer-structural-final-filter
  const structural = nodes.filter(node => isStructuralSlot(node.slotId))
  // TASK8_STABLE_END:renderer-structural-final-filter
  const structuralByKey = new Map(structural.map(node => [node.key, node]))
  const headOcclusionMasks = new Map<string, { foreground: CanvasImageSource, background: CanvasImageSource }>()
  for (const bridge of tree.bridges) {
    const parent = structuralByKey.get(bridge.parentNodeKey)
    const child = structuralByKey.get(bridge.childNodeKey)
    if (
      parent?.slotId === 'bodyFrame'
      && child?.node.layer === 'head'
      && bridge.plug.role === 'plug'
    ) {
      const assets = bridgeAssets.get(bridge.key)
      if (assets !== undefined) headOcclusionMasks.set(child.key, {
        foreground: assets.plugForeground,
        background: assets.plugBackground,
      })
    }
  }
  const layeredHeads = structural.filter(node => headOcclusionMasks.has(node.key))
  const rear = structural.filter(node => node.slotId !== 'bodyFrame' && node.node.layer === 'rearAppendage')
  const bodyAndHead = structural.filter(node => (
    !rear.includes(node) && !layeredHeads.includes(node)
  )).sort((left, right) => (
    (left.slotId === 'headShape' ? 2 : left.slotId === 'bodyFrame' ? 1 : 0)
      - (right.slotId === 'headShape' ? 2 : right.slotId === 'bodyFrame' ? 1 : 0)
      || left.sequence - right.sequence
  ))
  // TASK8_STABLE_BEGIN:renderer-v04-body-appearance-partition
  const body = bodyAndHead.filter(node => node.slotId === 'bodyFrame')
  const unlayeredHeads = bodyAndHead.filter(node => node.slotId === 'headShape')
  const limbsBehindBody = bodyAndHead.filter(node => (
    node.slotId !== 'bodyFrame' && node.slotId !== 'headShape'
  ))
  const isBodyAppearanceNode = (node: ResolvedRenderNode) => (
    node.slotId === 'surfaceMaterial' || node.slotId === 'pattern'
  )
  const bodyAppearance = nodes.filter(node => (
    !isStructuralSlot(node.slotId) && isBodyAppearanceNode(node)
  )).sort((left, right) => (
    compositionLayerRank.get(left.node.layer)! - compositionLayerRank.get(right.node.layer)!
      || left.sequence - right.sequence
  ))
  // TASK8_STABLE_END:renderer-v04-body-appearance-partition
  // TASK8_STABLE_BEGIN:renderer-nonstructural-final-filter
  const nonStructural = nodes.filter(node => (
    !isStructuralSlot(node.slotId) && !isBodyAppearanceNode(node)
  )).sort((left, right) => (
  // TASK8_STABLE_END:renderer-nonstructural-final-filter
    compositionLayerRank.get(left.node.layer)! - compositionLayerRank.get(right.node.layer)!
      || left.sequence - right.sequence
  ))
  clearSurface(surfaces.eyesAlpha)
  clearSurface(surfaces.mouthAlpha)
  clearSurface(surfaces.outputAlpha)
  clearSurface(surfaces.eyesOccluderAlpha)
  clearSurface(surfaces.mouthOccluderAlpha)
  // TASK8_STABLE_BEGIN:renderer-v04-interface-oral-surface-clear
  clearSurface(surfaces.oralDetailAlpha)
  clearSurface(surfaces.oralDetailOccluderAlpha)
  // TASK8_STABLE_END:renderer-v04-interface-oral-surface-clear
  clearSurface(surfaces.finalOutput)
  const drawnAssetIds: string[] = []
  const finalContext = surfaces.finalOutput.context
  try {
    // TASK8_STABLE_BEGIN:renderer-bridge-draw-setup
    const orderedBridges = [...tree.bridges].sort((left, right) => {
      const leftSequence = structuralByKey.get(left.childNodeKey)?.sequence ?? Number.MAX_SAFE_INTEGER
      const rightSequence = structuralByKey.get(right.childNodeKey)?.sequence ?? Number.MAX_SAFE_INTEGER
      return leftSequence - rightSequence || left.connectorId.localeCompare(right.connectorId)
    })
    const drawBridges = (pass: 'back' | 'front') => {
      for (const bridge of orderedBridges) {
        const assets = bridgeAssets.get(bridge.key)
        const mesh = meshes.get(bridge.key)
        const sampledColors = colors.get(bridge.key)
        const receiverSource = sources.get(bridge.parentNodeKey)
        if (
          assets === undefined || mesh === undefined || sampledColors === undefined
          || receiverSource === undefined
        ) {
          throw new Error(`Bridge draw inputs for ${bridge.connectorId} are unavailable.`)
        }
        drawBridgePass(
          finalContext, surfaces, bridge, assets, mesh, tree, receiverSource,
          options.bridgeRoleProjection, sampledColors[0], sampledColors[1], pass,
        )
      }
    }
    // TASK8_STABLE_END:renderer-bridge-draw-setup
    // TASK8_STABLE_BEGIN:renderer-v04-body-appearance-draw-helper
    const drawNodes = (
      items: readonly ResolvedRenderNode[],
      clipAlpha = surfaces.structureAlpha,
    ) => {
      for (const node of items) {
        const source = sources.get(node.key)
        if (source === undefined) continue
        drawCompositionNodeToSurface(
          surfaces.nodeLayer, node, source, clipAlpha, tree.faceSafeZones,
        )
        finalContext.drawImage(surfaces.nodeLayer.canvas, 0, 0)
        drawMetricAlpha(surfaces.outputAlpha, surfaces.nodeLayer)
        drawnAssetIds.push(node.key)
      }
    }
    // TASK8_STABLE_END:renderer-v04-body-appearance-draw-helper
    // TASK8_STABLE_BEGIN:renderer-bridge-back-call
    drawBridges('back')
    // TASK8_STABLE_END:renderer-bridge-back-call
    drawNodes(rear)
    for (const node of layeredHeads) {
      const source = sources.get(node.key)
      const masks = headOcclusionMasks.get(node.key)
      if (source === undefined || masks === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, node, source, surfaces.structureAlpha, tree.faceSafeZones,
      )
      clearSurface(surfaces.connectorMask)
      drawPlacedSource(surfaces.connectorMask.context, node, masks.background)
      withSavedContext(surfaces.nodeLayer.context, () => {
        surfaces.nodeLayer.context.globalCompositeOperation = 'destination-in'
        surfaces.nodeLayer.context.drawImage(surfaces.connectorMask.canvas, 0, 0)
      })
      finalContext.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
    // TASK8_STABLE_BEGIN:renderer-v04-body-appearance-render-order
    drawNodes(limbsBehindBody)
    drawNodes(body)
    drawNodes(bodyAppearance, surfaces.bodyAlpha)
    drawNodes(unlayeredHeads)
    // TASK8_STABLE_END:renderer-v04-body-appearance-render-order
    for (const node of layeredHeads) {
      const source = sources.get(node.key)
      const masks = headOcclusionMasks.get(node.key)
      if (source === undefined || masks === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, node, source, surfaces.structureAlpha, tree.faceSafeZones,
      )
      clearSurface(surfaces.connectorMask)
      drawPlacedSource(surfaces.connectorMask.context, node, masks.foreground)
      withSavedContext(surfaces.nodeLayer.context, () => {
        surfaces.nodeLayer.context.globalCompositeOperation = 'destination-in'
        surfaces.nodeLayer.context.drawImage(surfaces.connectorMask.canvas, 0, 0)
      })
      finalContext.drawImage(surfaces.nodeLayer.canvas, 0, 0)
      drawMetricAlpha(surfaces.outputAlpha, surfaces.nodeLayer)
      drawnAssetIds.push(node.key)
    }
    // TASK8_STABLE_BEGIN:renderer-bridge-front-call
    drawBridges('front')
    // TASK8_STABLE_END:renderer-bridge-front-call
    // TASK8_STABLE_BEGIN:renderer-pre-face-bridge-comment
    // TASK8_STABLE_END:renderer-pre-face-bridge-comment
    // TASK8_STABLE_BEGIN:renderer-palette-pass
    const colorMasks = colorPart?.rigMaskPaths?.[colorSelection.rigId]
    if (options.applyPaletteMasks !== false && colorPart !== undefined && colorMasks !== undefined) {
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
    // TASK8_STABLE_END:renderer-palette-pass
    let eyesStarted = false
    let mouthStarted = false
    // TASK8_STABLE_BEGIN:renderer-v04-interface-oral-start
    let oralDetailStarted = false
    // TASK8_STABLE_END:renderer-v04-interface-oral-start
    for (const node of nonStructural) {
      // TASK8_STABLE_BEGIN:renderer-skip-palette-node
      if (node.slotId === 'colorScheme') continue
      // TASK8_STABLE_END:renderer-skip-palette-node
      const source = sources.get(node.key)
      if (source === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.nodeLayer, node, source, surfaces.structureAlpha, tree.faceSafeZones,
      )
      finalContext.drawImage(surfaces.nodeLayer.canvas, 0, 0)
      drawMetricAlpha(surfaces.outputAlpha, surfaces.nodeLayer)
      // TASK8_STABLE_BEGIN:renderer-task10-face-occluder-routing
      const occlusionTargets = faceMetricOcclusionTargets(node.slotId, {
        eyes: eyesStarted, mouth: mouthStarted,
      })
      if (node.slotId === 'eyes') {
        drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.eyesAlpha, surfaces.nodeLayer)
        eyesStarted = true
      } else if (occlusionTargets.eyes) drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer)
      if (node.slotId === 'mouthShape') {
        drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.mouthAlpha, surfaces.nodeLayer)
        mouthStarted = true
      } else if (occlusionTargets.mouth) drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer)
      if (node.slotId === 'oralDetail') {
        drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer, 'destination-out')
        drawMetricAlpha(surfaces.oralDetailAlpha, surfaces.nodeLayer)
        oralDetailStarted = true
      } else if (oralDetailStarted) {
        drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer)
      }
      // TASK8_STABLE_END:renderer-task10-face-occluder-routing
      drawnAssetIds.push(node.key)
    }
  } catch {
    diagnostics.push(connectorCompositeDiagnostic(
      'structure', 'The final isolated bridge composition failed.',
    ))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics }
  }

  let compositionMetrics: CompositionMetrics | null = null
  try {
    const metricFaceSafeZones = scaleFaceSafeZones(tree.faceSafeZones)
    const eyes = measureFeatureAlpha(
      imageData(surfaces.eyesAlpha, METRIC_SIZE), imageData(surfaces.eyesOccluderAlpha, METRIC_SIZE),
      METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
    )
    const mouth = measureFeatureAlpha(
      imageData(surfaces.mouthAlpha, METRIC_SIZE), imageData(surfaces.mouthOccluderAlpha, METRIC_SIZE),
      METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
    )
    // TASK8_STABLE_BEGIN:renderer-v04-interface-face-metrics
    const selectedOralDetail = catalog.parts.find(part => (
      part.slotId === 'oralDetail' && part.id === spec.visualSlots.oralDetail.partId
    ))
    const oralDetail = selectedOralDetail?.composition?.isNone === true
      ? null
      : measureFeatureAlpha(
        imageData(surfaces.oralDetailAlpha, METRIC_SIZE),
        imageData(surfaces.oralDetailOccluderAlpha, METRIC_SIZE),
        METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
      )
    compositionMetrics = {
      eyesInsideRatio: eyes.insideRatio, eyesVisibleRatio: eyes.visibleRatio,
      mouthInsideRatio: mouth.insideRatio, mouthVisibleRatio: mouth.visibleRatio,
      oralDetailInsideRatio: oralDetail?.insideRatio ?? null,
      oralDetailVisibleRatio: oralDetail?.visibleRatio ?? null,
      visibleBounds: scaleMetricBounds(measureVisibleBounds(
        imageData(surfaces.outputAlpha, METRIC_SIZE), METRIC_SIZE, METRIC_SIZE,
      )),
    }
    const policy = catalog.compositionPolicy!
    const faceMetrics: Array<readonly [
      'eyes' | 'mouthShape' | 'oralDetail',
      typeof eyes,
    ]> = [['eyes', eyes], ['mouthShape', mouth]]
    if (oralDetail !== null) faceMetrics.push(['oralDetail', oralDetail])
    for (const [slotId, metric] of faceMetrics) {
      const thresholds = faceMetricThresholds(policy, slotId)!
      if (metric.insideRatio < thresholds.inside) {
        pushFaceMetricDiagnostic(slotId, metricDiagnostic(
          'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, thresholds.inside,
        ))
      }
      if (metric.visibleRatio < thresholds.visible) {
        pushFaceMetricDiagnostic(slotId, metricDiagnostic(
          'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, thresholds.visible,
        ))
      }
    }
    // TASK8_STABLE_END:renderer-v04-interface-face-metrics
    if (
      compositionMetrics.visibleBounds !== null
      // TASK8_STABLE_BEGIN:renderer-shared-interface-bounds-call
      && !boundsInsideFrame(compositionMetrics.visibleBounds, policy.frameBounds)
      // TASK8_STABLE_END:renderer-shared-interface-bounds-call
    ) diagnostics.push(boundsExceededDiagnostic())
  } catch {
    diagnostics.push(connectorCompositeDiagnostic('structure', 'Interface alpha metrics are unreadable.'))
  }
  try {
    withSavedContext(context, () => {
      context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
      context.drawImage(surfaces.finalOutput.canvas, 0, 0)
    })
  } catch {
    diagnostics.push(connectorCompositeDiagnostic(
      'structure', 'The final isolated composition could not be committed.',
    ))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics }
  }
  // TASK8_STABLE_BEGIN:renderer-diagnostic-return
  return {
    drawnAssetIds, diagnostics, compositionMetrics, connectorMetrics,
    ...(diagnosticScope === undefined ? {} : {
      diagnosticScope: {
        ...diagnosticScope,
        activeVisualSlots: [...diagnosticScope.activeVisualSlots],
        activeConnectorIds: [...diagnosticScope.activeConnectorIds],
        suppressedDiagnostics,
      },
    }),
  }
  // TASK8_STABLE_END:renderer-diagnostic-return
}

function anatomyBundleAssetLoadDiagnostic(assetPath: string): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: ['anatomyBundle'],
    message: `Failed to load anatomy bundle resource ${assetPath}.`,
  }
}

function anatomyBundleRenderPlanDiagnostic(): Diagnostic {
  return {
    severity: 'error',
    code: 'ANATOMY_BUNDLE_RENDER_PLAN_INVALID',
    path: ['anatomyBundleId'],
    message: 'The selected anatomy bundle does not provide its structural render node.',
  }
}

function anatomyNodePlacement(
  node: ResolvedRenderNode['node'],
  slotId: ResolvedRenderNode['slotId'],
  part: ResolvedRenderNode['part'],
  bundle: ReturnType<typeof resolveAnatomyBundleRenderPlan> extends infer Plan
    ? Plan extends { bundle: infer Bundle } ? Bundle : never
    : never,
): Placement {
  const specialAnchor = part.specialFeatureAnchor === undefined
    ? undefined
    : bundle.mutationAnchors[part.specialFeatureAnchor]
  const localSocket = specialAnchor === undefined
    ? node.parentSlot === null
      ? { x: 1024, y: 1024 }
      : bundle.featureSockets[node.socket ?? slotId] ?? { x: 1024, y: 1024 }
    : {
      x: specialAnchor.x + specialAnchor.width / 2,
      y: specialAnchor.y + specialAnchor.height / 2,
    }
  const scaleX = node.transform.mirrorX ? -node.transform.scale : node.transform.scale
  return {
    x: localSocket.x - node.origin.x * scaleX,
    y: localSocket.y - node.origin.y * node.transform.scale,
    scaleX,
    scaleY: node.transform.scale,
  }
}

function anatomyBundleNodes(
  spec: MonsterSpec,
  catalog: Catalog,
  plan: NonNullable<ReturnType<typeof resolveAnatomyBundleRenderPlan>>,
): ResolvedRenderNode[] {
  const nodes: ResolvedRenderNode[] = []
  let sequence = 0
  for (const slotId of Object.keys(spec.visualSlots) as ResolvedRenderNode['slotId'][]) {
    if (isStructuralSlot(slotId)) continue
    const selection = spec.visualSlots[slotId]
    const part = catalog.parts.find(candidate => (
      candidate.slotId === slotId && candidate.id === selection.partId
    ))
    const composition = part?.composition
    if (part === undefined || !isAttachmentPartComposition(composition) || composition.isNone) continue
    for (const node of composition.renderNodes) {
      if (!node.compatibleRigs.includes(selection.rigId)) continue
      nodes.push({
        key: node.id,
        slotId,
        part,
        node,
        placement: anatomyNodePlacement(node, slotId, part, plan.bundle),
        sequence,
      })
      sequence += 1
    }
  }
  return nodes.sort((left, right) => (
    compositionLayerRank.get(left.node.layer)! - compositionLayerRank.get(right.node.layer)!
      || left.sequence - right.sequence
  ))
}

function anatomyNodeClip(
  node: ResolvedRenderNode,
  plan: NonNullable<ReturnType<typeof resolveAnatomyBundleRenderPlan>>,
): 'surface' | { x: number; y: number; width: number; height: number } | null {
  const specialAnchor = node.part.specialFeatureAnchor === undefined
    ? undefined
    : plan.bundle.mutationAnchors[node.part.specialFeatureAnchor]
  if (specialAnchor !== undefined) return specialAnchor
  if (['surfaceMaterial', 'pattern', 'colorScheme'].includes(node.slotId)) return 'surface'
  if (['eyes', 'mouthShape', 'oralDetail', 'headAppendage'].includes(node.slotId)) {
    return plan.bundle.faceSafeZone
  }
  return null
}

function clipAnatomyNode(
  surface: RenderSurface,
  clip: ReturnType<typeof anatomyNodeClip>,
  localClipMask: RenderSurface,
): void {
  if (clip === null) return
  withSavedContext(surface.context, () => {
    surface.context.globalCompositeOperation = 'destination-in'
    if (clip === 'surface') surface.context.drawImage(localClipMask.canvas, 0, 0)
    else surface.context.fillRect(clip.x, clip.y, clip.width, clip.height)
  })
}

async function renderAnatomyBundleMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const plan = resolveAnatomyBundleRenderPlan(spec, catalog)
  if (plan === null) {
    return {
      drawnAssetIds: [], diagnostics: [anatomyBundleRenderPlanDiagnostic()],
      compositionMetrics: null, connectorMetrics: [],
    }
  }
  const surfaces = createInterfaceSurfaces(context, options.surfaceFactory ?? browserSurfaceFactory)
  if (surfaces === null) {
    return {
      drawnAssetIds: [], diagnostics: [compositionSurfaceUnavailableDiagnostic()],
      compositionMetrics: null, connectorMetrics: [],
    }
  }
  const diagnostics: Diagnostic[] = []
  const sources = new Map<string, CanvasImageSource>()
  const load = async (assetPath: string): Promise<CanvasImageSource | null> => {
    const cached = sources.get(assetPath)
    if (cached !== undefined) return cached
    try {
      const source = await resolver.resolve(assetPath)
      sources.set(assetPath, source)
      return source
    } catch {
      diagnostics.push(anatomyBundleAssetLoadDiagnostic(assetPath))
      return null
    }
  }
  const [structural, structuralAlpha, localClip] = await Promise.all([
    load(plan.bundle.structural.assetPath),
    load(plan.bundle.alpha.assetPath),
    load(plan.localClipMask.assetPath),
  ])
  if (structural === null || structuralAlpha === null || localClip === null) {
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }

  const nodes = anatomyBundleNodes(spec, catalog, plan)
  const nodeSources = new Map<string, CanvasImageSource>()
  for (const node of nodes) {
    const source = await load(node.node.assetPath)
    if (source !== null) nodeSources.set(node.key, source)
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }

  for (const surface of [
    surfaces.nodeLayer, surfaces.childAlpha, surfaces.structureAlpha, surfaces.finalOutput,
    surfaces.eyesAlpha, surfaces.mouthAlpha, surfaces.outputAlpha,
    surfaces.eyesOccluderAlpha, surfaces.mouthOccluderAlpha,
    surfaces.oralDetailAlpha, surfaces.oralDetailOccluderAlpha,
  ]) clearSurface(surface)
  surfaces.structureAlpha.context.drawImage(structuralAlpha, 0, 0)
  surfaces.childAlpha.context.drawImage(localClip, 0, 0)
  surfaces.finalOutput.context.drawImage(structural, 0, 0)
  drawMetricAlpha(surfaces.outputAlpha, surfaces.structureAlpha)

  const seenFaceSlots = new Set<ResolvedRenderNode['slotId']>()
  let eyesStarted = false
  let mouthStarted = false
  let oralDetailStarted = false
  for (const node of nodes) {
    const source = nodeSources.get(node.key)
    if (source === undefined) continue
    clearSurface(surfaces.nodeLayer)
    drawPlacedSource(surfaces.nodeLayer.context, node, source)
    clipAnatomyNode(surfaces.nodeLayer, anatomyNodeClip(node, plan), surfaces.childAlpha)
    surfaces.finalOutput.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    drawMetricAlpha(surfaces.outputAlpha, surfaces.nodeLayer)
    if (node.slotId === 'eyes') {
      drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer, 'destination-out')
      drawMetricAlpha(surfaces.eyesAlpha, surfaces.nodeLayer)
      eyesStarted = true
      seenFaceSlots.add(node.slotId)
    } else if (eyesStarted) drawMetricAlpha(surfaces.eyesOccluderAlpha, surfaces.nodeLayer)
    if (node.slotId === 'mouthShape') {
      drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer, 'destination-out')
      drawMetricAlpha(surfaces.mouthAlpha, surfaces.nodeLayer)
      mouthStarted = true
      seenFaceSlots.add(node.slotId)
    } else if (mouthStarted) drawMetricAlpha(surfaces.mouthOccluderAlpha, surfaces.nodeLayer)
    if (node.slotId === 'oralDetail') {
      drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer, 'destination-out')
      drawMetricAlpha(surfaces.oralDetailAlpha, surfaces.nodeLayer)
      oralDetailStarted = true
      seenFaceSlots.add(node.slotId)
    } else if (oralDetailStarted) drawMetricAlpha(surfaces.oralDetailOccluderAlpha, surfaces.nodeLayer)
  }

  let compositionMetrics: CompositionMetrics | null = null
  try {
    const metricFaceSafeZones = scaleFaceSafeZones(plan.faceSafeZones)
    const eyes = measureFeatureAlpha(
      imageData(surfaces.eyesAlpha, METRIC_SIZE), imageData(surfaces.eyesOccluderAlpha, METRIC_SIZE),
      METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
    )
    const mouth = measureFeatureAlpha(
      imageData(surfaces.mouthAlpha, METRIC_SIZE), imageData(surfaces.mouthOccluderAlpha, METRIC_SIZE),
      METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
    )
    const oralDetail = seenFaceSlots.has('oralDetail')
      ? measureFeatureAlpha(
        imageData(surfaces.oralDetailAlpha, METRIC_SIZE),
        imageData(surfaces.oralDetailOccluderAlpha, METRIC_SIZE),
        METRIC_SIZE, METRIC_SIZE, metricFaceSafeZones,
      )
      : null
    const visibleBounds = scaleMetricBounds(measureVisibleBounds(
      imageData(surfaces.outputAlpha, METRIC_SIZE), METRIC_SIZE, METRIC_SIZE,
    ))
    compositionMetrics = {
      eyesInsideRatio: seenFaceSlots.has('eyes') ? eyes.insideRatio : 1,
      eyesVisibleRatio: seenFaceSlots.has('eyes') ? eyes.visibleRatio : 1,
      mouthInsideRatio: seenFaceSlots.has('mouthShape') ? mouth.insideRatio : 1,
      mouthVisibleRatio: seenFaceSlots.has('mouthShape') ? mouth.visibleRatio : 1,
      oralDetailInsideRatio: oralDetail?.insideRatio ?? null,
      oralDetailVisibleRatio: oralDetail?.visibleRatio ?? null,
      visibleBounds,
    }
    const policy = catalog.compositionPolicy
    if (policy !== undefined) {
      const metrics: Array<readonly ['eyes' | 'mouthShape' | 'oralDetail', typeof eyes]> = []
      if (seenFaceSlots.has('eyes')) metrics.push(['eyes', eyes])
      if (seenFaceSlots.has('mouthShape')) metrics.push(['mouthShape', mouth])
      if (oralDetail !== null) metrics.push(['oralDetail', oralDetail])
      for (const [slotId, metric] of metrics) {
        const thresholds = faceMetricThresholds(policy, slotId)!
        if (metric.insideRatio < thresholds.inside) diagnostics.push(metricDiagnostic(
          'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, thresholds.inside,
        ))
        if (metric.visibleRatio < thresholds.visible) diagnostics.push(metricDiagnostic(
          'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, thresholds.visible,
        ))
      }
      if (visibleBounds !== null && !boundsInsideFrame(visibleBounds, policy.frameBounds)) {
        diagnostics.push(boundsExceededDiagnostic())
      }
    }
  } catch {
    diagnostics.push(anatomyBundleAssetLoadDiagnostic('anatomy-bundle-metrics'))
  }
  try {
    withSavedContext(context, () => {
      context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
      context.drawImage(surfaces.finalOutput.canvas, 0, 0)
    })
  } catch {
    diagnostics.push(anatomyBundleAssetLoadDiagnostic('anatomy-bundle-output'))
    return { drawnAssetIds: [], diagnostics, compositionMetrics: null, connectorMetrics: [] }
  }
  return {
    drawnAssetIds: [plan.bundle.id, ...nodes.map(node => node.key)],
    diagnostics,
    compositionMetrics,
    connectorMetrics: [],
  }
}

// TASK8_STABLE_BEGIN:renderer-versioned-interface-pair-helper
function isInterfaceRenderPair(spec: MonsterSpec, catalog: Catalog): boolean {
  return (catalog.version === '0.3.0' && spec.rendererVersion === '0.3.0')
    || (catalog.version === '0.4.0' && spec.rendererVersion === '0.4.0')
    || (catalog.version === '0.5.0' && spec.rendererVersion === '0.5.0')
}

function isV06RenderPair(spec: MonsterSpec, catalog: Catalog): boolean {
  return catalog.version === '0.6.0' && spec.rendererVersion === '0.6.0'
}
// TASK8_STABLE_END:renderer-versioned-interface-pair-helper

export async function renderMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  // TASK8_STABLE_BEGIN:renderer-diagnostic-scope-validation
  if (
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
      connectorMetrics: isInterfaceRenderPair(spec, catalog) ? [] : null,
    }
  }
  // TASK8_STABLE_END:renderer-diagnostic-scope-validation
  const validationDiagnostics = validateMonsterSpecAgainstCatalog(spec, catalog)
  if (validationDiagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return {
      drawnAssetIds: [], diagnostics: validationDiagnostics, compositionMetrics: null,
      // TASK8_STABLE_BEGIN:renderer-v04-invalid-interface-pair
      connectorMetrics: isInterfaceRenderPair(spec, catalog) || isV06RenderPair(spec, catalog) ? [] : null,
      // TASK8_STABLE_END:renderer-v04-invalid-interface-pair
    }
  }
  if (resolveAnatomyBundleRenderPlan(spec, catalog) !== null) {
    return renderAnatomyBundleMonster(context, spec, catalog, resolver, options)
  }
  // TASK8_STABLE_BEGIN:renderer-v04-interface-route
  if (isInterfaceRenderPair(spec, catalog)) {
  // TASK8_STABLE_END:renderer-v04-interface-route
    return renderInterfaceMonster(context, spec, catalog, resolver, options)
  }
  if (catalog.compositionPolicy !== undefined && spec.rendererVersion === '0.2.0') {
    return renderCompositionMonster(context, spec, catalog, resolver, options)
  }
  const expanded = expandRenderLayers(spec, catalog)
  const diagnostics = [...expanded.diagnostics]
  const drawnAssetIds: string[] = []
  const surfaces = createCompositeSurfaces(
    context,
    options.surfaceFactory ?? browserSurfaceFactory,
  )

  await withSavedContextAsync(context, async () => {
    context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
    for (const layer of expanded.layers) {
      if (!options.includeGroundShadow && layer.part.layer === 'groundShadow') continue
      if (surfaces === null) {
        if (hasMasks(layer)) {
          diagnostics.push(surfaceUnavailableDiagnostic(layer))
          continue
        }
        await drawLayerDirect(context, layer, resolver, drawnAssetIds, diagnostics)
      } else {
        await drawLayerBuffered(
          context, surfaces, layer, expanded.palette, resolver, drawnAssetIds, diagnostics,
        )
      }
    }
  })

  return { drawnAssetIds, diagnostics, compositionMetrics: null, connectorMetrics: null }
}
