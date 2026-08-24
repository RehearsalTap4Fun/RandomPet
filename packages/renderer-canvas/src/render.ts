import {
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type Palette,
} from '@qmonster/generator-core'
import { resolveAttachmentTree } from './attachment-tree.js'
import { measureFeatureAlpha, measureVisibleBounds } from './composition-metrics.js'
import { resolvePartPlacement } from './layout.js'
import { expandRenderLayers, RENDER_LAYER_ORDER } from './layers.js'
import type {
  AttachmentTreeResult,
  CompositionMetrics,
  ImageResolver,
  Placement,
  RenderLayerInstance,
  RenderOptions,
  RenderResult,
  RenderSurface,
  RenderSurfaceFactory,
  ResolvedRenderNode,
} from './types.js'

const MASTER_SIZE = 2048
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
  laterOccluderAlpha: RenderSurface
  occluderNodeLayer: RenderSurface
}

const browserCompositeCache = new WeakMap<object, CompositeSurfaces>()
const browserCompositionCache = new WeakMap<object, CompositionSurfaces>()
const compositionLayerRank = new Map(
  RENDER_LAYER_ORDER.map((layer, index) => [layer, index]),
)

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
  const surfaces = Array.from({ length: 7 }, () => (
    factory(MASTER_SIZE, MASTER_SIZE, context)
  ))
  if (surfaces.some(surface => surface === null)) return null
  const result: CompositionSurfaces = {
    nodeLayer: surfaces[0]!,
    bodyAlpha: surfaces[1]!,
    eyesAlpha: surfaces[2]!,
    mouthAlpha: surfaces[3]!,
    outputAlpha: surfaces[4]!,
    laterOccluderAlpha: surfaces[5]!,
    occluderNodeLayer: surfaces[6]!,
  }
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
      maskContext.save()
      maskContext.translate(placement.x, placement.y)
      maskContext.scale(placement.scaleX, placement.scaleY)
      maskContext.drawImage(mask, 0, 0)
      maskContext.restore()
      maskContext.save()
      maskContext.globalCompositeOperation = 'source-in'
      maskContext.fillStyle = palette[maskName]
      maskContext.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      maskContext.restore()
      context.save()
      context.globalCompositeOperation = 'color'
      context.drawImage(surfaces.mask.canvas, 0, 0)
      context.restore()
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
  context.save()
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
  context.restore()
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

  layerContext.save()
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
  layerContext.restore()

  for (const maskName of ['primary', 'secondary'] as const) {
    const assetPath = layer.part.maskPaths[maskName]
    if (assetPath === undefined) continue
    try {
      const mask = await resolver.resolve(assetPath)
      maskContext.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      maskContext.save()
      maskContext.translate(placement.x, placement.y)
      maskContext.scale(placement.scaleX, placement.scaleY)
      maskContext.drawImage(mask, 0, 0)
      maskContext.restore()
      maskContext.save()
      maskContext.globalCompositeOperation = 'source-in'
      maskContext.fillStyle = palette[maskName]
      maskContext.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
      maskContext.restore()
      layerContext.drawImage(surfaces.mask.canvas, 0, 0)
    } catch {
      diagnostics.push(assetLoadDiagnostic(layer, assetPath, maskName))
      layerContext.save()
      layerContext.translate(placement.x, placement.y)
      layerContext.scale(placement.scaleX, placement.scaleY)
      drawMissingPlaceholder(layerContext, assetPath)
      layerContext.restore()
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

function clearSurface(surface: RenderSurface): void {
  surface.context.clearRect(0, 0, MASTER_SIZE, MASTER_SIZE)
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
      layerContext.save()
      layerContext.globalCompositeOperation = 'destination-in'
      layerContext.drawImage(bodyAlpha.canvas, 0, 0)
      layerContext.restore()
      break
    case 'protect-face':
      layerContext.save()
      layerContext.globalCompositeOperation = 'destination-out'
      for (const face of faceSafeZones) {
        layerContext.fillRect(face.x, face.y, face.width, face.height)
      }
      layerContext.restore()
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
  layerContext.save()
  layerContext.translate(node.placement.x, node.placement.y)
  layerContext.scale(node.placement.scaleX, node.placement.scaleY)
  layerContext.drawImage(source, 0, 0)
  layerContext.restore()
  applyCompositionClip(surface, node, bodyAlpha, faceSafeZones)
}

function imageData(surface: RenderSurface): Uint8ClampedArray {
  return surface.context.getImageData(0, 0, MASTER_SIZE, MASTER_SIZE).data
}

function alphaTotal(pixels: Uint8ClampedArray): number {
  let total = 0
  for (let index = 3; index < pixels.length; index += 4) total += pixels[index] ?? 0
  return total
}

function measureSlotVisibility(
  slotId: 'eyes' | 'mouthShape',
  nodes: readonly ResolvedRenderNode[],
  sources: ReadonlyMap<string, CanvasImageSource>,
  surfaces: CompositionSurfaces,
  faceSafeZones: AttachmentTreeResult['faceSafeZones'],
): number {
  let weightedVisibleAlpha = 0
  let featureAlpha = 0
  for (const [featureIndex, featureNode] of nodes.entries()) {
    if (featureNode.slotId !== slotId) continue
    const featureSource = sources.get(featureNode.key)
    if (featureSource === undefined) continue
    drawCompositionNodeToSurface(
      surfaces.occluderNodeLayer,
      featureNode,
      featureSource,
      surfaces.bodyAlpha,
      faceSafeZones,
    )
    const featurePixels = imageData(surfaces.occluderNodeLayer)
    const nodeAlpha = alphaTotal(featurePixels)
    featureAlpha += nodeAlpha

    clearSurface(surfaces.laterOccluderAlpha)
    for (let laterIndex = featureIndex + 1; laterIndex < nodes.length; laterIndex += 1) {
      const laterNode = nodes[laterIndex]!
      if (laterNode.slotId === slotId) continue
      const laterSource = sources.get(laterNode.key)
      if (laterSource === undefined) continue
      drawCompositionNodeToSurface(
        surfaces.occluderNodeLayer,
        laterNode,
        laterSource,
        surfaces.bodyAlpha,
        faceSafeZones,
      )
      surfaces.laterOccluderAlpha.context.drawImage(
        surfaces.occluderNodeLayer.canvas, 0, 0,
      )
    }
    const metric = measureFeatureAlpha(
      featurePixels,
      imageData(surfaces.laterOccluderAlpha),
      MASTER_SIZE,
      MASTER_SIZE,
      faceSafeZones,
    )
    weightedVisibleAlpha += metric.visibleRatio * nodeAlpha
  }
  return featureAlpha === 0 ? 0 : weightedVisibleAlpha / featureAlpha
}

function metricDiagnostic(
  code: 'COMPOSITION_FACE_OUT_OF_ZONE' | 'COMPOSITION_FACE_OCCLUDED',
  slotId: 'eyes' | 'mouthShape',
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

function boundsInside(
  bounds: NonNullable<CompositionMetrics['visibleBounds']>,
  frame: NonNullable<Catalog['compositionPolicy']>['frameBounds'],
): boolean {
  return bounds.x >= frame.x
    && bounds.y >= frame.y
    && bounds.x + bounds.width <= frame.x + frame.width
    && bounds.y + bounds.height <= frame.y + frame.height
}

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

  for (const surface of Object.values(surfaces)) clearSurface(surface)
  const bodyNode = nodes.find(node => node.slotId === 'bodyFrame')
  const bodySource = bodyNode === undefined ? undefined : sources.get(bodyNode.key)
  if (bodyNode !== undefined && bodySource !== undefined) {
    const bodyContext = surfaces.bodyAlpha.context
    bodyContext.save()
    bodyContext.translate(bodyNode.placement.x, bodyNode.placement.y)
    bodyContext.scale(bodyNode.placement.scaleX, bodyNode.placement.scaleY)
    bodyContext.drawImage(bodySource, 0, 0)
    bodyContext.restore()
  }

  context.save()
  context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
  for (const node of nodes) {
    const source = sources.get(node.key)
    if (source === undefined) continue
    drawCompositionNodeToSurface(
      surfaces.nodeLayer, node, source, surfaces.bodyAlpha, attachment.faceSafeZones,
    )
    context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    surfaces.outputAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    if (node.slotId === 'eyes') {
      surfaces.eyesAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
    if (node.slotId === 'mouthShape') {
      surfaces.mouthAlpha.context.drawImage(surfaces.nodeLayer.canvas, 0, 0)
    }
    drawnAssetIds.push(node.key)
  }
  context.restore()

  const policy = catalog.compositionPolicy!
  const transparent = new Uint8ClampedArray()
  const eyes = measureFeatureAlpha(
    imageData(surfaces.eyesAlpha),
    transparent,
    MASTER_SIZE,
    MASTER_SIZE,
    attachment.faceSafeZones,
  )
  eyes.visibleRatio = measureSlotVisibility(
    'eyes', nodes, sources, surfaces, attachment.faceSafeZones,
  )
  const mouth = measureFeatureAlpha(
    imageData(surfaces.mouthAlpha),
    transparent,
    MASTER_SIZE,
    MASTER_SIZE,
    attachment.faceSafeZones,
  )
  mouth.visibleRatio = measureSlotVisibility(
    'mouthShape', nodes, sources, surfaces, attachment.faceSafeZones,
  )
  const visibleBounds = measureVisibleBounds(
    imageData(surfaces.outputAlpha), MASTER_SIZE, MASTER_SIZE,
  )
  const compositionMetrics: CompositionMetrics = {
    eyesInsideRatio: eyes.insideRatio,
    eyesVisibleRatio: eyes.visibleRatio,
    mouthInsideRatio: mouth.insideRatio,
    mouthVisibleRatio: mouth.visibleRatio,
    visibleBounds,
  }
  for (const [slotId, metric] of [
    ['eyes', eyes], ['mouthShape', mouth],
  ] as const) {
    if (metric.insideRatio < policy.faceInsideRatio) {
      diagnostics.push(metricDiagnostic(
        'COMPOSITION_FACE_OUT_OF_ZONE', slotId, metric.insideRatio, policy.faceInsideRatio,
      ))
    }
    if (metric.visibleRatio < policy.faceVisibleRatio) {
      diagnostics.push(metricDiagnostic(
        'COMPOSITION_FACE_OCCLUDED', slotId, metric.visibleRatio, policy.faceVisibleRatio,
      ))
    }
  }
  if (visibleBounds !== null && !boundsInside(visibleBounds, policy.frameBounds)) {
    diagnostics.push(boundsExceededDiagnostic())
  }
  return { drawnAssetIds, diagnostics, compositionMetrics }
}

export async function renderMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const validationDiagnostics = validateMonsterSpecAgainstCatalog(spec, catalog)
  if (validationDiagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { drawnAssetIds: [], diagnostics: validationDiagnostics, compositionMetrics: null }
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

  context.save()
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
  context.restore()

  return { drawnAssetIds, diagnostics, compositionMetrics: null }
}
