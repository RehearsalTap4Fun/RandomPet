import { z } from 'zod'
import {
  V09_COMPOSITION_NODE_IDS, V09_TRAIT_SLOT_IDS, V09_VERSION_TUPLE, isV09MaterialRegistry,
  parseContentResourceId, parseReleaseManifestV09, parseSealedTraitArtifactV1,
  type AssemblyTemplateV1, type CompositionGraphV1, type ContentResourceRef, type JsonResourceRef,
  type ResolvedV09Catalog, type SealedTraitArtifactV1, type SkeletonFamilyV1, type SkeletonPoolV1,
} from '@qmonster/generator-core'

const HASH = /^[a-f0-9]{64}$/u
type DocumentInput = unknown | (() => Promise<unknown>)

const bundledActivePointerDocuments = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/releases/active-release.json', { eager: true, import: 'default' },
)
const bundledReleaseManifestModules = import.meta.glob<string>(
  '../../../packages/asset-catalog/releases/by-sha256/*.json', { query: '?raw', import: 'default' },
)

export class ProductionReleaseError extends Error {
  public constructor(public readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options); this.name = 'ProductionReleaseError'
  }
}
export interface ProductionTraitRecord { artifact: SealedTraitArtifactV1; sealedArtifactSha256: string; fullContextPreviewSha256: string; approvalState: 'approved' }
export interface ProductionAssemblyRecord { skeletonFamilyId: string; neutralMasterSha256: string; approvalState: 'approved' }
export interface ProductionV09Release { manifestHash: string; catalog: ResolvedV09Catalog; traits: ProductionTraitRecord[]; assemblies: ProductionAssemblyRecord[] }
export interface ProductionReleaseDocuments {
  pointer?: unknown
  activePointerDocuments?: Readonly<Record<string, unknown>>
  releaseManifestDocuments?: Readonly<Record<string, DocumentInput>>
  resourceDocuments?: Readonly<Record<string, DocumentInput>>
  loadResourceBytes?: (resourceId: string) => Promise<Uint8Array>
}

function fail(code: string, message: string, cause?: unknown): never { throw new ProductionReleaseError(code, message, cause === undefined ? undefined : { cause }) }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function pointerFrom(input: unknown): { releaseManifestSha256: string } {
  if (!isRecord(input) || input.schemaVersion !== 'qmonster-active-release-v1' || typeof input.releaseManifestSha256 !== 'string'
    || !HASH.test(input.releaseManifestSha256) || Object.keys(input).sort().join(',') !== 'releaseManifestSha256,schemaVersion') {
    return fail('ACTIVE_RELEASE_INVALID', 'The active release pointer is missing or invalid.')
  }
  return { releaseManifestSha256: input.releaseManifestSha256 }
}
function oneBundledPointer(documents: Readonly<Record<string, unknown>>): unknown {
  const values = Object.values(documents)
  if (values.length === 0) return fail('ACTIVE_RELEASE_MISSING', 'No active v0.9 release has been activated.')
  if (values.length !== 1) return fail('ACTIVE_RELEASE_INVALID', 'Exactly one active release pointer is required.')
  return values[0]
}
function inputsByHash(documents: Readonly<Record<string, DocumentInput>>, jsonSuffix = false): Map<string, DocumentInput> {
  const result = new Map<string, DocumentInput>()
  for (const [key, value] of Object.entries(documents)) {
    const normalized = key.replaceAll('\\', '/')
    const match = new RegExp(`/([a-f0-9]{64})${jsonSuffix ? '\\.json' : ''}$`, 'u').exec(normalized)
    const digest = match?.[1] ?? (HASH.test(key) ? key : undefined)
    if (digest !== undefined) result.set(digest, value)
  }
  return result
}
function canonicalize(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') { if (!Number.isFinite(value)) return fail('CANONICAL_JSON_INVALID', 'Canonical JSON rejects non-finite numbers.'); return JSON.stringify(value) }
  if (typeof value !== 'object') return fail('CANONICAL_JSON_INVALID', 'Canonical JSON contains an unsupported value.')
  if (ancestors.has(value)) return fail('CANONICAL_JSON_INVALID', 'Canonical JSON rejects cycles.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const members: string[] = []
      for (let index = 0; index < value.length; index += 1) { if (!(index in value)) return fail('CANONICAL_JSON_INVALID', 'Canonical JSON rejects sparse arrays.'); members.push(canonicalize(value[index], ancestors)) }
      return `[${members.join(',')}]`
    }
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return fail('CANONICAL_JSON_INVALID', 'Canonical JSON requires ordinary objects.')
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`).join(',')}}`
  } finally { ancestors.delete(value) }
}
export async function browserCanonicalJsonSha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function materialize(input: DocumentInput, code: string): Promise<unknown> {
  let value = typeof input === 'function' ? await input() : input
  if (isRecord(value) && Object.keys(value).length === 1 && 'default' in value) value = value.default
  if (typeof value !== 'string') return structuredClone(value)
  try { return JSON.parse(value) as unknown } catch (error) { return fail(code, 'Content-addressed JSON could not be parsed.', error) }
}
function assertRef(value: unknown): asserts value is ContentResourceRef {
  if (!isRecord(value) || typeof value.resourceId !== 'string' || typeof value.sha256 !== 'string' || parseContentResourceId(value.resourceId) === undefined
    || value.resourceId !== `sha256:${value.sha256}` || !HASH.test(value.sha256)) return fail('RESOURCE_HASH_MISMATCH', 'Resource identity and digest must agree.')
  const keys = Object.keys(value).sort().join(',')
  if (value.mediaType === 'image/png') {
    if (value.width !== 2048 || value.height !== 2048 || keys !== 'height,mediaType,resourceId,sha256,width') return fail('RESOURCE_SCHEMA_INVALID', 'PNG references must be strict 2048x2048 refs.')
  } else if ((value.mediaType !== 'application/qmonster-material-v1+json' && value.mediaType !== 'application/qmonster-manifest-v1+json') || keys !== 'mediaType,resourceId,sha256') {
    return fail('RESOURCE_SCHEMA_INVALID', 'JSON references must use a supported strict media type.')
  }
}
function collectRefs(value: unknown, found = new Map<string, ContentResourceRef>()): Map<string, ContentResourceRef> {
  if (Array.isArray(value)) value.forEach(item => collectRefs(item, found))
  else if (isRecord(value)) {
    if (['resourceId', 'sha256', 'mediaType'].some(key => Object.hasOwn(value, key))) {
      assertRef(value); const previous = found.get(value.resourceId)
      if (previous !== undefined && canonicalize(previous) !== canonicalize(value)) return fail('RESOURCE_HASH_MISMATCH', 'A resource identity has conflicting declarations.')
      found.set(value.resourceId, value)
    }
    Object.values(value).forEach(item => collectRefs(item, found))
  }
  return found
}

const hash = z.string().regex(HASH)
const pngRef = z.strictObject({ resourceId: z.string(), sha256: hash, mediaType: z.literal('image/png'), width: z.literal(2048), height: z.literal(2048) })
const canvas = z.strictObject({ width: z.literal(2048), height: z.literal(2048) })
const graphSchema = z.strictObject({ schemaVersion: z.literal('qmonster-composition-graph-v1'), orderedNodes: z.array(z.enum(V09_COMPOSITION_NODE_IDS)).length(V09_COMPOSITION_NODE_IDS.length), blendMode: z.literal('source-over-premultiplied-srgb'), transformPolicy: z.literal('identity-only') })
const poolSchema = z.strictObject({ schemaVersion: z.literal('qmonster-skeleton-pool-v1'), skeletonPoolId: z.string().min(1), candidates: z.tuple([z.strictObject({ skeletonFamilyId: z.string().min(1), skeletonClass: z.literal('base'), weight: z.literal(8) }), z.strictObject({ skeletonFamilyId: z.string().min(1), skeletonClass: z.literal('legendary'), weight: z.literal(1) })]) })
const familySchema = z.strictObject({ schemaVersion: z.literal('qmonster-skeleton-family-v1'), skeletonFamilyId: z.string().min(1), skeletonClass: z.enum(['base', 'legendary']), structuralShapeClasses: z.array(z.enum(['feline-standard', 'cat-tail-long', 'cat-tail-curled', 'dog-tail-curled'])).min(1), archetypeId: z.string().min(1), poseId: z.string().min(1), speciesRigId: z.string().min(1), canvas, neutralMaster: pngRef, materialMap: pngRef, fixedOccluderMasks: z.record(z.string(), pngRef), assemblyTemplateId: z.string().min(1) })
const surfaceTemplate = z.strictObject({ kind: z.literal('surface'), slotId: z.enum(['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface']), ownerMaterialId: z.string().min(1), authoringZone: pngRef })
const eyeTemplate = z.strictObject({ kind: z.literal('eyePair'), slotId: z.literal('eyes'), leftAuthoringZone: pngRef, rightAuthoringZone: pngRef, pairAuthoringZone: pngRef, occlusionReplayZone: pngRef })
const mouthTemplate = z.strictObject({ kind: z.literal('mouth'), slotId: z.literal('mouthShape'), authoringZone: pngRef, occlusionReplayZone: pngRef })
const oralDetailTemplate = z.strictObject({ kind: z.literal('oralDetail'), slotId: z.literal('oralDetail'), socketRegistry: z.record(z.string(), z.strictObject({ authoringZone: pngRef, parentMouthTraitIds: z.array(z.string().min(1)) })), closedMouthSentinel: z.literal('oral-none') })
const attachmentTemplate = z.strictObject({ kind: z.literal('attachment'), slotId: z.enum(['headAppendage', 'extraAppendage']), attachmentInterface: z.strictObject({ interfaceId: z.string().min(1), allowedShapeClasses: z.array(z.enum(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar'])), allowedZone: pngRef, rearRootStencil: pngRef, frontRootStencil: pngRef.optional(), fixedOccluderMaskId: z.string().min(1) }) })
const targetedEffectTemplate = z.strictObject({ kind: z.literal('targetedEffect'), slotId: z.literal('effect'), targetId: z.string().min(1), authoringZone: pngRef, compositionNode: z.enum(['targetedEffect.underlay', 'targetedEffect.overlay']) })
const ambientEffectTemplate = z.strictObject({ kind: z.literal('ambientEffect'), slotId: z.literal('effect'), zoneId: z.enum(['background', 'foreground']), authoringZone: pngRef, compositionNode: z.enum(['backgroundEffect', 'foregroundAmbientEffect']) })
const templateSchema = z.strictObject({ schemaVersion: z.literal('qmonster-assembly-template-v1'), assemblyTemplateId: z.string().min(1), skeletonFamilyId: z.string().min(1), canvas, neutralMasterSha256: hash, materialRegistry: z.record(z.string(), z.number()).refine(isV09MaterialRegistry), slots: z.strictObject({ surface: z.array(surfaceTemplate), embedded: z.array(z.discriminatedUnion('kind', [eyeTemplate, mouthTemplate, oralDetailTemplate])), attachment: z.array(attachmentTemplate), effect: z.array(z.discriminatedUnion('kind', [targetedEffectTemplate, ambientEffectTemplate])) }), compositionGraph: graphSchema }).refine(value => value.slots.surface.every(slot => Object.hasOwn(value.materialRegistry, slot.ownerMaterialId)), 'Every surface owner must be registered.')
const assemblyApprovalSchema = z.strictObject({ schemaVersion: z.literal('qmonster-assembly-approval-v1'), skeletonFamilyId: z.string().min(1), assemblyTemplateId: z.string().min(1), assemblyTemplateSha256: hash, neutralMasterSha256: hash, materialMapSha256: hash, fixedOccluderMasksSha256: hash, attachmentAllowlistSha256: hash, compositionGraphSha256: hash, overlaySha256: hash, approvedBy: z.string().min(1), approvedAt: z.string().min(1), approvalRevision: z.number().int().positive(), status: z.literal('approved') })
const traitApprovalSchema = z.strictObject({ schemaVersion: z.literal('qmonster-trait-visual-approval-v1'), skeletonFamilyId: z.string().min(1), assemblyTemplateSha256: hash, sealedArtifactSha256: hash, fullContextPreviewSha256: hash, approvedBy: z.string().min(1), approvedAt: z.string().min(1), approvalRevision: z.number().int().positive(), status: z.literal('approved') })
const inventoryEntrySchema = z.strictObject({ slotId: z.enum(V09_TRAIT_SLOT_IDS), traitId: z.string().min(1), rarity: z.enum(['common', 'rare', 'legendary']), oralSocketClass: z.string().min(1).optional() })
const inventorySchema = z.strictObject({ schemaVersion: z.literal('qmonster-trait-inventory-v1'), traits: z.array(inventoryEntrySchema).length(156) })
const speciesRigSchema = z.strictObject({ speciesRigId: z.literal('feline-sit-v2') })
const allowlistSchema = z.strictObject({ schemaVersion: z.literal('qmonster-approved-attachment-allowlist-v1'), entries: z.array(z.strictObject({ skeletonFamilyId: z.string().min(1), interfaceId: z.string().min(1), shapeClass: z.enum(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar']), sealedArtifactSha256: hash, traitVisualApprovalSha256: hash })) })
function parsed<T>(schema: z.ZodType<T>, value: unknown, code: string, message: string): T { const result = schema.safeParse(value); if (!result.success) return fail(code, message); return result.data }

/** Load the exact active release. Candidate use is explicit through `pointer`, never a fallback. */
export async function loadActiveProductionRelease(options: ProductionReleaseDocuments = {}): Promise<ProductionV09Release> {
  const pointer = pointerFrom(options.pointer ?? oneBundledPointer(options.activePointerDocuments ?? bundledActivePointerDocuments))
  const manifests = inputsByHash({ ...bundledReleaseManifestModules, ...options.releaseManifestDocuments }, true)
  const manifestInput = manifests.get(pointer.releaseManifestSha256)
  if (manifestInput === undefined) return fail('RELEASE_MANIFEST_HASH_MISMATCH', 'The exact active release manifest is not bundled.')
  const manifestDocument = await materialize(manifestInput, 'RELEASE_MANIFEST_SCHEMA_INVALID')
  if (await browserCanonicalJsonSha256(manifestDocument) !== pointer.releaseManifestSha256) return fail('RELEASE_MANIFEST_HASH_MISMATCH', 'The active manifest body does not match its pointer digest.')
  const manifestParsed = parseReleaseManifestV09(manifestDocument)
  if (!manifestParsed.ok) { const diagnostic = manifestParsed.diagnostics.find(item => item.code === 'VERSION_TUPLE_MISMATCH') ?? manifestParsed.diagnostics[0]; return fail(diagnostic?.code ?? 'RELEASE_MANIFEST_SCHEMA_INVALID', diagnostic?.message ?? 'Release manifest invalid.') }
  const manifest = manifestParsed.value
  if (canonicalize(manifest.versionTuple) !== canonicalize(V09_VERSION_TUPLE)) return fail('VERSION_TUPLE_MISMATCH', 'Only the exact v0.9 tuple is supported.')

  const resources = inputsByHash(options.resourceDocuments ?? {})
  const loadBytes = options.loadResourceBytes ?? (resourceId => bundledV09ResourceBytes(resourceId.slice('sha256:'.length)))
  const loadJsonByHash = async (resourceId: string, hash: string, code: string): Promise<unknown> => {
    const source = resources.get(hash)
    let document: unknown
    if (source !== undefined) document = await materialize(source, code)
    else {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await loadBytes(resourceId))
        document = await materialize(text, code)
      } catch (error) {
        if (error instanceof ProductionReleaseError) throw error
        return fail('RESOURCE_HASH_MISMATCH', `Referenced resource could not be loaded: ${resourceId}`, error)
      }
    }
    if (await browserCanonicalJsonSha256(document) !== hash) return fail('RESOURCE_HASH_MISMATCH', `JSON resource digest mismatch: ${resourceId}`)
    return document
  }
  const loadedJson = new Map<string, unknown>(), loadedRefs = new Map<string, ContentResourceRef>(), pending = collectRefs(manifest)
  while (pending.size > 0) {
    const batch = [...pending.entries()]; pending.clear()
    const nested = await Promise.all(batch.map(async ([resourceId, ref]) => {
      if (loadedRefs.has(resourceId)) return [] as Array<[string, ContentResourceRef]>
      loadedRefs.set(resourceId, ref); if (ref.mediaType === 'image/png') return [] as Array<[string, ContentResourceRef]>
      const document = await loadJsonByHash(resourceId, ref.sha256, 'RESOURCE_SCHEMA_INVALID')
      loadedJson.set(resourceId, document)
      return [...collectRefs(document).entries()]
    }))
    for (const refs of nested) for (const [resourceId, ref] of refs) {
      const previous = loadedRefs.get(resourceId) ?? pending.get(resourceId)
      if (previous !== undefined && canonicalize(previous) !== canonicalize(ref)) return fail('RESOURCE_HASH_MISMATCH', 'A resource identity has conflicting declarations.')
      if (previous === undefined) pending.set(resourceId, ref)
    }
  }
  const required = <T,>(ref: JsonResourceRef, schema: z.ZodType<T>, code: string, message: string): T => { const value = loadedJson.get(ref.resourceId); if (value === undefined) return fail(code, 'Required content-addressed document missing.'); return parsed(schema, value, code, message) }
  required(manifest.speciesRig, speciesRigSchema, 'SKELETON_PROJECTION_MISSING', 'Species rig schema invalid.')
  const skeletonPool = required(manifest.skeletonPool, poolSchema, 'SKELETON_POOL_INVALID', 'Skeleton pool schema invalid.') as SkeletonPoolV1
  const compositionGraph = required(manifest.compositionGraph, graphSchema, 'COMPOSITION_GRAPH_MISMATCH', 'Composition graph invalid.') as CompositionGraphV1
  if (canonicalize(compositionGraph.orderedNodes) !== canonicalize(V09_COMPOSITION_NODE_IDS)) return fail('COMPOSITION_GRAPH_MISMATCH', 'Composition graph nodes are not in the fixed v0.9 order.')
  const families = manifest.skeletonFamilies.map(ref => required(ref, familySchema, 'SKELETON_PROJECTION_MISSING', 'Skeleton family schema invalid.') as SkeletonFamilyV1)
  const templates = manifest.assemblyTemplates.map(ref => required(ref, templateSchema, 'SKELETON_PROJECTION_MISSING', 'Assembly template schema invalid.') as AssemblyTemplateV1)
  const inventory = required(manifest.traitInventory, inventorySchema, 'RARITY_INVENTORY_MISMATCH', 'Trait inventory schema invalid.')
  const sealedTraits = manifest.sealedTraits.map(ref => { const result = parseSealedTraitArtifactV1(loadedJson.get(ref.resourceId)); if (!result.ok) return fail(result.diagnostics[0]?.code ?? 'TRAIT_SCHEMA_INVALID', 'Sealed trait schema invalid.'); return result.value })
  const assemblyApprovals = manifest.approvals.map(ref => required(ref, assemblyApprovalSchema, 'ASSEMBLY_TEMPLATE_UNAPPROVED', 'Assembly approval invalid.'))
  const traitApprovals = manifest.traitApprovals.map(ref => required(ref, traitApprovalSchema, 'TRAIT_APPROVAL_MISSING', 'Trait approval invalid.'))
  if (families.length !== 2 || templates.length !== 2 || sealedTraits.length !== 312 || traitApprovals.length !== 312) return fail('SKELETON_PROJECTION_MISSING', 'Release projection matrix incomplete.')
  const familyById = new Map(families.map(family => [family.skeletonFamilyId, family]))
  const templateByFamily = new Map(templates.map((template, index) => [template.skeletonFamilyId, { template, hash: manifest.assemblyTemplates[index]!.sha256 }]))
  if (familyById.size !== 2 || templateByFamily.size !== 2) return fail('SKELETON_PROJECTION_MISSING', 'Families/templates must be unique.')
  for (const candidate of skeletonPool.candidates) {
    const family = familyById.get(candidate.skeletonFamilyId), template = templateByFamily.get(candidate.skeletonFamilyId)
    if (family === undefined || template === undefined || family.skeletonClass !== candidate.skeletonClass || family.assemblyTemplateId !== template.template.assemblyTemplateId || template.template.neutralMasterSha256 !== family.neutralMaster.sha256 || canonicalize(template.template.compositionGraph) !== canonicalize(compositionGraph)) return fail('SKELETON_PROJECTION_MISSING', 'Pool, family and template are cross-wired.')
  }
  const semantic = new Map(inventory.traits.map(entry => [`${entry.slotId}\u0000${entry.traitId}`, entry])); if (semantic.size !== 156) return fail('RARITY_INVENTORY_MISMATCH', 'Duplicate trait semantics.')
  for (const slotId of V09_TRAIT_SLOT_IDS) for (const [rarity, expected] of Object.entries({ common: 8, rare: 4, legendary: 1 })) if (inventory.traits.filter(entry => entry.slotId === slotId && entry.rarity === rarity).length !== expected) return fail('RARITY_INVENTORY_MISMATCH', 'Inventory is not 8/4/1.')
  const approvalsByArtifact = new Map<string, typeof traitApprovals>(); traitApprovals.forEach(approval => approvalsByArtifact.set(approval.sealedArtifactSha256, [...(approvalsByArtifact.get(approval.sealedArtifactSha256) ?? []), approval]))
  const traitRecords = new Map<string, ProductionTraitRecord>()
  for (const [index, artifact] of sealedTraits.entries()) {
    const sealedHash = manifest.sealedTraits[index]!.sha256, family = familyById.get(artifact.skeletonFamilyId), template = templateByFamily.get(artifact.skeletonFamilyId), approval = approvalsByArtifact.get(sealedHash)
    if (family === undefined || template === undefined || artifact.assemblyTemplateId !== template.template.assemblyTemplateId || artifact.assemblyTemplateSha256 !== template.hash || artifact.neutralMasterSha256 !== family.neutralMaster.sha256) return fail('SKELETON_PROJECTION_MISSING', 'Trait family/template binding invalid.')
    if (approval?.length !== 1 || approval[0]!.skeletonFamilyId !== artifact.skeletonFamilyId || approval[0]!.assemblyTemplateSha256 !== artifact.assemblyTemplateSha256 || approval[0]!.fullContextPreviewSha256 !== artifact.fullContextPreview.sha256) return fail('TRAIT_APPROVAL_MISSING', 'Trait lacks one exact approval.')
    const key = `${artifact.skeletonFamilyId}\u0000${artifact.slotId}\u0000${artifact.traitId}`
    if (traitRecords.has(key) || !semantic.has(`${artifact.slotId}\u0000${artifact.traitId}`)) return fail('SKELETON_PROJECTION_MISSING', 'Trait projection duplicated or unreachable.')
    traitRecords.set(key, { artifact, sealedArtifactSha256: sealedHash, fullContextPreviewSha256: artifact.fullContextPreview.sha256, approvalState: 'approved' })
  }
  if ([...semantic.keys()].some(key => families.some(family => !traitRecords.has(`${family.skeletonFamilyId}\u0000${key}`)))) return fail('SKELETON_PROJECTION_MISSING', 'Projection matrix incomplete.')
  const assemblyByFamily = new Map(assemblyApprovals.map(approval => [approval.skeletonFamilyId, approval])); if (assemblyByFamily.size !== 2) return fail('ASSEMBLY_TEMPLATE_UNAPPROVED', 'Assembly approvals must be unique.')
  const allowlistHashes = new Set(assemblyApprovals.map(approval => approval.attachmentAllowlistSha256)); if (allowlistHashes.size !== 1) return fail('ATTACHMENT_HASH_NOT_APPROVED', 'Approvals must bind one allowlist.')
  const allowlistHash = [...allowlistHashes][0]!
  const allowlistDocument = await loadJsonByHash(`sha256:${allowlistHash}`, allowlistHash, 'ATTACHMENT_HASH_NOT_APPROVED')
  const allowlist = parsed(allowlistSchema, allowlistDocument, 'ATTACHMENT_HASH_NOT_APPROVED', 'Attachment allowlist invalid.')
  const approvalHashByArtifact = new Map<string, string>(); traitApprovals.forEach((approval, index) => approvalHashByArtifact.set(approval.sealedArtifactSha256, manifest.traitApprovals[index]!.sha256))
  for (const record of traitRecords.values()) if (record.artifact.kind === 'attachment') {
    const attachment = record.artifact
    if (!allowlist.entries.some(entry => entry.skeletonFamilyId === attachment.skeletonFamilyId && entry.interfaceId === attachment.interfaceId && entry.shapeClass === attachment.shapeClass && entry.sealedArtifactSha256 === record.sealedArtifactSha256 && entry.traitVisualApprovalSha256 === approvalHashByArtifact.get(record.sealedArtifactSha256))) return fail('ATTACHMENT_HASH_NOT_APPROVED', 'Attachment outside allowlist.')
  }
  const assemblies: ProductionAssemblyRecord[] = []
  for (const family of families) {
    const template = templateByFamily.get(family.skeletonFamilyId)!, approval = assemblyByFamily.get(family.skeletonFamilyId)
    if (approval === undefined || approval.assemblyTemplateId !== template.template.assemblyTemplateId || approval.assemblyTemplateSha256 !== template.hash || approval.neutralMasterSha256 !== family.neutralMaster.sha256 || approval.materialMapSha256 !== family.materialMap.sha256 || approval.fixedOccluderMasksSha256 !== await browserCanonicalJsonSha256(family.fixedOccluderMasks) || approval.compositionGraphSha256 !== manifest.compositionGraph.sha256) return fail('ASSEMBLY_TEMPLATE_HASH_MISMATCH', 'Assembly approval binding invalid.')
    assemblies.push({ skeletonFamilyId: family.skeletonFamilyId, neutralMasterSha256: family.neutralMaster.sha256, approvalState: 'approved' })
  }
  const catalog: ResolvedV09Catalog = { releaseManifestSha256: pointer.releaseManifestSha256, releaseManifest: structuredClone(manifest), speciesRig: structuredClone(manifest.speciesRig), skeletonPool, skeletonFamilies: families, assemblyTemplates: templates, sealedTraits, compositionGraph }
  return { manifestHash: pointer.releaseManifestSha256, catalog, traits: [...traitRecords.values()], assemblies }
}

export function bundledV09ResourceUrl(sha256: string): Promise<string> {
  if (!HASH.test(sha256)) return Promise.reject(new ProductionReleaseError('RESOURCE_HASH_MISMATCH', 'Invalid resource digest.'))
  return Promise.resolve(`${import.meta.env.BASE_URL}v09-resources/${sha256}`)
}
export async function bundledV09ResourceBytes(sha256: string): Promise<Uint8Array> {
  const response = await fetch(await bundledV09ResourceUrl(sha256)); if (!response.ok) return fail('RESOURCE_HASH_MISMATCH', `Resource request failed: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
