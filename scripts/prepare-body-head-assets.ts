import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { processInterfaceAsset } from './process-interface-asset.js'

const ROOT = process.cwd()
const SOURCE_ROOT = join(ROOT, 'asset-source', 'v0.3.0')
const CATALOG_ROOT = join(ROOT, 'packages', 'asset-catalog')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const RIGS = ['blob', 'biped', 'floating'] as const
type RigId = typeof RIGS[number]
type Point = { x: number, y: number }
type Rect = { x: number, y: number, width: number, height: number }

const selections = [
  ['blob', 'body_blob_round', 1, 'bodyFrame'],
  ['blob', 'body_blob_wide', 1, 'bodyFrame'],
  ['floating', 'body_floating_drop', 1, 'bodyFrame'],
  ['biped', 'head_round_dome', 1, 'headShape'],
  ['biped', 'head_angler_bulb', 1, 'headShape'],
  ['biped', 'head_shadow_hood', 1, 'headShape'],
  ['blob', 'head_round_dome', 2, 'headShape'],
  ['blob', 'head_mushroom_cap', 2, 'headShape'],
  ['blob', 'head_angler_bulb', 3, 'headShape'],
  ['blob', 'head_shadow_hood', 1, 'headShape'],
  ['floating', 'head_round_dome', 1, 'headShape'],
  ['floating', 'head_mushroom_cap', 1, 'headShape'],
  ['floating', 'head_angler_bulb', 1, 'headShape'],
  ['floating', 'head_shadow_hood', 1, 'headShape'],
] as const

const faceSafeZone: Record<RigId, Rect> = {
  biped: { x: 790, y: 1050, width: 468, height: 300 },
  blob: { x: 770, y: 1020, width: 508, height: 320 },
  floating: { x: 800, y: 1050, width: 448, height: 290 },
}
const featureSockets: Record<RigId, Record<string, Point>> = {
  biped: { eyes: { x: 1024, y: 1160 }, mouth: { x: 1024, y: 1310 }, headAppendage: { x: 1024, y: 940 } },
  blob: { eyes: { x: 1024, y: 1150 }, mouth: { x: 1024, y: 1300 }, headAppendage: { x: 1024, y: 920 } },
  floating: { eyes: { x: 1024, y: 1160 }, mouth: { x: 1024, y: 1300 }, headAppendage: { x: 1024, y: 940 } },
}

const neckProfiles: Record<RigId, { origin: Point, width: number, depth: number }> = {
  biped: { origin: { x: 1024, y: 1460 }, width: 310, depth: 180 },
  blob: { origin: { x: 1024, y: 1420 }, width: 400, depth: 200 },
  floating: { origin: { x: 1024, y: 1430 }, width: 300, depth: 180 },
}

const bodyProfiles: Record<string, { neck: { origin: Point, width: number, depth: number }, shoulderY: number, shoulderX: [number, number], hipY: number, hipX: [number, number] }> = {
  body_blob_round: { neck: { origin: { x: 1024, y: 620 }, width: 400, depth: 200 }, shoulderY: 930, shoulderX: [600, 1448], hipY: 1200, hipX: [820, 1228] },
  body_blob_wide: { neck: { origin: { x: 1024, y: 620 }, width: 400, depth: 200 }, shoulderY: 870, shoulderX: [500, 1548], hipY: 1080, hipX: [800, 1248] },
  body_floating_drop: { neck: { origin: { x: 1024, y: 520 }, width: 300, depth: 180 }, shoulderY: 900, shoulderX: [650, 1398], hipY: 1260, hipX: [860, 1188] },
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return hash(await readFile(path)) }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function largestAlphaComponent(input: Buffer): Promise<Buffer> {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const count = width * height
  const labels = new Int32Array(count)
  const queue = new Int32Array(count)
  const masses: number[] = [0]
  let label = 0
  for (let first = 0; first < count; first += 1) {
    if (labels[first] !== 0 || decoded.data[first * 4 + 3] === 0) continue
    label += 1; labels[first] = label; queue[0] = first
    let queued = 1; let mass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!; mass += decoded.data[current * 4 + 3]!
      const x = current % width; const y = Math.floor(current / width)
      for (const next of [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1]) {
        if (next < 0 || labels[next] !== 0 || decoded.data[next * 4 + 3] === 0) continue
        labels[next] = label; queue[queued++] = next
      }
    }
    masses[label] = mass
  }
  let keep = 0
  for (let index = 1; index < masses.length; index += 1) if ((masses[index] ?? 0) > (masses[keep] ?? 0)) keep = index
  for (let pixel = 0; pixel < count; pixel += 1) if (labels[pixel] !== keep) decoded.data[pixel * 4 + 3] = 0
  return sharp(decoded.data, { raw: { width, height, channels: 4 } }).png(PNG).toBuffer()
}

async function extractChecker(sourcePath: string, outputPath: string) {
  const bytes = await readFile(sourcePath)
  const meta = await sharp(bytes).metadata()
  const decoded = await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(decoded.info.width * decoded.info.height * 4)
  let boundaryAlphaPixels = 0; let partialAlphaPixels = 0; let subjectPixels = 0
  for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
    const pixel = y * decoded.info.width + x; const i3 = pixel * 3; const i4 = pixel * 4
    const r = decoded.data[i3]!; const g = decoded.data[i3 + 1]!; const b = decoded.data[i3 + 2]!
    const low = Math.min(r, g, b); const neutral = Math.max(r, g, b) - low
    let alpha = 255
    if (neutral <= 10 && low >= 236) alpha = 0
    else if (neutral <= 14 && low >= 218) alpha = Math.round(255 * (236 - low) / 18)
    if (x < 8 || y < 8 || x >= decoded.info.width - 8 || y >= decoded.info.height - 8) alpha = 0
    rgba[i4] = r; rgba[i4 + 1] = g; rgba[i4 + 2] = b; rgba[i4 + 3] = alpha
    if (alpha > 0) subjectPixels += 1
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1
    if ((x === 0 || y === 0 || x === decoded.info.width - 1 || y === decoded.info.height - 1) && alpha > 0) boundaryAlphaPixels += 1
  }
  const cleaned = await largestAlphaComponent(await sharp(rgba, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } }).png(PNG).toBuffer())
  await mkdir(dirname(outputPath), { recursive: true }); await sharp(cleaned).png(PNG).toFile(outputPath)
  return { inputHasAlpha: meta.hasAlpha ?? false, width: decoded.info.width, height: decoded.info.height, boundaryAlphaPixels, partialAlphaPixels, subjectCoverage: subjectPixels / (decoded.info.width * decoded.info.height), sourceSha256: hash(bytes), rgbaSha256: await hashFile(outputPath) }
}

async function normalized(candidate: string, rigId: RigId, slotId: string): Promise<Buffer> {
  const trimmed = await sharp(candidate).trim({ background: '#00000000' }).png(PNG).toBuffer()
  const isHead = slotId === 'headShape'
  const size = isHead
    ? (rigId === 'blob' ? { width: 850, height: 720, bottom: 1580 }
      : rigId === 'biped' ? { width: 650, height: 540, bottom: 1580 }
        : { width: 680, height: 560, bottom: 1580 })
    : candidate.includes('body_blob_wide') ? { width: 1450, height: 800, bottom: 1200 }
      : candidate.includes('body_floating_drop') ? { width: 950, height: 1000, bottom: 1400 }
        : { width: 1250, height: 950, bottom: 1320 }
  const resized = await sharp(trimmed).resize(size.width, size.height, { fit: 'inside', withoutEnlargement: false }).png(PNG).toBuffer({ resolveWithObject: true })
  const left = Math.round((2048 - resized.info.width) / 2)
  const top = size.bottom - resized.info.height
  return sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: resized.data, left, top }]).png(PNG).toBuffer()
}

function band(profile: any): Buffer {
  const alpha = Buffer.alloc(2048 * 2048)
  const tangentLimit = profile.width * (profile.role === 'plug' ? 0.25 : 0.4)
  const normalLimit = profile.depth * (profile.role === 'plug' ? 0.35 : 0.48)
  for (let y = 0; y < 2048; y += 1) for (let x = 0; x < 2048; x += 1) {
    const dx = x + 0.5 - profile.origin.x; const dy = y + 0.5 - profile.origin.y
    const tangent = dx * profile.tangent.x + dy * profile.tangent.y
    const normal = dx * profile.outwardNormal.x + dy * profile.outwardNormal.y
    if (Math.abs(tangent) <= tangentLimit && Math.abs(normal) <= normalLimit) alpha[y * 2048 + x] = 255
  }
  return alpha
}

async function maskPng(alpha: Buffer): Promise<Buffer> {
  return sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width: 2048, height: 2048, channels: 1 } }).png(PNG).toBuffer()
}

function connector(id: string, role: 'receiver' | 'plug', rigId: RigId, partId: string, origin: Point, tangent: Point, outwardNormal: Point, width: number, depth: number) {
  const base = `assets/v0.3.0/connectors/${rigId}/${partId}-${id}`
  return { id, role, connectorClass: id === 'neck' ? 'neck' : id.startsWith('shoulder') ? 'shoulder' : 'hip', origin, tangent, outwardNormal, width, depth, contourMaskPath: `${base}-contour.png`, foregroundMaskPath: `${base}-foreground.png`, backgroundMaskPath: `${base}-background.png`, materialSampleRegion: { x: 896, y: 896, width: 256, height: 256 }, warpLimits: { widthRatio: { min: 0.85, max: 1.15 }, depthRatio: { min: 0.8, max: 1.2 }, rotationDegrees: { min: -12, max: 12 } } }
}

function profilesFor(rigId: RigId, partId: string, slotId: string) {
  if (slotId === 'headShape') {
    const p = neckProfiles[rigId]
    return [connector('neck', 'plug', rigId, partId, p.origin, { x: 1, y: 0 }, { x: 0, y: 1 }, p.width, p.depth)]
  }
  const p = bodyProfiles[partId]!
  return [
    connector('neck', 'receiver', rigId, partId, p.neck.origin, { x: 1, y: 0 }, { x: 0, y: -1 }, p.neck.width, p.neck.depth),
    connector('shoulderLeft', 'receiver', rigId, partId, { x: p.shoulderX[0], y: p.shoulderY }, { x: 0, y: 1 }, { x: -1, y: 0 }, 220, 120),
    connector('shoulderRight', 'receiver', rigId, partId, { x: p.shoulderX[1], y: p.shoulderY }, { x: 0, y: 1 }, { x: 1, y: 0 }, 220, 120),
    connector('hipLeft', 'receiver', rigId, partId, { x: p.hipX[0], y: p.hipY }, { x: 1, y: 0 }, { x: 0, y: 1 }, 220, 120),
    connector('hipRight', 'receiver', rigId, partId, { x: p.hipX[1], y: p.hipY }, { x: 1, y: 0 }, { x: 0, y: 1 }, 220, 120),
  ]
}

async function writeMasks(rigId: RigId, partId: string, slotId: string, profiles: any[], nodePath: string) {
  const node = await sharp(nodePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const nodeAlpha = Buffer.alloc(2048 * 2048)
  for (let pixel = 0; pixel < nodeAlpha.length; pixel += 1) nodeAlpha[pixel] = node.data[pixel * 4 + 3]! > 0 ? 255 : 0
  const inputs: any[] = []
  for (const profile of profiles) {
    const contour = band(profile)
    let foreground = Buffer.from(contour); let background = Buffer.from(contour)
    if (slotId === 'headShape') {
      foreground = Buffer.from(nodeAlpha); background = Buffer.alloc(nodeAlpha.length)
      const tip = profile.origin.y - profile.depth * 0.35
      for (let y = 0; y < 2048; y += 1) for (let x = 0; x < 2048; x += 1) {
        const pixel = y * 2048 + x
        if (nodeAlpha[pixel] === 0) continue
        const dx = x + 0.5 - profile.origin.x
        if (Math.abs(dx) <= profile.width * 0.52 && y >= tip) { foreground[pixel] = 0; background[pixel] = 255 }
      }
    } else {
      foreground = Buffer.alloc(contour.length); background = Buffer.alloc(contour.length)
      for (let y = 0; y < 2048; y += 1) for (let x = 0; x < 2048; x += 1) {
        const pixel = y * 2048 + x
        if (contour[pixel] === 0) continue
        if ((x + y) % 2 === 0) foreground[pixel] = 255
        else background[pixel] = 255
      }
    }
    for (const [kind, alpha] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
      const bytes = await maskPng(alpha)
      const runtime = resolve(CATALOG_ROOT, profile[`${kind}MaskPath`])
      const source = join(SOURCE_ROOT, 'masks', rigId, partId, `${profile.id}-${kind}.png`)
      await mkdir(dirname(runtime), { recursive: true }); await mkdir(dirname(source), { recursive: true })
      await writeFile(runtime, bytes); await writeFile(source, bytes)
    }
    inputs.push({ id: profile.id, contourMaskPath: resolve(CATALOG_ROOT, profile.contourMaskPath), foregroundMaskPath: resolve(CATALOG_ROOT, profile.foregroundMaskPath), backgroundMaskPath: resolve(CATALOG_ROOT, profile.backgroundMaskPath), ...(slotId === 'headShape' ? { role: 'plug', nodeLayer: 'head', occlusionNodePath: nodePath, origin: profile.origin, outwardNormal: profile.outwardNormal, depth: profile.depth, faceSafeZones: [faceSafeZone[rigId]] } : {}) })
  }
  return inputs
}

async function writeRuntimeNode(source: string, base: string) {
  const pngFs = resolve(CATALOG_ROOT, `${base}.png`); const webpFs = resolve(CATALOG_ROOT, `${base}.webp`)
  await mkdir(dirname(pngFs), { recursive: true }); await sharp(source).png(PNG).toFile(pngFs); await sharp(source).webp({ lossless: true, effort: 6 }).toFile(webpFs)
  return { pngPath: `${base}.png`, pngSha256: await hashFile(pngFs), webpPath: `${base}.webp`, webpSha256: await hashFile(webpFs) }
}

async function prepareVariant(rigId: RigId, partId: string, selected: number, slotId: string, promptEvidence: any) {
  const candidatePath = join(SOURCE_ROOT, 'generation', 'task7-candidates', rigId, partId, `candidate-${selected}.png`)
  const extractedPath = join(SOURCE_ROOT, 'generation', 'task7-extracted', rigId, `${partId}.png`)
  const extraction = await extractChecker(candidatePath, extractedPath)
  const sourcePngPath = `asset-source/v0.3.0/structural/${rigId}/${partId}.png`
  const sourceFs = resolve(ROOT, sourcePngPath)
  await mkdir(dirname(sourceFs), { recursive: true }); await writeFile(sourceFs, await normalized(extractedPath, rigId, slotId))
  const nodeId = `${partId}-${rigId}-${slotId === 'headShape' ? 'neck' : 'body'}`
  const nodeSourcePngPath = `asset-source/v0.3.0/structural/${rigId}/nodes/${partId}/${slotId === 'headShape' ? 'neck' : 'body'}.png`
  const nodeFs = resolve(ROOT, nodeSourcePngPath)
  await mkdir(dirname(nodeFs), { recursive: true }); await copyFile(sourceFs, nodeFs)
  const profiles = profilesFor(rigId, partId, slotId)
  const maskInputs = await writeMasks(rigId, partId, slotId, profiles, nodeFs)
  const runtimeBase = `assets/v0.3.0/structural/${rigId}/${partId}`
  const processed = await processInterfaceAsset({ sourcePath: sourceFs, outputPngPath: resolve(CATALOG_ROOT, `${runtimeBase}.png`), outputWebpPath: resolve(CATALOG_ROOT, `${runtimeBase}.webp`), connectors: maskInputs, materialSampleRegion: profiles[0].materialSampleRegion })
  const nodeRuntimeBase = `assets/v0.3.0/structural/${rigId}/nodes/${partId}/${slotId === 'headShape' ? 'neck' : 'body'}`
  const renderNode = await writeRuntimeNode(nodeFs, nodeRuntimeBase)
  return {
    variant: { rigId, materialFamily: partId.includes('mushroom') ? 'mushroom-velvet' : 'short-fur', sourcePngPath, promptEvidence, connectors: profiles, renderNodes: [{ id: nodeId, ...(slotId === 'headShape' ? { connectorId: 'neck' } : {}), sourcePngPath: nodeSourcePngPath }], ...(slotId === 'headShape' ? { faceSafeZones: [faceSafeZone[rigId]], featureSockets: featureSockets[rigId] } : {}) },
    processed: { pngPath: `${runtimeBase}.png`, pngSha256: processed.pngSha256, webpPath: `${runtimeBase}.webp`, webpSha256: processed.webpSha256, renderNodes: { [nodeId]: renderNode }, connectorHashes: processed.connectorHashes },
    evidence: { candidatePaths: Array.from({ length: selected }, (_, index) => `asset-source/v0.3.0/generation/task7-candidates/${rigId}/${partId}/candidate-${index + 1}.png`), selectedCandidate: selected, selectedReason: 'Passed original-size identity and organic connector review; no flat cut, pedestal, notch, or baked facial features.', extraction, connectorCoverage: processed.connectorCoverage },
  }
}

function flatToGroups(manifest: any) {
  if (manifest.assets.every((asset: any) => Array.isArray(asset.variants))) return manifest.assets
  const groups = new Map<string, any>()
  for (const asset of manifest.assets) {
    const { id, slotId, ...variant } = asset
    const group = groups.get(id) ?? { id, slotId, variants: [] }
    group.variants.push(variant); groups.set(id, group)
  }
  return [...groups.values()]
}

async function copyBridge(rigId: 'blob' | 'floating', connectorClass: 'neck' | 'shoulder' | 'hip', manifest: any, processedIndex: any) {
  const old = manifest.bridges.find((item: any) => item.rigId === 'biped' && item.connectorClass === connectorClass)
  const bridge = { ...old, id: `${rigId}-${connectorClass}-bridge`, rigId, neutralPngPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.png`, neutralWebpPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}.webp`, frontMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-front.png`, backMaskPath: `assets/v0.3.0/bridges/${rigId}/${connectorClass}-back.png` }
  for (const [field, sourceField] of [['neutralPngPath', 'neutralPngPath'], ['neutralWebpPath', 'neutralWebpPath'], ['frontMaskPath', 'frontMaskPath'], ['backMaskPath', 'backMaskPath']] as const) {
    const target = resolve(CATALOG_ROOT, bridge[field]); await mkdir(dirname(target), { recursive: true }); await copyFile(resolve(CATALOG_ROOT, old[sourceField]), target)
  }
  const p = processedIndex.processedBridges[connectorClass]
  processedIndex.processedBridges[`${rigId}:${connectorClass}`] = { ...p }
  return bridge
}

async function main() {
  const manifestPath = join(SOURCE_ROOT, 'interface-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.assets = flatToGroups(manifest)
  manifest.rigIds = [...RIGS]; delete manifest.rigId
  const retainedMushroom = manifest.assets.find((asset: any) => asset.id === 'head_mushroom_cap')?.variants.find((variant: any) => variant.rigId === 'biped')
  if (retainedMushroom === undefined) throw new Error('Retained approved biped mushroom head is missing.')
  retainedMushroom.faceSafeZones = [faceSafeZone.biped]
  retainedMushroom.featureSockets = featureSockets.biped
  const promptPath = join(SOURCE_ROOT, 'prompts', 'task7-body-head-prompts.json')
  const promptSha256 = await hashFile(promptPath)
  const reviewRecordPath = 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json'
  const promptEvidence = { promptId: 'task7-body-head-connection-aware', promptPath: 'asset-source/v0.3.0/prompts/task7-body-head-prompts.json', promptSha256, reviewRecordPath }
  const processedPath = join(SOURCE_ROOT, 'production', 'processed-index.json')
  const processedIndex = JSON.parse(await readFile(processedPath, 'utf8'))
  const productionEvidence: any = { schemaVersion: 'body-head-production-v1', generator: 'built-in-image_gen', initialCandidateCalls: 14, targetedRegenerationCalls: 4, assets: {}, matrices: {} }
  for (const [rigId, partId, selected, slotId] of selections) {
    const result = await prepareVariant(rigId, partId, selected, slotId, promptEvidence).catch((caught: unknown) => {
      throw new Error(`${partId}:${rigId}: ${caught instanceof Error ? caught.message : String(caught)}`)
    })
    let group = manifest.assets.find((asset: any) => asset.id === partId)
    if (group === undefined) { group = { id: partId, slotId, variants: [] }; manifest.assets.push(group) }
    group.variants = group.variants.filter((variant: any) => variant.rigId !== rigId)
    group.variants.push(result.variant)
    processedIndex.processedAssets[`${partId}:${rigId}`] = result.processed
    productionEvidence.assets[`${partId}:${rigId}`] = result.evidence
  }
  for (const rigId of ['blob', 'floating'] as const) for (const connectorClass of ['neck', 'shoulder', 'hip'] as const) {
    manifest.bridges = manifest.bridges.filter((item: any) => !(item.rigId === rigId && item.connectorClass === connectorClass))
    manifest.bridges.push(await copyBridge(rigId, connectorClass, manifest, processedIndex))
  }
  manifest.schemaVersion = 'interface-source-v2'
  await writeJson(manifestPath, manifest)
  await writeJson(join(SOURCE_ROOT, 'generation', 'production-evidence.json'), productionEvidence)
  await writeJson(resolve(CATALOG_ROOT, reviewRecordPath.replace(/^packages\/asset-catalog\//u, '')), { schemaVersion: 'body-head-self-review-v1', status: 'WAITING_FOR_USER_APPROVAL', reviewer: 'Codex visual self-review', userApproved: false, selections: Object.fromEntries(selections.map(([rigId, id, selected]) => [`${id}:${rigId}`, selected])) })
  const reviewHash = await hashFile(resolve(CATALOG_ROOT, reviewRecordPath.replace(/^packages\/asset-catalog\//u, '')))
  const sources = []
  for (const asset of manifest.assets) for (const variant of asset.variants) sources.push({ sourceId: `${asset.id}:${variant.rigId}`, kind: 'interface-structural', promptId: variant.promptEvidence.promptId, promptPath: variant.promptEvidence.promptPath, promptSha256: variant.promptEvidence.promptSha256, reviewRecordPath: variant.promptEvidence.reviewRecordPath, reviewRecordSha256: variant.promptEvidence.reviewRecordPath === reviewRecordPath ? reviewHash : await hashFile(resolve(ROOT, variant.promptEvidence.reviewRecordPath)), sourceResources: await Promise.all([...new Set([variant.sourcePngPath, ...variant.renderNodes.map((node: any) => node.sourcePngPath)])].map(async path => ({ path, sha256: await hashFile(resolve(ROOT, path)) }))) })
  for (const bridge of manifest.bridges) sources.push({ sourceId: bridge.id, kind: 'interface-bridge', promptId: bridge.promptEvidence.promptId, promptPath: bridge.promptEvidence.promptPath, promptSha256: bridge.promptEvidence.promptSha256, reviewRecordPath: bridge.promptEvidence.reviewRecordPath, reviewRecordSha256: await hashFile(resolve(ROOT, bridge.promptEvidence.reviewRecordPath)), sourceResources: [{ path: bridge.sourcePngPath, sha256: await hashFile(resolve(ROOT, bridge.sourcePngPath)) }] })
  processedIndex.sourceIndex = { catalogVersion: '0.3.0', sources }
  await writeJson(processedPath, processedIndex)
  console.log(JSON.stringify({ processed: selections.length, manifestAssets: manifest.assets.length }))
}

await main()
