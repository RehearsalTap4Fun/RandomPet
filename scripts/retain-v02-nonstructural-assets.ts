import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const RETAINED_NONSTRUCTURAL_SLOTS = [
  ['eyes', 5],
  ['mouthShape', 4],
  ['oralDetail', 4],
  ['headAppendage', 4],
  ['surfaceMaterial', 4],
  ['pattern', 4],
  ['colorScheme', 3],
  ['effect', 3],
] as const

type RetainedSlotId = typeof RETAINED_NONSTRUCTURAL_SLOTS[number][0]
type RetainedFormat = 'png' | 'webp'

interface CatalogPartResource {
  id: string
  slotId: string
  pngPath: string
  assetPath: string
}

interface V02SourceRecord {
  sourceId: string
  kind?: string
  slotId: string
  runtimePngPath: string
  runtimePngSha256: string
  runtimeWebpPath: string
  runtimeWebpSha256: string
  masterPath?: string
  masterSha256?: string
}

export interface RetainedPartPlan {
  partId: string
  slotId: RetainedSlotId
  pngPath: string
  webpPath: string
  isNone: boolean
}

export interface RetainedFilePlan {
  partId: string
  slotId: RetainedSlotId
  format: RetainedFormat
  v02Path: string
  v02Sha256: string
  v03SourcePath: string
  v03RuntimePath: string
}

export interface RetainedNonstructuralPlan {
  parts: RetainedPartPlan[]
  files: RetainedFilePlan[]
}

export interface RetainedProvenanceEntry extends RetainedFilePlan {
  v03SourceSha256: string
  v03RuntimeSha256: string
  byteIdentical: true
}

type RigId = 'blob' | 'biped' | 'floating'
interface Point { x: number, y: number }
interface Bounds extends Point { width: number, height: number }
interface RetainedRenderNodeMetadata {
  id: string
  assetPath: string
  pngPath: string
  assetSha256: string
  pngSha256: string
  parentSlot: string
  socket: string
  origin: Point
  transform: { scale: number, mirrorX: false }
  layer: string
  compatibleRigs: [RigId]
  clipPolicy: 'none' | 'body' | 'protect-face'
  coordinateSource: 'v0.3-feature-socket+retained-alpha' | 'v0.3-structural-union-alpha'
}
export interface RetainedCoordinateMetadata {
  schemaVersion: 'qmonster-retained-coordinate-v1'
  headFeatureSockets: Array<{
    partId: string
    rigId: RigId
    featureSockets: Record<string, Point>
    faceSafeZones: Bounds[]
  }>
  bodyStructuralUnions: Array<{
    bodyId: string
    rigId: RigId
    contributorIds: string[]
    structuralUnionSha256: string
    alphaBounds: Bounds
    socket: Point
  }>
  parts: Array<{
    partId: string
    slotId: RetainedSlotId
    isNone: boolean
    renderNodes: RetainedRenderNodeMetadata[]
    geometryByRig: Partial<Record<RigId, { sockets: Record<string, Point> }>>
  }>
}

const SHA256 = /^[a-f0-9]{64}$/u
const ASSET_PATH = /^parts\/[A-Za-z0-9_-]+\.(?:png|webp)$/u

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function hashFile(path: string): Promise<string> {
  return digest(await readFile(path))
}

function fail(message: string): never {
  throw new Error(`RETAINED_NONSTRUCTURAL_INVALID: ${message}`)
}

export async function planRetainedNonstructuralAssets(
  root = process.cwd(),
): Promise<RetainedNonstructuralPlan> {
  const catalog = JSON.parse(await readFile(
    join(root, 'packages/asset-catalog/catalog/v0.2.0/catalog.json'),
    'utf8',
  )) as { parts?: CatalogPartResource[] }
  const sourceIndex = JSON.parse(await readFile(
    join(root, 'packages/asset-catalog/source-index-v0.2.0.json'),
    'utf8',
  )) as { sources?: V02SourceRecord[] }
  const expectedCounts = new Map<string, number>(RETAINED_NONSTRUCTURAL_SLOTS)
  const retainedParts = (catalog.parts ?? []).filter(part => expectedCounts.has(part.slotId))
  for (const [slotId, expected] of expectedCounts) {
    const actual = retainedParts.filter(part => part.slotId === slotId).length
    if (actual !== expected) fail(`${slotId} expected ${expected} parts, got ${actual}`)
  }
  if (new Set(retainedParts.map(part => part.id)).size !== retainedParts.length) {
    fail('retained catalog part IDs must be unique')
  }
  const sourcesById = new Map<string, V02SourceRecord>()
  const duplicates = new Set<string>()
  for (const source of sourceIndex.sources ?? []) {
    if (!expectedCounts.has(source.slotId)) continue
    if (sourcesById.has(source.sourceId)) duplicates.add(source.sourceId)
    else sourcesById.set(source.sourceId, source)
  }
  if (duplicates.size > 0) fail(`duplicate v0.2 source records: ${[...duplicates].join(', ')}`)

  const parts: RetainedPartPlan[] = []
  const files: RetainedFilePlan[] = []
  for (const part of retainedParts) {
    const source = sourcesById.get(part.id)
    if (source === undefined || source.slotId !== part.slotId) fail(`missing v0.2 source record for ${part.id}`)
    if (!ASSET_PATH.test(part.pngPath) || !ASSET_PATH.test(part.assetPath)) {
      fail(`non-canonical part paths for ${part.id}`)
    }
    if (!SHA256.test(source.runtimePngSha256) || !SHA256.test(source.runtimeWebpSha256)) {
      fail(`invalid v0.2 runtime hash for ${part.id}`)
    }
    const slotId = part.slotId as RetainedSlotId
    parts.push({
      partId: part.id,
      slotId,
      pngPath: part.pngPath,
      webpPath: part.assetPath,
      isNone: source.kind === 'explicit-none-layer' || part.id.endsWith('_none'),
    })
    for (const format of ['png', 'webp'] as const) {
      const relativePath = format === 'png' ? part.pngPath : part.assetPath
      const v02Path = format === 'png' ? source.runtimePngPath : source.runtimeWebpPath
      const v02Sha256 = format === 'png' ? source.runtimePngSha256 : source.runtimeWebpSha256
      const expectedV02Path = `packages/asset-catalog/assets/v0.2.0/${relativePath}`
      if (v02Path !== expectedV02Path) fail(`runtime path mismatch for ${part.id}.${format}`)
      files.push({
        partId: part.id,
        slotId,
        format,
        v02Path,
        v02Sha256,
        v03SourcePath: `asset-source/v0.3.0/retained-v0.2/${relativePath}`,
        v03RuntimePath: `packages/asset-catalog/assets/v0.3.0/${relativePath}`,
      })
    }
  }
  if (parts.length !== 31 || files.length !== 62) fail(`expected 31 parts/62 files, got ${parts.length}/${files.length}`)
  return { parts, files }
}

export async function retainV02NonstructuralAssets(root = process.cwd()): Promise<{
  parts: number
  files: number
  byteIdenticalFiles: number
  provenancePath: string
  acceptedSourceMasters: number
}> {
  const plan = await planRetainedNonstructuralAssets(root)
  const v02SourceIndexPath = join(root, 'packages/asset-catalog/source-index-v0.2.0.json')
  const v02SourceIndex = JSON.parse(await readFile(v02SourceIndexPath, 'utf8')) as { sources?: V02SourceRecord[] }
  const v02Sources = new Map((v02SourceIndex.sources ?? []).map(source => [source.sourceId, source]))
  const entries: RetainedProvenanceEntry[] = []
  for (const item of plan.files) {
    const sourcePath = join(root, item.v02Path)
    const actualSourceHash = await hashFile(sourcePath)
    if (actualSourceHash !== item.v02Sha256) fail(`v0.2 hash mismatch for ${item.v02Path}`)
    const sourceDestination = join(root, item.v03SourcePath)
    const runtimeDestination = join(root, item.v03RuntimePath)
    await mkdir(dirname(sourceDestination), { recursive: true })
    await mkdir(dirname(runtimeDestination), { recursive: true })
    await copyFile(sourcePath, sourceDestination)
    await copyFile(sourcePath, runtimeDestination)
    const v03SourceSha256 = await hashFile(sourceDestination)
    const v03RuntimeSha256 = await hashFile(runtimeDestination)
    if (v03SourceSha256 !== item.v02Sha256 || v03RuntimeSha256 !== item.v02Sha256) {
      fail(`retained bytes changed for ${item.partId}.${item.format}`)
    }
    entries.push({ ...item, v03SourceSha256, v03RuntimeSha256, byteIdentical: true })
  }
  const acceptedSourceMasters = []
  for (const part of plan.parts) {
    const source = v02Sources.get(part.partId)
    const v02Path = source?.masterPath ?? `packages/asset-catalog/assets/v0.2.0/${part.pngPath}`
    const v02Sha256 = source?.masterSha256 ?? await hashFile(join(root, v02Path))
    const v03Path = `asset-source/v0.3.0/retained-v0.2/masters/${part.partId}.png`
    if (!SHA256.test(v02Sha256) || await hashFile(join(root, v02Path)) !== v02Sha256) {
      fail(`accepted master hash mismatch for ${part.partId}`)
    }
    await mkdir(dirname(join(root, v03Path)), { recursive: true })
    await copyFile(join(root, v02Path), join(root, v03Path))
    const v03Sha256 = await hashFile(join(root, v03Path))
    if (v03Sha256 !== v02Sha256) fail(`accepted master bytes changed for ${part.partId}`)
    acceptedSourceMasters.push({ partId: part.partId, slotId: part.slotId, v02Path, v02Sha256, v03Path, v03Sha256, byteIdentical: true })
  }
  const provenancePath = 'asset-source/v0.3.0/provenance/retained-v0.2-nonstructural.json'
  const provenance = {
    schemaVersion: 'qmonster-retained-nonstructural-v1',
    sourceCatalogVersion: '0.2.0',
    targetCatalogVersion: '0.3.0',
    policy: 'accepted visual bytes copied verbatim; render coordinates are rebuilt separately from v0.3 sockets and alpha',
    counts: Object.fromEntries(RETAINED_NONSTRUCTURAL_SLOTS),
    entries,
    acceptedSourceMasters,
  }
  await mkdir(dirname(join(root, provenancePath)), { recursive: true })
  await writeFile(join(root, provenancePath), `${JSON.stringify(provenance, null, 2)}\n`)
  return {
    parts: plan.parts.length,
    files: plan.files.length,
    byteIdenticalFiles: entries.filter(entry => entry.byteIdentical).length,
    provenancePath,
    acceptedSourceMasters: acceptedSourceMasters.length,
  }
}

function qualityGateSummary(sources: any[]): Record<string, number> {
  const rigs = sources.filter(source => source.kind === 'rig-base')
  const parts = sources.filter(source => source.kind === 'generated-slot-layer')
  return {
    rigCandidatesEvaluated: rigs.reduce((count, source) => count + (source.candidateEvaluations?.length ?? 0), 0),
    rigCandidatesPassed: rigs.flatMap(source => source.candidateEvaluations ?? []).filter(candidate => candidate.machineApproved).length,
    partCandidatesEvaluated: parts.reduce((count, source) => count + (source.candidateEvaluations?.length ?? 0), 0),
    partCandidatesPassed: parts.flatMap(source => source.candidateEvaluations ?? []).filter(candidate => candidate.machineApproved).length,
    approvedRigSelectionsPassing: rigs.filter(source => source.candidateEvaluations?.some(candidate => candidate.selected && candidate.machineApproved)).length,
    approvedPartSelectionsPassing: parts.filter(source => source.candidateEvaluations?.some(candidate => candidate.selected && candidate.machineApproved)).length,
  }
}

async function migrateRetainedSourceRichPaths(root: string, source: any): Promise<any> {
  const clone = structuredClone(source)
  const copies = new Map<string, string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof item === 'string'
        && (key === 'path' || key.endsWith('Path'))
        && item.startsWith('asset-source/v0.2.0/')
      ) {
        const target = `asset-source/v0.3.0/retained-v0.2/source-rich/${item.slice('asset-source/v0.2.0/'.length)}`
        ;(value as Record<string, unknown>)[key] = target
        copies.set(target, item)
      } else visit(item)
    }
  }
  visit(clone)
  for (const [target, original] of copies) {
    const originalPath = join(root, original)
    const targetPath = join(root, target)
    const originalBytes = await readFile(originalPath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(originalPath, targetPath)
    if (!originalBytes.equals(await readFile(targetPath))) fail(`source-rich bytes changed while migrating ${original}`)
  }
  return clone
}

export async function mergeRetainedNonstructuralSourceIndex(root = process.cwd()): Promise<{
  retainedSources: number
  totalSources: number
}> {
  const v02 = JSON.parse(await readFile(
    join(root, 'packages/asset-catalog/source-index-v0.2.0.json'), 'utf8',
  )) as any
  const processedPath = join(root, 'asset-source/v0.3.0/production/processed-index.json')
  const processed = JSON.parse(await readFile(processedPath, 'utf8')) as any
  const plan = await planRetainedNonstructuralAssets(root)
  const ids = new Set(plan.parts.map(part => part.partId))
  const retained = []
  for (const source of (v02.sources ?? []).filter((candidate: any) => ids.has(candidate.sourceId))) {
    const part = plan.parts.find(candidate => candidate.partId === source.sourceId)!
    const migrated = await migrateRetainedSourceRichPaths(root, source)
    retained.push({
      ...migrated,
      catalogVersion: undefined,
      masterPath: `asset-source/v0.3.0/retained-v0.2/masters/${part.partId}.png`,
      runtimePngPath: `packages/asset-catalog/assets/v0.3.0/${part.pngPath}`,
      runtimeWebpPath: `packages/asset-catalog/assets/v0.3.0/${part.webpPath}`,
      retainedFrom: {
        catalogVersion: '0.2.0',
        masterPath: source.masterPath,
        masterSha256: source.masterSha256,
        runtimePngPath: source.runtimePngPath,
        runtimePngSha256: source.runtimePngSha256,
        runtimeWebpPath: source.runtimeWebpPath,
        runtimeWebpSha256: source.runtimeWebpSha256,
        provenancePath: 'asset-source/v0.3.0/provenance/retained-v0.2-nonstructural.json',
      },
    })
  }
  if (retained.length !== 31) fail(`expected 31 retained source records, got ${retained.length}`)
  const existing = (processed.sourceIndex?.sources ?? []).filter((source: any) => !ids.has(source.sourceId))
  const sources = [...existing, ...retained]
  processed.sourceIndex = {
    ...(processed.sourceIndex ?? {}),
    catalogVersion: '0.3.0',
    extractionGate: v02.extractionGate,
    immutablePromptTemplateSha256: v02.immutablePromptTemplateSha256,
    qualityGateSummary: qualityGateSummary(sources),
    sources,
  }
  await writeFile(processedPath, `${JSON.stringify(processed, null, 2)}\n`)
  await writeFile(
    join(root, 'packages/asset-catalog/source-index-v0.3.0.json'),
    `${JSON.stringify(processed.sourceIndex, null, 2)}\n`,
  )
  return { retainedSources: retained.length, totalSources: sources.length }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0
}

async function alphaStats(path: string): Promise<{
  width: number
  height: number
  bounds: Bounds | null
  centroid: Point
}> {
  const decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = decoded.info.width; let minY = decoded.info.height; let maxX = -1; let maxY = -1
  let mass = 0; let weightedX = 0; let weightedY = 0
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const alpha = decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3] ?? 0
      if (alpha === 0) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      mass += alpha; weightedX += x * alpha; weightedY += y * alpha
    }
  }
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    bounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    centroid: mass === 0
      ? { x: decoded.info.width / 2, y: decoded.info.height / 2 }
      : { x: weightedX / mass, y: weightedY / mass },
  }
}

async function addAlphaToUnion(
  path: string,
  placement: Point,
  union: Uint8Array,
  size: number,
  scale = 1,
): Promise<void> {
  const metadata = await sharp(path).metadata()
  const decoded = await sharp(path)
    .resize(Math.max(1, Math.round((metadata.width ?? size) * scale)), Math.max(1, Math.round((metadata.height ?? size) * scale)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const left = Math.round(placement.x); const top = Math.round(placement.y)
  for (let y = 0; y < decoded.info.height; y += 1) {
    const targetY = top + y
    if (targetY < 0 || targetY >= size) continue
    for (let x = 0; x < decoded.info.width; x += 1) {
      const targetX = left + x
      if (targetX < 0 || targetX >= size) continue
      const alpha = decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3] ?? 0
      const target = targetY * size + targetX
      if (alpha > (union[target] ?? 0)) union[target] = alpha
    }
  }
}

function statsForUnion(alpha: Uint8Array, size: number): { bounds: Bounds, centroid: Point, sha256: string } {
  let minX = size; let minY = size; let maxX = -1; let maxY = -1
  let mass = 0; let weightedX = 0; let weightedY = 0
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index] ?? 0
    if (value === 0) continue
    const x = index % size; const y = Math.floor(index / size)
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    mass += value; weightedX += x * value; weightedY += y * value
  }
  if (mass === 0) fail('structural union alpha is empty')
  return {
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    centroid: { x: Math.round(weightedX / mass), y: Math.round(weightedY / mass) },
    sha256: digest(alpha),
  }
}

function sourceVariantRecords(manifest: any): Array<any> {
  return (manifest.assets ?? []).flatMap((asset: any) => (
    Array.isArray(asset.variants)
      ? asset.variants.map((variant: any) => ({ ...variant, partId: asset.id, slotId: asset.slotId }))
      : [{ ...asset, partId: asset.id, slotId: asset.slotId }]
  ))
}

async function structuralUnionAlphaForBody(root: string, manifest: any, body: any): Promise<{
  alpha: Uint8Array
  contributorIds: string[]
}> {
  const size = 2048
  const union = new Uint8Array(size * size)
  const contributors: string[] = []
  const bodyNode = body.renderNodes[0]
  await addAlphaToUnion(join(root, bodyNode.sourcePngPath), { x: 0, y: 0 }, union, size)
  contributors.push(bodyNode.id)
  const variants = sourceVariantRecords(manifest)
  for (const slotId of ['headShape', 'arms', 'legs', 'tail', 'extraAppendage']) {
    const child = variants.find(item => item.slotId === slotId && item.rigId === body.rigId)
    if (child === undefined) fail(`missing ${body.rigId} ${slotId} variant for structural union`)
    for (const plug of child.connectors.filter((profile: any) => profile.role === 'plug')) {
      const receiver = body.connectors.find((profile: any) => profile.role === 'receiver' && profile.id === plug.id)
      const node = child.renderNodes.find((candidate: any) => candidate.connectorId === plug.id)
      if (receiver === undefined || node === undefined) fail(`missing ${body.partId}:${plug.id} union connector`)
      if (
        Math.abs(receiver.tangent.x - plug.tangent.x) > 0.001
        || Math.abs(receiver.tangent.y - plug.tangent.y) > 0.001
      ) fail(`rotated structural union contributor is unsupported: ${node.id}`)
      const scale = node.transform?.scale ?? 1
      if (node.transform?.mirrorX === true) fail(`mirrored structural union contributor is unsupported: ${node.id}`)
      await addAlphaToUnion(
        join(root, node.sourcePngPath),
        { x: receiver.origin.x - plug.origin.x * scale, y: receiver.origin.y - plug.origin.y * scale },
        union,
        size,
        scale,
      )
      contributors.push(node.id)
    }
  }
  return { alpha: union, contributorIds: contributors }
}

async function structuralUnionForBody(root: string, manifest: any, body: any): Promise<{
  bodyId: string
  rigId: RigId
  contributorIds: string[]
  structuralUnionSha256: string
  alphaBounds: Bounds
  socket: Point
}> {
  const union = await structuralUnionAlphaForBody(root, manifest, body)
  const stats = statsForUnion(union.alpha, 2048)
  return {
    bodyId: body.partId,
    rigId: body.rigId,
    contributorIds: union.contributorIds,
    structuralUnionSha256: stats.sha256,
    alphaBounds: stats.bounds,
    socket: stats.centroid,
  }
}

export async function buildRigStructuralUnionAlphaEvidence(
  root = process.cwd(),
  options: { dryRun?: boolean } = {},
): Promise<Array<{
  rigId: RigId
  bodyIds: string[]
  path: string
  pngSha256: string
  alphaBounds: Bounds
  alphaCentroid: Point
}>> {
  const manifest = JSON.parse(await readFile(join(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8')) as any
  const bodies = sourceVariantRecords(manifest).filter(item => item.slotId === 'bodyFrame')
  const evidence = []
  for (const rigId of ['blob', 'biped', 'floating'] as const) {
    const rigBodies = bodies.filter(body => body.rigId === rigId)
    const union = new Uint8Array(2048 * 2048)
    for (const body of rigBodies) {
      const bodyUnion = await structuralUnionAlphaForBody(root, manifest, body)
      for (let index = 0; index < union.length; index += 1) {
        if ((bodyUnion.alpha[index] ?? 0) > (union[index] ?? 0)) union[index] = bodyUnion.alpha[index]!
      }
    }
    const rgba = Buffer.alloc(union.length * 4)
    for (let pixel = 0; pixel < union.length; pixel += 1) {
      rgba[pixel * 4] = 255; rgba[pixel * 4 + 1] = 255; rgba[pixel * 4 + 2] = 255
      rgba[pixel * 4 + 3] = union[pixel]!
    }
    const png = await sharp(rgba, { raw: { width: 2048, height: 2048, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
    const path = `asset-source/v0.3.0/retained-v0.2/structural-union-alpha/${rigId}.png`
    if (!options.dryRun) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), png)
    }
    const stats = statsForUnion(union, 2048)
    evidence.push({
      rigId,
      bodyIds: rigBodies.map(body => body.partId),
      path,
      pngSha256: digest(png),
      alphaBounds: stats.bounds,
      alphaCentroid: stats.centroid,
    })
  }
  if (!options.dryRun) {
    const path = join(root, 'asset-source/v0.3.0/retained-v0.2/structural-union-alpha-index.json')
    await writeFile(path, `${JSON.stringify({
      schemaVersion: 'qmonster-structural-union-alpha-v1',
      catalogVersion: '0.3.0',
      construction: 'max-alpha union of five exact body reference compositions with head, limbs, tail, and extras',
      rigs: evidence,
    }, null, 2)}\n`)
  }
  return evidence
}

const RIGS: RigId[] = ['blob', 'biped', 'floating']
const FACE_SLOTS = new Set<RetainedSlotId>(['eyes', 'mouthShape', 'oralDetail', 'headAppendage'])

function nodeContract(slotId: RetainedSlotId): {
  parentSlot: string, socket: string, layer: string, clipPolicy: 'none' | 'body' | 'protect-face'
} {
  if (slotId === 'oralDetail') return { parentSlot: 'mouthShape', socket: 'oralDetail', layer: 'faceAndHeadwear', clipPolicy: 'none' }
  if (slotId === 'eyes' || slotId === 'mouthShape' || slotId === 'headAppendage') return {
    parentSlot: 'headShape', socket: slotId === 'mouthShape' ? 'mouth' : slotId,
    layer: 'faceAndHeadwear', clipPolicy: 'none',
  }
  if (slotId === 'effect') return { parentSlot: 'bodyFrame', socket: 'effect', layer: 'foregroundEffect', clipPolicy: 'protect-face' }
  return {
    parentSlot: 'bodyFrame', socket: 'overlay',
    layer: slotId === 'surfaceMaterial' ? 'surface' : 'pattern', clipPolicy: 'body',
  }
}

function faceScale(slotId: RetainedSlotId, bounds: Bounds, zones: Bounds[]): number {
  const width = median(zones.map(zone => zone.width))
  const height = median(zones.map(zone => zone.height))
  const factor = slotId === 'eyes' ? [0.82, 0.5]
    : slotId === 'mouthShape' ? [0.72, 0.48]
      : slotId === 'oralDetail' ? [0.36, 0.28]
        : [0.8, 0.75]
  return Math.max(0.05, Math.min(2, width * factor[0]! / bounds.width, height * factor[1]! / bounds.height))
}

export async function deriveRetainedCoordinateMetadata(
  root = process.cwd(),
): Promise<RetainedCoordinateMetadata> {
  const manifest = JSON.parse(await readFile(join(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8')) as any
  const variants = sourceVariantRecords(manifest)
  const headFeatureSockets = variants.filter(item => item.slotId === 'headShape').map(item => ({
    partId: item.partId,
    rigId: item.rigId as RigId,
    featureSockets: structuredClone(item.featureSockets),
    faceSafeZones: structuredClone(item.faceSafeZones),
  }))
  if (headFeatureSockets.length !== 12 || headFeatureSockets.some(item => (
    item.featureSockets === undefined || !Array.isArray(item.faceSafeZones)
  ))) fail('expected 12 exact head feature socket records')
  const bodyVariants = variants.filter(item => item.slotId === 'bodyFrame')
  const bodyStructuralUnions = await Promise.all(bodyVariants.map(body => structuralUnionForBody(root, manifest, body)))
  if (bodyStructuralUnions.length !== 5) fail(`expected five body structural unions, got ${bodyStructuralUnions.length}`)
  const plan = await planRetainedNonstructuralAssets(root)
  const fileByPartFormat = new Map(plan.files.map(item => [`${item.partId}:${item.format}`, item]))
  const parts: RetainedCoordinateMetadata['parts'] = []
  for (const part of plan.parts) {
    const png = fileByPartFormat.get(`${part.partId}:png`)!; const webp = fileByPartFormat.get(`${part.partId}:webp`)!
    const stats = await alphaStats(join(root, png.v03RuntimePath))
    const isNone = part.isNone
    const renderNodes: RetainedRenderNodeMetadata[] = []
    if (!isNone) for (const rigId of RIGS) {
      const contract = nodeContract(part.slotId)
      const zones = headFeatureSockets.filter(item => item.rigId === rigId).flatMap(item => item.faceSafeZones)
      const rigUnions = bodyStructuralUnions.filter(item => item.rigId === rigId)
      const scale = FACE_SLOTS.has(part.slotId)
        ? faceScale(part.slotId, stats.bounds!, zones)
        : Math.min(
            median(rigUnions.map(item => item.alphaBounds.width)) / stats.width,
            median(rigUnions.map(item => item.alphaBounds.height)) / stats.height,
          )
      const sourceIsFace = FACE_SLOTS.has(part.slotId)
      renderNodes.push({
        id: `${part.partId}_${rigId}`,
        assetPath: part.webpPath,
        pngPath: part.pngPath,
        assetSha256: webp.v02Sha256,
        pngSha256: png.v02Sha256,
        ...contract,
        origin: sourceIsFace
          ? { x: Math.round(stats.centroid.x), y: Math.round(stats.centroid.y) }
          : { x: stats.width / 2, y: stats.height / 2 },
        transform: { scale, mirrorX: false },
        compatibleRigs: [rigId],
        coordinateSource: sourceIsFace ? 'v0.3-feature-socket+retained-alpha' : 'v0.3-structural-union-alpha',
      })
    }
    const geometryByRig = part.slotId === 'mouthShape' && !isNone
      ? Object.fromEntries(RIGS.map(rigId => [rigId, {
          sockets: { oralDetail: { x: Math.round(stats.centroid.x), y: Math.round(stats.centroid.y) } },
        }]))
      : {}
    parts.push({ partId: part.partId, slotId: part.slotId, isNone, renderNodes, geometryByRig })
  }
  return {
    schemaVersion: 'qmonster-retained-coordinate-v1',
    headFeatureSockets,
    bodyStructuralUnions,
    parts,
  }
}

export async function applyRetainedCoordinateMetadata(
  root = process.cwd(),
  options: { dryRun?: boolean } = {},
): Promise<{ parts: number, renderNodes: number, headFeatureSockets: number, bodyStructuralUnions: number }> {
  const metadata = await deriveRetainedCoordinateMetadata(root)
  if (!options.dryRun) {
    await buildRigStructuralUnionAlphaEvidence(root)
    const metadataPath = join(root, 'asset-source/v0.3.0/retained-v0.2/coordinate-metadata.json')
    await mkdir(dirname(metadataPath), { recursive: true })
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    const manifestPath = join(root, 'asset-source/v0.3.0/interface-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as any
    const unionByBodyRig = new Map(metadata.bodyStructuralUnions.map(item => [`${item.bodyId}:${item.rigId}`, item]))
    for (const asset of manifest.assets ?? []) {
      if (asset.slotId !== 'bodyFrame') continue
      const variants = Array.isArray(asset.variants) ? asset.variants : [asset]
      for (const variant of variants) {
        const union = unionByBodyRig.get(`${asset.id}:${variant.rigId}`)
        if (union === undefined) fail(`missing structural union for ${asset.id}:${variant.rigId}`)
        variant.featureSockets = { ...(variant.featureSockets ?? {}), overlay: union.socket, effect: union.socket }
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return {
    parts: metadata.parts.length,
    renderNodes: metadata.parts.flatMap(part => part.renderNodes).length,
    headFeatureSockets: metadata.headFeatureSockets.length,
    bodyStructuralUnions: metadata.bodyStructuralUnions.length,
  }
}

const direct = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (direct) {
  if (process.argv.slice(2).join(' ') !== '--version 0.3.0') {
    throw new Error('Usage: tsx scripts/retain-v02-nonstructural-assets.ts --version 0.3.0')
  }
  const retained = await retainV02NonstructuralAssets()
  const coordinates = await applyRetainedCoordinateMetadata()
  const sourceIndex = await mergeRetainedNonstructuralSourceIndex()
  console.log(JSON.stringify({ ...retained, coordinates, sourceIndex }))
}
