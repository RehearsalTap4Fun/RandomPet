import { parseContentResourceId, parseSealedTraitArtifactV1, type AssemblyTemplateV1, type AttachmentShapeClass, type ContentResourceRef, type PngResourceRef, type SealedTraitArtifactV1, type SkeletonFamilyV1 } from '@qmonster/generator-core'
import { canonicalJsonSha256, decodedPngSha256, V09CatalogError } from './v09-content-identity.js'
import { decodeBinaryFullMasterMask, decodeFullMasterPng, enforceAuthoringZone, type PngBytes } from './v09-authoring-workbench.js'

type TraitKind = 'surface' | 'eyePair' | 'mouth' | 'oralDetail' | 'attachment' | 'targetedEffect' | 'ambientEffect'
type ResourceRole = Record<string, ContentResourceRef | Record<string, PngResourceRef>>

export interface TraitBundleV1 {
  traitId: string
  rarity: 'common' | 'rare' | 'legendary'
  kind: TraitKind
  slotId: string
  skeletonFamilyId: string
  assemblyTemplateId: string
  assemblyTemplateSha256: string
  neutralMasterSha256: string
  resources: ResourceRole
  fullContextPreview: PngResourceRef
  sealerVersion: string
  interfaceId?: string
  shapeClass?: AttachmentShapeClass
  oralSocketClass?: string
  oralSocketClasses?: string[]
  targetId?: string
  zoneId?: 'background' | 'foreground'
}

export interface SealContext {
  family: SkeletonFamilyV1
  template: AssemblyTemplateV1
  assemblyTemplateSha256: string
  resources: ReadonlyMap<string, PngBytes> | Readonly<Record<string, PngBytes>>
}

export interface TraitVisualApprovalInput {
  skeletonFamilyId: string
  assemblyTemplateSha256: string
  sealedArtifactSha256: string
  fullContextPreview: PngBytes | PngResourceRef
  fullContextPreviewBytes?: PngBytes
  approvedBy: string
  approvedAt: string
  approvalRevision: number
  status: 'approved' | 'revoked'
}

export interface TraitVisualApprovalV1 {
  schemaVersion: 'qmonster-trait-visual-approval-v1'
  skeletonFamilyId: string
  assemblyTemplateSha256: string
  sealedArtifactSha256: string
  fullContextPreviewSha256: string
  approvedBy: string
  approvedAt: string
  approvalRevision: number
  status: 'approved' | 'revoked'
}

const HASH = /^[a-f0-9]{64}$/
const SIZE = 2048
const ATTACHMENT_CLASSES = new Set<AttachmentShapeClass>(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar'])
const PLACEMENT_KEYS = new Set(['anchor', 'anchorx', 'anchory', 'x', 'y', 'offset', 'position', 'transform', 'translate', 'scale', 'rotation', 'crop', 'zindex', 'layerorder', 'occludermask', 'occludermasks'])
const PATH_KEYS = new Set(['assetpath', 'path', 'url'])
const DANGEROUS_STRUCTURE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const EXPECTED_ROLES: Record<TraitKind, readonly string[]> = {
  surface: ['materialOperation'], eyePair: ['underlay', 'content'], mouth: ['mouthBack', 'mouthFront'], oralDetail: ['oralProjections'],
  attachment: ['attachmentBehind', 'attachmentFront'], targetedEffect: ['effectLayer'], ambientEffect: ['effectLayer'],
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new V09CatalogError(code, message, cause === undefined ? undefined : { cause })
}

function nonBlank(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code, 'Expected a non-blank identity field.')
  return value
}

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code, 'Expected a lowercase SHA-256 digest.')
  return value
}

function snapshotPureData(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('TRAIT_SCHEMA_INVALID', 'Trait drafts only allow finite primitive data.')
    return value
  }
  if (typeof value !== 'object') fail('TRAIT_SCHEMA_INVALID', 'Trait drafts only allow plain data structures.')
  if (ancestors.has(value)) fail('TRAIT_SCHEMA_INVALID', 'Trait drafts cannot contain cycles.')
  ancestors.add(value)
  try {
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol')) fail('TRAIT_SCHEMA_INVALID', 'Trait drafts cannot contain symbol keys.')
    const stringKeys = keys as string[]
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail('TRAIT_SCHEMA_INVALID', 'Trait draft arrays must have the ordinary Array prototype.')
      const result: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail('TRAIT_SCHEMA_INVALID', 'Trait draft arrays cannot be sparse or contain accessors.')
        result.push(snapshotPureData(descriptor.value, ancestors))
      }
      if (stringKeys.some(key => key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
        fail('TRAIT_SCHEMA_INVALID', 'Trait draft arrays cannot contain non-index properties.')
      }
      return Object.freeze(result)
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) fail('TRAIT_SCHEMA_INVALID', 'Trait drafts must use ordinary plain-object prototypes.')
    const result: Record<string, unknown> = {}
    for (const key of stringKeys) {
      if (DANGEROUS_STRUCTURE_KEYS.has(key.toLowerCase())) fail('TRAIT_SCHEMA_INVALID', `Trait drafts cannot contain dangerous structure key: ${key}.`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail('TRAIT_SCHEMA_INVALID', 'Trait drafts cannot contain accessors.')
      result[key] = snapshotPureData(descriptor.value, ancestors)
    }
    return Object.freeze(result)
  } finally {
    ancestors.delete(value)
  }
}

function rejectForbidden(value: unknown, ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object') return
  if (ancestors.has(value)) fail('NON_IDENTITY_TRANSFORM', 'Draft cannot contain cycles.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const member of value) rejectForbidden(member, ancestors)
      return
    }
    for (const [key, member] of Object.entries(value)) {
      const normalized = key.toLowerCase()
      if (PLACEMENT_KEYS.has(normalized)) fail('NON_IDENTITY_TRANSFORM', `Forbidden author placement key: ${key}.`)
      if (PATH_KEYS.has(normalized)) fail('RESOURCE_HASH_MISMATCH', `Filesystem paths and URLs are forbidden: ${key}.`)
      rejectForbidden(member, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

function parseStrictJsonObject(bytes: Buffer): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail('RESOURCE_SCHEMA_INVALID', 'JSON resource bytes are invalid.', error)
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object' || Object.getPrototypeOf(parsed) !== Object.prototype) {
    fail('RESOURCE_SCHEMA_INVALID', 'JSON resources must contain an ordinary object payload.')
  }
  return parsed as Record<string, unknown>
}

function contentBytes(context: SealContext, resourceId: string): Buffer {
  const mapped = context.resources as ReadonlyMap<string, PngBytes>
  const bytes = typeof mapped.get === 'function'
    ? mapped.get(resourceId)
    : (context.resources as Readonly<Record<string, PngBytes>>)[resourceId]
  if (bytes === undefined) fail('RESOURCE_HASH_MISMATCH', 'A declared resource is absent from the context-owned content map.')
  return Buffer.from(bytes)
}

function assertRef(ref: unknown): ContentResourceRef {
  if (ref === null || typeof ref !== 'object') fail('RESOURCE_HASH_MISMATCH', 'Expected a content-addressed resource reference.')
  const candidate = ref as Record<string, unknown>
  const resourceId = parseContentResourceId(candidate.resourceId)
  const digest = hash(candidate.sha256, 'RESOURCE_HASH_MISMATCH')
  if (resourceId === undefined || resourceId.slice('sha256:'.length) !== digest) {
    fail('RESOURCE_HASH_MISMATCH', 'Resource ID and declared digest must agree.')
  }
  if (candidate.mediaType === 'image/png') {
    if (candidate.width !== 2048 || candidate.height !== 2048) fail('RESOURCE_HASH_MISMATCH', 'PNG references must be full-master dimensions.')
    return candidate as unknown as PngResourceRef
  }
  if (candidate.mediaType === 'application/qmonster-material-v1+json' || candidate.mediaType === 'application/qmonster-manifest-v1+json') {
    return candidate as unknown as ContentResourceRef
  }
  fail('RESOURCE_HASH_MISMATCH', 'Resource media type is not sealed-content compatible.')
}

async function verifyRef(refInput: unknown, context: SealContext): Promise<ContentResourceRef> {
  const ref = assertRef(refInput)
  const bytes = contentBytes(context, ref.resourceId)
  let actual: string
  if (ref.mediaType === 'image/png') {
    actual = await decodedPngSha256(bytes)
  } else {
    actual = canonicalJsonSha256(parseStrictJsonObject(bytes))
  }
  if (actual !== ref.sha256) fail('RESOURCE_HASH_MISMATCH', 'Content bytes do not match their declared content identity.')
  return ref
}

function exactRoles(kind: TraitKind, roles: unknown, required = EXPECTED_ROLES[kind]): Record<string, unknown> {
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) fail('RESOURCE_HASH_MISMATCH', 'Trait resources must be a named role object.')
  const actual = Object.keys(roles as Record<string, unknown>).sort()
  if (actual.length !== required.length || actual.some((role, index) => role !== [...required].sort()[index])) {
    fail('RESOURCE_HASH_MISMATCH', `Trait kind ${kind} has missing or extra runtime resource roles.`)
  }
  return roles as Record<string, unknown>
}

async function checkedPng(ref: unknown, context: SealContext): Promise<{ ref: PngResourceRef; bytes: Buffer }> {
  const checked = await verifyRef(ref, context)
  if (checked.mediaType !== 'image/png') fail('RESOURCE_HASH_MISMATCH', 'This trait role requires a PNG full-master resource.')
  return { ref: checked, bytes: contentBytes(context, checked.resourceId) }
}

function attachmentTemplate(template: AssemblyTemplateV1, slotId: string, interfaceId: string) {
  const found = template.slots.attachment.find(slot => slot.slotId === slotId && slot.attachmentInterface.interfaceId === interfaceId)
  if (found === undefined) fail('ATTACHMENT_INTERFACE_INVALID', 'Attachment slot does not own the requested immutable interface.')
  return found.attachmentInterface
}

function componentsConnectToRoot(pixels: Uint8Array, root: Uint8Array): boolean {
  const rootPixels: number[] = []
  for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) if (root[pixel * 4 + 3] === 255) rootPixels.push(pixel)
  if (rootPixels.length === 0) return false
  const visited = new Uint8Array(SIZE * SIZE)
  const queue = new Int32Array(SIZE * SIZE)
  let read = 0
  let written = 0
  for (const rootPixel of rootPixels) {
    if (pixels[rootPixel * 4 + 3] === 0) return false
    visited[rootPixel] = 1
    queue[written++] = rootPixel
  }
  while (read < written) {
    const current = queue[read++]!
    const x = current % SIZE
    const y = Math.floor(current / SIZE)
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nextX = x + dx
      const nextY = y + dy
      if (nextX < 0 || nextX >= SIZE || nextY < 0 || nextY >= SIZE) continue
      const next = nextY * SIZE + nextX
      if (visited[next] !== 0 || pixels[next * 4 + 3] === 0) continue
      visited[next] = 1
      queue[written++] = next
    }
  }
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) if (pixels[pixel * 4 + 3] !== 0 && visited[pixel] === 0) return false
  return true
}

async function validateAttachment(layer: { bytes: Buffer }, rootRef: PngResourceRef, allowedZone: PngResourceRef, context: SealContext): Promise<void> {
  const root = await checkedPng(rootRef, context)
  const zone = await checkedPng(allowedZone, context)
  await enforceAuthoringZone({ mode: 'exported-layer', candidate: layer.bytes, authoringZone: zone.bytes })
  const decodedLayer = await decodeFullMasterPng(layer.bytes, 'ATTACHMENT_INTERFACE_INVALID')
  const decodedRoot = await decodeBinaryFullMasterMask(root.bytes, 'ROOT_STENCIL_INVALID')
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    if (decodedRoot.pixels[pixel * 4 + 3] !== 255) continue
    const offset = pixel * 4
    for (let channel = 0; channel < 4; channel += 1) if (decodedLayer.pixels[offset + channel] !== decodedRoot.pixels[offset + channel]) {
      fail('ATTACHMENT_INTERFACE_INVALID', 'A required immutable root pixel was deleted, recolored, or regenerated.')
    }
  }
  if (!componentsConnectToRoot(decodedLayer.pixels, decodedRoot.pixels)) fail('ATTACHMENT_INTERFACE_INVALID', 'Visible attachment alpha must be 8-neighbour connected to its fixed root.')
}

function oralProjectionRoles(roles: Record<string, unknown>, template: AssemblyTemplateV1, draft: TraitBundleV1): Record<string, PngResourceRef> {
  const projections = roles.oralProjections
  const classes = draft.oralSocketClasses
  const slot = template.slots.embedded.find(item => item.kind === 'oralDetail' && item.slotId === draft.slotId)
  if (slot?.kind !== 'oralDetail' || !Array.isArray(classes) || classes.length === 0 || new Set(classes).size !== classes.length
    || classes.some(key => typeof key !== 'string' || key.trim() === '' || key === 'closed' || key === 'oral-none' || !Object.hasOwn(slot.socketRegistry, key) || slot.socketRegistry[key]!.parentMouthTraitIds.length === 0)
    || projections === null || typeof projections !== 'object' || Array.isArray(projections)
    || Object.keys(projections).length !== classes.length || classes.some(key => !Object.hasOwn(projections, key)) || draft.oralSocketClass !== undefined) {
    fail('ORAL_SOCKET_INCOMPATIBLE', 'Oral resources must exactly cover the declared nonempty set of registered open socket classes.')
  }
  return projections as Record<string, PngResourceRef>
}

async function validateLayerRoles(kind: TraitKind, roles: Record<string, unknown>, template: AssemblyTemplateV1, draft: TraitBundleV1, context: SealContext): Promise<void> {
  if (kind === 'surface') {
    const slot = template.slots.surface.find(item => item.slotId === draft.slotId)
    if (slot === undefined) fail('AUTHORING_ZONE_VIOLATION', 'Surface slot is not owned by the selected assembly template.')
    const ref = await verifyRef(roles.materialOperation, context)
    if (ref.mediaType !== 'application/qmonster-material-v1+json') fail('RESOURCE_HASH_MISMATCH', 'Surface material operation must be JSON.')
    const json = parseStrictJsonObject(contentBytes(context, ref.resourceId))
    if (json.ownerMaterialId === undefined) fail('RESOURCE_SCHEMA_INVALID', 'Surface material operation requires an ownerMaterialId.')
    if (json.ownerMaterialId !== slot.ownerMaterialId) fail('AUTHORING_ZONE_VIOLATION', 'Surface operation does not bind the template owner material slot.')
    return
  }
  if (kind === 'attachment') {
    const interfaceId = nonBlank(draft.interfaceId, 'ATTACHMENT_INTERFACE_INVALID')
    if (!ATTACHMENT_CLASSES.has(draft.shapeClass as AttachmentShapeClass)) fail('SHAPE_CLASS_NOT_ALLOWED', 'Attachment shape class is not in the closed allowlist.')
    const attachment = attachmentTemplate(template, draft.slotId, interfaceId)
    if (!attachment.allowedShapeClasses.includes(draft.shapeClass as AttachmentShapeClass)) fail('SHAPE_CLASS_NOT_ALLOWED', 'Attachment shape class is not allowed by this interface.')
    const behind = await checkedPng(roles.attachmentBehind, context)
    await validateAttachment(behind, attachment.rearRootStencil, attachment.allowedZone, context)
    if (attachment.frontRootStencil === undefined) {
      if (roles.attachmentFront !== undefined) fail('ATTACHMENT_INTERFACE_INVALID', 'This attachment interface does not own a front output.')
    } else {
      const front = await checkedPng(roles.attachmentFront, context)
      await validateAttachment(front, attachment.frontRootStencil, attachment.allowedZone, context)
    }
    return
  }

  if (kind === 'oralDetail') {
    const projections = oralProjectionRoles(roles, template, draft)
    const slot = template.slots.embedded.find(item => item.kind === 'oralDetail' && item.slotId === draft.slotId)!
    if (slot.kind !== 'oralDetail') fail('ORAL_SOCKET_INCOMPATIBLE', 'Expected oral socket registry.')
    for (const key of Object.keys(projections).sort()) {
      const layer = await checkedPng(projections[key], context)
      const zone = await checkedPng(slot.socketRegistry[key]!.authoringZone, context)
      await enforceAuthoringZone({ mode: 'exported-layer', candidate: layer.bytes, authoringZone: zone.bytes })
    }
    return
  }
  const role = kind === 'eyePair' ? ['underlay', 'content'] : kind === 'mouth' ? ['mouthBack', 'mouthFront'] : ['effectLayer']
  const zones: PngResourceRef[] = []
  if (kind === 'eyePair') {
    const slot = template.slots.embedded.find(item => item.kind === 'eyePair' && item.slotId === draft.slotId)
    if (slot === undefined || slot.kind !== 'eyePair') fail('AUTHORING_ZONE_VIOLATION', 'Eye pair slot is not template compatible.')
    zones.push(slot.pairAuthoringZone)
  } else if (kind === 'mouth') {
    if (typeof draft.oralSocketClass !== 'string' || draft.oralSocketClass.trim() === '') fail('ATTACHMENT_INTERFACE_INVALID', 'Mouth traits require a declared oral socket class.')
    const slot = template.slots.embedded.find(item => item.kind === 'mouth' && item.slotId === draft.slotId)
    if (slot === undefined || slot.kind !== 'mouth') fail('AUTHORING_ZONE_VIOLATION', 'Mouth slot is not template compatible.')
    zones.push(slot.authoringZone)
  } else if (kind === 'targetedEffect') {
    const slot = template.slots.effect.find(item => item.kind === 'targetedEffect' && item.targetId === draft.targetId)
    if (slot === undefined || slot.kind !== 'targetedEffect') fail('AUTHORING_ZONE_VIOLATION', 'Targeted effect target is not template compatible.')
    zones.push(slot.authoringZone)
  } else {
    const slot = template.slots.effect.find(item => item.kind === 'ambientEffect' && item.zoneId === draft.zoneId)
    if (slot === undefined || slot.kind !== 'ambientEffect') fail('AUTHORING_ZONE_VIOLATION', 'Ambient effect zone is not template compatible.')
    zones.push(slot.authoringZone)
  }
  for (const name of role) {
    const layer = await checkedPng(roles[name], context)
    const zone = await checkedPng(zones[0], context)
    await enforceAuthoringZone({ mode: 'exported-layer', candidate: layer.bytes, authoringZone: zone.bytes })
  }
}

/** Seal a typed, content-addressed trait only after all full-master contracts are verified. */
export async function sealTraitBundle(draft: TraitBundleV1, context: SealContext): Promise<{ artifact: SealedTraitArtifactV1; artifactSha256: string }> {
  const snapshot = snapshotPureData(draft) as TraitBundleV1
  rejectForbidden(snapshot)
  const record = snapshot as unknown as Record<string, unknown>
  const kind = record.kind as TraitKind
  if (!Object.hasOwn(EXPECTED_ROLES, kind)) fail('RESOURCE_HASH_MISMATCH', 'Unknown trait kind.')
  if (kind === 'oralDetail' && snapshot.traitId === 'oral-none') fail('TRAIT_SCHEMA_INVALID', 'oral-none is a derived closed-mouth sentinel, not a sealable trait.')
  if (snapshot.skeletonFamilyId !== context.family.skeletonFamilyId || snapshot.assemblyTemplateId !== context.template.assemblyTemplateId
    || context.template.skeletonFamilyId !== context.family.skeletonFamilyId || snapshot.assemblyTemplateSha256 !== context.assemblyTemplateSha256) {
    fail('ASSEMBLY_TEMPLATE_HASH_MISMATCH', 'Draft does not bind the selected skeleton family and assembly template hash.')
  }
  if (snapshot.neutralMasterSha256 !== context.family.neutralMaster.sha256 || snapshot.neutralMasterSha256 !== context.template.neutralMasterSha256) {
    fail('RESOURCE_HASH_MISMATCH', 'Draft neutral master does not match the selected family/template.')
  }
  await verifyRef(context.family.neutralMaster, context)
  const selectedAttachment = kind === 'attachment'
    ? attachmentTemplate(context.template, snapshot.slotId, nonBlank(snapshot.interfaceId, 'ATTACHMENT_INTERFACE_INVALID'))
    : undefined
  const roleOrder = kind === 'attachment' && selectedAttachment?.frontRootStencil === undefined
    ? ['attachmentBehind']
    : EXPECTED_ROLES[kind]
  const roles = exactRoles(kind, snapshot.resources, roleOrder)
  const oralProjections = kind === 'oralDetail' ? oralProjectionRoles(roles, context.template, snapshot) : undefined
  for (const ref of Object.values(oralProjections ?? roles)) await verifyRef(ref, context)
  const preview = await checkedPng(snapshot.fullContextPreview, context)
  await decodeFullMasterPng(preview.bytes, 'RESOURCE_HASH_MISMATCH')
  await validateLayerRoles(kind, roles, context.template, snapshot, context)

  const authoringInputs = oralProjections === undefined ? roleOrder.map(role => roles[role]!) : Object.keys(oralProjections).sort().map(key => oralProjections[key]!)
  const attachmentRuntimeResources = kind === 'attachment'
    ? (selectedAttachment?.frontRootStencil === undefined
      ? { attachmentBehind: roles.attachmentBehind }
      : { attachmentBehind: roles.attachmentBehind, attachmentFront: roles.attachmentFront })
    : undefined

  const artifact = {
    schemaVersion: 'qmonster-sealed-trait-v1', traitId: snapshot.traitId, rarity: snapshot.rarity, kind, slotId: snapshot.slotId,
    skeletonFamilyId: snapshot.skeletonFamilyId, assemblyTemplateId: snapshot.assemblyTemplateId, assemblyTemplateSha256: snapshot.assemblyTemplateSha256,
    neutralMasterSha256: snapshot.neutralMasterSha256, authoringInputs, fullContextPreview: preview.ref, sealerVersion: snapshot.sealerVersion,
    ...(kind === 'surface' ? { runtimeResources: { materialOperation: roles.materialOperation } }
      : kind === 'eyePair' ? { runtimeResources: { underlay: roles.underlay, content: roles.content } }
        : kind === 'mouth' ? { oralSocketClass: snapshot.oralSocketClass, runtimeResources: { mouthBack: roles.mouthBack, mouthFront: roles.mouthFront } }
          : kind === 'oralDetail' ? { runtimeResources: { oralProjections } }
            : kind === 'attachment' ? { interfaceId: snapshot.interfaceId, shapeClass: snapshot.shapeClass, runtimeResources: attachmentRuntimeResources }
              : kind === 'targetedEffect' ? { targetId: snapshot.targetId, runtimeResources: { effectLayer: roles.effectLayer } }
                : { zoneId: snapshot.zoneId, runtimeResources: { effectLayer: roles.effectLayer } }),
  }
  const parsed = parseSealedTraitArtifactV1(artifact)
  if (!parsed.ok) fail('RESOURCE_HASH_MISMATCH', 'Sealed artifact failed the frozen v0.9 schema parser.')
  const sealed = parsed.value
  return { artifact: sealed, artifactSha256: canonicalJsonSha256(sealed) }
}

/** Create a deterministic, explicitly timestamped visual approval record. */
export async function createTraitVisualApproval(input: TraitVisualApprovalInput): Promise<{ approval: TraitVisualApprovalV1; approvalSha256: string }> {
  const previewBytes = Buffer.isBuffer(input.fullContextPreview) || input.fullContextPreview instanceof Uint8Array
    ? input.fullContextPreview
    : input.fullContextPreviewBytes
  if (previewBytes === undefined) fail('RESOURCE_HASH_MISMATCH', 'Visual approval needs preview PNG bytes for decoded identity hashing.')
  const previewHash = await decodedPngSha256(previewBytes)
  if (typeof input.fullContextPreview === 'object' && !Buffer.isBuffer(input.fullContextPreview) && !(input.fullContextPreview instanceof Uint8Array)) {
    const previewRef = assertRef(input.fullContextPreview)
    if (previewRef.mediaType !== 'image/png' || previewRef.sha256 !== previewHash) fail('RESOURCE_HASH_MISMATCH', 'Visual approval preview reference does not bind its decoded PNG digest.')
  }
  const approvedAt = nonBlank(input.approvedAt, 'RESOURCE_HASH_MISMATCH')
  if (!Number.isFinite(Date.parse(approvedAt)) || new Date(approvedAt).toISOString() !== approvedAt) fail('RESOURCE_HASH_MISMATCH', 'Approval timestamp must be an ISO-8601 instant.')
  if (!Number.isInteger(input.approvalRevision) || input.approvalRevision <= 0) fail('RESOURCE_HASH_MISMATCH', 'Approval revision must be a positive integer.')
  if (input.status !== 'approved' && input.status !== 'revoked') fail('RESOURCE_HASH_MISMATCH', 'Approval status is invalid.')
  const approval: TraitVisualApprovalV1 = {
    schemaVersion: 'qmonster-trait-visual-approval-v1', skeletonFamilyId: nonBlank(input.skeletonFamilyId, 'RESOURCE_HASH_MISMATCH'),
    assemblyTemplateSha256: hash(input.assemblyTemplateSha256, 'ASSEMBLY_TEMPLATE_HASH_MISMATCH'), sealedArtifactSha256: hash(input.sealedArtifactSha256, 'RESOURCE_HASH_MISMATCH'),
    fullContextPreviewSha256: previewHash, approvedBy: nonBlank(input.approvedBy, 'RESOURCE_HASH_MISMATCH'), approvedAt, approvalRevision: input.approvalRevision, status: input.status,
  }
  return { approval, approvalSha256: canonicalJsonSha256(approval) }
}
