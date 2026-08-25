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
const runtimePngPath = z.string().regex(/^assets\/v0\.3\.0\/.+\.png$/u)
const runtimeWebpPath = z.string().regex(/^assets\/v0\.3\.0\/.+\.webp$/u)
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
  contourMaskPath: runtimePngPath,
  foregroundMaskPath: runtimePngPath,
  backgroundMaskPath: runtimePngPath,
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
  neutralPngPath: runtimePngPath,
  neutralWebpPath: runtimeWebpPath,
  frontMaskPath: runtimePngPath,
  backMaskPath: runtimePngPath,
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
  const allNodeIds = value.assets.flatMap(item => item.renderNodes.map(node => node.id))
  const allNodeSources = value.assets.flatMap(item => item.renderNodes.map(node => node.sourcePngPath))
  if (new Set(allNodeIds).size !== allNodeIds.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Render node IDs must be globally unique.' })
  if (new Set(allNodeSources).size !== allNodeSources.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Render node source paths must be globally distinct.' })
  for (const [index, item] of value.assets.entries()) {
    const expectedIds = item.slotId === 'bodyFrame'
      ? ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight']
      : item.slotId === 'headShape' ? ['neck']
        : item.slotId === 'arms' ? ['shoulderLeft', 'shoulderRight'] : ['hipLeft', 'hipRight']
    const expectedRole = item.slotId === 'bodyFrame' ? 'receiver' : 'plug'
    const renderNodeIds = item.renderNodes.map(node => node.id)
    const renderNodeSources = item.renderNodes.map(node => node.sourcePngPath)
    if (new Set(renderNodeIds).size !== renderNodeIds.length) {
      context.addIssue({ code: 'custom', path: ['assets', index, 'renderNodes'], message: `Asset ${item.id} render node IDs must be unique.` })
    }
    if (new Set(renderNodeSources).size !== renderNodeSources.length) {
      context.addIssue({ code: 'custom', path: ['assets', index, 'renderNodes'], message: `Asset ${item.id} render node source paths must be distinct.` })
    }
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

const sha256Text = /^[a-f0-9]{64}$/u

export function validateInterfaceSourceIndex(manifest: InterfaceSourceManifest, sourceIndex: unknown): void {
  const index = sourceIndex !== null && typeof sourceIndex === 'object' && !Array.isArray(sourceIndex) ? sourceIndex as Record<string, any> : {}
  const sources = Array.isArray(index.sources) ? index.sources as Array<Record<string, any>> : []
  const indexed = new Map<string, Record<string, any>>()
  const duplicates = new Set<string>()
  for (const source of sources) {
    if (source === null || typeof source !== 'object' || typeof source.sourceId !== 'string') continue
    if (indexed.has(source.sourceId)) duplicates.add(source.sourceId)
    else indexed.set(source.sourceId, source)
  }
  const expected = [
    ...manifest.assets.map(asset => ({ sourceId: asset.id, kind: 'interface-structural', evidence: asset.promptEvidence, paths: [...new Set([asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)])] })),
    ...manifest.bridges.map(bridge => ({ sourceId: bridge.id, kind: 'interface-bridge', evidence: bridge.promptEvidence, paths: [bridge.sourcePngPath] })),
  ]
  const expectedIds = new Set(expected.map(item => item.sourceId))
  const invalid: string[] = index.catalogVersion === manifest.catalogVersion ? [] : ['catalogVersion']
  invalid.push(...[...duplicates].map(id => `duplicate:${id}`))
  for (const source of sources) {
    if ((source.kind === 'interface-structural' || source.kind === 'interface-bridge') && !expectedIds.has(source.sourceId)) invalid.push(`extra:${String(source.sourceId)}`)
  }
  for (const item of expected) {
    const source = indexed.get(item.sourceId)
    const resources = Array.isArray(source?.sourceResources) ? source.sourceResources as Array<Record<string, any>> : []
    const byPath = new Map(resources.flatMap(resource => typeof resource?.path === 'string' ? [[resource.path, resource.sha256] as const] : []))
    if (
      source === undefined || source.kind !== item.kind || source.promptId !== item.evidence.promptId
      || source.promptPath !== item.evidence.promptPath || source.promptSha256 !== item.evidence.promptSha256
      || source.reviewRecordPath !== item.evidence.reviewRecordPath || !sha256Text.test(source.reviewRecordSha256 ?? '')
      || resources.length !== item.paths.length || item.paths.some(path => !sha256Text.test(byPath.get(path) ?? ''))
      || resources.some(resource => typeof resource?.path !== 'string' || !item.paths.includes(resource.path))
    ) invalid.push(item.sourceId)
  }
  if (invalid.length > 0) throw new Error(`INTERFACE_SOURCE_INDEX_INVALID: ${invalid.join(', ')}`)
}
