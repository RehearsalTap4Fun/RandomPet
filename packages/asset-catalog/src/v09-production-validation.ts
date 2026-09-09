import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  V09_COMPOSITION_NODE_IDS,
  V09_TRAIT_SLOT_IDS,
  V09_VERSION_TUPLE,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
  type ContentResourceRef,
  type Diagnostic,
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
  overlayPolicySha256: string
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

export interface AssembleV09ReleaseOptions { root: string; candidate: unknown }

type Pure = null | string | boolean | number | Uint8Array | Pure[] | { [key: string]: Pure }

function diagnostic(code: string, path: string[], message: string): Diagnostic {
  return { severity: 'error', code, path, message }
}

function stable(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => a.path.join('\u0000').localeCompare(b.path.join('\u0000')) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message))
}

function snapshot(value: unknown, path: string[] = [], ancestors = new WeakSet<object>()): Pure {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate numbers must be finite.')
    return value
  }
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (typeof value !== 'object') throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must contain only plain data and byte arrays.')
  if (ancestors.has(value)) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must not contain cycles.')
  ancestors.add(value)
  try {
    if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate must not contain symbol keys.')
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARRAY) throw diagnostic('RELEASE_CANDIDATE_INVALID', path, 'Candidate array is not an ordinary bounded array.')
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
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || ['__proto__', 'prototype', 'constructor'].includes(key.toLowerCase())) throw diagnostic('RELEASE_CANDIDATE_INVALID', [...path, key], 'Candidate objects must not contain accessors or dangerous keys.')
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

function record(value: Pure, diagnostics: Diagnostic[], path: string[], keys?: readonly string[]): Record<string, Pure> | undefined {
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
  if (typeof entry.resourceId !== 'string' || typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256) || entry.resourceId !== `sha256:${entry.sha256}`) return undefined
  if (entry.mediaType === 'image/png' && entry.width === 2048 && entry.height === 2048) return entry as unknown as ContentResourceRef
  if ((entry.mediaType === 'application/qmonster-material-v1+json' || entry.mediaType === 'application/qmonster-manifest-v1+json')) return entry as unknown as ContentResourceRef
  return undefined
}

function refsFrom(value: unknown, found = new Map<string, ContentResourceRef>()): void {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return
  if (Array.isArray(value)) { value.forEach(item => refsFrom(item, found)); return }
  const candidate = ref(value)
  if (candidate !== undefined) { found.set(candidate.resourceId, candidate); return }
  Object.values(value as Record<string, unknown>).forEach(item => refsFrom(item, found))
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
  return { releaseManifest: input.releaseManifest, speciesRig: input.speciesRig, skeletonPool: input.skeletonPool, skeletonFamilies, assemblyTemplates, assemblyApprovals: assemblyApprovals as unknown as AssemblyApprovalV1[], traitApprovals: traitApprovals as unknown as TraitVisualApprovalV1[], attachmentAllowlist: input.attachmentAllowlist as unknown as ApprovedAttachmentAllowlistV1, traitInventory: input.traitInventory as unknown as TraitInventoryV1, sealedTraits, compositionGraph: input.compositionGraph, resources }
}

function addOnce(seen: Set<string>, key: string, diagnostics: Diagnostic[], code: string, path: string[], label: string): void {
  if (seen.has(key)) diagnostics.push(diagnostic(code, path, `Duplicate ${label}: ${key}.`)); else seen.add(key)
}

function approvalHash(value: unknown): string | undefined { try { return canonicalJsonSha256(value) } catch { return undefined } }

/** Validate an untrusted release candidate without mutating it or performing filesystem writes. */
export async function validateV09Release(input: unknown): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  let raw: Pure
  try { raw = snapshot(input) } catch (error) { return [error as Diagnostic] }
  forbidden(raw, diagnostics)
  const candidate = candidateShape(raw, diagnostics)
  if (candidate === undefined) return stable(diagnostics)

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
  refsFrom(candidate.releaseManifest, requiredRefs); refsFrom(candidate.speciesRig, requiredRefs); refsFrom(candidate.skeletonPool, requiredRefs)
  refsFrom(candidate.skeletonFamilies, requiredRefs); refsFrom(candidate.assemblyTemplates, requiredRefs); refsFrom(candidate.assemblyApprovals, requiredRefs)
  refsFrom(candidate.traitApprovals, requiredRefs); refsFrom(candidate.attachmentAllowlist, requiredRefs); refsFrom(candidate.traitInventory, requiredRefs)
  refsFrom(candidate.sealedTraits, requiredRefs); refsFrom(candidate.compositionGraph, requiredRefs)
  const allowlistDigest = canonicalOrEmpty(candidate.attachmentAllowlist)
  if (allowlistDigest !== '') requiredRefs.set(`sha256:${allowlistDigest}`, { resourceId: `sha256:${allowlistDigest}`, sha256: allowlistDigest, mediaType: 'application/qmonster-manifest-v1+json' } as unknown as ContentResourceRef)
  for (const [resourceId, declared] of requiredRefs) {
    const supplied = resourceById.get(resourceId)
    if (supplied === undefined || !equalJson(supplied.ref, declared) || !await verifyResource(supplied.ref, supplied.bytes)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['resources', resourceId], 'Referenced resource is absent, not exact, or does not match its canonical/decoded identity.'))
  }
  if (manifest !== undefined) {
    const documentBindings: Array<[ContentResourceRef, unknown, string]> = [
      [manifest.speciesRig, candidate.speciesRig, 'speciesRig'], [manifest.skeletonPool, candidate.skeletonPool, 'skeletonPool'],
      [manifest.traitInventory, candidate.traitInventory, 'traitInventory'], [manifest.compositionGraph, candidate.compositionGraph, 'compositionGraph'],
    ]
    manifest.skeletonFamilies.forEach((item, index) => documentBindings.push([item, candidate.skeletonFamilies[index], `skeletonFamilies.${index}`]))
    manifest.assemblyTemplates.forEach((item, index) => documentBindings.push([item, candidate.assemblyTemplates[index], `assemblyTemplates.${index}`]))
    manifest.approvals.forEach((item, index) => documentBindings.push([item, candidate.assemblyApprovals[index], `assemblyApprovals.${index}`]))
    manifest.traitApprovals.forEach((item, index) => documentBindings.push([item, candidate.traitApprovals[index], `traitApprovals.${index}`]))
    manifest.sealedTraits.forEach((item, index) => documentBindings.push([item, candidate.sealedTraits[index], `sealedTraits.${index}`]))
    for (const [item, payload, label] of documentBindings) if (payload === undefined || item.sha256 !== canonicalOrEmpty(payload)) diagnostics.push(diagnostic('RESOURCE_HASH_MISMATCH', ['releaseManifest', label], 'Manifest reference does not bind the exact candidate document.'))
  }

  validatePoolAndFamilies(candidate, diagnostics)
  validateGraph(candidate.compositionGraph, diagnostics)
  const inventory = validateInventory(candidate.traitInventory, diagnostics)
  const projections = await validateTraits(candidate, inventory, diagnostics)
  validateApprovals(candidate, projections, diagnostics)
  return stable(diagnostics)
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
    if (rawArtifact.kind === 'attachment' && !ATTACHMENT_CLASSES.has(String(rawArtifact.shapeClass))) diagnostics.push(diagnostic('SHAPE_CLASS_NOT_ALLOWED', ['sealedTraits', String(index), 'shapeClass'], 'Attachment class is outside the closed global enum.'))
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

function validateArtifactRoles(artifact: SealedTraitArtifactV1, family: Record<string, unknown> | undefined, template: Record<string, unknown> | undefined, candidate: V09ReleaseCandidate, diagnostics: Diagnostic[], index: number): void {
  const resources = artifact.runtimeResources as Record<string, ContentResourceRef>
  const roles = Object.keys(resources).sort(); const required = artifact.kind === 'surface' ? ['materialOperation'] : artifact.kind === 'eyePair' ? ['content', 'underlay'] : artifact.kind === 'mouth' ? ['mouthBack', 'mouthFront'] : artifact.kind === 'oralDetail' ? ['oralProjection'] : artifact.kind === 'attachment' ? (resources.attachmentFront === undefined ? ['attachmentBehind'] : ['attachmentBehind', 'attachmentFront']) : ['effectLayer']
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
    else if (artifact.oralSocketClass === 'closed' && !(oral.socketRegistry as Record<string, unknown> | undefined)?.['oral-none']) diagnostics.push(diagnostic('ORAL_SOCKET_INCOMPATIBLE', ['sealedTraits', String(index)], 'Closed mouth must use the oral-none sentinel socket.'))
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

function validateApprovals(candidate: V09ReleaseCandidate, projections: Map<string, { artifact: SealedTraitArtifactV1; hash: string }>, diagnostics: Diagnostic[]): void {
  const allowlist = candidate.attachmentAllowlist as unknown as Record<string, unknown>
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries as Record<string, unknown>[] : []
  const allowlistHash = canonicalOrEmpty(candidate.attachmentAllowlist)
  if (allowlist?.schemaVersion !== 'qmonster-approved-attachment-allowlist-v1') diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['attachmentAllowlist'], 'Attachment allowlist is malformed.'))
  const traits = new Map<string, TraitVisualApprovalV1>()
  for (const approval of candidate.traitApprovals) if (approval.status === 'approved') traits.set(`${approval.skeletonFamilyId}\u0000${approval.sealedArtifactSha256}`, approval)
  const assemblies = new Map<string, AssemblyApprovalV1>()
  for (const approval of candidate.assemblyApprovals) if (approval.status === 'approved') assemblies.set(approval.skeletonFamilyId, approval)
  for (const [index, family] of candidate.skeletonFamilies.entries()) {
    const value = family as Record<string, unknown>; const id = String(value.skeletonFamilyId); const template = candidate.assemblyTemplates.find(item => (item as Record<string, unknown>).skeletonFamilyId === id) as Record<string, unknown> | undefined; const approval = assemblies.get(id)
    const masksHash = canonicalOrEmpty(value.fixedOccluderMasks)
    if (approval === undefined) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_UNAPPROVED', ['assemblyApprovals', String(index)], 'Family has no non-revoked assembly approval.'))
    else if (template === undefined || approval.assemblyTemplateId !== template.assemblyTemplateId || approval.assemblyTemplateSha256 !== canonicalOrEmpty(template) || approval.neutralMasterSha256 !== (value.neutralMaster as Record<string, unknown> | undefined)?.sha256 || approval.materialMapSha256 !== (value.materialMap as Record<string, unknown> | undefined)?.sha256 || approval.fixedOccluderMasksSha256 !== masksHash || approval.attachmentAllowlistSha256 !== allowlistHash || approval.compositionGraphSha256 !== canonicalOrEmpty(candidate.compositionGraph) || !HASH.test(approval.overlayPolicySha256)) diagnostics.push(diagnostic('ASSEMBLY_TEMPLATE_HASH_MISMATCH', ['assemblyApprovals', String(index)], 'Assembly approval does not bind the exact template/family/allowlist/graph identities.'))
  }
  for (const item of projections.values()) {
    const artifact = item.artifact; const approval = traits.get(`${artifact.skeletonFamilyId}\u0000${item.hash}`)
    if (approval === undefined || approval.assemblyTemplateSha256 !== artifact.assemblyTemplateSha256 || approval.fullContextPreviewSha256 !== artifact.fullContextPreview.sha256) diagnostics.push(diagnostic('TRAIT_APPROVAL_MISSING', ['sealedTraits', artifact.slotId, artifact.traitId], 'Trait lacks an exact non-revoked visual approval.'))
    if (artifact.kind === 'attachment') {
      const found = entries.some(entry => entry.skeletonFamilyId === artifact.skeletonFamilyId && entry.interfaceId === artifact.interfaceId && entry.shapeClass === artifact.shapeClass && entry.sealedArtifactSha256 === item.hash && entry.traitVisualApprovalSha256 === approvalHash(approval))
      if (!found) diagnostics.push(diagnostic('ATTACHMENT_HASH_NOT_APPROVED', ['sealedTraits', artifact.slotId, artifact.traitId], 'Attachment tuple is not exactly in the approved allowlist.'))
    }
  }
}

async function directDirectory(path: string): Promise<string> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw Object.assign(new Error('Unsafe release root.'), { code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
  return realpath(path)
}

async function ensureDirectory(root: string, segments: string[]): Promise<string> {
  let current = root
  for (const segment of segments) {
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) throw Object.assign(new Error('Unsafe release path.'), { code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
    current = join(current, segment)
    try { await directDirectory(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(current)
      await directDirectory(current)
    }
  }
  if (isAbsolute(relative(root, current)) || relative(root, current).startsWith('..')) throw Object.assign(new Error('Write escaped release root.'), { code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
  return current
}

async function immutableWrite(path: string, refValue: ContentResourceRef, bytes: Uint8Array): Promise<void> {
  const expected = refValue.mediaType === 'image/png' ? Buffer.from(bytes) : Buffer.concat([canonicalJsonBytes(JSON.parse(Buffer.from(bytes).toString('utf8'))), Buffer.from('\n')])
  try {
    const current = await readFile(path)
    if (!await verifyResource(refValue, current)) throw Object.assign(new Error('Conflicting immutable content.'), { code: 'IMMUTABLE_CONTENT_CONFLICT' })
    return
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await writeFile(path, expected, { flag: 'wx' })
}

async function atomicJson(directory: string, name: string, value: unknown): Promise<string> {
  const destination = join(directory, name); const temp = join(directory, `.${name}.${randomUUID()}.tmp`)
  const bytes = Buffer.concat([canonicalJsonBytes(value), Buffer.from('\n')])
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, destination); return destination } catch (error) { await rm(temp, { force: true }); throw error }
}

/** Assemble a fully validated immutable v0.9 candidate, never activating it. */
export async function assembleV09Release(options: AssembleV09ReleaseOptions): Promise<{ releaseManifestSha256: string; candidatePointerPath: string; auditPath: string }> {
  const diagnostics = await validateV09Release(options?.candidate)
  if (diagnostics.length > 0) throw Object.assign(new Error('V0.9 release candidate is invalid.'), { code: 'V09_RELEASE_INVALID', diagnostics })
  if (typeof options.root !== 'string' || options.root.length === 0) throw Object.assign(new Error('Release root is required.'), { code: 'RESOURCE_OUTSIDE_CATALOG_ROOT' })
  const assemblyDiagnostics: Diagnostic[] = []
  const candidate = candidateShape(snapshot(options.candidate), assemblyDiagnostics)
  if (candidate === undefined || assemblyDiagnostics.length > 0) throw Object.assign(new Error('Candidate changed while being assembled.'), { code: 'V09_RELEASE_INVALID' })
  const target = resolve(options.root)
  try { await directDirectory(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await mkdir(target, { recursive: true }); await directDirectory(target) }
  const root = await directDirectory(target)
  const resourceDirectory = await ensureDirectory(root, ['resources', 'by-sha256']); const releaseDirectory = await ensureDirectory(root, ['releases', 'by-sha256']); const candidateDirectory = await ensureDirectory(root, ['releases']); const auditDirectory = await ensureDirectory(root, ['audit', 'v0.9.0'])
  for (const resource of candidate.resources) await immutableWrite(join(resourceDirectory, resource.ref.sha256), resource.ref, resource.bytes)
  const manifestHash = canonicalJsonSha256(candidate.releaseManifest); const manifestPath = join(releaseDirectory, `${manifestHash}.json`)
  const manifestRef = { resourceId: `sha256:${manifestHash}`, sha256: manifestHash, mediaType: 'application/qmonster-manifest-v1+json' as const } as unknown as ContentResourceRef
  await immutableWrite(manifestPath, manifestRef, canonicalJsonBytes(candidate.releaseManifest))
  const candidatePointerPath = await atomicJson(candidateDirectory, 'candidate-v0.9.0.json', { schemaVersion: 'qmonster-active-release-v1', releaseManifestSha256: manifestHash })
  const auditPath = await atomicJson(auditDirectory, `release-${manifestHash}.json`, { schemaVersion: 'qmonster-v09-release-audit-v1', versionTuple: V09_VERSION_TUPLE, releaseManifestSha256: manifestHash, inventoryCounts: RARITY_COUNTS, skeletons: candidate.skeletonFamilies.map(value => ({ skeletonFamilyId: (value as Record<string, unknown>).skeletonFamilyId, assemblyTemplateId: (value as Record<string, unknown>).assemblyTemplateId })), assemblyApprovals: candidate.assemblyApprovals.map(approval => ({ skeletonFamilyId: approval.skeletonFamilyId, assemblyApprovalSha256: canonicalOrEmpty(approval) })), result: 'valid' })
  return { releaseManifestSha256: manifestHash, candidatePointerPath, auditPath }
}

/** Strictly validate a non-active candidate pointer and its immutable manifest identity. */
export async function validateV09CandidatePointer(options: { root: string; releasePointer: string }): Promise<Diagnostic[]> {
  try {
    const root = await directDirectory(resolve(options.root)); const pointer = resolve(options.releasePointer)
    if (relative(root, pointer).startsWith('..') || isAbsolute(relative(root, pointer)) || pointer.endsWith('active-release.json')) return [diagnostic('RESOURCE_OUTSIDE_CATALOG_ROOT', ['releasePointer'], 'Candidate pointer must be below root and must not be active-release.json.')]
    const value = JSON.parse((await readFile(pointer)).toString('utf8')) as Record<string, unknown>
    if (!equalJson(Object.keys(value).sort(), ['releaseManifestSha256', 'schemaVersion']) || value.schemaVersion !== 'qmonster-active-release-v1' || !HASH.test(value.releaseManifestSha256 as string)) return [diagnostic('RELEASE_MANIFEST_SCHEMA_INVALID', ['releasePointer'], 'Candidate pointer has invalid strict shape.')]
    const manifestPath = join(root, 'releases', 'by-sha256', `${value.releaseManifestSha256}.json`); const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as unknown
    if (canonicalJsonSha256(manifest) !== value.releaseManifestSha256) return [diagnostic('RELEASE_MANIFEST_HASH_MISMATCH', ['releasePointer'], 'Candidate pointer manifest identity does not match its content.')]
    return parseReleaseManifestV09(manifest).ok ? [] : [diagnostic('RELEASE_MANIFEST_SCHEMA_INVALID', ['releasePointer'], 'Candidate pointer manifest is invalid.')]
  } catch { return [diagnostic('RESOURCE_OUTSIDE_CATALOG_ROOT', ['releasePointer'], 'Candidate pointer cannot be read from the trusted root.')] }
}
