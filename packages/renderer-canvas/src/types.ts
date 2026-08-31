import type {
  ApprovedTransform,
  ConnectorProfile,
  Diagnostic,
  Palette,
  RenderNodeDefinition,
  RigDefinition,
  TransitionBridgeDefinition,
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
  applyPaletteMasks?: boolean
  /** Historical audit reconstruction only. Live rendering always omits this. */
  connectorMetricProjection?: 'task8-task9-neutral-bridge-v1'
  /** Historical audit reconstruction only. Live rendering uses effective role masks. */
  bridgeRoleProjection?: 'task8-task9-cross-product-v1'
  surfaceFactory?: RenderSurfaceFactory
  diagnosticScope?: {
    id: string
    activeVisualSlots: VisualSlotId[]
    activeConnectorIds: string[]
  }
}

export interface RenderResult {
  drawnAssetIds: string[]
  diagnostics: Diagnostic[]
  compositionMetrics: CompositionMetrics | null
  connectorMetrics: ConnectorMetric[] | null
  diagnosticScope?: {
    id: string
    activeVisualSlots: VisualSlotId[]
    activeConnectorIds: string[]
    suppressedDiagnostics: Diagnostic[]
  }
}

export interface Placement {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotationDegrees?: number
}

export interface WorldRect { x: number; y: number; width: number; height: number }

export interface ResolvedRenderNode {
  key: string
  slotId: VisualSlotId
  part: VisualPartDefinition
  node: RenderNodeDefinition
  placement: Placement
  sequence: number
}

export interface CompositionMetrics {
  eyesInsideRatio: number
  eyesVisibleRatio: number
  mouthInsideRatio: number
  mouthVisibleRatio: number
  visibleBounds: WorldRect | null
}

export interface ConnectorMetric {
  connectorId: string
  receiverCoverage: number
  plugCoverage: number
  largestComponentRatio: number
  centerlineGapPixels: number
  childOutsideBodyRatio: number | null
}

export interface ResolvedBridge {
  key: string
  connectorId: string
  parentNodeKey: string
  childNodeKey: string
  receiver: ConnectorProfile
  plug: ConnectorProfile
  bridge: TransitionBridgeDefinition
  solved: import('./connector-solver.js').SolvedConnector
}

export interface InterfaceRenderResult {
  nodes: ResolvedRenderNode[]
  bridges: ResolvedBridge[]
  faceSafeZones: WorldRect[]
  diagnostics: Diagnostic[]
}

export interface AttachmentTreeResult {
  nodes: ResolvedRenderNode[]
  faceSafeZones: WorldRect[]
  parentChainBySlot: Partial<Record<VisualSlotId, VisualSlotId[]>>
  diagnostics: Diagnostic[]
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
