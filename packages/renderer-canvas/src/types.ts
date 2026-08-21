import type {
  ApprovedTransform,
  Diagnostic,
  Palette,
  RigDefinition,
  VisualPartDefinition,
  VisualSlotId,
} from '@qmonster/generator-core'

export interface ImageResolver {
  resolve(assetPath: string): Promise<CanvasImageSource>
}

export interface RenderSurface {
  canvas: CanvasImageSource
  context: CanvasRenderingContext2D
}

export type RenderSurfaceFactory = (
  width: number,
  height: number,
  destination: CanvasRenderingContext2D,
) => RenderSurface | null

export interface RenderOptions {
  width: 1024 | 2048
  height: 1024 | 2048
  includeGroundShadow: boolean
  surfaceFactory?: RenderSurfaceFactory
}

export interface RenderResult {
  drawnAssetIds: string[]
  diagnostics: Diagnostic[]
}

export interface Placement {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

export type PlacementResult =
  | { ok: true; value: Placement }
  | { ok: false; diagnostic: Diagnostic }

export interface RenderLayerInstance {
  slotId: VisualSlotId
  part: VisualPartDefinition
  rig: RigDefinition
  socketName: string | null
  transform: ApprovedTransform
  sequence: number
}

export interface ExpandedRenderLayers {
  layers: RenderLayerInstance[]
  palette: Palette
  diagnostics: Diagnostic[]
}
