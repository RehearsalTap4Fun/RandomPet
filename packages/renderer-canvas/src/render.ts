import {
  validateMonsterSpecAgainstCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type Palette,
} from '@qmonster/generator-core'
import { resolvePartPlacement } from './layout.js'
import { expandRenderLayers } from './layers.js'
import type {
  ImageResolver,
  Placement,
  RenderLayerInstance,
  RenderOptions,
  RenderResult,
  RenderSurface,
  RenderSurfaceFactory,
} from './types.js'

const MASTER_SIZE = 2048
const PLACEHOLDER_CELL = 32
const PLACEHOLDER_CELLS = 8

interface CompositeSurfaces {
  layer: RenderSurface
  mask: RenderSurface
}

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
  const layer = factory(MASTER_SIZE, MASTER_SIZE, context)
  const mask = factory(MASTER_SIZE, MASTER_SIZE, context)
  return layer === null || mask === null ? null : { layer, mask }
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

export async function renderMonster(
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: RenderOptions,
): Promise<RenderResult> {
  const validationDiagnostics = validateMonsterSpecAgainstCatalog(spec, catalog)
  if (validationDiagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { drawnAssetIds: [], diagnostics: validationDiagnostics }
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

  return { drawnAssetIds, diagnostics }
}
