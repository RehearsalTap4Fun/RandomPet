import { z } from 'zod'
import { STRUCTURAL_SLOT_IDS, type ConnectorClass, type ConnectorRole, type Diagnostic, type MaterialFamily, type ParseResult, type Point2D, type Rect, type StructuralSlotId, type WarpLimits } from '@qmonster/generator-core'

export const BIPED_SLICE = {
  bodyFrame: ['body_biped_peanut', 'body_biped_tall'], headShape: ['head_mushroom_cap', 'head_round_dome'],
  arms: ['arms_short_plush', 'arms_long_noodle'], legs: ['legs_webbed', 'legs_mushroom'],
} as const
export type InterfaceRigId = 'blob' | 'biped' | 'floating'
export interface InterfacePromptEvidence { promptId: string, promptPath: string, promptSha256: string, reviewRecordPath: string }
export interface InterfaceConnectorSource {
  id: string, role: ConnectorRole, connectorClass: ConnectorClass, origin: Point2D, tangent: Point2D,
  outwardNormal: Point2D, width: number, depth: number, contourMaskPath: string,
  foregroundMaskPath: string, backgroundMaskPath: string, materialSampleRegion: Rect, warpLimits: WarpLimits,
}
export interface InterfaceRenderNodeSource {
  id: string
  connectorId?: string
  sourcePngPath: string
  transform?: { scale: number; mirrorX: boolean }
}
export interface InterfaceAssetVariantSource {
  rigId: InterfaceRigId, materialFamily: MaterialFamily, sourcePngPath: string,
  promptEvidence: InterfacePromptEvidence, connectors: InterfaceConnectorSource[], renderNodes: InterfaceRenderNodeSource[],
  faceSafeZones?: Rect[], featureSockets?: Record<string, Point2D>,
}
type InterfaceSlotId = StructuralSlotId
export interface InterfaceAssetSource extends InterfaceAssetVariantSource { id: string, slotId: InterfaceSlotId }
export interface InterfaceAssetGroupSource { id: string, slotId: InterfaceSlotId, variants: InterfaceAssetVariantSource[] }
export interface InterfaceBridgeSource {
  id: string, rigId: InterfaceRigId, connectorClass: ConnectorClass,
  materialFamilies: MaterialFamily[], sourcePngPath: string, neutralPngPath: string, neutralWebpPath: string,
  frontMaskPath: string, backMaskPath: string, promptEvidence: InterfacePromptEvidence,
}
export interface InterfaceSourceManifest {
  schemaVersion: 'interface-source-v1' | 'interface-source-v2', catalogVersion: '0.3.0' | '0.5.0',
  rigId?: 'biped', rigIds?: InterfaceRigId[], canvasSize: 2048,
  assets: Array<InterfaceAssetSource | InterfaceAssetGroupSource>, bridges: InterfaceBridgeSource[],
}
export interface FlattenedInterfaceVariant extends InterfaceAssetVariantSource {
  partId: string, slotId: InterfaceSlotId,
}

export const HEAD_EYES_SAFE_ZONE_Y_OFFSET_MIN = 80
export const HEAD_MOUTH_EYES_Y_GAP_MIN = 120

export function headFaceSocketPolicyIssue(
  variant: Pick<InterfaceAssetVariantSource, 'faceSafeZones' | 'featureSockets'>,
): string | null {
  const zone = variant.faceSafeZones?.[0]
  const eyes = variant.featureSockets?.eyes
  const mouth = variant.featureSockets?.mouth
  if (zone === undefined || eyes === undefined || mouth === undefined) {
    return 'Head variants require a face safe zone plus eyes and mouth feature sockets.'
  }
  if (eyes.y < zone.y + HEAD_EYES_SAFE_ZONE_Y_OFFSET_MIN) {
    return `Head eyes socket must be at least ${HEAD_EYES_SAFE_ZONE_Y_OFFSET_MIN}px below the face safe-zone top.`
  }
  if (mouth.y < eyes.y + HEAD_MOUTH_EYES_Y_GAP_MIN) {
    return `Head mouth socket must be at least ${HEAD_MOUTH_EYES_Y_GAP_MIN}px below the eyes socket.`
  }
  return null
}
export function structuralVariants(manifest: InterfaceSourceManifest): FlattenedInterfaceVariant[] {
  return manifest.assets.flatMap(asset => 'variants' in asset
    ? asset.variants.map(variant => ({ ...variant, partId: asset.id, slotId: asset.slotId }))
    : [{ ...asset, partId: asset.id, slotId: asset.slotId }])
}
export function interfaceVariantKey(partId: string, rigId: InterfaceRigId): string { return `${partId}:${rigId}` }

export function task9VariantSourceMaskPaths(
  variant: Pick<FlattenedInterfaceVariant, 'partId' | 'slotId' | 'rigId' | 'connectors'>,
  catalogVersion: InterfaceSourceManifest['catalogVersion'] = '0.3.0',
): string[] {
  if (variant.slotId !== 'tail' && variant.slotId !== 'extraAppendage') return []
  return variant.connectors.flatMap(profile => ['contour', 'foreground', 'background'].map(kind => (
    `asset-source/v${catalogVersion}/masks/${variant.rigId}/${variant.partId}/${profile.id}-${kind}.png`
  )))
}

export function canonicalBipedGuideFiles(manifest: InterfaceSourceManifest): string[] {
  const idsBySlot = new Map(Object.entries(BIPED_SLICE).map(([slotId, ids]) => [slotId, new Set<string>(ids)]))
  return structuralVariants(manifest)
    .filter(asset => asset.rigId === 'biped' && idsBySlot.get(asset.slotId)?.has(asset.partId))
    .flatMap(asset => asset.connectors.flatMap(connector => {
      const stem = `${asset.partId}-${connector.id}-${connector.role}`
      return [`${stem}-guide.png`, `${stem}-mask.png`]
    }))
    .sort()
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const runtimePngPath = z.string().regex(/^assets\/v0\.(?:3|5)\.0\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.png$/u)
const runtimeWebpPath = z.string().regex(/^assets\/v0\.(?:3|5)\.0\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.webp$/u)
const sourcePngPath = z.string().regex(/^asset-source\/v0\.(?:3|5)\.0\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.png$/u)
const promptPath = z.string().regex(/^asset-source\/v0\.(?:3|5)\.0\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/u)
const reviewRecordPath = z.string().regex(/^packages\/asset-catalog\/review\/v0\.(?:3|5)\.0\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/u)
const rigId = z.enum(['blob', 'biped', 'floating'])
const slotId = z.enum(STRUCTURAL_SLOT_IDS)
const point = z.object({ x: z.number().finite().min(0).max(2048), y: z.number().finite().min(0).max(2048) }).strict()
const vector = z.object({ x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) }).strict()
  .refine(value => Math.abs(Math.hypot(value.x, value.y) - 1) <= 0.001, { message: 'Connector direction vectors must be normalized.' })
const rect = z.object({ x: z.number().finite().min(0).max(2048), y: z.number().finite().min(0).max(2048), width: z.number().finite().positive().max(2048), height: z.number().finite().positive().max(2048) }).strict()
  .refine(value => value.x + value.width <= 2048 && value.y + value.height <= 2048)
const range = z.object({ min: z.number().finite(), max: z.number().finite() }).strict().refine(value => value.min <= value.max)
const promptEvidence = z.object({ promptId: z.string().min(1), promptPath, promptSha256: sha256, reviewRecordPath }).strict()
const connector = z.object({
  id: z.enum(['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight', 'tailRoot', 'extraLeft', 'extraRight']), role: z.enum(['receiver', 'plug']), connectorClass: z.enum(['neck', 'shoulder', 'hip', 'tail', 'extra']),
  origin: point, tangent: vector, outwardNormal: vector, width: z.number().finite().positive(), depth: z.number().finite().positive(),
  contourMaskPath: runtimePngPath, foregroundMaskPath: runtimePngPath, backgroundMaskPath: runtimePngPath,
  materialSampleRegion: rect, warpLimits: z.object({ widthRatio: range, depthRatio: range, rotationDegrees: range }).strict(),
}).strict()
  .refine(value => Math.abs(value.tangent.x * value.outwardNormal.x + value.tangent.y * value.outwardNormal.y) <= 0.001, { message: 'Connector tangent and outward normal must be orthogonal.', path: ['outwardNormal'] })
  .refine(value => value.id !== 'tailRoot' || value.connectorClass === 'tail', { message: 'tailRoot requires the tail connector class.', path: ['connectorClass'] })
  .refine(value => !['extraLeft', 'extraRight'].includes(value.id) || value.connectorClass === 'extra', { message: 'extraLeft and extraRight require the extra connector class.', path: ['connectorClass'] })
const renderNode = z.object({
  id: z.string().min(1), connectorId: z.string().min(1).optional(), sourcePngPath,
  transform: z.object({ scale: z.number().finite().positive(), mirrorX: z.boolean() }).strict().optional(),
}).strict()
const variant = z.object({
  rigId, materialFamily: z.enum(['short-fur', 'mushroom-velvet', 'soft-skin']), sourcePngPath, promptEvidence,
  connectors: z.array(connector).min(1), renderNodes: z.array(renderNode).min(1),
  faceSafeZones: z.array(rect).min(1).optional(), featureSockets: z.record(z.string().min(1), point).optional(),
}).strict()
const flatAsset = z.object({ id: z.string().min(1), slotId, ...variant.shape }).strict()
const groupedAsset = z.object({ id: z.string().min(1), slotId, variants: z.array(variant).min(1) }).strict()
const bridge = z.object({
  id: z.string().min(1), rigId, connectorClass: z.enum(['neck', 'shoulder', 'hip', 'tail', 'extra']),
  materialFamilies: z.array(z.enum(['short-fur', 'mushroom-velvet', 'soft-skin'])).min(1), sourcePngPath,
  neutralPngPath: runtimePngPath, neutralWebpPath: runtimeWebpPath, frontMaskPath: runtimePngPath, backMaskPath: runtimePngPath, promptEvidence,
}).strict()

const InterfaceSourceManifestSchema = z.object({
  schemaVersion: z.enum(['interface-source-v1', 'interface-source-v2']), catalogVersion: z.enum(['0.3.0', '0.5.0']),
  rigId: z.literal('biped').optional(), rigIds: z.array(rigId).optional(), canvasSize: z.literal(2048),
  assets: z.array(z.union([flatAsset, groupedAsset])), bridges: z.array(bridge),
}).strict().superRefine((value, context) => {
  const flattened = structuralVariants(value as InterfaceSourceManifest)
  if (value.schemaVersion === 'interface-source-v1' && value.rigId !== 'biped') context.addIssue({ code: 'custom', path: ['rigId'], message: 'v1 requires biped.' })
  if (value.schemaVersion === 'interface-source-v2' && (value.rigIds?.length !== 3 || !['blob', 'biped', 'floating'].every(id => value.rigIds?.includes(id as InterfaceRigId)))) context.addIssue({ code: 'custom', path: ['rigIds'], message: 'v2 requires all exact rigs.' })
  const variantKeys = flattened.map(item => `${item.slotId}:${item.partId}:${item.rigId}`)
  if (new Set(variantKeys).size !== variantKeys.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Part rig variants must be unique.' })
  const requiredBiped = Object.entries(BIPED_SLICE).flatMap(([slot, ids]) => ids.map(id => `${slot}:${id}:biped`))
  if (requiredBiped.some(key => !variantKeys.includes(key))) context.addIssue({ code: 'custom', path: ['assets'], message: 'Manifest must retain the approved biped slice.' })
  if (value.schemaVersion === 'interface-source-v2') {
    if (flattened.filter(item => item.slotId === 'bodyFrame').length !== 5) context.addIssue({ code: 'custom', path: ['assets'], message: 'v2 requires exactly five body variants.' })
    const heads = ['head_angler_bulb', 'head_mushroom_cap', 'head_round_dome', 'head_shadow_hood']
    for (const exactRig of ['blob', 'biped', 'floating'] as const) if (heads.some(id => !variantKeys.includes(`headShape:${id}:${exactRig}`))) context.addIssue({ code: 'custom', path: ['assets'], message: `v2 requires four head identities for ${exactRig}.` })
  }
  const nodeIds = flattened.flatMap(item => item.renderNodes.map(node => node.id)); const nodeSources = flattened.flatMap(item => item.renderNodes.map(node => node.sourcePngPath))
  if (new Set(nodeIds).size !== nodeIds.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Render node IDs must be globally unique.' })
  if (new Set(nodeSources).size !== nodeSources.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Render node source paths must be globally distinct.' })
  const hasTail = flattened.some(item => item.slotId === 'tail')
  const hasExtra = flattened.some(item => item.slotId === 'extraAppendage')
  for (const [index, item] of flattened.entries()) {
    if (item.slotId === 'headShape') {
      const faceSocketIssue = headFaceSocketPolicyIssue(item)
      if (faceSocketIssue !== null) context.addIssue({
        code: 'custom', path: ['assets', index, 'featureSockets'], message: faceSocketIssue,
      })
    }
    const expectedIds = item.slotId === 'bodyFrame'
      ? ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight', ...(hasTail ? ['tailRoot'] : []), ...(hasExtra ? ['extraLeft', 'extraRight'] : [])]
      : item.slotId === 'headShape' ? ['neck']
        : item.slotId === 'arms' ? ['shoulderLeft', 'shoulderRight']
          : item.slotId === 'legs' ? ['hipLeft', 'hipRight']
            : item.slotId === 'tail' ? ['tailRoot']
              : ['extraLeft', 'extraRight']
    const expectedRole = item.slotId === 'bodyFrame' ? 'receiver' : 'plug'; const connectorIds = item.connectors.map(profile => profile.id)
    if (connectorIds.length !== expectedIds.length || new Set(connectorIds).size !== connectorIds.length || expectedIds.some(id => !connectorIds.includes(id)) || item.connectors.some(profile => profile.role !== expectedRole)) context.addIssue({ code: 'custom', path: ['assets', index, 'connectors'], message: `${item.partId}:${item.rigId} has an invalid connector roster.` })
    const plugIds = item.connectors.filter(profile => profile.role === 'plug').map(profile => profile.id); const pluggedNodes = item.renderNodes.filter(node => node.connectorId !== undefined).map(node => node.connectorId!)
    if (plugIds.length > 0 && (pluggedNodes.length !== plugIds.length || new Set(pluggedNodes).size !== pluggedNodes.length || plugIds.some(id => !pluggedNodes.includes(id)))) context.addIssue({ code: 'custom', path: ['assets', index, 'renderNodes'], message: 'Every plug requires one render node with the same connectorId.' })
    if (value.schemaVersion === 'interface-source-v2' && item.slotId === 'headShape' && (item.faceSafeZones === undefined || item.featureSockets === undefined)) context.addIssue({ code: 'custom', path: ['assets', index], message: 'Every exact head requires face safe zones and feature sockets.' })
  }
  const bridgeIds = value.bridges.map(item => item.id); const bridgeKeys = value.bridges.map(item => `${item.rigId}:${item.connectorClass}`)
  if (new Set(bridgeIds).size !== bridgeIds.length || new Set(bridgeKeys).size !== bridgeKeys.length) context.addIssue({ code: 'custom', path: ['bridges'], message: 'Transition bridges must be unique per rig and class.' })
  for (const key of ['biped:neck', 'biped:shoulder', 'biped:hip']) if (!bridgeKeys.includes(key)) context.addIssue({ code: 'custom', path: ['bridges'], message: 'Manifest requires approved biped bridges.' })
  for (const connectorClass of [...(hasTail ? ['tail'] : []), ...(hasExtra ? ['extra'] : [])]) {
    const rigs = value.schemaVersion === 'interface-source-v2' ? ['blob', 'biped', 'floating'] : ['biped']
    for (const exactRig of rigs) if (!bridgeKeys.includes(`${exactRig}:${connectorClass}`)) context.addIssue({ code: 'custom', path: ['bridges'], message: `Manifest requires ${exactRig}:${connectorClass}.` })
  }
  if (value.schemaVersion === 'interface-source-v2') for (const key of ['blob:neck', 'floating:neck']) if (!bridgeKeys.includes(key)) context.addIssue({ code: 'custom', path: ['bridges'], message: `Manifest requires ${key}.` })
})

function diagnostic(issue: z.core.$ZodIssue): Diagnostic { return { severity: 'error', code: `INTERFACE_SOURCE_${issue.code.toUpperCase()}`, path: issue.path.map(String), message: issue.message } }
export function parseInterfaceSourceManifest(input: unknown): ParseResult<InterfaceSourceManifest> {
  const parsed = InterfaceSourceManifestSchema.safeParse(input)
  return parsed.success ? { ok: true, value: parsed.data as InterfaceSourceManifest } : { ok: false, diagnostics: parsed.error.issues.map(diagnostic) }
}

const sha256Text = /^[a-f0-9]{64}$/u
export function validateInterfaceSourceIndex(manifest: InterfaceSourceManifest, sourceIndex: unknown): void {
  const index = sourceIndex !== null && typeof sourceIndex === 'object' && !Array.isArray(sourceIndex) ? sourceIndex as Record<string, any> : {}
  const sources: Array<Record<string, any>> = Array.isArray(index.sources) ? index.sources as Array<Record<string, any>> : []
  const indexed = new Map<string, Record<string, any>>(); const duplicates = new Set<string>()
  for (const source of sources) { if (source === null || typeof source !== 'object' || typeof source.sourceId !== 'string') continue; if (indexed.has(source.sourceId)) duplicates.add(source.sourceId); else indexed.set(source.sourceId, source) }
  const expected = [
    ...structuralVariants(manifest).map(item => ({ sourceId: manifest.schemaVersion === 'interface-source-v2' ? interfaceVariantKey(item.partId, item.rigId) : item.partId, kind: 'interface-structural', evidence: item.promptEvidence, paths: [...new Set([item.sourcePngPath, ...item.renderNodes.map(node => node.sourcePngPath), ...task9VariantSourceMaskPaths(item, manifest.catalogVersion)])] })),
    ...manifest.bridges.map(item => ({ sourceId: item.id, kind: 'interface-bridge', evidence: item.promptEvidence, paths: [item.sourcePngPath] })),
  ]
  const expectedIds = new Set(expected.map(item => item.sourceId)); const invalid: string[] = index.catalogVersion === manifest.catalogVersion ? [] : ['catalogVersion']
  invalid.push(...[...duplicates].map(id => `duplicate:${id}`))
  for (const source of sources) if ((source.kind === 'interface-structural' || source.kind === 'interface-bridge') && !expectedIds.has(source.sourceId)) invalid.push(`extra:${String(source.sourceId)}`)
  for (const item of expected) {
    const source = indexed.get(item.sourceId); const resources = Array.isArray(source?.sourceResources) ? source.sourceResources as Array<Record<string, any>> : []
    const byPath = new Map(resources.flatMap(resource => typeof resource?.path === 'string' ? [[resource.path, resource.sha256] as const] : []))
    if (source === undefined || source.kind !== item.kind || source.promptId !== item.evidence.promptId || source.promptPath !== item.evidence.promptPath || source.promptSha256 !== item.evidence.promptSha256 || source.reviewRecordPath !== item.evidence.reviewRecordPath || !sha256Text.test(source.reviewRecordSha256 ?? '') || resources.length !== item.paths.length || item.paths.some(path => !sha256Text.test(byPath.get(path) ?? '')) || resources.some(resource => typeof resource?.path !== 'string' || !item.paths.includes(resource.path))) invalid.push(item.sourceId)
  }
  if (invalid.length > 0) throw new Error(`INTERFACE_SOURCE_INDEX_INVALID: ${invalid.join(', ')}`)
}
