import { lstat, open, realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  parseContentResourceId,
  type ContentResourceRef,
  type ContentResourceId,
  type ResolvedV09Catalog,
  type ReleaseManifestV09,
  type SkeletonPoolV1,
  type SkeletonFamilyV1,
  type AssemblyTemplateV1,
  type SealedTraitArtifactV1,
  type CompositionGraphV1,
} from '@qmonster/generator-core'
import { parseReleaseManifestV09, parseSealedTraitArtifactV1 } from '@qmonster/generator-core'
import { canonicalJsonSha256, decodedPngSha256, V09CatalogError } from './v09-content-identity.js'

const HASH = /^[a-f0-9]{64}$/
const STABLE_READ_FAILURE_CODE = 'RESOURCE_OUTSIDE_CATALOG_ROOT'
const MAX_STABLE_READ_ATTEMPTS = 3
const contentId = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const hash = z.string().regex(HASH)
const pngRef = z.strictObject({ resourceId: contentId, sha256: hash, mediaType: z.literal('image/png'), width: z.literal(2048), height: z.literal(2048) })
const jsonRef = z.strictObject({ resourceId: contentId, sha256: hash, mediaType: z.enum(['application/qmonster-material-v1+json', 'application/qmonster-manifest-v1+json']) })
const anyRef = z.discriminatedUnion('mediaType', [pngRef, jsonRef])
const canvas = z.strictObject({ width: z.literal(2048), height: z.literal(2048) })
const surfaceSlot = z.enum(['bodyColor', 'surfacePattern', 'surfaceTexture', 'forepawDetail', 'hindpawDetail', 'tailSurface'])
const attachmentSlot = z.enum(['headAppendage', 'extraAppendage'])
const attachmentShape = z.enum(['ear-horn-small', 'ear-ornament', 'mane-small', 'collar'])
const compositionNode = z.enum([
  'backgroundEffect', 'attachment.behind', 'skeleton.base', 'surface.bodyColor', 'surface.pattern', 'surface.texture',
  'surface.forepawDetail', 'surface.hindpawDetail', 'surface.tailSurface', 'targetedEffect.underlay', 'eyePair.underlay',
  'eyePair.content', 'eyePair.edgeOcclusionReplay', 'mouth.back', 'oralDetail', 'mouth.front', 'mouth.edgeOcclusionReplay',
  'attachment.front', 'skeleton.attachmentOcclusionReplay', 'targetedEffect.overlay', 'foregroundAmbientEffect',
])
const compositionGraphSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-composition-graph-v1'),
  orderedNodes: z.array(compositionNode).min(1),
  blendMode: z.literal('source-over-premultiplied-srgb'),
  transformPolicy: z.literal('identity-only'),
})
const skeletonPoolSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-skeleton-pool-v1'),
  skeletonPoolId: z.string().min(1),
  candidates: z.tuple([
    z.strictObject({ skeletonFamilyId: z.string().min(1), skeletonClass: z.literal('base'), weight: z.literal(8) }),
    z.strictObject({ skeletonFamilyId: z.string().min(1), skeletonClass: z.literal('legendary'), weight: z.literal(1) }),
  ]),
})
const skeletonFamilySchema = z.strictObject({
  schemaVersion: z.literal('qmonster-skeleton-family-v1'),
  skeletonFamilyId: z.string().min(1),
  skeletonClass: z.enum(['base', 'legendary']),
  structuralShapeClasses: z.array(z.enum(['feline-standard', 'cat-tail-long', 'cat-tail-curled', 'dog-tail-curled'])).min(1),
  archetypeId: z.string().min(1),
  poseId: z.string().min(1),
  speciesRigId: z.string().min(1),
  canvas,
  neutralMaster: pngRef,
  materialMap: pngRef,
  fixedOccluderMasks: z.record(z.string(), pngRef),
  assemblyTemplateId: z.string().min(1),
})
const surfaceTemplate = z.strictObject({ kind: z.literal('surface'), slotId: surfaceSlot, ownerMaterialId: z.string().min(1), authoringZone: pngRef })
const eyeTemplate = z.strictObject({ kind: z.literal('eyePair'), slotId: z.literal('eyes'), leftAuthoringZone: pngRef, rightAuthoringZone: pngRef, pairAuthoringZone: pngRef, occlusionReplayZone: pngRef })
const mouthTemplate = z.strictObject({ kind: z.literal('mouth'), slotId: z.literal('mouthShape'), authoringZone: pngRef, occlusionReplayZone: pngRef })
const oralDetailTemplate = z.strictObject({
  kind: z.literal('oralDetail'), slotId: z.literal('oralDetail'),
  socketRegistry: z.record(z.string(), z.strictObject({ authoringZone: pngRef, parentMouthTraitIds: z.array(z.string().min(1)) })),
  closedMouthSentinel: z.literal('oral-none'),
})
const attachmentTemplate = z.strictObject({
  kind: z.literal('attachment'), slotId: attachmentSlot,
  attachmentInterface: z.strictObject({ interfaceId: z.string().min(1), allowedShapeClasses: z.array(attachmentShape), allowedZone: pngRef, rearRootStencil: pngRef, frontRootStencil: pngRef.optional(), fixedOccluderMaskId: z.string().min(1) }),
})
const targetedEffectTemplate = z.strictObject({ kind: z.literal('targetedEffect'), slotId: z.literal('effect'), targetId: z.string().min(1), authoringZone: pngRef, compositionNode: z.enum(['targetedEffect.underlay', 'targetedEffect.overlay']) })
const ambientEffectTemplate = z.strictObject({ kind: z.literal('ambientEffect'), slotId: z.literal('effect'), zoneId: z.enum(['background', 'foreground']), authoringZone: pngRef, compositionNode: z.enum(['backgroundEffect', 'foregroundAmbientEffect']) })
const assemblyTemplateSchema = z.strictObject({
  schemaVersion: z.literal('qmonster-assembly-template-v1'),
  assemblyTemplateId: z.string().min(1),
  skeletonFamilyId: z.string().min(1),
  canvas,
  neutralMasterSha256: hash,
  slots: z.strictObject({
    surface: z.array(surfaceTemplate),
    embedded: z.array(z.discriminatedUnion('kind', [eyeTemplate, mouthTemplate, oralDetailTemplate])),
    attachment: z.array(attachmentTemplate),
    effect: z.array(z.discriminatedUnion('kind', [targetedEffectTemplate, ambientEffectTemplate])),
  }),
  compositionGraph: compositionGraphSchema,
})

type StableReadStage = 'afterPrecheck' | 'afterOpen'
let stableReadHook: ((stage: StableReadStage) => void | Promise<void>) | undefined

/** @internal Test-only deterministic seam; it is intentionally not exported from the package barrel. */
export function __setV09StableReadHookForTest(hook?: (stage: StableReadStage) => void | Promise<void>): void {
  stableReadHook = hook
}

async function runStableReadHook(stage: StableReadStage): Promise<void> {
  await stableReadHook?.(stage)
}

class RetryStableReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryStableReadError'
  }
}

function retryStableRead(message: string): never {
  throw new RetryStableReadError(message)
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new V09CatalogError(code, message, cause === undefined ? undefined : { cause })
}

async function directDirectory(path: string, code: string): Promise<string> {
  let entry: Awaited<ReturnType<typeof lstat>>
  try {
    entry = await lstat(path)
  } catch (error) {
    return fail(code, `Trusted directory is missing: ${path}`, error)
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail(code, `Trusted directory is not a direct directory: ${path}`)
  return realpath(path)
}

function contained(root: string, target: string): boolean {
  const pathRelative = relative(root, target)
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative))
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameStableFile(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink
}

async function stableRootIdentity(root: string, code: string): Promise<Stats> {
  let entry: Stats
  try {
    entry = await lstat(root)
  } catch (error) {
    return fail(code, 'Catalog root became unavailable.', error)
  }
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(root) !== root) {
    fail(code, 'Catalog root is no longer its original direct directory.')
  }
  return entry
}

async function directFile(root: string, segments: string[], code: string): Promise<string> {
  let current = root
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
      fail(code, 'Trusted layout contains an invalid path segment.')
    }
    current = join(current, segment)
    let entry: Awaited<ReturnType<typeof lstat>>
    try {
      entry = await lstat(current)
    } catch (error) {
      return fail(code, `Trusted resource is missing: ${segment}`, error)
    }
    if (entry.isSymbolicLink()) fail(code, `Trusted layout contains a symbolic-link or junction: ${segment}`)
    if (segment === segments.at(-1)) {
      if (!entry.isFile()) fail(code, `Trusted resource is not a regular file: ${segment}`)
    } else if (!entry.isDirectory()) {
      fail(code, `Trusted layout component is not a directory: ${segment}`)
    }
  }
  const target = await realpath(current)
  if (!contained(root, target)) fail(code, 'Trusted resource escaped its catalog root.')
  return target
}

async function trustedFileBytes(root: string, expectedRoot: Stats, segments: string[], code: string): Promise<Buffer> {
  const rootBefore = await stableRootIdentity(root, STABLE_READ_FAILURE_CODE)
  if (!sameIdentity(expectedRoot, rootBefore)) fail(STABLE_READ_FAILURE_CODE, 'Catalog root identity changed before reading.')
  const initialPath = await directFile(root, segments, STABLE_READ_FAILURE_CODE)
  const initialFile = await lstat(initialPath)
  if (!initialFile.isFile() || initialFile.isSymbolicLink()) fail(code, 'Trusted file is not a direct regular file.')
  await runStableReadHook('afterPrecheck')

  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(initialPath, 'r')
  } catch (error) {
    return fail(code, 'Trusted file could not be opened.', error)
  }
  try {
    await runStableReadHook('afterOpen')
    const openedBeforeRead = await handle.stat()
    if (!openedBeforeRead.isFile() || !sameStableFile(initialFile, openedBeforeRead)) {
      retryStableRead('Opened file does not match the initially trusted file.')
    }
    const bytes = await handle.readFile()
    const openedAfterRead = await handle.stat()
    if (!sameStableFile(openedBeforeRead, openedAfterRead)) retryStableRead('Trusted file changed while being read.')

    const rootAfter = await stableRootIdentity(root, STABLE_READ_FAILURE_CODE)
    if (!sameIdentity(expectedRoot, rootAfter) || !sameIdentity(rootBefore, rootAfter)) fail(STABLE_READ_FAILURE_CODE, 'Catalog root identity changed while reading.')
    const finalPath = await directFile(root, segments, STABLE_READ_FAILURE_CODE)
    const finalFile = await stat(finalPath)
    if (!sameStableFile(openedAfterRead, finalFile) || !contained(root, await realpath(finalPath))) {
      retryStableRead('Opened file no longer matches the final trusted catalog path.')
    }
    return bytes
  } finally {
    await handle.close()
  }
}

async function trustedRoot(root: string): Promise<string> {
  if (typeof root !== 'string' || root.length === 0) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Catalog root must be a non-empty path.')
  return directDirectory(resolve(root), 'RESOURCE_OUTSIDE_CATALOG_ROOT')
}

/** Resolve an opaque content identity only through the fixed content-addressed layout. */
export async function resolveV09Resource(root: string, resourceId: unknown): Promise<string> {
  const parsed = parseContentResourceId(resourceId)
  if (parsed === undefined) fail('RESOURCE_OUTSIDE_CATALOG_ROOT', 'Resource ID must be a canonical sha256 identity, never a path or URL.')
  const catalogRoot = await trustedRoot(root)
  return directFile(catalogRoot, ['resources', 'by-sha256', parsed.slice('sha256:'.length)], 'RESOURCE_OUTSIDE_CATALOG_ROOT')
}

function parseJson(bytes: Buffer, code: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    return fail(code, 'Expected strict JSON.', error)
  }
}

function refDigest(ref: ContentResourceRef): string {
  const parsed = parseContentResourceId(ref.resourceId)
  if (parsed === undefined || parsed.slice('sha256:'.length) !== ref.sha256) {
    fail('RESOURCE_HASH_MISMATCH', 'Content resource ID and declared SHA-256 must agree.')
  }
  return ref.sha256
}

function collectRefs(value: unknown, found = new Map<string, ContentResourceRef>()): Map<string, ContentResourceRef> {
  if (Array.isArray(value)) {
    value.forEach(item => collectRefs(item, found))
  } else if (value !== null && typeof value === 'object') {
    const candidate = anyRef.safeParse(value)
    const object = value as Record<string, unknown>
    const refLike = ['resourceId', 'sha256', 'mediaType'].some(key => Object.prototype.hasOwnProperty.call(object, key))
    if (refLike && !candidate.success) fail('RESOURCE_SCHEMA_INVALID', 'Resource-like objects must be strict, supported content references.')
    if (candidate.success) {
      const ref = candidate.data as ContentResourceRef
      const existing = found.get(ref.resourceId)
      if (existing !== undefined && (existing.sha256 !== ref.sha256 || existing.mediaType !== ref.mediaType)) {
        fail('RESOURCE_HASH_MISMATCH', 'A content identity cannot have conflicting declarations.')
      }
      found.set(ref.resourceId, ref)
    }
    for (const item of Object.values(object)) collectRefs(item, found)
  }
  return found
}

async function loadRef(root: string, rootIdentity: Stats, ref: ContentResourceRef): Promise<{ ref: ContentResourceRef; parsed?: unknown }> {
  const declared = refDigest(ref)
  const parsed = parseContentResourceId(ref.resourceId) as ContentResourceId
  const bytes = await trustedFileBytes(root, rootIdentity, ['resources', 'by-sha256', parsed.slice('sha256:'.length)], 'RESOURCE_OUTSIDE_CATALOG_ROOT')
  if (ref.mediaType === 'image/png') {
    const actual = await decodedPngSha256(bytes)
    if (actual !== declared) fail('RESOURCE_HASH_MISMATCH', 'PNG resource digest mismatch.')
    return { ref }
  }
  if (ref.mediaType === 'application/qmonster-material-v1+json' || ref.mediaType === 'application/qmonster-manifest-v1+json') {
    const payload = parseJson(bytes, 'RESOURCE_SCHEMA_INVALID')
    if (canonicalJsonSha256(payload) !== declared) fail('RESOURCE_HASH_MISMATCH', 'JSON resource digest mismatch.')
    return { ref, parsed: payload }
  }
  return fail('RESOURCE_HASH_MISMATCH', 'Unknown content media type.')
}

function checked<T>(result: { success: boolean; data?: T }, code: string, message: string): T {
  if (!result.success || result.data === undefined) fail(code, message)
  return result.data
}

function requiredJson<T>(loaded: Map<string, unknown>, ref: ContentResourceRef, parser: { safeParse(value: unknown): { success: boolean; data?: T } }, code: string, message: string): T {
  const value = loaded.get(ref.resourceId)
  if (value === undefined) fail(code, 'Referenced JSON payload was not loaded.')
  return checked(parser.safeParse(value), code, message)
}

function validateProjections(pool: SkeletonPoolV1, families: SkeletonFamilyV1[], templates: AssemblyTemplateV1[], graph: CompositionGraphV1, loadedRefs: Map<string, ContentResourceRef>): void {
  const familyById = new Map<string, SkeletonFamilyV1>()
  for (const family of families) {
    if (familyById.has(family.skeletonFamilyId)) fail('SKELETON_PROJECTION_MISSING', 'Skeleton family IDs must be unique.')
    familyById.set(family.skeletonFamilyId, family)
  }
  const templateById = new Map<string, AssemblyTemplateV1>()
  for (const template of templates) {
    if (templateById.has(template.assemblyTemplateId)) fail('SKELETON_PROJECTION_MISSING', 'Assembly template IDs must be unique.')
    templateById.set(template.assemblyTemplateId, template)
    const family = familyById.get(template.skeletonFamilyId)
    if (family === undefined || canonicalJsonSha256(template.compositionGraph) !== canonicalJsonSha256(graph)) {
      fail('SKELETON_PROJECTION_MISSING', 'Assembly template does not share its family or declared composition graph.')
    }
    for (const attachment of template.slots.attachment) {
      if (!Object.prototype.hasOwnProperty.call(family.fixedOccluderMasks, attachment.attachmentInterface.fixedOccluderMaskId)) {
        fail('SKELETON_PROJECTION_MISSING', 'Attachment template references a missing fixed occluder mask.')
      }
    }
  }
  for (const candidate of pool.candidates) {
    const family = familyById.get(candidate.skeletonFamilyId)
    if (family === undefined || family.skeletonClass !== candidate.skeletonClass) fail('SKELETON_PROJECTION_MISSING', 'Pool candidate has no matching skeleton family.')
    const template = templateById.get(family.assemblyTemplateId)
    if (template === undefined || template.skeletonFamilyId !== family.skeletonFamilyId) fail('SKELETON_PROJECTION_MISSING', 'Skeleton family has no owned assembly template.')
    if (!loadedRefs.has(family.neutralMaster.resourceId) || !loadedRefs.has(family.materialMap.resourceId)
      || template.neutralMasterSha256 !== family.neutralMaster.sha256) {
      fail('SKELETON_PROJECTION_MISSING', 'Skeleton family cannot provide its declared projection identities.')
    }
  }
}

async function loadActiveV09ReleaseOnce(root: string, rootIdentity: Stats): Promise<ResolvedV09Catalog> {
  const pointer = z.strictObject({ schemaVersion: z.literal('qmonster-active-release-v1'), releaseManifestSha256: hash }).safeParse(parseJson(await trustedFileBytes(root, rootIdentity, ['releases', 'active-release.json'], 'RELEASE_MANIFEST_SCHEMA_INVALID'), 'RELEASE_MANIFEST_SCHEMA_INVALID'))
  if (!pointer.success) fail('RELEASE_MANIFEST_SCHEMA_INVALID', 'Active release pointer has an invalid schema.')

  const manifestInput = parseJson(await trustedFileBytes(root, rootIdentity, ['releases', 'by-sha256', `${pointer.data.releaseManifestSha256}.json`], 'RELEASE_MANIFEST_SCHEMA_INVALID'), 'RELEASE_MANIFEST_SCHEMA_INVALID')
  if (canonicalJsonSha256(manifestInput) !== pointer.data.releaseManifestSha256) fail('RELEASE_MANIFEST_HASH_MISMATCH', 'Release manifest digest mismatch.')
  const parsedManifest = parseReleaseManifestV09(manifestInput)
  if (!parsedManifest.ok) {
    const tuple = parsedManifest.diagnostics.find(diagnostic => diagnostic.code === 'VERSION_TUPLE_MISMATCH')
    fail(tuple?.code ?? 'RELEASE_MANIFEST_SCHEMA_INVALID', tuple?.message ?? 'Release manifest has an invalid schema.')
  }
  const manifest = parsedManifest.value as ReleaseManifestV09

  const loadedJson = new Map<string, unknown>()
  const loadedRefs = new Map<string, ContentResourceRef>()
  const pending = collectRefs(manifest)
  while (pending.size > 0) {
    const [resourceId, ref] = pending.entries().next().value as [string, ContentResourceRef]
    pending.delete(resourceId)
    if (loadedRefs.has(resourceId)) continue
    const loaded = await loadRef(root, rootIdentity, ref)
    loadedRefs.set(resourceId, ref)
    if (loaded.parsed !== undefined) {
      loadedJson.set(resourceId, loaded.parsed)
      for (const [nestedId, nestedRef] of collectRefs(loaded.parsed)) if (!loadedRefs.has(nestedId)) pending.set(nestedId, nestedRef)
    }
  }

  const pool = requiredJson(loadedJson, manifest.skeletonPool, skeletonPoolSchema, 'SKELETON_POOL_INVALID', 'Skeleton pool must contain exactly the fixed base/legendary candidates.') as SkeletonPoolV1
  const families = manifest.skeletonFamilies.map(ref => requiredJson(loadedJson, ref, skeletonFamilySchema, 'SKELETON_PROJECTION_MISSING', 'Skeleton family has an invalid schema.') as SkeletonFamilyV1)
  const templates = manifest.assemblyTemplates.map(ref => requiredJson(loadedJson, ref, assemblyTemplateSchema, 'SKELETON_PROJECTION_MISSING', 'Assembly template has an invalid schema.') as AssemblyTemplateV1)
  const graph = requiredJson(loadedJson, manifest.compositionGraph, compositionGraphSchema, 'SKELETON_PROJECTION_MISSING', 'Composition graph has an invalid schema.') as CompositionGraphV1
  const traits = manifest.sealedTraits.map(ref => {
    const value = loadedJson.get(ref.resourceId)
    if (value === undefined) fail('RESOURCE_SCHEMA_INVALID', 'Sealed trait payload was not loaded.')
    const parsed = parseSealedTraitArtifactV1(value)
    if (!parsed.ok) fail('RESOURCE_SCHEMA_INVALID', 'Sealed trait payload has an invalid schema.')
    return parsed.value
  })
  validateProjections(pool, families, templates, graph, loadedRefs)
  return { releaseManifestSha256: pointer.data.releaseManifestSha256, releaseManifest: manifest, speciesRig: manifest.speciesRig, skeletonPool: pool, skeletonFamilies: families, assemblyTemplates: templates, sealedTraits: traits as SealedTraitArtifactV1[], compositionGraph: graph }
}

/** Load one complete content-addressed v0.9 release, with no legacy fallback path. */
export async function loadActiveV09Release(options: { root: string }): Promise<ResolvedV09Catalog> {
  const root = await trustedRoot(options?.root)
  const rootIdentity = await stableRootIdentity(root, STABLE_READ_FAILURE_CODE)
  for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt += 1) {
    try {
      return await loadActiveV09ReleaseOnce(root, rootIdentity)
    } catch (error) {
      if (!(error instanceof RetryStableReadError)) throw error
      if (attempt === MAX_STABLE_READ_ATTEMPTS - 1) {
        fail(STABLE_READ_FAILURE_CODE, 'Catalog files did not remain stable across bounded read attempts.', error)
      }
    }
  }
  return fail(STABLE_READ_FAILURE_CODE, 'Catalog release could not be read stably.')
}
