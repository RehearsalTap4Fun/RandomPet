import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  V09_VERSION_TUPLE,
  type AssemblyTemplateV1,
  type CompositionGraphV1,
  type ContentResourceRef,
  type JsonResourceRef,
  type ReleaseManifestV09,
  type SkeletonFamilyV1,
} from '@qmonster/generator-core'
import {
  assembleV09Release,
  canonicalJsonBytes,
  canonicalJsonSha256,
  decodedPngSha256,
  type ApprovedAttachmentAllowlistV1,
  type AssemblyApprovalV1,
  type TraitInventoryV1,
  type TraitVisualApprovalV1,
  type V09ContentRecordV1,
  type V09ReleaseCandidate,
} from '@qmonster/asset-catalog'

const HASH = /^[a-f0-9]{64}$/u
const SOURCE_ROOT = 'asset-source/v0.9.0/feline'
const CATALOG_ROOT = 'packages/asset-catalog'
const FAMILY_IDS = ['feline-sit-v2-core', 'feline-sit-v2-legendary-01'] as const

export interface BuildV09ReleaseCandidateOptions {
  repositoryRoot: string
  catalogVersion: '0.9.0'
}

export interface V09AssemblyCliOptions extends BuildV09ReleaseCandidateOptions {
  outputPointer: string
}

type V09Assembler = typeof assembleV09Release

export interface AssembleBuiltV09CandidateOptions {
  catalogRoot: string
  outputPointer: string
  candidate: V09ReleaseCandidate
  assembler?: V09Assembler
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

async function trustedFile(root: string, path: string): Promise<Buffer> {
  const target = resolve(root, path)
  if (!contained(resolve(root), target)) throw new Error(`Candidate input escapes the repository root: ${path}`)
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Candidate input is not a direct regular file: ${path}`)
  return readFile(target)
}

async function readJson<T>(root: string, path: string): Promise<T> {
  return JSON.parse((await trustedFile(root, path)).toString('utf8')) as T
}

async function filesBelow(root: string, directory: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absolute = resolve(root, relativeDirectory)
    if (!contained(resolve(root), absolute)) throw new Error(`Candidate directory escapes the repository root: ${relativeDirectory}`)
    const entries = await readdir(absolute, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relativeDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Candidate directory contains a link: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) output.push(path)
      else throw new Error(`Candidate directory contains an unsupported entry: ${path}`)
    }
  }
  await visit(directory)
  return output.sort((a, b) => a.localeCompare(b))
}

function jsonRef(value: unknown, mediaType: JsonResourceRef['mediaType'] = 'application/qmonster-manifest-v1+json'): JsonResourceRef {
  const sha256 = canonicalJsonSha256(value)
  return { resourceId: `sha256:${sha256}` as JsonResourceRef['resourceId'], sha256, mediaType }
}

function contentRef(value: unknown): ContentResourceRef | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.resourceId !== 'string' || typeof candidate.sha256 !== 'string'
    || candidate.resourceId !== `sha256:${candidate.sha256}` || !HASH.test(candidate.sha256)) return undefined
  if (candidate.mediaType === 'image/png' && candidate.width === 2048 && candidate.height === 2048) return candidate as unknown as ContentResourceRef
  if (candidate.mediaType === 'application/qmonster-material-v1+json' || candidate.mediaType === 'application/qmonster-manifest-v1+json') return candidate as unknown as ContentResourceRef
  return undefined
}

function collectRefs(value: unknown, refs: Map<string, ContentResourceRef>): void {
  const ref = contentRef(value)
  if (ref !== undefined) {
    const previous = refs.get(ref.resourceId)
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(ref)) throw new Error(`Conflicting candidate content reference: ${ref.resourceId}`)
    refs.set(ref.resourceId, ref)
    return
  }
  if (Array.isArray(value)) for (const child of value) collectRefs(child, refs)
  else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) collectRefs(child, refs)
}

async function rendererBuildSha256(repositoryRoot: string): Promise<string> {
  const files = ['packages/renderer-canvas/src/v09-material-render.ts', 'packages/renderer-canvas/src/v09-render.ts']
  const identities = []
  for (const path of files) identities.push({ path, sha256: createHash('sha256').update(await trustedFile(repositoryRoot, path)).digest('hex') })
  return canonicalJsonSha256({ files: identities })
}

async function sourceResourceIndex(repositoryRoot: string): Promise<Map<string, string>> {
  const paths = (
    await Promise.all([
      filesBelow(repositoryRoot, `${SOURCE_ROOT}/masters`),
      filesBelow(repositoryRoot, `${SOURCE_ROOT}/templates`),
      filesBelow(repositoryRoot, `${SOURCE_ROOT}/review/resources`),
    ])
  ).flat().filter(path => path.endsWith('.png') || path.endsWith('.json'))
  const index = new Map<string, string>()
  for (const path of paths) {
    const bytes = await trustedFile(repositoryRoot, path)
    const sha256 = path.endsWith('.png')
      ? await decodedPngSha256(bytes)
      : canonicalJsonSha256(JSON.parse(bytes.toString('utf8')))
    const previous = index.get(sha256)
    if (previous === undefined || path.localeCompare(previous) < 0) index.set(sha256, path)
  }
  return index
}

/** Build the complete immutable release candidate from the exact approved Task 7/8 closure. */
export async function buildV09ReleaseCandidate(options: BuildV09ReleaseCandidateOptions): Promise<V09ReleaseCandidate> {
  if (options.catalogVersion !== '0.9.0') throw new Error(`Unsupported catalog version: ${String(options.catalogVersion)}`)
  const root = resolve(options.repositoryRoot)
  const speciesRig = { speciesRigId: 'feline-sit-v2' }
  const skeletonPool = {
    schemaVersion: 'qmonster-skeleton-pool-v1' as const,
    skeletonPoolId: 'feline-sit-v2-pool',
    candidates: [
      { skeletonFamilyId: FAMILY_IDS[0], skeletonClass: 'base' as const, weight: 8 as const },
      { skeletonFamilyId: FAMILY_IDS[1], skeletonClass: 'legendary' as const, weight: 1 as const },
    ],
  }
  const skeletonFamilies = await Promise.all(FAMILY_IDS.map(id => readJson<SkeletonFamilyV1>(root, `${SOURCE_ROOT}/templates/${id}/family.json`)))
  const assemblyTemplates = await Promise.all(FAMILY_IDS.map(id => readJson<AssemblyTemplateV1>(root, `${SOURCE_ROOT}/templates/${id}.json`)))
  const assemblyApprovals = await readJson<AssemblyApprovalV1[]>(root, `${SOURCE_ROOT}/approvals/assembly-approvals.json`)
  const attachmentAllowlist = await readJson<ApprovedAttachmentAllowlistV1>(root, `${SOURCE_ROOT}/approvals/attachment-allowlist.json`)
  const traitInventory = await readJson<TraitInventoryV1>(root, `${SOURCE_ROOT}/trait-inventory.json`)
  const traitApprovalPaths = (await filesBelow(root, `${CATALOG_ROOT}/audit/v0.9.0/trait-approvals`)).filter(path => path.endsWith('.json'))
  const sealedTraitPaths = (await filesBelow(root, `${CATALOG_ROOT}/catalog/v0.9.0/sealed-traits`)).filter(path => path.endsWith('.json'))
  const traitApprovals = await Promise.all(traitApprovalPaths.map(path => readJson<TraitVisualApprovalV1>(root, path)))
  const sealedTraits = await Promise.all(sealedTraitPaths.map(path => readJson<unknown>(root, path)))
  const compositionGraph = structuredClone(assemblyTemplates[0]!.compositionGraph) as CompositionGraphV1
  if (assemblyTemplates.some(template => canonicalJsonSha256(template.compositionGraph) !== canonicalJsonSha256(compositionGraph))) {
    throw new Error('Approved assembly templates do not share one frozen composition graph.')
  }

  const releaseManifest: ReleaseManifestV09 = {
    schemaVersion: 'qmonster-release-v1',
    versionTuple: V09_VERSION_TUPLE,
    speciesRig: jsonRef(speciesRig),
    skeletonPool: jsonRef(skeletonPool),
    skeletonFamilies: skeletonFamilies.map(value => jsonRef(value)),
    assemblyTemplates: assemblyTemplates.map(value => jsonRef(value)),
    approvals: assemblyApprovals.map(value => jsonRef(value)),
    traitApprovals: traitApprovals.map(value => jsonRef(value)),
    traitInventory: jsonRef(traitInventory),
    sealedTraits: sealedTraits.map(value => jsonRef(value)),
    compositionGraph: jsonRef(compositionGraph),
    rendererBuildSha256: await rendererBuildSha256(root),
  }

  const documents = [
    speciesRig, skeletonPool, ...skeletonFamilies, ...assemblyTemplates, ...assemblyApprovals,
    ...traitApprovals, attachmentAllowlist, traitInventory, ...sealedTraits, compositionGraph,
  ]
  const resources = new Map<string, V09ContentRecordV1>()
  for (const document of documents) {
    const ref = jsonRef(document)
    resources.set(ref.resourceId, { ref, bytes: canonicalJsonBytes(document) })
  }
  const refs = new Map<string, ContentResourceRef>()
  collectRefs(releaseManifest, refs)
  collectRefs(documents, refs)
  const allowlistRef = jsonRef(attachmentAllowlist)
  refs.set(allowlistRef.resourceId, allowlistRef)
  let sourceResources: Map<string, string> | undefined

  for (const [resourceId, ref] of refs) {
    if (resources.has(resourceId)) continue
    const extension = ref.mediaType === 'image/png' ? '.png' : '.json'
    const catalogPath = `${CATALOG_ROOT}/assets/v0.9.0/by-sha256/${ref.sha256}${extension}`
    let bytes: Buffer
    try {
      bytes = await trustedFile(root, catalogPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      sourceResources ??= await sourceResourceIndex(root)
      const sourcePath = sourceResources.get(ref.sha256)
      if (sourcePath === undefined) throw new Error(`Approved content resource is missing: ${ref.resourceId}`, { cause: error })
      bytes = await trustedFile(root, sourcePath)
    }
    resources.set(resourceId, { ref, bytes })
    if (ref.mediaType !== 'image/png') collectRefs(JSON.parse(bytes.toString('utf8')), refs)
  }

  return {
    releaseManifest,
    speciesRig,
    skeletonPool,
    skeletonFamilies,
    assemblyTemplates,
    assemblyApprovals,
    traitApprovals,
    attachmentAllowlist,
    traitInventory,
    sealedTraits,
    compositionGraph,
    resources: [...resources.values()].sort((a, b) => a.ref.resourceId.localeCompare(b.ref.resourceId)),
  }
}

export { assembleV09Release }

export function parseV09AssemblyArgs(args: readonly string[], repositoryRoot: string): V09AssemblyCliOptions {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const catalogVersion = value('--catalog-version')
  const output = value('--output-pointer')
  if (catalogVersion !== '0.9.0') throw new Error('Expected --catalog-version 0.9.0.')
  if (output === undefined) throw new Error('Missing required --output-pointer.')
  const root = resolve(repositoryRoot)
  const outputPointer = resolve(root, output)
  const expected = resolve(root, CATALOG_ROOT, 'releases', 'candidate-v0.9.0.json')
  if (outputPointer !== expected || outputPointer.toLowerCase().endsWith(`${sep}active-release.json`)) {
    throw new Error('Output pointer must be the explicit non-active v0.9 candidate pointer.')
  }
  return { repositoryRoot: root, catalogVersion, outputPointer }
}

/** Delegate public catalog documents and release outputs to one Task 5 transaction. */
export async function assembleBuiltV09Candidate(options: AssembleBuiltV09CandidateOptions): Promise<Awaited<ReturnType<V09Assembler>>> {
  const catalogRoot = resolve(options.catalogRoot)
  const expectedPointer = resolve(catalogRoot, 'releases', 'candidate-v0.9.0.json')
  if (resolve(options.outputPointer) !== expectedPointer) throw new Error('Built candidate output pointer is not the explicit v0.9 candidate pointer.')
  const result = await (options.assembler ?? assembleV09Release)({ root: catalogRoot, candidate: options.candidate, publishCatalogDocuments: true })
  if (resolve(result.candidatePointerPath) !== expectedPointer) throw new Error('Assembler returned an unexpected candidate pointer path.')
  return result
}

/** Assemble the approved production candidate while proving the active pointer is untouched. */
export async function assembleApprovedV09Candidate(options: V09AssemblyCliOptions): Promise<{
  releaseManifestSha256: string
  rendererBuildSha256: string
  resourceCount: number
  resourceBytes: number
}> {
  const catalogRoot = resolve(options.repositoryRoot, CATALOG_ROOT)
  const candidate = await buildV09ReleaseCandidate(options)
  const result = await assembleBuiltV09Candidate({ catalogRoot, outputPointer: options.outputPointer, candidate })
  return {
    releaseManifestSha256: result.releaseManifestSha256,
    rendererBuildSha256: (candidate.releaseManifest as ReleaseManifestV09).rendererBuildSha256,
    resourceCount: candidate.resources.length,
    resourceBytes: candidate.resources.reduce((total, item) => total + item.bytes.byteLength, 0),
  }
}

export async function runV09AssemblyCli(args = process.argv.slice(2), repositoryRoot = process.cwd()): Promise<number> {
  try {
    const result = await assembleApprovedV09Candidate(parseV09AssemblyArgs(args, repositoryRoot))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runV09AssemblyCli()
}
