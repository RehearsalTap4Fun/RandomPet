import type { Catalog, Diagnostic, MonsterSpec, Palette } from '@qmonster/generator-core'
import { resolvePlacement } from './layout.js'
import { expandRenderLayers } from './layers.js'
import type {
  ImageResolver,
  Placement,
  RenderLayerInstance,
  RenderOptions,
  RenderResult,
} from './types.js'

const MASTER_SIZE = 2048
const PLACEHOLDER_CELL = 32
const PLACEHOLDER_CELLS = 8

interface CanvasSurface {
  canvas: CanvasImageSource
  context: CanvasRenderingContext2D
}

interface CompositeSurfaces {
  layer: CanvasSurface
  mask: CanvasSurface
}

function assetLoadDiagnostic(
  layer: RenderLayerInstance,
  assetPath: string,
  maskName?: 'primary' | 'secondary',
): Diagnostic {
  return {
    severity: 'error',
    code: 'ASSET_LOAD_FAILED',
    path: maskName === undefined
      ? ['parts', layer.part.id]
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

async function drawMask(
  context: CanvasRenderingContext2D,
  resolver: ImageResolver,
  layer: RenderLayerInstance,
  maskName: 'primary' | 'secondary',
  palette: Palette,
  diagnostics: Diagnostic[],
): Promise<void> {
  const assetPath = layer.part.maskPaths[maskName]
  if (assetPath === undefined) return
  try {
    const mask = await resolver.resolve(assetPath)
    context.save()
    context.drawImage(mask, 0, 0)
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = palette[maskName]
    context.fillRect(0, 0, MASTER_SIZE, MASTER_SIZE)
    context.restore()
  } catch {
    diagnostics.push(assetLoadDiagnostic(layer, assetPath, maskName))
    drawMissingPlaceholder(context, layer.part.id)
  }
}

function createCanvasSurface(context: CanvasRenderingContext2D): CanvasSurface | null {
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
  canvas.width = MASTER_SIZE
  canvas.height = MASTER_SIZE
  const surfaceContext = canvas.getContext('2d')
  if (surfaceContext === null) return null
  return {
    canvas: canvas as CanvasImageSource,
    context: surfaceContext as CanvasRenderingContext2D,
  }
}

function createCompositeSurfaces(context: CanvasRenderingContext2D): CompositeSurfaces | null {
  const layer = createCanvasSurface(context)
  const mask = createCanvasSurface(context)
  return layer === null || mask === null ? null : { layer, mask }
}

function placementFor(layer: RenderLayerInstance): { placement?: Placement; diagnostic?: Diagnostic } {
  const socket = layer.socketName === null
    ? { x: MASTER_SIZE / 2, y: MASTER_SIZE / 2 }
    : layer.rig.sockets[layer.socketName]
  if (socket === undefined) {
    return {
      diagnostic: {
        severity: 'error',
        code: 'RENDER_SOCKET_MISSING',
        path: ['socket'],
        message: `Rig ${layer.rig.id} has no ${layer.socketName} socket for ${layer.part.id}.`,
      },
    }
  }
  const result = resolvePlacement(
    socket,
    layer.part.origin,
    layer.transform,
    layer.part.approvedTransforms ?? [],
  )
  return result.ok ? { placement: result.value } : { diagnostic: result.diagnostic }
}

async function drawLayerDirect(
  context: CanvasRenderingContext2D,
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
  await drawMask(context, resolver, layer, 'primary', palette, diagnostics)
  await drawMask(context, resolver, layer, 'secondary', palette, diagnostics)
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
      drawMissingPlaceholder(layerContext, layer.part.id)
      layerContext.restore()
    }
  }
  context.drawImage(surfaces.layer.canvas, 0, 0)
}

export async function renderMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const expanded = expandRenderLayers(spec, catalog)
  const diagnostics = [...expanded.diagnostics]
  const drawnAssetIds: string[] = []
  const surfaces = createCompositeSurfaces(context)

  context.save()
  context.scale(options.width / MASTER_SIZE, options.height / MASTER_SIZE)
  for (const layer of expanded.layers) {
    if (!options.includeGroundShadow && layer.part.layer === 'groundShadow') continue
    if (surfaces === null) {
      await drawLayerDirect(context, layer, expanded.palette, resolver, drawnAssetIds, diagnostics)
    } else {
      await drawLayerBuffered(
        context, surfaces, layer, expanded.palette, resolver, drawnAssetIds, diagnostics,
      )
    }
  }
  context.restore()

  return { drawnAssetIds, diagnostics }
}
