import {
  V09_VERSION_TUPLE,
  parseReleaseManifestV09,
  parseSealedTraitArtifactV1,
  type AssemblyTemplateV1,
  type CompositionGraphV1,
  type ReleaseManifestV09,
  type ResolvedV09Catalog,
  type SealedTraitArtifactV1,
  type SkeletonFamilyV1,
  type SkeletonPoolV1,
} from '@qmonster/generator-core'
import skeletonPoolDocument from '../../../packages/asset-catalog/catalog/v0.9.0/skeleton-pool.json'
import coreFamilyDocument from '../../../asset-source/v0.9.0/feline/templates/feline-sit-v2-core/family.json'
import legendaryFamilyDocument from '../../../asset-source/v0.9.0/feline/templates/feline-sit-v2-legendary-01/family.json'
import coreTemplateDocument from '../../../asset-source/v0.9.0/feline/templates/feline-sit-v2-core.json'
import legendaryTemplateDocument from '../../../asset-source/v0.9.0/feline/templates/feline-sit-v2-legendary-01.json'

const HASH = /^[a-f0-9]{64}$/u

const bundledActivePointerDocuments = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/releases/active-release.json',
  { eager: true, import: 'default' },
)
const bundledReleaseManifestModules = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/releases/by-sha256/*.json',
  { eager: true, import: 'default' },
)
const bundledSealedTraitModules = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/catalog/v0.9.0/sealed-traits/**/*.json',
  { eager: true, import: 'default' },
)
const bundledTraitApprovalModules = import.meta.glob<unknown>(
  '../../../packages/asset-catalog/audit/v0.9.0/trait-approvals/**/*.json',
  { eager: true, import: 'default' },
)

export class ProductionReleaseError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ProductionReleaseError'
  }
}

export interface ProductionTraitRecord {
  artifact: SealedTraitArtifactV1
  sealedArtifactSha256: string
  fullContextPreviewSha256: string
  approvalState: 'approved'
}

export interface ProductionV09Release {
  manifestHash: string
  catalog: ResolvedV09Catalog
  traits: ProductionTraitRecord[]
}

export interface ProductionReleaseDocuments {
  /** Explicit test/preview injection. Omit to resolve only the real bundled active pointer. */
  pointer?: unknown
  activePointerDocuments?: Readonly<Record<string, unknown>>
  releaseManifestDocuments?: Readonly<Record<string, unknown>>
  traitApprovalDocuments?: Readonly<Record<string, unknown>>
}

function fail(code: string, message: string): never {
  throw new ProductionReleaseError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pointerFrom(input: unknown): { releaseManifestSha256: string } {
  if (!isRecord(input)
    || input.schemaVersion !== 'qmonster-active-release-v1'
    || typeof input.releaseManifestSha256 !== 'string'
    || !HASH.test(input.releaseManifestSha256)
    || Object.keys(input).sort().join(',') !== 'releaseManifestSha256,schemaVersion') {
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

function manifestDocumentsByHash(documents: Readonly<Record<string, unknown>>): Map<string, unknown> {
  const result = new Map<string, unknown>()
  for (const [key, document] of Object.entries(documents)) {
    const match = /\/([a-f0-9]{64})\.json$/u.exec(key.replaceAll('\\', '/'))
    const hash = match?.[1] ?? (HASH.test(key) ? key : undefined)
    if (hash !== undefined) result.set(hash, document)
  }
  return result
}

function strictCandidateResources(
  manifest: ReleaseManifestV09,
  traitApprovalDocuments: Readonly<Record<string, unknown>>,
): {
  skeletonPool: SkeletonPoolV1
  skeletonFamilies: SkeletonFamilyV1[]
  assemblyTemplates: AssemblyTemplateV1[]
  sealedTraits: SealedTraitArtifactV1[]
  compositionGraph: CompositionGraphV1
} {
  const traitDocuments = Object.entries(bundledSealedTraitModules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, document]) => document)
  if (traitDocuments.length !== manifest.sealedTraits.length) {
    return fail('SKELETON_PROJECTION_MISSING', 'The bundled sealed-trait inventory does not match the release manifest.')
  }
  if (manifest.traitApprovals.length !== manifest.sealedTraits.length) {
    return fail('TRAIT_APPROVAL_MISSING', 'Every bundled sealed projection must have one approval.')
  }
  const approvalDocuments = Object.entries(traitApprovalDocuments)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, document]) => document)
  if (approvalDocuments.length !== manifest.traitApprovals.length) {
    return fail('TRAIT_APPROVAL_MISSING', 'The bundled approval inventory does not match the release manifest.')
  }
  const sealedTraits = traitDocuments.map((document, index) => {
    const parsed = parseSealedTraitArtifactV1(document)
    if (!parsed.ok) return fail(parsed.diagnostics[0]?.code ?? 'TRAIT_SCHEMA_INVALID', 'A bundled sealed trait is invalid.')
    const ref = manifest.sealedTraits[index]
    if (ref === undefined || ref.resourceId !== `sha256:${ref.sha256}`) {
      return fail('RESOURCE_HASH_MISMATCH', 'A sealed trait reference has an invalid content identity.')
    }
    const approval = approvalDocuments[index]
    const approvalRef = manifest.traitApprovals[index]
    if (!isRecord(approval)
      || approval.schemaVersion !== 'qmonster-trait-visual-approval-v1'
      || approval.status !== 'approved'
      || approval.skeletonFamilyId !== parsed.value.skeletonFamilyId
      || approval.sealedArtifactSha256 !== ref.sha256
      || approval.assemblyTemplateSha256 !== parsed.value.assemblyTemplateSha256
      || approval.fullContextPreviewSha256 !== parsed.value.fullContextPreview.sha256
      || approvalRef === undefined
      || approvalRef.resourceId !== `sha256:${approvalRef.sha256}`) {
      return fail('TRAIT_APPROVAL_MISSING', 'A sealed trait lacks one exact approved visual record.')
    }
    return parsed.value
  })
  const skeletonPool = structuredClone(skeletonPoolDocument) as SkeletonPoolV1
  const skeletonFamilies = [structuredClone(coreFamilyDocument), structuredClone(legendaryFamilyDocument)] as unknown as SkeletonFamilyV1[]
  const assemblyTemplates = [structuredClone(coreTemplateDocument), structuredClone(legendaryTemplateDocument)] as unknown as AssemblyTemplateV1[]
  const compositionGraph = structuredClone(coreTemplateDocument.compositionGraph) as CompositionGraphV1
  if (JSON.stringify(skeletonPool.candidates.map(item => [item.skeletonClass, item.weight])) !== JSON.stringify([['base', 8], ['legendary', 1]])) {
    return fail('SKELETON_POOL_INVALID', 'The browser bundle must contain the fixed 8:1 skeleton pool.')
  }
  if (skeletonFamilies.length !== manifest.skeletonFamilies.length || assemblyTemplates.length !== manifest.assemblyTemplates.length) {
    return fail('SKELETON_PROJECTION_MISSING', 'The browser bundle is missing a skeleton family or assembly template.')
  }
  if (assemblyTemplates.some(template => JSON.stringify(template.compositionGraph) !== JSON.stringify(compositionGraph))) {
    return fail('COMPOSITION_GRAPH_MISMATCH', 'Every bundled template must use the frozen composition graph.')
  }
  return { skeletonPool, skeletonFamilies, assemblyTemplates, sealedTraits, compositionGraph }
}

/**
 * Resolve one browser-bundled release by the exact active-pointer hash.
 * Candidate use is deliberately explicit through `pointer`; it is never a fallback.
 */
export function loadActiveProductionRelease(options: ProductionReleaseDocuments = {}): ProductionV09Release {
  const pointer = pointerFrom(options.pointer ?? oneBundledPointer(
    options.activePointerDocuments ?? bundledActivePointerDocuments,
  ))
  const manifests = manifestDocumentsByHash(options.releaseManifestDocuments ?? bundledReleaseManifestModules)
  const manifestInput = manifests.get(pointer.releaseManifestSha256)
  if (manifestInput === undefined) {
    return fail('RELEASE_MANIFEST_HASH_MISMATCH', 'The exact active release manifest is not bundled.')
  }
  const parsed = parseReleaseManifestV09(manifestInput)
  if (!parsed.ok) {
    const diagnostic = parsed.diagnostics.find(item => item.code === 'VERSION_TUPLE_MISMATCH') ?? parsed.diagnostics[0]
    return fail(diagnostic?.code ?? 'RELEASE_MANIFEST_SCHEMA_INVALID', diagnostic?.message ?? 'The release manifest is invalid.')
  }
  const manifest = parsed.value
  if (manifest.versionTuple.schemaVersion !== V09_VERSION_TUPLE.schemaVersion
    || manifest.versionTuple.catalogVersion !== V09_VERSION_TUPLE.catalogVersion
    || manifest.versionTuple.generatorVersion !== V09_VERSION_TUPLE.generatorVersion) {
    return fail('VERSION_TUPLE_MISMATCH', 'Only the exact v0.9 version tuple is supported.')
  }
  const resources = strictCandidateResources(
    manifest,
    options.traitApprovalDocuments ?? bundledTraitApprovalModules,
  )
  const catalog: ResolvedV09Catalog = {
    releaseManifestSha256: pointer.releaseManifestSha256,
    releaseManifest: structuredClone(manifest),
    speciesRig: structuredClone(manifest.speciesRig),
    ...resources,
  }
  const traits = catalog.sealedTraits.map((artifact, index) => ({
    artifact,
    sealedArtifactSha256: manifest.sealedTraits[index]!.sha256,
    fullContextPreviewSha256: artifact.fullContextPreview.sha256,
    approvalState: 'approved' as const,
  }))
  return { manifestHash: pointer.releaseManifestSha256, catalog, traits }
}
