import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  V09_COMPOSITION_NODE_IDS,
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  isV09MaterialRegistry,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
  type ContentResourceRef,
  type Diagnostic,
  type ReleaseManifestV09,
  type SealedTraitArtifactV1,
} from '@qmonster/generator-core'
import { canonicalJsonBytes, canonicalJsonSha256, decodedPngSha256 } from './v09-content-identity.js'
import type { TraitVisualApprovalV1 } from './v09-trait-sealer.js'

const HASH = /^[a-f0-9]{64}$/
const RARITY_COUNTS = Object.freeze({ common: 8, rare: 4, legendary: 1 })
const ATTACHMENT_CLASSES = new Set(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar'])
const PLACEMENT_KEYS = new Set(['anchor', 'anchorx', 'anchory', 'x', 'y', 'offset', 'position', 'transform', 'translate', 'scale', 'rotation', 'crop', 'zindex', 'layerorder', 'occludermask', 'occludermasks'])
const PATH_KEYS = new Set(['assetpath', 'path', 'url'])
const MAX_ARRAY = 1024
const MAX_RESOURCES = 8192
type AssemblyStage = 'staging-create' | 'staged' | 'resource' | 'manifest' | 'audit' | 'pointer' | 'catalog-trait-inventory' | 'catalog-skeleton-pool' | 'catalog-revalidate' | 'restore' | 'lock-before-move' | 'lock-after-move'
let assemblyFailureHook: ((stage: AssemblyStage) => void | Promise<void>) | undefined
const processRootMutex = new Set<string>()
const catalogAssemblyQueues = new Map<string, Promise<void>>()

/** @internal deterministic failure seam for rollback tests; intentionally not re-exported by the package barrel. */
export function __setV09AssemblyFailureHookForTest(hook?: (stage: AssemblyStage) => void | Promise<void>): void { assemblyFailureHook = hook }

// Task 1 exports parsers for manifests/sealed traits; these validation-only
// document schemas mirror its remaining public contracts without changing them.
const idSchema = z.string().min(1).max(512).refine(value => value.trim() === value && !/[\\/]|:\/\//.test(value))
const hashSchema = z.string().regex(HASH)
const pngSchema = z.strictObject({ resourceId: z.string().regex(/^sha256:[a-f0-9]{64}$/), sha256: hashSchema, mediaType: z.literal('image/png'), width: z.literal(2048), height: z.literal(2048) })
const materialSchema = z.strictObject({ schemaVersion: z.literal('qmonster-material-v1'), ownerMaterialId: idSchema, colorMap: pngSchema.optional(), colorLut: z.array(z.number().int().min(0).max(255)).length(1024).optional(), alphaPolicy: z.literal('preserve-skeleton-alpha'), blendMode: z.enum(['replace-color', 'multiply', 'overlay']) }).refine(value => value.colorMap !== undefined || value.colorLut !== undefined, 'A material operation requires colorMap or colorLut.')
// An independent, content-addressed input of every projection in this family.
// It binds the template and actual overlay without referring back to approvals.
const overlaySchema = z.strictObject({ schemaVersion: z.literal('qmonster-overlay-policy-v1'), skeletonFamilyId: idSchema, assemblyTemplateSha256: hashSchema, fullContextOverlay: pngSchema, previewPolicy: z.literal('full-context-identity-only') })
const canvasSchema = z.strictObject({ width: z.literal(2048), height: z.literal(2048) })
const boundedRecord = <T extends z.ZodType>(schema: T) => z.record(idSchema, schema).refine(value => Object.keys(value).length <= MAX_ARRAY)
const graphSchema = z.strictObject({ schemaVersion: z.literal('qmonster-composition-graph-v1'), orderedNodes: z.array(z.enum(V09_COMPOSITION_NODE_IDS)).max(21), blendMode: z.literal('source-over-premultiplied-srgb'), transformPolicy: z.literal('identity-only') })
const poolSchema = z.strictObject({ schemaVersion: z.literal('qmonster-skeleton-pool-v1'), skeletonPoolId: idSchema, candidates: z.tuple([z.strictObject({ skeletonFamilyId: idSchema, skeletonClass: z.literal('base'), weight: z.literal(8) }), z.strictObject({ skeletonFamilyId: idSchema, skeletonClass: z.literal('legendary'), weight: z.literal(1) })]) })
const familySchema = z.strictObject({ schemaVersion: z.literal('qmonster-skeleton-family-v1'), skeletonFamilyId: idSchema, skeletonClass: z.enum(['base', 'legendary']), structuralShapeClasses: z.array(z.enum(['feline-standard', 'cat-tail-long', 'cat-tail-curled'])).min(1).max(3), archetypeId: idSchema, poseId: idSchema, speciesRigId: z.literal('feline-sit-v2'), canvas: canvasSchema, neutralMaster: pngSchema, materialMap: pngSchema, fixedOccluderMasks: boundedRecord(pngSchema), assemblyTemplateId: idSchema })
const attachmentClassSchema = z.enum(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar'])
const templateSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-assembly-template-v1'), assemblyTemplateId: idSchema, skeletonFamilyId: idSchema, canvas: canvasSchema, neutralMasterSha256: hashSchema, compositionGraph: graphSchema,
  materialRegistry: z.record(z.string(), z.number()).refine(isV09MaterialRegistry),
  slots: z.strictObject({
    surface: z.array(z.strictObject({ kind: z.literal('surface'), slotId: z.enum(['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface']), ownerMaterialId: idSchema, authoringZone: pngSchema })).length(6),
    embedded: z.array(z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('eyePair'), slotId: z.literal('eyes'), leftAuthoringZone: pngSchema, rightAuthoringZone: pngSchema, pairAuthoringZone: pngSchema, occlusionReplayZone: pngSchema }),
      z.strictObject({ kind: z.literal('mouth'), slotId: z.literal('mouthShape'), authoringZone: pngSchema, occlusionReplayZone: pngSchema }),
      z.strictObject({ kind: z.literal('oralDetail'), slotId: z.literal('oralDetail'), socketRegistry: boundedRecord(z.strictObject({ authoringZone: pngSchema, parentMouthTraitIds: z.array(idSchema).min(1).max(13) })), closedMouthSentinel: z.literal('oral-none') }),
    ])).length(3),
    attachment: z.array(z.strictObject({ kind: z.literal('attachment'), slotId: z.enum(['headAppendage', 'extraAppendage']), attachmentInterface: z.strictObject({ interfaceId: idSchema, allowedShapeClasses: z.array(attachmentClassSchema).min(1).max(4), allowedZone: pngSchema, rearRootStencil: pngSchema, frontRootStencil: pngSchema.optional(), fixedOccluderMaskId: idSchema }) })).length(2),
    effect: z.array(z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('targetedEffect'), slotId: z.literal('effect'), targetId: idSchema, authoringZone: pngSchema, compositionNode: z.enum(['targetedEffect.underlay', 'targetedEffect.overlay']) }),
      z.strictObject({ kind: z.literal('ambientEffect'), slotId: z.literal('effect'), zoneId: z.enum(['background', 'foreground']), authoringZone: pngSchema, compositionNode: z.enum(['backgroundEffect', 'foregroundAmbientEffect']) }),
    ])).min(1).max(32),
  }),
}).refine(value => value.slots.surface.every(slot => Object.hasOwn(value.materialRegistry, slot.ownerMaterialId)), {
  message: 'Every surface owner must be registered.', path: ['slots', 'surface'], params: { diagnosticCode: 'SURFACE_OWNER_VIOLATION' },
})

function schemaCheck(schema: z.ZodType, value: unknown, path: string[], code: string, diagnostics: Diagnostic[]): void {
  const result = schema.safeParse(value)
  if (!result.success) for (const issue of result.error.issues) diagnostics.push(diagnostic(issue.code === 'custom' && issue.params?.diagnosticCode === 'SURFACE_OWNER_VIOLATION' ? 'SURFACE_OWNER_VIOLATION' : code, [...path, ...issue.path.map(String)], issue.message))
}

export interface AssemblyApprovalV1 {
  schemaVersion: 'qmonster-assembly-approval-v1'
  skeletonFamilyId: string
  assemblyTemplateId: string
  assemblyTemplateSha256: string
  neutralMasterSha256: string
  materialMapSha256: string
  fixedOccluderMasksSha256: string
  attachmentAllowlistSha256: string
  compositionGraphSha256: string
  overlaySha256: string
  approvedBy: string
  approvedAt: string
  approvalRevision: number
  status: 'approved' | 'revoked'
}

export interface ApprovedAttachmentAllowlistV1 {
  schemaVersion: 'qmonster-approved-attachment-allowlist-v1'
  entries: Array<{
    skeletonFamilyId: string
    interfaceId: string
    shapeClass: 'ear-horn-small' | 'ear-ornament' | 'mane-small' | 'collar'
    sealedArtifactSha256: string
    traitVisualApprovalSha256: string
  }>
}

export interface TraitInventoryV1 {
  schemaVersion: 'qmonster-trait-inventory-v1'
  traits: Array<{ slotId: string; traitId: string; rarity: 'common' | 'rare' | 'legendary'; oralSocketClass?: string }>
}

export interface V09ContentRecordV1 {
  ref: ContentResourceRef
  bytes: Uint8Array
}

export interface V09ReleaseCandidate {
  releaseManifest: unknown
  speciesRig: unknown
  skeletonPool: unknown
  skeletonFamilies: unknown[]
  assemblyTemplates: unknown[]
  assemblyApprovals: AssemblyApprovalV1[]
  traitApprovals: TraitVisualApprovalV1[]
  attachmentAllowlist: ApprovedAttachmentAllowlistV1
  traitInventory: TraitInventoryV1
  sealedTraits: unknown[]
  compositionGraph: unknown
  resources: V09ContentRecordV1[]
}

export interface AssembleV09ReleaseOptions {
  root: string
  candidate: unknown
  /** Publish the two public v0.9 catalog documents inside the release transaction. */
  publishCatalogDocuments?: true
}

type Pure = null | string | boolean | number | Uint8Array | Pure[] | { [key: string]: Pure }

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function stable(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => a.path.join('\u0000').localeCompare(b.path.join('\u0000')) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message))
}

function snapshot(value: unknown, path: string[] = [], ancestors = new WeakSet<object>()): Pure {
  if (path.length > 64) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate nesting exceeds 64 levels.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate numbers must be finite.')
    return value
  }
  if (value instanceof Uint8Array) {
    if (path.length !== 3 || path[0] !== 'resources' || path[2] !== 'bytes' || value.byteLength > 64 * 1024 * 1024 || (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key))) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Bytes are allowed only in bounded resource records.')
    return new Uint8Array(value)
  }
  if (typeof value !== 'object') throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must contain only plain data and byte arrays.')
  if (ancestors.has(value)) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must not contain cycles.')
  ancestors.add(value)
  try {
    if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must not contain symbol keys.')
    if (Array.isArray(value)) {
      const limit = path.length === 1 && path[0] === 'resources' ? MAX_RESOURCES : MAX_ARRAY
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate array is not an ordinary bounded array.')
      const result: Pure[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw diagnostic('RELEASE_CANDIDATE_INVALID', [...path, String(index)], 'Candidate arrays must not be sparse or contain accessors.')
        result.push(snapshot(descriptor.value, [...path, String(index)], ancestors))
      }
      if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate arrays must not have named properties.')
      return result
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate objects must have the ordinary Object prototype.')
    const result: Record<string, Pure> = {}
    if (Reflect.ownKeys(value).length > MAX_ARRAY) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Object has too many fields.')
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || ['__proto__', 'prototype', 'constructor'].includes(key.toLowerCase())) throw diagnostic('RELEASE_CANDIDATE_INVALID', [...path, key], 'Candidate objects must not contain hidden fields, accessors or dangerous keys.')
      result[key] = snapshot(descriptor.value, [...path, key], ancestors)
    }
    return result
  } finally { ancestors.delete(value) }
}

function forbidden(value: Pure, diagnostics: Diagnostic[], path: string[] = []): void {
  if (value instanceof Uint8Array || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach((item, index) => forbidden(item, diagnostics, [...path, String(index)])); return }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (PLACEMENT_KEYS.has(normalized)) diagnostics.push(diagnostic('NON_IDENTITY_TRANSFORM', [...path, key], `Forbidden placement or trait-owned occluder field: ${key}.`))
    if (PATH_KEYS.has(normalized)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', [...path, key], `Paths and URLs are forbidden: ${key}.`))
    forbidden(child, diagnostics, [...path, key])
  }
}

function record(value: Pure | undefined, diagnostics: Diagnostic[], path: string[], keys?: readonly string[]): Record<string, Pure> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) { diagnostics.push(diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Expected an ordinary object.')); return undefined }
  const result = value as Record<string, Pure>
  if (keys !== undefined) for (const key of Object.keys(result)) if (!keys.includes(key)) diagnostics.push(diagnostic('RELEASE_CANDIDATE_INVALID', [...path, key], 'Unknown field.'))
  return result
}

function array(value: Pure | undefined, diagnostics: Diagnostic[], path: string[]): Pure[] | undefined {
  if (!Array.isArray(value)) { diagnostics.push(diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Expected an array.')); return undefined }
  return value
}

function text(value: Pure | undefined): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value : undefined }
function hash(value: Pure | undefined): string | undefined { return typeof value === 'string' && HASH.test(value) ? value : undefined }
function equalJson(left: unknown, right: unknown): boolean { try { return canonicalJsonSha256(left) === canonicalJsonSha256(right) } catch { return false } }

function ref(value: unknown): ContentResourceRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  const keys = Object.keys(entry).sort()
  if (typeof entry.resourceId !== 'string' || typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256) || entry.resourceId !== `sha256:${entry.sha256}`) return undefined
  if (entry.mediaType === 'image/png' && entry.width === 2048 && entry.height === 2048 && equalJson(keys, ['height', 'mediaType', 'resourceId', 'sha256', 'width'])) return entry as unknown as ContentResourceRef
  if ((entry.mediaType === 'application/qmonster-material-v1+json' || entry.mediaType === 'application/qmonster-manifest-v1+json') && equalJson(keys, ['mediaType', 'resourceId', 'sha256'])) return entry as unknown as ContentResourceRef
  return undefined
}

function refsFrom(value: unknown, found: Map<string, ContentResourceRef>, diagnostics: Diagnostic[], path: string[] = []): void {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return
  if (Array.isArray(value)) { value.forEach((item, index) => refsFrom(item, found, diagnostics, [...path, String(index)])); return }
  const candidate = ref(value)
  if (candidate !== undefined) {
    const previous = found.get(candidate.resourceId)
    if (previous !== undefined && !equalJson(previous, candidate)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', path, `Conflicting canonical refs for ${candidate.resourceId}.`))
    else found.set(candidate.resourceId, candidate)
    return
  }
  if (['resourceId', 'sha256', 'mediaType'].some(key => Object.hasOwn(value, key))) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', path, 'Malformed content resource reference.'))
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => refsFrom(item, found, diagnostics, [...path, key]))
}

async function verifyResource(refValue: ContentResourceRef, bytes: Uint8Array): Promise<boolean> {
  try {
    if (refValue.mediaType === 'image/png') return await decodedPngSha256(bytes) === refValue.sha256
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
    return canonicalJsonSha256(parsed) === refValue.sha256
  } catch { return false }
}

function exactTuple(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && equalJson(value, V09_VERSION_TUPLE)
}

function candidateShape(raw: Pure, diagnostics: Diagnostic[]): V09ReleaseCandidate | undefined {
  const input = record(raw, diagnostics, [], ['releaseManifest', 'speciesRig', 'skeletonPool', 'skeletonFamilies', 'assemblyTemplates', 'assemblyApprovals', 'traitApprovals', 'attachmentAllowlist', 'traitInventory', 'sealedTraits', 'compositionGraph', 'resources'])
  if (input === undefined) return undefined
  for (const key of ['releaseManifest', 'speciesRig', 'skeletonPool', 'assemblyApprovals', 'traitApprovals', 'attachmentAllowlist', 'traitInventory', 'compositionGraph', 'resources'] as const) if (!(key in input)) diagnostics.push(diagnostic('RELEASE_CANDIDATE_INVALID', [key], 'Required candidate field is missing.'))
  const skeletonFamilies = array(input.skeletonFamilies, diagnostics, ['skeletonFamilies'])
  const assemblyTemplates = array(input.assemblyTemplates, diagnostics, ['assemblyTemplates'])
  const sealedTraits = array(input.sealedTraits, diagnostics, ['sealedTraits'])
  const resourcesRaw = array(input.resources, diagnostics, ['resources'])
  const assemblyApprovals = array(input.assemblyApprovals, diagnostics, ['assemblyApprovals'])
  const traitApprovals = array(input.traitApprovals, diagnostics, ['traitApprovals'])
  if (skeletonFamilies === undefined || assemblyTemplates === undefined || sealedTraits === undefined || resourcesRaw === undefined || assemblyApprovals === undefined || traitApprovals === undefined) return undefined
  const resources: V09ContentRecordV1[] = []
  for (let index = 0; index < resourcesRaw.length; index += 1) {
    const item = record(resourcesRaw[index]!, diagnostics, ['resources', String(index)], ['ref', 'bytes'])
    const resourceRef = item === undefined ? undefined : ref(item.ref)
    if (resourceRef === undefined || !(item?.bytes instanceof Uint8Array)) { diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['resources', String(index)], 'Resource records require a strict ref and in-memory bytes.')); continue }
    resources.push({ ref: resourceRef, bytes: item.bytes })
  }
  validateApprovalDocuments(assemblyApprovals, traitApprovals, input.attachmentAllowlist, input.traitInventory, diagnostics)
  schemaCheck(z.strictObject({ speciesRigId: z.literal('feline-sit-v2') }), input.speciesRig, ['speciesRig'], 'RELEASE_CANDIDATE_INVALID', diagnostics)
  schemaCheck(poolSchema, input.skeletonPool, ['skeletonPool'], 'SKELETON_POOL_INVALID', diagnostics)
  skeletonFamilies.forEach((value, index) => schemaCheck(familySchema, value, ['skeletonFamilies', String(index)], 'SKELETON_POOL_INVALID', diagnostics))
  assemblyTemplates.forEach((value, index) => schemaCheck(templateSchema, value, ['assemblyTemplates', String(index)], 'SKELETON_PROJECTION_MISSING', diagnostics))
  return { releaseManifest: input.releaseManifest, speciesRig: input.speciesRig, skeletonPool: input.skeletonPool, skeletonFamilies, assemblyTemplates, assemblyApprovals: assemblyApprovals as unknown as AssemblyApprovalV1[], traitApprovals: traitApprovals as unknown as TraitVisualApprovalV1[], attachmentAllowlist: input.attachmentAllowlist as unknown as ApprovedAttachmentAllowlistV1, traitInventory: input.traitInventory as unknown as TraitInventoryV1, sealedTraits, compositionGraph: input.compositionGraph, resources }
}

function validInstant(value: Pure | undefined): boolean {
  return z.iso.datetime({ offset: true }).safeParse(value).success
}

function validateApprovalDocuments(assemblies: Pure[], traits: Pure[], allowlist: Pure | undefined, inventory: Pure | undefined, diagnostics: Diagnostic[]): void {
  const assemblyKeys = ['schemaVersion', 'skeletonFamilyId', 'assemblyTemplateId', 'assemblyTemplateSha256', 'neutralMasterSha256', 'materialMapSha256', 'fixedOccluderMasksSha256', 'attachmentAllowlistSha256', 'compositionGraphSha256', 'overlaySha256', 'approvedBy', 'approvedAt', 'approvalRevision', 'status'] as const
  const traitKeys = ['schemaVersion', 'skeletonFamilyId', 'assemblyTemplateSha256', 'sealedArtifactSha256', 'fullContextPreviewSha256', 'approvedBy', 'approvedAt', 'approvalRevision', 'status'] as const
  for (const [index, value] of assemblies.entries()) {
    const item = record(value, diagnostics, ['assemblyApprovals', String(index)], assemblyKeys)
    if (!hash(item?.overlaySha256)) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_HASH_MISMATCH', ['assemblyApprovals', String(index), 'overlaySha256'], 'Assembly approval requires the exact overlay policy digest.'))
    if (item === undefined || item.schemaVersion !== 'qmonster-assembly-approval-v1' || !text(item.skeletonFamilyId) || !text(item.assemblyTemplateId) || assemblyKeys.filter(key => key.endsWith('Sha256')).some(key => !hash(item[key])) || !text(item.approvedBy) || typeof item.approvalRevision !== 'number' || !Number.isInteger(item.approvalRevision) || item.approvalRevision <= 0 || (item.status !== 'approved' && item.status !== 'revoked')) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_UNAPPROVED', ['assemblyApprovals', String(index)], 'Assembly approval is not a strict approved-design record.'))
    if (!validInstant(item?.approvedAt)) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_UNAPPROVED', ['assemblyApprovals', String(index), 'approvedAt'], 'Expected a valid ISO instant.'))
  }
  for (const [index, value] of traits.entries()) {
    const item = record(value, diagnostics, ['traitApprovals', String(index)], traitKeys)
    if (item === undefined || item.schemaVersion !== 'qmonster-trait-visual-approval-v1' || !text(item.skeletonFamilyId) || traitKeys.filter(key => key.endsWith('Sha256')).some(key => !hash(item[key])) || !text(item.approvedBy) || typeof item.approvalRevision !== 'number' || !Number.isInteger(item.approvalRevision) || item.approvalRevision <= 0 || (item.status !== 'approved' && item.status !== 'revoked')) diagnostics.push(diagnostic('TRAIT_APPROVAL_MISSING', ['traitApprovals', String(index)], 'Trait approval is not a strict approved-design record.'))
    if (!validInstant(item?.approvedAt)) diagnostics.push(diagnostic('TRAIT_APPROVAL_MISSING', ['traitApprovals', String(index), 'approvedAt'], 'Expected a valid ISO instant.'))
  }
  const allow = record(allowlist as Pure, diagnostics, ['attachmentAllowlist'], ['schemaVersion', 'entries'])
  if (allow === undefined || allow.schemaVersion !== 'qmonster-approved-attachment-allowlist-v1' || array(allow.entries, diagnostics, ['attachmentAllowlist', 'entries']) === undefined) diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['attachmentAllowlist'], 'Attachment allowlist is not a strict record.'))
  if (Array.isArray(allow?.entries)) {
    const seen = new Set<string>()
    allow.entries.forEach((entry, index) => {
      schemaCheck(z.strictObject({ skeletonFamilyId: idSchema, interfaceId: idSchema, shapeClass: attachmentClassSchema, sealedArtifactSha256: hashSchema, traitVisualApprovalSha256: hashSchema }), entry, ['attachmentAllowlist', 'entries', String(index)], 'ATTACHMENT_HASH_NOT_APPROVED', diagnostics)
      addOnce(seen, canonicalOrEmpty(entry), diagnostics, 'ATTACHMENT_HASH_NOT_APPROVED', ['attachmentAllowlist', 'entries', String(index)], 'allowlist entry')
    })
  }
  const inv = record(inventory as Pure, diagnostics, ['traitInventory'], ['schemaVersion', 'traits'])
  if (inv === undefined || inv.schemaVersion !== 'qmonster-trait-inventory-v1' || array(inv.traits, diagnostics, ['traitInventory', 'traits']) === undefined) diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['traitInventory'], 'Inventory is not a strict record.'))
  if (Array.isArray(inv?.traits)) inv.traits.forEach((entry, index) => schemaCheck(z.strictObject({ slotId: z.enum(V09_TRAIT_SLOT_IDS), traitId: idSchema, rarity: z.enum(['common', 'rare', 'legendary']), oralSocketClass: idSchema.optional() }), entry, ['traitInventory', 'traits', String(index)], 'RARITY_INVENTORY_MISMATCH', diagnostics))
}

function addOnce(seen: Set<string>, key: string, diagnostics: Diagnostic[], code: string, path: string[], label: string): void {
  if (seen.has(key)) diagnostics.push(diagnostic(code, path, `Duplicate ${label}: ${key}.`)); else seen.add(key)
}

function approvalHash(value: unknown): string | undefined { try { return canonicalJsonSha256(value) } catch { return undefined } }

/** Snapshot and validate once; callers that write must retain this exact frozen copy. */
async function parseAndValidateV09Release(input: unknown): Promise<{ candidate?: V09ReleaseCandidate; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  let raw: Pure
  try { raw = snapshot(input) } catch (error) { return { diagnostics: [error as Diagnostic] } }
  forbidden(raw, diagnostics)
  const candidate = candidateShape(raw, diagnostics)
  if (candidate === undefined) return { diagnostics: stable(diagnostics) }
  const invalidDocumentShape = diagnostics.length > 0

  const manifestParsed = parseReleaseManifestV09(candidate.releaseManifest)
  if (!manifestParsed.ok) diagnostics.push(...manifestParsed.diagnostics)
  const manifest = manifestParsed.ok ? manifestParsed.value : undefined
  if (manifest !== undefined && !exactTuple(manifest.versionTuple)) diagnostics.push(diagnostic('VERSION_TUPLE_MISMATCH', ['releaseManifest', 'versionTuple'], 'Expected frozen v0.9 schema/catalog/generator version tuple.'))

  const resourceById = new Map<string, V09ContentRecordV1>()
  for (const [index, resource] of candidate.resources.entries()) {
    if (resourceById.has(resource.ref.resourceId)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['resources', String(index)], 'Duplicate resource identity.'))
    else resourceById.set(resource.ref.resourceId, resource)
  }
  const requiredRefs = new Map<string, ContentResourceRef>()
  for (const [key, value] of Object.entries(candidate)) if (key !== 'resources') refsFrom(value, requiredRefs, diagnostics, [key])
  const allowlistDigest = canonicalOrEmpty(candidate.attachmentAllowlist)
  if (allowlistDigest !== '') refsFrom({ resourceId: `sha256:${allowlistDigest}`, sha256: allowlistDigest, mediaType: 'application/qmonster-manifest-v1+json' }, requiredRefs, diagnostics, ['attachmentAllowlist'])
  const declaredDocs = new Set([candidate.speciesRig, candidate.skeletonPool, ...candidate.skeletonFamilies, ...candidate.assemblyTemplates, ...candidate.assemblyApprovals, ...candidate.traitApprovals, candidate.attachmentAllowlist, candidate.traitInventory, ...candidate.sealedTraits, candidate.compositionGraph].map(canonicalOrEmpty))
  // Inspect JSON bytes too: forbidden fields and nested refs cannot hide in a
  // resource record whose outer candidate representation happened to be valid.
  const payloads = new Map<string, Pure>()
  for (const resource of candidate.resources) if (resource.ref.mediaType !== 'image/png') {
    const path = ['resources', resource.ref.resourceId]
    try {
      const payload = snapshot(JSON.parse(Buffer.from(resource.bytes).toString('utf8')), path)
      payloads.set(resource.ref.resourceId, payload)
      forbidden(payload, diagnostics, path)
      if (resource.ref.mediaType === 'application/qmonster-material-v1+json' || !declaredDocs.has(canonicalOrEmpty(payload))) schemaCheck((payload as Record<string, Pure>)?.schemaVersion === 'qmonster-overlay-policy-v1' && resource.ref.mediaType === 'application/qmonster-manifest-v1+json' ? overlaySchema : materialSchema, payload, path, 'RESOURCE_HASH_MISMATCH', diagnostics)
    } catch { diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', path, 'Resource must contain strict plain JSON.')) }
  }
  // Expand only reachable JSON documents: an orphan cannot make its own children
  // reachable. Map iteration also visits refs discovered in nested materials.
  for (const [resourceId] of requiredRefs) {
    const payload = payloads.get(resourceId)
    if (payload !== undefined) refsFrom(payload, requiredRefs, diagnostics, ['resources', resourceId])
  }
  for (const [resourceId, declared] of requiredRefs) {
    const supplied = resourceById.get(resourceId)
    if (supplied === undefined || !equalJson(supplied.ref, declared) || !await verifyResource(supplied.ref, supplied.bytes)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['resources', resourceId], 'Referenced resource is absent, not exact, or does not match its canonical/decoded identity.'))
  }
  for (const resource of candidate.resources) if (!requiredRefs.has(resource.ref.resourceId)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['resources', resource.ref.resourceId], 'Orphan resource is not reachable from the manifest closure.'))
  if (manifest !== undefined) {
    validateManifestClosure(manifest, candidate, diagnostics)
  }

  validatePoolAndFamilies(candidate, diagnostics)
  validateGraph(candidate.compositionGraph, diagnostics)
  validateOverlayBindings(candidate, payloads, diagnostics)
  const inventory = validateInventory(candidate.traitInventory, diagnostics)
  // Report independent graph/inventory/resource failures even if another
  // document is malformed; only cross-document relations need parsed shapes.
  if (invalidDocumentShape) return { diagnostics: stable(diagnostics) }
  const projections = await validateTraits(candidate, inventory, diagnostics)
  validateApprovals(candidate, projections, diagnostics)
  return { candidate, diagnostics: stable(diagnostics) }
}

function validateManifestClosure(manifest: ReleaseManifestV09, candidate: V09ReleaseCandidate, diagnostics: Diagnostic[]): void {
  const expectedRef = (payload: unknown) => ({ resourceId: `sha256:${canonicalOrEmpty(payload)}`, sha256: canonicalOrEmpty(payload), mediaType: 'application/qmonster-manifest-v1+json' })
  const one = (document: ContentResourceRef, payload: unknown, label: string) => {
    if (!equalJson(document, expectedRef(payload))) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['releaseManifest', label], 'Manifest singleton does not bind the exact canonical candidate reference.'))
  }
  const many = (refs: ContentResourceRef[], payloads: unknown[], label: string) => {
    const refObjects = refs.map(ref => canonicalOrEmpty(ref)).sort(); const payloadRefs = payloads.map(expectedRef).map(canonicalOrEmpty).sort()
    const uniqueRefs = new Set(refObjects); const uniquePayloads = new Set(payloadRefs)
    if (refs.length !== payloads.length || uniqueRefs.size !== refs.length || uniquePayloads.size !== payloads.length || !equalJson(refObjects, payloadRefs)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['releaseManifest', label], 'Manifest references must be an exact duplicate-free set of canonical candidate references.'))
  }
  one(manifest.speciesRig, candidate.speciesRig, 'speciesRig')
  one(manifest.skeletonPool, candidate.skeletonPool, 'skeletonPool')
  one(manifest.traitInventory, candidate.traitInventory, 'traitInventory')
  one(manifest.compositionGraph, candidate.compositionGraph, 'compositionGraph')
  many(manifest.skeletonFamilies, candidate.skeletonFamilies, 'skeletonFamilies')
  many(manifest.assemblyTemplates, candidate.assemblyTemplates, 'assemblyTemplates')
  many(manifest.approvals, candidate.assemblyApprovals, 'approvals')
  many(manifest.traitApprovals, candidate.traitApprovals, 'traitApprovals')
  many(manifest.sealedTraits, candidate.sealedTraits, 'sealedTraits')
}

/** Validate an untrusted release candidate without mutating it or performing filesystem writes. */
export async function validateV09Release(input: unknown): Promise<Diagnostic[]> {
  return (await parseAndValidateV09Release(input)).diagnostics
}

function canonicalOrEmpty(value: unknown): string { try { return canonicalJsonSha256(value) } catch { return '' } }

function validatePoolAndFamilies(candidate: V09ReleaseCandidate, diagnostics: Diagnostic[]): void {
  const pool = record(candidate.skeletonPool as Pure, diagnostics, ['skeletonPool'])
  const candidates = pool === undefined ? undefined : array(pool.candidates, diagnostics, ['skeletonPool', 'candidates'])
  const familyById = new Map<string, Record<string, Pure>>()
  for (const [index, value] of candidate.skeletonFamilies.entries()) {
    const family = record(value as Pure, diagnostics, ['skeletonFamilies', String(index)])
    const id = family === undefined ? undefined : text(family.skeletonFamilyId)
    if (id === undefined) diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonFamilies', String(index)], 'Skeleton family requires an ID.'))
    else { if (familyById.has(id)) diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonFamilies', String(index)], `Duplicate skeleton family: ${id}.`)); familyById.set(id, family!) }
    const shapes = family === undefined ? undefined : array(family.structuralShapeClasses, diagnostics, ['skeletonFamilies', String(index), 'structuralShapeClasses'])
    if (family?.speciesRigId !== 'feline-sit-v2' || shapes === undefined || !shapes.includes('feline-standard') || shapes.some(shape => !['feline-standard', 'cat-tail-long', 'cat-tail-curled'].includes(shape as string))) diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonFamilies', String(index)], 'Family must be a complete feline-sit-v2 projection with only feline structural classes.'))
    if (family !== undefined) {
      const masks = record(family.fixedOccluderMasks, diagnostics, ['skeletonFamilies', String(index), 'fixedOccluderMasks'])
      if (masks === undefined || Object.keys(masks).length === 0 || Object.values(masks).some(value => ref(value)?.mediaType !== 'image/png')) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['skeletonFamilies', String(index), 'fixedOccluderMasks'], 'Family fixed occluder masks must be manifest-reachable PNG references.'))
    }
  }
  const templateByFamily = new Map<string, Record<string, Pure>>()
  for (const [index, value] of candidate.assemblyTemplates.entries()) {
    const template = record(value as Pure, diagnostics, ['assemblyTemplates', String(index)])
    const familyId = template === undefined ? undefined : text(template.skeletonFamilyId)
    if (familyId === undefined || templateByFamily.has(familyId)) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['assemblyTemplates', String(index)], 'Each skeleton family needs one unique assembly template.'))
    else templateByFamily.set(familyId, template!)
    if (template !== undefined && !equalJson(template.compositionGraph, candidate.compositionGraph)) diagnostics.push(diagnostic('COMPOSITION_GRAPH_MISMATCH', ['assemblyTemplates', String(index), 'compositionGraph'], 'Every assembly template must use the exact frozen composition graph.'))
  }
  if (candidates === undefined || candidates.length !== 2) { diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonPool', 'candidates'], 'Pool must contain exactly base weight 8 and legendary weight 1.')); return }
  const expected = new Map([['base', 8], ['legendary', 1]])
  const seenClasses = new Set<string>()
  for (const [index, value] of candidates.entries()) {
    const entry = record(value, diagnostics, ['skeletonPool', 'candidates', String(index)])
    const klass = entry === undefined ? undefined : text(entry.skeletonClass)
    const id = entry === undefined ? undefined : text(entry.skeletonFamilyId)
    if (klass === undefined || id === undefined || expected.get(klass) !== entry?.weight || seenClasses.has(klass)) { diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonPool', 'candidates', String(index)], 'Pool candidates must be one base weight 8 and one legendary weight 1.')); continue }
    seenClasses.add(klass)
    const family = familyById.get(id)
    const template = templateByFamily.get(id)
    if (family === undefined || template === undefined || family.skeletonClass !== klass || family.assemblyTemplateId !== template.assemblyTemplateId || template.skeletonFamilyId !== id) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['skeletonPool', 'candidates', String(index)], 'Pool family must have exactly matching family and template projection.'))
    if (family !== undefined && (ref(family.neutralMaster) === undefined || ref(family.materialMap) === undefined || family.fixedOccluderMasks === undefined)) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['skeletonFamilies', id], 'Family must provide neutral, material map, and fixed occluder projection.'))
  }
  if (seenClasses.size !== 2 || familyById.size !== 2 || templateByFamily.size !== 2) diagnostics.push(diagnostic('SKELETON_POOL_INVALID', ['skeletonPool'], 'Exactly two skeleton family/template projections are required.'))
}

function validateGraph(graph: unknown, diagnostics: Diagnostic[]): void {
  const expected = { schemaVersion: 'qmonster-composition-graph-v1', orderedNodes: V09_COMPOSITION_NODE_IDS, blendMode: 'source-over-premultiplied-srgb', transformPolicy: 'identity-only' }
  if (!equalJson(graph, expected)) diagnostics.push(diagnostic('COMPOSITION_GRAPH_MISMATCH', ['compositionGraph'], 'Composition graph must be the frozen 21-node identity-only source-over graph.'))
}

type InventoryEntry = { slotId: string; traitId: string; rarity: 'common' | 'rare' | 'legendary'; oralSocketClass?: string }

function validateInventory(value: unknown, diagnostics: Diagnostic[]): InventoryEntry[] {
  const input = record(value as Pure, diagnostics, ['traitInventory'], ['schemaVersion', 'traits'])
  const traits = input === undefined ? undefined : array(input.traits, diagnostics, ['traitInventory', 'traits'])
  if (input?.schemaVersion !== 'qmonster-trait-inventory-v1' || traits === undefined) { diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['traitInventory'], 'Independent trait inventory schema is invalid.')); return [] }
  const result: InventoryEntry[] = []; const seen = new Set<string>()
  for (const [index, value] of traits.entries()) {
    const item = record(value, diagnostics, ['traitInventory', 'traits', String(index)], ['slotId', 'traitId', 'rarity', 'oralSocketClass'])
    const slotId = item === undefined ? undefined : text(item.slotId); const traitId = item === undefined ? undefined : text(item.traitId)
    const rarity = item?.rarity
    if (slotId === undefined || traitId === undefined || !V09_TRAIT_SLOT_IDS.includes(slotId as never) || (rarity !== 'common' && rarity !== 'rare' && rarity !== 'legendary')) { diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['traitInventory', 'traits', String(index)], 'Inventory trait is malformed or unreachable.')); continue }
    addOnce(seen, `${slotId}\u0000${traitId}`, diagnostics, 'RARITY_INVENTORY_MISMATCH', ['traitInventory', 'traits', String(index)], 'semantic trait')
    result.push({ slotId, traitId, rarity, ...(typeof item?.oralSocketClass === 'string' ? { oralSocketClass: item.oralSocketClass } : {}) })
  }
  for (const slotId of V09_TRAIT_SLOT_IDS) for (const [rarity, count] of Object.entries(RARITY_COUNTS) as Array<[InventoryEntry['rarity'], number]>) {
    const actual = result.filter(entry => entry.slotId === slotId && entry.rarity === rarity).length
    if (actual !== count) diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['traitInventory', slotId, rarity], `Expected frozen count ${count}; found ${actual}.`))
  }
  if (result.length !== 156) diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['traitInventory', 'traits'], 'Expected exactly 156 independent semantic traits.'))
  return result
}

async function validateTraits(candidate: V09ReleaseCandidate, inventory: InventoryEntry[], diagnostics: Diagnostic[]): Promise<Map<string, { artifact: SealedTraitArtifactV1; hash: string }>> {
  const bySemantic = new Map<string, Map<string, { artifact: SealedTraitArtifactV1; hash: string }>>()
  const families = new Map(candidate.skeletonFamilies.map(value => [String((value as Record<string, unknown>).skeletonFamilyId), value as Record<string, unknown>]))
  const templates = new Map(candidate.assemblyTemplates.map(value => [String((value as Record<string, unknown>).skeletonFamilyId), value as Record<string, unknown>]))
  for (const [index, value] of candidate.sealedTraits.entries()) {
    const rawArtifact = value as Record<string, unknown>
    if (rawArtifact?.kind === 'attachment' && !ATTACHMENT_CLASSES.has(String(rawArtifact.shapeClass))) diagnostics.push(diagnostic('SHAPE_CLASS_NOT_ALLOWED', ['sealedTraits', String(index), 'shapeClass'], 'Attachment class is outside the closed global enum.'))
    if (rawArtifact?.kind === 'oralDetail') validateOralProjectionBindings(rawArtifact, templates.get(String(rawArtifact.skeletonFamilyId)), candidate, diagnostics, index)
    const parsed = parseSealedTraitArtifactV1(value)
    if (!parsed.ok) { diagnostics.push(...parsed.diagnostics); continue }
    const artifact = parsed.value; const semantic = `${artifact.slotId}\u0000${artifact.traitId}`; const family = families.get(artifact.skeletonFamilyId); const template = templates.get(artifact.skeletonFamilyId)
    const existing = bySemantic.get(semantic) ?? new Map<string, { artifact: SealedTraitArtifactV1; hash: string }>(); bySemantic.set(semantic, existing)
    if (existing.has(artifact.skeletonFamilyId)) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', String(index)], 'Duplicate skeleton projection.'))
    else existing.set(artifact.skeletonFamilyId, { artifact, hash: canonicalOrEmpty(artifact) })
    if (family === undefined || template === undefined || artifact.assemblyTemplateId !== template.assemblyTemplateId || artifact.assemblyTemplateSha256 !== canonicalOrEmpty(template) || artifact.neutralMasterSha256 !== (family.neutralMaster as Record<string, unknown> | undefined)?.sha256) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', String(index)], 'Artifact family/template/neutral projection is cross-wired or absent.'))
    validateArtifactRoles(artifact, family, template, candidate, diagnostics, index)
  }
  if (candidate.sealedTraits.length !== 312) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits'], 'Expected exactly 312 sealed skeleton projections.'))
  const familyIds = [...families.keys()].sort()
  for (const entry of inventory) {
    const semantic = `${entry.slotId}\u0000${entry.traitId}`; const projections = bySemantic.get(semantic)
    if (projections === undefined || projections.size !== 2 || familyIds.some(id => !projections.has(id))) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', entry.slotId, entry.traitId], 'Every semantic trait must project exactly once to both skeletons.'))
    else for (const projection of projections.values()) if (projection.artifact.rarity !== entry.rarity) diagnostics.push(diagnostic('RARITY_INVENTORY_MISMATCH', ['sealedTraits', entry.slotId, entry.traitId], 'Projection rarity differs from independent inventory.'))
  }
  validateOralCompatibility(inventory, candidate.assemblyTemplates, diagnostics)
  const flat = new Map<string, { artifact: SealedTraitArtifactV1; hash: string }>()
  for (const projections of bySemantic.values()) for (const [family, item] of projections) flat.set(`${family}\u0000${item.hash}`, item)
  return flat
}

function validateOralCompatibility(inventory: InventoryEntry[], templates: unknown[], diagnostics: Diagnostic[]): void {
  const mouths = new Set(inventory.filter(entry => entry.slotId === 'mouthShape').map(entry => entry.traitId))
  for (const entry of inventory.filter(item => item.slotId === 'oralDetail')) {
    if (entry.traitId === 'oral-none') {
      if (entry.oralSocketClass !== 'oral-none') diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['traitInventory', 'oralDetail', entry.traitId], 'oral-none must declare the oral-none compatibility sentinel.'))
      continue
    }
    if (entry.oralSocketClass === undefined || entry.oralSocketClass === 'oral-none') { diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['traitInventory', 'oralDetail', entry.traitId], 'Non-sentinel oral trait needs a reachable declared socket.')); continue }
    for (const [index, templateValue] of templates.entries()) {
      const template = templateValue as Record<string, unknown>; const embedded = (template.slots as Record<string, unknown> | undefined)?.embedded
      const oral = Array.isArray(embedded) ? embedded.find(item => (item as Record<string, unknown>).kind === 'oralDetail') as Record<string, unknown> | undefined : undefined
      const socket = oral?.socketRegistry !== null && typeof oral?.socketRegistry === 'object' ? (oral.socketRegistry as Record<string, unknown>)[entry.oralSocketClass] as Record<string, unknown> | undefined : undefined
      if (socket === undefined || !Array.isArray(socket.parentMouthTraitIds) || !socket.parentMouthTraitIds.some(id => mouths.has(String(id)))) diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['assemblyTemplates', String(index), 'slots', 'oralDetail'], 'Oral compatibility socket is absent or unreachable from a mouth trait.'))
    }
  }
}

function validateOralProjectionBindings(artifact: Record<string, unknown>, template: Record<string, unknown> | undefined, candidate: V09ReleaseCandidate, diagnostics: Diagnostic[], index: number): void {
  const projections = (artifact.runtimeResources as Record<string, unknown> | null)?.oralProjections
  const embedded = (template?.slots as Record<string, unknown> | undefined)?.embedded
  const oral = Array.isArray(embedded) ? embedded.find(slot => slot?.kind === 'oralDetail') as Record<string, unknown> | undefined : undefined
  const registry = oral?.socketRegistry as Record<string, { parentMouthTraitIds?: unknown }> | undefined
  const keys = projections !== null && typeof projections === 'object' && !Array.isArray(projections) ? Object.keys(projections) : []
  if (artifact.traitId === 'oral-none' || keys.length === 0 || keys.some(key => {
    if (key.trim() === '' || key === 'closed' || key === 'oral-none' || !registry || !Object.hasOwn(registry, key)) return true
    const parents = registry[key]?.parentMouthTraitIds
    return !Array.isArray(parents) || !candidate.sealedTraits.some(value => {
      const mouth = value as Record<string, unknown> | null
      return mouth?.kind === 'mouth' && mouth.slotId === 'mouthShape' && mouth.skeletonFamilyId === artifact.skeletonFamilyId
        && mouth.assemblyTemplateId === artifact.assemblyTemplateId && mouth.oralSocketClass === key && parents.includes(mouth.traitId)
    })
  })) diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['sealedTraits', String(index), 'runtimeResources', 'oralProjections'], 'Every oral projection must name a registered socket usable by an actual open mouth in this family/template; closed sentinels are not projections.'))
}

function validateArtifactRoles(artifact: SealedTraitArtifactV1, family: Record<string, unknown> | undefined, template: Record<string, unknown> | undefined, candidate: V09ReleaseCandidate, diagnostics: Diagnostic[], index: number): void {
  const resources = artifact.runtimeResources as Record<string, ContentResourceRef>
  const roles = Object.keys(resources).sort(); const required = artifact.kind === 'surface' ? ['materialOperation'] : artifact.kind === 'eyePair' ? ['content', 'underlay'] : artifact.kind === 'mouth' ? ['mouthBack', 'mouthFront'] : artifact.kind === 'oralDetail' ? ['oralProjections'] : artifact.kind === 'attachment' ? (resources.attachmentFront === undefined ? ['attachmentBehind'] : ['attachmentBehind', 'attachmentFront']) : ['effectLayer']
  if (!equalJson(roles, [...required].sort())) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['sealedTraits', String(index), 'runtimeResources'], 'Trait has missing or extra resource roles.'))
  if (template === undefined || family === undefined) return
  const slots = template.slots as Record<string, unknown> | undefined
  const embedded = Array.isArray(slots?.embedded) ? slots.embedded as Record<string, unknown>[] : []
  if (artifact.kind === 'eyePair') {
    const item = embedded.find(slot => slot.kind === 'eyePair' && slot.slotId === 'eyes')
    if (item === undefined || ref(item.leftAuthoringZone) === undefined || ref(item.rightAuthoringZone) === undefined || ref(item.occlusionReplayZone) === undefined) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', String(index)], 'Eyes require template-owned left/right/content/occlusion roles.'))
  }
  if (artifact.kind === 'mouth') {
    const mouth = embedded.find(slot => slot.kind === 'mouth' && slot.slotId === 'mouthShape'); const oral = embedded.find(slot => slot.kind === 'oralDetail' && slot.slotId === 'oralDetail')
    if (mouth === undefined || oral === undefined || ref(mouth.occlusionReplayZone) === undefined) diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['sealedTraits', String(index)], 'Mouth requires template back/front/socket ownership.'))
    else {
      const socketClass = artifact.oralSocketClass === 'closed' ? 'oral-none' : artifact.oralSocketClass
      const socket = (oral.socketRegistry as Record<string, { parentMouthTraitIds: string[] }>)[socketClass]
      if (socket === undefined || !socket.parentMouthTraitIds.includes(artifact.traitId)) diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['sealedTraits', String(index)], 'Mouth trait must belong to its declared socket registry; closed mouths require oral-none.'))
    }
  }
  if (artifact.kind === 'surface') {
    const surface = Array.isArray(slots?.surface) ? slots.surface as Record<string, unknown>[] : []
    const owner = surface.find(slot => slot.slotId === artifact.slotId)?.ownerMaterialId
    const source = candidate.resources.find(item => item.ref.resourceId === resources.materialOperation?.resourceId)
    try { const payload = source === undefined ? undefined : JSON.parse(Buffer.from(source.bytes).toString('utf8')) as Record<string, unknown>; if (owner === undefined || payload?.ownerMaterialId !== owner) diagnostics.push(diagnostic('SURFACE_OWNER_VIOLATION', ['sealedTraits', String(index)], 'Surface operation owner does not match the template-owned material.')) } catch { diagnostics.push(diagnostic('SURFACE_OWNER_VIOLATION', ['sealedTraits', String(index)], 'Surface operation must be valid owned JSON.')) }
  }
  if (artifact.kind === 'attachment') {
    const attachment = Array.isArray(slots?.attachment) ? slots.attachment as Record<string, unknown>[] : []
    const item = attachment.find(slot => slot.slotId === artifact.slotId && (slot.attachmentInterface as Record<string, unknown> | undefined)?.interfaceId === artifact.interfaceId)
    const iface = item?.attachmentInterface as Record<string, unknown> | undefined
    if (!ATTACHMENT_CLASSES.has(artifact.shapeClass)) diagnostics.push(diagnostic('SHAPE_CLASS_NOT_ALLOWED', ['sealedTraits', String(index), 'shapeClass'], 'Attachment class is outside the closed global enum.'))
    else if (iface === undefined || !Array.isArray(iface.allowedShapeClasses) || !iface.allowedShapeClasses.includes(artifact.shapeClass)) diagnostics.push(diagnostic('SHAPE_CLASS_NOT_ALLOWED', ['sealedTraits', String(index)], 'Attachment class is not allowed by this skeleton interface.'))
    else if (typeof iface.fixedOccluderMaskId !== 'string' || !(family.fixedOccluderMasks as Record<string, unknown> | undefined)?.[iface.fixedOccluderMaskId]) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', String(index)], 'Attachment interface fixed occluder must be family-owned.'))
    if ((iface?.frontRootStencil === undefined) !== (resources.attachmentFront === undefined)) diagnostics.push(diagnostic('SKELETON_PROJECTION_MISSING', ['sealedTraits', String(index)], 'Attachment front role must exactly follow the interface.'))
  }
}

function validateOverlayBindings(candidate: V09ReleaseCandidate, payloads: Map<string, Pure>, diagnostics: Diagnostic[]): void {
  for (const [index, rawTemplate] of candidate.assemblyTemplates.entries()) {
    const template = rawTemplate as Record<string, unknown> | null
    if (!template) continue
    const policies = [...payloads.entries()].filter(([, payload]) => (payload as Record<string, Pure> | null)?.schemaVersion === 'qmonster-overlay-policy-v1' && (payload as Record<string, Pure>).skeletonFamilyId === template.skeletonFamilyId)
    const [resourceId, payload] = policies[0] ?? []
    const policy = overlaySchema.safeParse(payload)
    const digest = canonicalOrEmpty(payload)
    const approval = candidate.assemblyApprovals.find(item => item?.skeletonFamilyId === template.skeletonFamilyId)
    const artifacts = candidate.sealedTraits.filter(value => (value as Record<string, unknown> | null)?.skeletonFamilyId === template.skeletonFamilyId) as Array<Record<string, unknown>>
    const expected = { resourceId: 'sha256:' + digest, sha256: digest, mediaType: 'application/qmonster-manifest-v1+json' }
    if (policies.length !== 1 || !policy.success || resourceId !== expected.resourceId || policy.data.assemblyTemplateSha256 !== canonicalOrEmpty(template) || approval?.overlaySha256 !== digest || artifacts.length === 0 || artifacts.some(artifact => !Array.isArray(artifact.authoringInputs) || artifact.authoringInputs.filter(value => equalJson(value, expected)).length !== 1)) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_HASH_MISMATCH', ['assemblyApprovals', String(index), 'overlaySha256'], 'Approval must bind one exact template-owned overlay policy referenced by every family projection.'))
  }
}

function validateApprovals(candidate: V09ReleaseCandidate, projections: Map<string, { artifact: SealedTraitArtifactV1; hash: string }>, diagnostics: Diagnostic[]): void {
  const allowlist = candidate.attachmentAllowlist as unknown as Record<string, unknown>
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries as Record<string, unknown>[] : []
  const allowlistHash = canonicalOrEmpty(candidate.attachmentAllowlist)
  if (allowlist?.schemaVersion !== 'qmonster-approved-attachment-allowlist-v1') diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['attachmentAllowlist'], 'Attachment allowlist is malformed.'))
  const traits = new Map<string, TraitVisualApprovalV1[]>()
  for (const approval of candidate.traitApprovals) {
    const key = `${approval.skeletonFamilyId}\u0000${approval.sealedArtifactSha256}`
    traits.set(key, [...(traits.get(key) ?? []), approval])
  }
  const assemblies = new Map<string, AssemblyApprovalV1[]>()
  for (const approval of candidate.assemblyApprovals) assemblies.set(approval.skeletonFamilyId, [...(assemblies.get(approval.skeletonFamilyId) ?? []), approval])
  const familyIds = new Set(candidate.skeletonFamilies.map(value => (value as Record<string, unknown>).skeletonFamilyId))
  candidate.assemblyApprovals.forEach((approval, index) => {
    if (!familyIds.has(approval.skeletonFamilyId) || approval.status !== 'approved' || (assemblies.get(approval.skeletonFamilyId)?.length ?? 0) !== 1) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_UNAPPROVED', ['assemblyApprovals', String(index)], 'Orphan, duplicate or revoked assembly approval.'))
  })
  candidate.traitApprovals.forEach((approval, index) => {
    const key = `${approval.skeletonFamilyId}\u0000${approval.sealedArtifactSha256}`
    if (!projections.has(key) || approval.status !== 'approved' || (traits.get(key)?.length ?? 0) !== 1) diagnostics.push(diagnostic('TRAIT_APPROVAL_MISSING', ['traitApprovals', String(index)], 'Orphan, duplicate or revoked trait approval.'))
  })
  entries.forEach((entry, index) => {
    const item = projections.get(`${entry.skeletonFamilyId}\u0000${entry.sealedArtifactSha256}`)
    const approval = traits.get(`${entry.skeletonFamilyId}\u0000${entry.sealedArtifactSha256}`)?.[0]
    if (item?.artifact.kind !== 'attachment' || item.artifact.interfaceId !== entry.interfaceId || item.artifact.shapeClass !== entry.shapeClass || entry.traitVisualApprovalSha256 !== approvalHash(approval)) diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['attachmentAllowlist', 'entries', String(index)], 'Orphan or mismatched attachment approval tuple.'))
  })
  for (const [index, family] of candidate.skeletonFamilies.entries()) {
    const value = family as Record<string, unknown>; const id = String(value.skeletonFamilyId); const template = candidate.assemblyTemplates.find(item => (item as Record<string, unknown>).skeletonFamilyId === id) as Record<string, unknown> | undefined; const approvals = assemblies.get(id) ?? []; const approval = approvals[0]
    const masksHash = canonicalOrEmpty(value.fixedOccluderMasks)
    if (approvals.length !== 1 || approval?.status !== 'approved') diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_UNAPPROVED', ['assemblyApprovals', String(index)], 'Family requires exactly one approved, non-revoked assembly approval.'))
    else if (template === undefined || approval.assemblyTemplateId !== template.assemblyTemplateId || approval.assemblyTemplateSha256 !== canonicalOrEmpty(template) || approval.neutralMasterSha256 !== (value.neutralMaster as Record<string, unknown> | undefined)?.sha256 || approval.materialMapSha256 !== (value.materialMap as Record<string, unknown> | undefined)?.sha256 || approval.fixedOccluderMasksSha256 !== masksHash || approval.attachmentAllowlistSha256 !== allowlistHash || approval.compositionGraphSha256 !== canonicalOrEmpty(candidate.compositionGraph)) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_HASH_MISMATCH', ['assemblyApprovals', String(index)], 'Assembly approval does not bind the exact template/family/allowlist/graph identities.'))
  }
  for (const item of projections.values()) {
    const artifact = item.artifact; const matching = traits.get(`${artifact.skeletonFamilyId}\u0000${item.hash}`) ?? []; const approval = matching[0]
    if (matching.length !== 1 || approval?.status !== 'approved' || approval.assemblyTemplateSha256 !== artifact.assemblyTemplateSha256 || approval.fullContextPreviewSha256 !== artifact.fullContextPreview.sha256) diagnostics.push(diagnostic('TRAIT_APPROVAL_MISSING', ['sealedTraits', artifact.slotId, artifact.traitId], 'Trait requires exactly one exact non-revoked visual approval.'))
    if (artifact.kind === 'attachment') {
      const found = entries.some(entry => entry.skeletonFamilyId === artifact.skeletonFamilyId && entry.interfaceId === artifact.interfaceId && entry.shapeClass === artifact.shapeClass && entry.sealedArtifactSha256 === item.hash && entry.traitVisualApprovalSha256 === approvalHash(approval))
      if (!found) diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['sealedTraits', artifact.slotId, artifact.traitId], 'Attachment tuple is not exactly in the approved allowlist.'))
    }
  }
}

function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }) }
function sameIdentity(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs }
function byteDigest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function contained(root: string, path: string): boolean { const part = relative(root, path); return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part) }

/** Check each lexical component before resolving aliases (including Windows 8.3 names). */
async function directDirectory(path: string): Promise<string> {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const segment of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, segment)
    const entry = await lstat(current)
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Directory component is a link/reparse point or non-directory: ' + current)
  }
  return realpath(absolute)
}

async function ensureDirectory(root: string, segments: string[]): Promise<string> {
  let current = root
  for (const segment of segments) {
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Unsafe release path segment.')
    current = join(current, segment)
    try { await mkdir(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    await directDirectory(current)
  }
  if (!contained(root, current)) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Release path escaped root.')
  return current
}

interface FileState { identity: Stats; digest: string; bytes: Buffer }
async function fileState(path: string): Promise<FileState | undefined> {
  try {
    const initial = await lstat(path)
    if (!initial.isFile() || initial.isSymbolicLink()) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Expected a direct regular file: ' + path)
    const handle = await open(path, 'r')
    try {
      const opened = await handle.stat()
      if (!sameIdentity(initial, opened) || opened.size > 64 * 1024 * 1024) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'File changed or exceeds the read limit: ' + path)
      const bytes = await handle.readFile()
      const after = await handle.stat(); const named = await lstat(path)
      if (!sameIdentity(opened, after) || !sameIdentity(after, named) || named.isSymbolicLink() || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'File changed while reading: ' + path)
      return { identity: after, digest: byteDigest(bytes), bytes }
    } finally { await handle.close() }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

async function matches(path: string, expected: FileState): Promise<boolean> {
  const current = await fileState(path)
  return current !== undefined && sameIdentity(current.identity, expected.identity) && current.digest === expected.digest
}

async function trustedRead(root: string, rootIdentity: Stats, path: string): Promise<Buffer> {
  if (!contained(root, path)) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Read escaped trusted root.')
  const check = async () => {
    if (!sameIdentity(rootIdentity, await lstat(root))) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Trusted root identity changed.')
    await directDirectory(dirname(path))
    if (!contained(root, await realpath(dirname(path)))) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Read parent escaped trusted root.')
  }
  await check()
  const state = await fileState(path)
  if (state === undefined) fail('RESOURCE_HASH_MISMATCH', 'Referenced file is missing: ' + path)
  await check()
  if (!await matches(path, state)) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Referenced file changed after reading.')
  return state.bytes
}

function withCleanupCause(error: unknown, label: string, cause: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error))
  const prior = (original as Error & { rollbackDiagnostics?: string[] }).rollbackDiagnostics ?? []
  return Object.assign(original, { rollbackDiagnostics: [...prior, label + ': ' + String(cause)], cause: new AggregateError([cause], label, { cause: original.cause }) })
}

/** Record the exclusive handle identity before any write/close can fail. */
async function createOwnedToken(path: string, token: string): Promise<FileState> {
  const handle = await open(path, 'wx')
  let identity: Stats | undefined
  let closed = false
  try {
    identity = await handle.stat()
    await handle.writeFile(token)
    await handle.sync()
    await handle.close(); closed = true
    const state = { identity, bytes: Buffer.from(token), digest: byteDigest(Buffer.from(token)) }
    if (!await matches(path, state)) fail('V09_ASSEMBLY_LOCKED', 'Token ownership changed during initialization.')
    return state
  } catch (cause) {
    let error = cause
    if (!closed) { try { await handle.close() } catch (cleanup) { error = withCleanupCause(error, 'token handle close', cleanup) } }
    try {
      const current = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
      if (current !== undefined) {
        if (identity !== undefined && current.isFile() && !current.isSymbolicLink() && sameIdentity(identity, current)) await unlink(path)
        else fail('V09_ASSEMBLY_LOCKED', 'Token ownership changed; preserved ' + path)
      }
    } catch (cleanup) { error = withCleanupCause(error, 'token initialization cleanup', cleanup) }
    throw error
  }
}

interface OwnedLock { path: string; token: string; identity: Stats; owner?: FileState; gate: string }
async function acquireAssemblyLock(root: string, token: string): Promise<OwnedLock> {
  // The gate directory is permanent infrastructure. Only token-named blocker
  // files are removed; there is no fixed gate owner path with a handoff race.
  const gate = await ensureDirectory(root, ['.qmonster-v09-release-gate'])
  if ((await readdir(gate)).length !== 0) fail('V09_ASSEMBLY_LOCKED', 'A release handoff is blocked.')
  const path = join(root, '.qmonster-v09-assemble-lock')
  try { await mkdir(path) } catch (cause) { throw Object.assign(new Error('Another v0.9 assembly owns this catalog root.'), { code: 'V09_ASSEMBLY_LOCKED', cause }) }
  const identity = await lstat(path)
  let owner: FileState | undefined
  try {
    owner = await createOwnedToken(join(path, 'owner'), token)
    const lock = { path, token, identity, owner, gate }
    if ((await readdir(gate)).length !== 0) {
      await releaseAssemblyLock(lock)
      fail('V09_ASSEMBLY_LOCKED', 'A release handoff started during lock acquisition.')
    }
    return lock
  } catch (error) {
    // Partial setup uses the same protected move protocol; never delete the
    // fixed lock path even when creating its owner record failed.
    try { await releaseAssemblyLock({ path, token, identity, gate, ...(owner === undefined ? {} : { owner }) }) }
    catch (cleanup) { throw withCleanupCause(error, 'partial lock cleanup', cleanup) }
    throw error
  }
}

async function releaseAssemblyLock(lock: OwnedLock, retryInitialization = true): Promise<void> {
  const owned = async (path: string) => {
    try { const entry = await lstat(path); return entry.isDirectory() && !entry.isSymbolicLink() && sameIdentity(lock.identity, entry) && (lock.owner === undefined ? (await readdir(path)).length === 0 : await matches(join(path, 'owner'), lock.owner)) }
    catch { return false }
  }
  if (!await owned(lock.path)) return
  const blocker = join(lock.gate, lock.token)
  let blockerState: FileState
  try { blockerState = await createOwnedToken(blocker, lock.token) }
  catch (error) {
    // A transient partial blocker write must not strand the still-owned lock.
    // Retry the protected release once, retaining the original failure.
    if (retryInitialization) {
      try { await releaseAssemblyLock(lock, false) }
      catch (cleanup) { throw withCleanupCause(error, 'blocker retry cleanup', cleanup) }
    }
    throw error
  }
  const tombstone = lock.path + '.releasing-' + lock.token
  let safe = false
  try {
    await assemblyFailureHook?.('lock-before-move')
    await rename(lock.path, tombstone)
    await assemblyFailureHook?.('lock-after-move')
    if (!await owned(tombstone)) {
      // A foreign replacement was moved. While the token blocker exists every
      // compliant process fails closed, including during restoration.
      try {
        if (await lstat(lock.path).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error })) return
        await rename(tombstone, lock.path); safe = true
      } catch { /* Keep the blocker: never expose an unlocked root. */ }
      return
    }
    if (lock.owner !== undefined) await unlink(join(tombstone, 'owner'))
    await rmdir(tombstone)
    safe = true
  } finally {
    if (safe && await matches(blocker, blockerState)) await unlink(blocker)
  }
}

interface JournalEntry { path: string; written: FileState; before?: FileState; mutable: boolean }
interface StagedFile { path: string; state: FileState; ref?: ContentResourceRef }

/** Assemble the single verified snapshot through a call-owned staging transaction. */
async function assembleV09ReleaseTransaction(options: AssembleV09ReleaseOptions): Promise<{ releaseManifestSha256: string; candidatePointerPath: string; auditPath: string }> {
  const parsed = await parseAndValidateV09Release(options?.candidate)
  if (parsed.diagnostics.length > 0 || parsed.candidate === undefined) throw Object.assign(new Error('V0.9 release candidate is invalid.'), { code: 'V09_RELEASE_INVALID', diagnostics: parsed.diagnostics })
  if (typeof options.root !== 'string' || options.root.length === 0) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Release root is required.')
  const candidate = parsed.candidate
  const target = resolve(options.root)
  try { await directDirectory(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Check the existing ancestors before creating the missing root.
    let parent = dirname(target)
    while (true) { try { await directDirectory(parent); break } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; parent = dirname(parent) } }
    await mkdir(target, { recursive: true })
  }
  const root = await directDirectory(target); const rootIdentity = await lstat(root)
  const mutexKey = process.platform === 'win32' ? root.toLowerCase() : root
  if (processRootMutex.has(mutexKey)) fail('V09_ASSEMBLY_LOCKED', 'Another v0.9 assembly owns this catalog root.')
  processRootMutex.add(mutexKey)
  const token = randomUUID(); const staging = join(root, '.qmonster-v09-staging-' + token)
  const stagedPaths = new Map<string, Stats>(); const journal: JournalEntry[] = []; const diagnostics: string[] = []; const cleanupCauses: unknown[] = []
  let lock: OwnedLock | undefined; let stagingIdentity: Stats | undefined; let original: unknown; let failed = false
  const manifestHash = canonicalJsonSha256(candidate.releaseManifest)
  const pointerPath = join(root, 'releases', 'candidate-v0.9.0.json')
  const auditPath = join(root, 'audit', 'v0.9.0', 'release-' + manifestHash + '.json')
  const activePath = join(root, 'releases', 'active-release.json')
  const attempt = async (label: string, action: () => Promise<void>) => { try { await action() } catch (cause) { cleanupCauses.push(cause); diagnostics.push(label + ': ' + String(cause), ...((cause as { rollbackDiagnostics?: string[] })?.rollbackDiagnostics ?? [])) } }
  const checkWrite = async (path: string) => {
    if (!contained(root, path) || !sameIdentity(rootIdentity, await lstat(root))) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Write root identity changed.')
    await directDirectory(dirname(path))
  }
  const writeOwnedTemp = async (path: string, bytes: Uint8Array) => {
    const handle = await open(path, 'wx')
    try {
      // Record ownership before writing, so an actual short/failed write can
      // be cleaned without ever claiming an EEXIST file created by somebody else.
      stagedPaths.set(path, await handle.stat())
      await handle.writeFile(bytes)
    } finally { await handle.close() }
  }
  const stage = async (name: string, bytes: Uint8Array, contentRef?: ContentResourceRef): Promise<StagedFile> => {
    const path = join(staging, name)
    await writeOwnedTemp(path, bytes)
    const state = (await fileState(path))!
    if (state.digest !== byteDigest(bytes) || (contentRef !== undefined && !await verifyResource(contentRef, state.bytes))) fail('RESOURCE_HASH_MISMATCH', 'Staged bytes failed verification.')
    return { path, state, ...(contentRef === undefined ? {} : { ref: contentRef }) }
  }
  const publish = async (source: StagedFile, path: string, mutable: boolean) => {
    await checkWrite(path)
    if (!await matches(source.path, source.state)) fail('RESOURCE_HASH_MISMATCH', 'Staged resource changed before publication.')
    const before = await fileState(path)
    if (!mutable && before !== undefined) {
      const exact = source.ref === undefined
        ? before.digest === source.state.digest && before.bytes.equals(source.state.bytes)
        : await verifyResource(source.ref, before.bytes)
      if (!exact) fail('IMMUTABLE_CONTENT_CONFLICT', 'Conflicting immutable content: ' + path)
      return
    }
    const entry: JournalEntry = { path, written: source.state, mutable, ...(before === undefined ? {} : { before }) }
    if (mutable) {
      // Record intended identity before rename: even a failure immediately after
      // the atomic replacement is recoverable using this exact journal entry.
      journal.push(entry)
      await rename(source.path, path)
    } else {
      // Hard-link publication is atomic and fails if the destination exists.
      try { await link(source.path, path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const raced = await fileState(path)
        const exact = raced !== undefined && (source.ref === undefined
          ? raced.digest === source.state.digest && raced.bytes.equals(source.state.bytes)
          : await verifyResource(source.ref, raced.bytes))
        if (!exact) fail('IMMUTABLE_CONTENT_CONFLICT', 'Conflicting immutable content created concurrently.')
        return
      }
      journal.push(entry)
    }
    if (!await matches(path, source.state)) fail('RESOURCE_HASH_MISMATCH', 'Published output identity changed.')
  }
  try {
    lock = await acquireAssemblyLock(root, token)
    const activeBefore = options.publishCatalogDocuments === true ? await fileState(activePath) : undefined
    await assemblyFailureHook?.('staging-create')
    await mkdir(staging); stagingIdentity = await lstat(staging)
    const resourceFiles: StagedFile[] = []
    for (const resource of candidate.resources) {
      const bytes = resource.ref.mediaType === 'image/png' ? resource.bytes : jsonDisk(JSON.parse(Buffer.from(resource.bytes).toString('utf8')))
      resourceFiles.push(await stage(resource.ref.sha256, bytes, resource.ref))
    }
    const manifestRef = { resourceId: 'sha256:' + manifestHash, sha256: manifestHash, mediaType: 'application/qmonster-manifest-v1+json' } as ContentResourceRef
    const manifestFile = await stage('manifest.json', jsonDisk(candidate.releaseManifest), manifestRef)
    const auditFile = await stage('audit.json', jsonDisk({
      schemaVersion: 'qmonster-v09-release-audit-v1', versionTuple: V09_VERSION_TUPLE, releaseManifestSha256: manifestHash, inventoryCounts: RARITY_COUNTS,
      skeletons: candidate.skeletonFamilies.map(value => ({ skeletonFamilyId: (value as Record<string, unknown>).skeletonFamilyId, assemblyTemplateId: (value as Record<string, unknown>).assemblyTemplateId })),
      assemblyApprovals: candidate.assemblyApprovals.map(approval => ({ skeletonFamilyId: approval.skeletonFamilyId, assemblyApprovalSha256: canonicalOrEmpty(approval) })), result: 'valid',
    }))
    const pointerFile = await stage('pointer.json', jsonDisk({ schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: manifestHash }))
    const catalogFiles = options.publishCatalogDocuments === true ? [
      { stage: 'catalog-trait-inventory' as const, path: join(root, 'catalog', 'v0.9.0', 'trait-inventory.json'), file: await stage('trait-inventory.json', jsonDisk(candidate.traitInventory)) },
      { stage: 'catalog-skeleton-pool' as const, path: join(root, 'catalog', 'v0.9.0', 'skeleton-pool.json'), file: await stage('skeleton-pool.json', jsonDisk(candidate.skeletonPool)) },
    ] : []
    await assemblyFailureHook?.('staged')
    const resourceDirectory = await ensureDirectory(root, ['resources', 'by-sha256'])
    const manifestDirectory = await ensureDirectory(root, ['releases', 'by-sha256'])
    await ensureDirectory(root, ['audit', 'v0.9.0'])
    if (catalogFiles.length > 0) await ensureDirectory(root, ['catalog', 'v0.9.0'])
    for (const publication of catalogFiles) { await publish(publication.file, publication.path, false); await assemblyFailureHook?.(publication.stage) }
    for (const source of resourceFiles) { await publish(source, join(resourceDirectory, source.ref!.sha256), false); await assemblyFailureHook?.('resource') }
    await publish(manifestFile, join(manifestDirectory, manifestHash + '.json'), false); await assemblyFailureHook?.('manifest')
    await publish(auditFile, auditPath, true); await assemblyFailureHook?.('audit')
    await publish(pointerFile, pointerPath, true); await assemblyFailureHook?.('pointer')
    if (catalogFiles.length > 0) {
      await assemblyFailureHook?.('catalog-revalidate')
      for (const publication of catalogFiles) {
        const final = await fileState(publication.path)
        if (final === undefined || final.digest !== publication.file.state.digest || !final.bytes.equals(publication.file.state.bytes)) fail('IMMUTABLE_CONTENT_CONFLICT', 'Catalog document changed before release commit: ' + publication.path)
      }
      const activeAfter = await fileState(activePath)
      const activeUnchanged = activeBefore === undefined
        ? activeAfter === undefined
        : activeAfter !== undefined && activeAfter.digest === activeBefore.digest && activeAfter.bytes.equals(activeBefore.bytes)
      if (!activeUnchanged) fail('IMMUTABLE_CONTENT_CONFLICT', 'active-release.json changed during non-activating candidate assembly.')
    }
  } catch (cause) {
    original = cause; failed = true
    for (const entry of journal.reverse()) {
      await attempt('rollback ' + entry.path, async () => {
        await checkWrite(entry.path)
        if (!await matches(entry.path, entry.written)) { diagnostics.push('Ownership changed; preserved ' + entry.path); return }
        if (entry.mutable && entry.before !== undefined) {
          const restorePath = join(staging, 'restore-' + randomUUID())
          await writeOwnedTemp(restorePath, entry.before.bytes)
          const restored = await fileState(restorePath)
          if (restored?.digest !== entry.before.digest) fail('RESOURCE_HASH_MISMATCH', 'Restore bytes failed verification.')
          // A transient restore failure is retried once; independent entries
          // always continue, and every observed failure is retained.
          for (let retry = 0; ; retry++) {
            try { await assemblyFailureHook?.('restore'); if (await matches(entry.path, entry.written)) await rename(restorePath, entry.path); break }
            catch (error) { diagnostics.push('restore attempt: ' + String(error)); if (retry === 1) throw error }
          }
        } else await unlink(entry.path)
      })
    }
  } finally {
    if (stagingIdentity !== undefined) await attempt('staging cleanup', async () => {
      if (!sameIdentity(stagingIdentity!, await lstat(staging))) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Staging ownership changed.')
      for (const [path, identity] of stagedPaths) await attempt('staged file cleanup', async () => {
        const current = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
        if (current !== undefined) {
          if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Staged file ownership changed: ' + path)
          await unlink(path)
        }
      })
      await rmdir(staging)
    })
    if (lock !== undefined) await attempt('lock cleanup', () => releaseAssemblyLock(lock!))
    processRootMutex.delete(mutexKey)
  }
  if (failed) {
    if (original instanceof Error) { Object.assign(original, { rollbackDiagnostics: [...((original as Error & { rollbackDiagnostics?: string[] }).rollbackDiagnostics ?? []), ...diagnostics] }); throw original }
    throw Object.assign(new Error('Assembly failed.', { cause: original }), { rollbackDiagnostics: diagnostics })
  }
  if (diagnostics.length > 0) throw Object.assign(new Error('Assembly cleanup did not finish.', { cause: new AggregateError(cleanupCauses, 'Assembly cleanup failures') }), { code: 'V09_ASSEMBLY_CLEANUP_FAILED', rollbackDiagnostics: diagnostics })
  return { releaseManifestSha256: manifestHash, candidatePointerPath: pointerPath, auditPath }
}

/**
 * Catalog-publishing callers are serialized in-process before taking the existing
 * filesystem release lock. Other callers retain the Task 5 fail-closed lock API.
 */
export async function assembleV09Release(options: AssembleV09ReleaseOptions): Promise<{ releaseManifestSha256: string; candidatePointerPath: string; auditPath: string }> {
  if (options.publishCatalogDocuments !== true) return assembleV09ReleaseTransaction(options)
  const target = resolve(options.root)
  const key = process.platform === 'win32' ? target.toLowerCase() : target
  const previous = catalogAssemblyQueues.get(key) ?? Promise.resolve()
  let finish!: () => void
  const current = new Promise<void>(resolve => { finish = resolve })
  const tail = previous.catch(() => undefined).then(() => current)
  catalogAssemblyQueues.set(key, tail)
  await previous.catch(() => undefined)
  try { return await assembleV09ReleaseTransaction(options) }
  finally {
    finish()
    if (catalogAssemblyQueues.get(key) === tail) catalogAssemblyQueues.delete(key)
  }
}

function jsonDisk(value: unknown): Buffer { return Buffer.concat([canonicalJsonBytes(value), Buffer.from('\n')]) }

/** Resolve the entire pointer closure, reconstruct by document role/schema, then
 * run the same full validator used by assembly. No path here writes any file. */
export async function validateV09CandidatePointer(options: { root: string; releasePointer: string }): Promise<Diagnostic[]> {
  try {
    const lexicalRoot = resolve(options.root); const pointer = resolve(options.releasePointer)
    if (!contained(lexicalRoot, pointer) || pointer.toLowerCase().endsWith(sep + 'active-release.json')) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Candidate pointer must be below the trusted root and cannot be active-release.json.')
    const segments = relative(lexicalRoot, pointer)
    const root = await directDirectory(lexicalRoot); const identity = await lstat(root)
    const value = snapshot(JSON.parse((await trustedRead(root, identity, join(root, segments))).toString('utf8'))) as Record<string, Pure>
    if (!value || !equalJson(Object.keys(value).sort(), ['releaseManifestSha256', 'schemaVersion']) || value.schemaVersion !== 'qmonster-active-release-v1' || !hash(value.releaseManifestSha256)) fail('RELEASE_MANIFEST_SCHEMA_INVALID', 'Candidate pointer has an invalid strict shape.')
    const manifestValue = snapshot(JSON.parse((await trustedRead(root, identity, join(root, 'releases', 'by-sha256', value.releaseManifestSha256 + '.json'))).toString('utf8')))
    if (canonicalJsonSha256(manifestValue) !== value.releaseManifestSha256) fail('RELEASE_MANIFEST_HASH_MISMATCH', 'Candidate manifest identity does not match.')
    const parsed = parseReleaseManifestV09(manifestValue)
    if (!parsed.ok) return stable(parsed.diagnostics)
    const manifest = parsed.value
    const diagnostics: Diagnostic[] = []; const refs = new Map<string, ContentResourceRef>()
    const records = new Map<string, V09ContentRecordV1>(); const docs = new Map<string, unknown>(); const overlayHashes = new Set<string>()
    refsFrom(manifest, refs, diagnostics, ['releaseManifest'])
    while ([...refs.keys()].some(id => !records.has(id))) {
      if (refs.size > MAX_RESOURCES) fail('RESOURCE_HASH_MISMATCH', 'Release closure exceeds the resource limit.')
      const pending = [...refs.values()].filter(ref => !records.has(ref.resourceId))
      for (const declared of pending) {
        let bytes: Buffer
        try {
          bytes = await trustedRead(root, identity, join(root, 'resources', 'by-sha256', declared.sha256))
          if (!await verifyResource(declared, bytes)) fail('RESOURCE_HASH_MISMATCH', 'Resource identity mismatch: ' + declared.resourceId)
        } catch (error) {
          if (overlayHashes.has(declared.sha256) && (error as { code?: string }).code === 'RESOURCE_HASH_MISMATCH') fail('ASSEMBLY_TEMPLATE_HASH_MISMATCH', 'Bound overlay policy is missing or its content identity differs: ' + declared.resourceId)
          throw error
        }
        records.set(declared.resourceId, { ref: declared, bytes })
        if (declared.mediaType !== 'image/png') {
          const payload = snapshot(JSON.parse(bytes.toString('utf8'))) as Record<string, Pure>
          docs.set(declared.resourceId, payload)
          if (payload?.schemaVersion === 'qmonster-assembly-approval-v1' && hash(payload.overlaySha256)) overlayHashes.add(payload.overlaySha256 as string)
          refsFrom(payload, refs, diagnostics, ['resources', declared.resourceId])
          // Approval contracts contain this canonical digest rather than a ref.
          if (payload?.schemaVersion === 'qmonster-assembly-approval-v1' && hash(payload.attachmentAllowlistSha256)) {
            refsFrom({ resourceId: 'sha256:' + payload.attachmentAllowlistSha256, sha256: payload.attachmentAllowlistSha256, mediaType: 'application/qmonster-manifest-v1+json' }, refs, diagnostics, ['attachmentAllowlist'])
          }
        }
      }
      if (diagnostics.length > 0) return stable(diagnostics)
    }
    const required = (reference: ContentResourceRef, schemaVersion?: string): unknown => {
      const payload = docs.get(reference.resourceId)
      if (payload === undefined || (schemaVersion !== undefined && (payload as Record<string, unknown>)?.schemaVersion !== schemaVersion)) fail('RELEASE_CANDIDATE_INVALID', 'Missing or wrong document schema for ' + reference.resourceId)
      return payload
    }
    const assemblies = manifest.approvals.map(reference => required(reference, 'qmonster-assembly-approval-v1')) as AssemblyApprovalV1[]
    const allowlistHashes = new Set(assemblies.map(item => item.attachmentAllowlistSha256))
    if (allowlistHashes.size !== 1) fail('ATTACHMENT_HASH_NOT_APPROVED', 'Approvals must bind exactly one shared allowlist.')
    const allowlist = docs.get('sha256:' + [...allowlistHashes][0])
    const candidate: V09ReleaseCandidate = {
      releaseManifest: manifestValue, speciesRig: required(manifest.speciesRig), skeletonPool: required(manifest.skeletonPool, 'qmonster-skeleton-pool-v1'),
      skeletonFamilies: manifest.skeletonFamilies.map(reference => required(reference, 'qmonster-skeleton-family-v1')),
      assemblyTemplates: manifest.assemblyTemplates.map(reference => required(reference, 'qmonster-assembly-template-v1')),
      assemblyApprovals: assemblies,
      traitApprovals: manifest.traitApprovals.map(reference => required(reference, 'qmonster-trait-visual-approval-v1')) as TraitVisualApprovalV1[],
      attachmentAllowlist: allowlist as ApprovedAttachmentAllowlistV1, traitInventory: required(manifest.traitInventory, 'qmonster-trait-inventory-v1') as TraitInventoryV1,
      sealedTraits: manifest.sealedTraits.map(reference => required(reference, 'qmonster-sealed-trait-v1')),
      compositionGraph: required(manifest.compositionGraph, 'qmonster-composition-graph-v1'), resources: [...records.values()],
    }
    return validateV09Release(candidate)
  } catch (error) {
    const failure = error as { code?: string; message?: string }
    return [diagnostic(failure.code ?? 'RELEASE_CANDIDATE_INVALID', ['releasePointer'], failure.message ?? 'Candidate release cannot be read from the trusted root.')]
  }
}
