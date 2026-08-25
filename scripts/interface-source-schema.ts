import { z } from 'zod'
import type {
  ConnectorClass,
  ConnectorRole,
  Diagnostic,
  MaterialFamily,
  ParseResult,
  Point2D,
  Rect,
  StructuralSlotId,
  WarpLimits,
} from '@qmonster/generator-core'

export const BIPED_SLICE = {
  bodyFrame: ['body_biped_peanut', 'body_biped_tall'],
  headShape: ['head_round_dome', 'head_mushroom_cap'],
  arms: ['arms_short_plush', 'arms_long_noodle'],
  legs: ['legs_webbed', 'legs_mushroom'],
} as const

export interface InterfacePromptEvidence {
  promptId: string
  promptPath: string
  promptSha256: string
  reviewRecordPath: string
}

export interface InterfaceConnectorSource {
  id: string
  role: ConnectorRole
  connectorClass: ConnectorClass
  origin: Point2D
  tangent: Point2D
  outwardNormal: Point2D
  width: number
  depth: number
  contourMaskPath: string
  foregroundMaskPath: string
  backgroundMaskPath: string
  materialSampleRegion: Rect
  warpLimits: WarpLimits
}

export interface InterfaceRenderNodeSource {
  id: string
  connectorId?: string
  sourcePngPath: string
}

export interface InterfaceAssetSource {
  id: string
  slotId: Extract<StructuralSlotId, 'bodyFrame' | 'headShape' | 'arms' | 'legs'>
  rigId: 'biped'
  materialFamily: MaterialFamily
  sourcePngPath: string
  promptEvidence: InterfacePromptEvidence
  connectors: InterfaceConnectorSource[]
  renderNodes: InterfaceRenderNodeSource[]
}

export interface InterfaceBridgeSource {
  id: string
  rigId: 'biped'
  connectorClass: Extract<ConnectorClass, 'neck' | 'shoulder' | 'hip'>
  materialFamilies: MaterialFamily[]
  sourcePngPath: string
  neutralPngPath: string
  neutralWebpPath: string
  frontMaskPath: string
  backMaskPath: string
  promptEvidence: InterfacePromptEvidence
}

export interface InterfaceSourceManifest {
  schemaVersion: 'interface-source-v1'
  catalogVersion: '0.3.0'
  rigId: 'biped'
  canvasSize: 2048
  assets: InterfaceAssetSource[]
  bridges: InterfaceBridgeSource[]
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const point = z.object({
  x: z.number().finite().min(0).max(2048),
  y: z.number().finite().min(0).max(2048),
}).strict()
const vector = z.object({
  x: z.number().finite().min(-1).max(1),
  y: z.number().finite().min(-1).max(1),
}).strict().refine(value => Math.abs(Math.hypot(value.x, value.y) - 1) <= 0.001, {
  message: 'Connector direction vectors must be normalized.',
})
const rect = z.object({
  x: z.number().finite().min(0).max(2048),
  y: z.number().finite().min(0).max(2048),
  width: z.number().finite().positive().max(2048),
  height: z.number().finite().positive().max(2048),
}).strict().refine(value => value.x + value.width <= 2048 && value.y + value.height <= 2048)
const range = z.object({ min: z.number().finite(), max: z.number().finite() }).strict()
  .refine(value => value.min <= value.max)
const promptEvidence = z.object({
  promptId: z.string().min(1),
  promptPath: z.string().min(1),
  promptSha256: sha256,
  reviewRecordPath: z.string().min(1),
}).strict()
const connector = z.object({
  id: z.enum(['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']),
  role: z.enum(['receiver', 'plug']),
  connectorClass: z.enum(['neck', 'shoulder', 'hip']),
  origin: point,
  tangent: vector,
  outwardNormal: vector,
  width: z.number().finite().positive(),
  depth: z.number().finite().positive(),
  contourMaskPath: z.string().min(1),
  foregroundMaskPath: z.string().min(1),
  backgroundMaskPath: z.string().min(1),
  materialSampleRegion: rect,
  warpLimits: z.object({ widthRatio: range, depthRatio: range, rotationDegrees: range }).strict(),
}).strict().refine(value => Math.abs(value.tangent.x * value.outwardNormal.x + value.tangent.y * value.outwardNormal.y) <= 0.001, {
  message: 'Connector tangent and outward normal must be orthogonal.',
  path: ['outwardNormal'],
})
const asset = z.object({
  id: z.string().min(1),
  slotId: z.enum(['bodyFrame', 'headShape', 'arms', 'legs']),
  rigId: z.literal('biped'),
  materialFamily: z.enum(['short-fur', 'mushroom-velvet', 'soft-skin']),
  sourcePngPath: z.string().min(1),
  promptEvidence,
  connectors: z.array(connector).min(1),
  renderNodes: z.array(z.object({
    id: z.string().min(1),
    connectorId: z.string().min(1).optional(),
    sourcePngPath: z.string().min(1),
  }).strict()).min(1),
}).strict()
const bridge = z.object({
  id: z.string().min(1),
  rigId: z.literal('biped'),
  connectorClass: z.enum(['neck', 'shoulder', 'hip']),
  materialFamilies: z.array(z.enum(['short-fur', 'mushroom-velvet', 'soft-skin'])).min(1),
  sourcePngPath: z.string().min(1),
  neutralPngPath: z.string().min(1),
  neutralWebpPath: z.string().min(1),
  frontMaskPath: z.string().min(1),
  backMaskPath: z.string().min(1),
  promptEvidence,
}).strict()

const InterfaceSourceManifestSchema = z.object({
  schemaVersion: z.literal('interface-source-v1'),
  catalogVersion: z.literal('0.3.0'),
  rigId: z.literal('biped'),
  canvasSize: z.literal(2048),
  assets: z.array(asset),
  bridges: z.array(bridge),
}).strict().superRefine((value, context) => {
  const expected = Object.entries(BIPED_SLICE).flatMap(([slotId, ids]) => ids.map(id => `${slotId}:${id}`))
  const actual = value.assets.map(item => `${item.slotId}:${item.id}`)
  if (actual.length !== expected.length || expected.some(id => !actual.includes(id)) || new Set(actual).size !== actual.length) {
    context.addIssue({ code: 'custom', path: ['assets'], message: 'Manifest must contain the exact biped structural slice.' })
  }
  for (const [index, item] of value.assets.entries()) {
    const expectedIds = item.slotId === 'bodyFrame'
      ? ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']
      : item.slotId === 'headShape' ? ['neck']
        : item.slotId === 'arms' ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight']
    const expectedRole = item.slotId === 'bodyFrame' ? 'receiver' : 'plug'
    const connectorIds = item.connectors.map(profile => profile.id)
    if (
      connectorIds.length !== expectedIds.length
      || new Set(connectorIds).size !== connectorIds.length
      || expectedIds.some(id => !connectorIds.includes(id as any))
      || item.connectors.some(profile => profile.role !== expectedRole)
    ) context.addIssue({ code: 'custom', path: ['assets', index, 'connectors'], message: `Asset ${item.id} has an invalid connector roster.` })
    const plugIds = item.connectors.filter(profile => profile.role === 'plug').map(profile => profile.id)
    if (plugIds.length > 0) {
      const nodeIds = item.renderNodes.map(node => node.connectorId)
      if (
        nodeIds.length !== plugIds.length
        || nodeIds.some(id => id === undefined)
        || new Set(nodeIds).size !== nodeIds.length
        || plugIds.some(id => !nodeIds.includes(id))
      ) context.addIssue({ code: 'custom', path: ['assets', index, 'renderNodes'], message: 'Every plug requires one render node with the same connectorId.' })
    }
  }
  const bridgeClasses = value.bridges.map(item => item.connectorClass)
  if (
    bridgeClasses.length !== 3
    || new Set(bridgeClasses).size !== 3
    || ['neck', 'shoulder', 'hip'].some(id => !bridgeClasses.includes(id as any))
  ) context.addIssue({ code: 'custom', path: ['bridges'], message: 'Manifest requires exactly neck, shoulder, and hip bridges.' })
})

function diagnostic(issue: z.core.$ZodIssue): Diagnostic {
  return { severity: 'error', code: `INTERFACE_SOURCE_${issue.code.toUpperCase()}`, path: issue.path.map(String), message: issue.message }
}

export function parseInterfaceSourceManifest(input: unknown): ParseResult<InterfaceSourceManifest> {
  const parsed = InterfaceSourceManifestSchema.safeParse(input)
  return parsed.success
    ? { ok: true, value: parsed.data as InterfaceSourceManifest }
    : { ok: false, diagnostics: parsed.error.issues.map(diagnostic) }
}
