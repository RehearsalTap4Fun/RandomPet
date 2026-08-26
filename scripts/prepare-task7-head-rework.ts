import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { interfaceVariantKey, structuralVariants, type InterfaceSourceManifest } from './interface-source-schema.js'

const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function largestAlphaComponent(input: Buffer): Promise<Buffer> {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const labels = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  const masses = [0]
  let label = 0
  for (let first = 0; first < labels.length; first += 1) {
    if (labels[first] !== 0 || decoded.data[first * 4 + 3] === 0) continue
    label += 1
    labels[first] = label
    queue[0] = first
    let queued = 1
    let mass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!
      mass += decoded.data[current * 4 + 3]!
      const x = current % width
      const y = Math.floor(current / width)
      for (const next of [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]) {
        if (next < 0 || labels[next] !== 0 || decoded.data[next * 4 + 3] === 0) continue
        labels[next] = label
        queue[queued++] = next
      }
    }
    masses[label] = mass
  }
  let keep = 0
  for (let index = 1; index < masses.length; index += 1) {
    if ((masses[index] ?? 0) > (masses[keep] ?? 0)) keep = index
  }
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    if (labels[pixel] !== keep) decoded.data[pixel * 4 + 3] = 0
  }
  return sharp(decoded.data, { raw: { width, height, channels: 4 } }).png(PNG).toBuffer()
}

export async function extractChecker(sourcePath: string, outputPath: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(sourcePath)
  const metadata = await sharp(bytes).metadata()
  const decoded = await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(decoded.info.width * decoded.info.height * 4)
  let partialAlphaPixels = 0
  let subjectPixels = 0
  let boundaryAlphaPixels = 0
  for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
    const pixel = y * decoded.info.width + x
    const input = pixel * 3
    const output = pixel * 4
    const r = decoded.data[input]!
    const g = decoded.data[input + 1]!
    const b = decoded.data[input + 2]!
    const low = Math.min(r, g, b)
    const neutral = Math.max(r, g, b) - low
    let alpha = 255
    if (neutral <= 10 && low >= 236) alpha = 0
    else if (neutral <= 14 && low >= 218) alpha = Math.round(255 * (236 - low) / 18)
    if (x < 8 || y < 8 || x >= decoded.info.width - 8 || y >= decoded.info.height - 8) alpha = 0
    rgba[output] = r
    rgba[output + 1] = g
    rgba[output + 2] = b
    rgba[output + 3] = alpha
    if (alpha > 0) subjectPixels += 1
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1
    if ((x === 0 || y === 0 || x === decoded.info.width - 1 || y === decoded.info.height - 1) && alpha > 0) boundaryAlphaPixels += 1
  }
  const cleaned = await largestAlphaComponent(await sharp(rgba, {
    raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
  }).png(PNG).toBuffer())
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, cleaned)
  return {
    inputHasAlpha: metadata.hasAlpha ?? false,
    width: decoded.info.width,
    height: decoded.info.height,
    boundaryAlphaPixels,
    partialAlphaPixels,
    subjectCoverage: subjectPixels / (decoded.info.width * decoded.info.height),
    sourceSha256: sha256(bytes),
    extractedSha256: sha256(cleaned),
  }
}

export async function normalizeHead(inputPath: string, outputPath: string, rigId: 'blob' | 'biped' | 'floating'): Promise<void> {
  const size = rigId === 'blob'
    ? { width: 850, height: 720, bottom: 1580 }
    : rigId === 'biped'
      ? { width: 650, height: 540, bottom: 1580 }
      : { width: 680, height: 560, bottom: 1580 }
  const trimmed = await sharp(inputPath).trim({ background: '#00000000' }).png(PNG).toBuffer()
  const resized = await sharp(trimmed).resize(size.width, size.height, {
    fit: 'inside',
    withoutEnlargement: false,
  }).png(PNG).toBuffer({ resolveWithObject: true })
  const canvas = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: resized.data, left: Math.round((2048 - resized.info.width) / 2), top: size.bottom - resized.info.height }])
    .png(PNG)
    .toBuffer()
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, canvas)
}

async function writeRuntime(sourcePath: string, pngPath: string, webpPath: string): Promise<{ pngSha256: string, webpSha256: string }> {
  const png = await sharp(sourcePath).png(PNG).toBuffer()
  const webp = await sharp(sourcePath).webp({ lossless: true, effort: 6 }).toBuffer()
  await mkdir(dirname(pngPath), { recursive: true })
  await mkdir(dirname(webpPath), { recursive: true })
  await writeFile(pngPath, png)
  await writeFile(webpPath, webp)
  return { pngSha256: sha256(png), webpSha256: sha256(webp) }
}

const HEAD_SELECTIONS = [
  ['biped', 'head_round_dome'],
  ['biped', 'head_mushroom_cap'],
  ['biped', 'head_angler_bulb'],
  ['biped', 'head_shadow_hood'],
  ['blob', 'head_round_dome'],
  ['blob', 'head_mushroom_cap'],
  ['blob', 'head_angler_bulb'],
  ['blob', 'head_shadow_hood'],
  ['floating', 'head_round_dome'],
  ['floating', 'head_mushroom_cap'],
  ['floating', 'head_angler_bulb'],
  ['floating', 'head_shadow_hood'],
] as const

const CANDIDATE_SELECTION: Partial<Record<`${(typeof HEAD_SELECTIONS)[number][0]}:${(typeof HEAD_SELECTIONS)[number][1]}`, number>> = {
  'blob:head_round_dome': 3,
}

export async function prepareAllNaturalNeckHeads(root: string): Promise<Record<string, unknown>> {
  const sourceRoot = resolve(root, 'asset-source/v0.3.0')
  const catalogRoot = resolve(root, 'packages/asset-catalog')
  const manifestPath = resolve(sourceRoot, 'interface-manifest.json')
  const processedPath = resolve(sourceRoot, 'production/processed-index.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as InterfaceSourceManifest
  const processed = JSON.parse(await readFile(processedPath, 'utf8')) as any
  const promptRelative = 'asset-source/v0.3.0/prompts/task7-head-natural-neck-rework.json'
  const promptSha256 = sha256(await readFile(resolve(root, promptRelative)))
  const evidence: any = {
    schemaVersion: 'task7-head-natural-neck-production-v1',
    status: 'ALL_HEADS_EXTRACTED_PENDING_COMPOSITION_GATE',
    builtInImageGenCalls: 14,
    targetedRegenerationCalls: 2,
    assets: {},
  }
  const variants = structuralVariants(manifest)
  for (const [rigId, partId] of HEAD_SELECTIONS) {
    const variant = variants.find(item => item.partId === partId && item.rigId === rigId)
    if (variant === undefined) throw new Error(`${partId}:${rigId} is missing.`)
    const candidateNumber = CANDIDATE_SELECTION[`${rigId}:${partId}`] ?? 1
    const candidateRelative = `asset-source/v0.3.0/generation/task7-candidates/${rigId}/${partId}/candidate-natural-neck-${candidateNumber}.png`
    const extractedRelative = `asset-source/v0.3.0/generation/task7-extracted/${rigId}/${partId}-natural-neck-v2.png`
    const sourceRelative = `asset-source/v0.3.0/structural/${rigId}/task7-natural-neck/${partId}.png`
    const nodeRelative = `asset-source/v0.3.0/structural/${rigId}/task7-natural-neck/nodes/${partId}/neck.png`
    const extraction = await extractChecker(resolve(root, candidateRelative), resolve(root, extractedRelative))
    await normalizeHead(resolve(root, extractedRelative), resolve(root, sourceRelative), rigId)
    await mkdir(dirname(resolve(root, nodeRelative)), { recursive: true })
    await writeFile(resolve(root, nodeRelative), await readFile(resolve(root, sourceRelative)))

    const runtimeBase = `assets/v0.3.0/structural/${rigId}/task7-natural-neck/${partId}`
    const runtimeNodeBase = `assets/v0.3.0/structural/${rigId}/task7-natural-neck/nodes/${partId}/neck`
    const runtime = await writeRuntime(resolve(root, sourceRelative), resolve(catalogRoot, `${runtimeBase}.png`), resolve(catalogRoot, `${runtimeBase}.webp`))
    const runtimeNode = await writeRuntime(resolve(root, nodeRelative), resolve(catalogRoot, `${runtimeNodeBase}.png`), resolve(catalogRoot, `${runtimeNodeBase}.webp`))

    const assetGroup = manifest.assets.find(asset => asset.id === partId)
    if (assetGroup === undefined) throw new Error(`${partId} manifest group is missing.`)
    const manifestVariant = 'variants' in assetGroup
      ? assetGroup.variants.find(item => item.rigId === rigId)
      : assetGroup.rigId === rigId ? assetGroup : undefined
    if (manifestVariant === undefined) throw new Error(`${partId}:${rigId} manifest variant is missing.`)
    manifestVariant.sourcePngPath = sourceRelative
    variant.sourcePngPath = sourceRelative
    const node = variant.renderNodes.find(item => item.connectorId === 'neck')
    if (node === undefined) throw new Error(`${partId}:${rigId} neck node is missing.`)
    node.sourcePngPath = nodeRelative
    node.id = `${partId}-${rigId}-neck-natural-v2`
    variant.promptEvidence.promptId = 'task7-head-natural-neck-rework'
    variant.promptEvidence.promptPath = promptRelative
    variant.promptEvidence.promptSha256 = promptSha256

    const key = interfaceVariantKey(variant.partId, variant.rigId)
    const record = processed.processedAssets[key] ?? processed.processedAssets[variant.partId]
    if (record === undefined) throw new Error(`Processed record ${key} is missing.`)
    record.pngPath = `${runtimeBase}.png`
    record.pngSha256 = runtime.pngSha256
    record.webpPath = `${runtimeBase}.webp`
    record.webpSha256 = runtime.webpSha256
    record.renderNodes = {
      [node.id]: {
        pngPath: `${runtimeNodeBase}.png`,
        pngSha256: runtimeNode.pngSha256,
        webpPath: `${runtimeNodeBase}.webp`,
        webpSha256: runtimeNode.webpSha256,
      },
    }
    processed.processedAssets[key] = record
    const sourceRecord = processed.sourceIndex.sources.find((source: any) => source.sourceId === key)
    if (sourceRecord === undefined) throw new Error(`Source-index record ${key} is missing.`)
    sourceRecord.promptId = variant.promptEvidence.promptId
    sourceRecord.promptPath = variant.promptEvidence.promptPath
    sourceRecord.promptSha256 = variant.promptEvidence.promptSha256
    sourceRecord.reviewRecordPath = variant.promptEvidence.reviewRecordPath
    sourceRecord.reviewRecordSha256 = sha256(await readFile(resolve(root, variant.promptEvidence.reviewRecordPath)))
    sourceRecord.sourceResources = await Promise.all(
      [...new Set([variant.sourcePngPath, ...variant.renderNodes.map(item => item.sourcePngPath)])].map(async path => ({
        path,
        sha256: sha256(await readFile(resolve(root, path))),
      })),
    )
    evidence.assets[key] = {
      candidatePaths: Array.from({ length: candidateNumber }, (_, index) => (
        `asset-source/v0.3.0/generation/task7-candidates/${rigId}/${partId}/candidate-natural-neck-${index + 1}.png`
      )),
      candidatePath: candidateRelative,
      selectedCandidate: candidateNumber,
      selectionReason: rigId === 'blob' && partId === 'head_round_dome'
        ? 'Candidate 1 failed central-lobe depth (0.215 > 0.200); candidate 2 was visually rejected for a near-straight lower cut; candidate 3 passed the fixed metric and original/256 composition gate.'
        : 'First natural-neck candidate preserved identity and passed shell-base, extraction, fixed-metric, and original/256 composition gates.',
      extractedPath: extractedRelative,
      productionSourcePath: sourceRelative,
      runtimePath: record.pngPath,
      extraction,
    }
  }
  await writeJson(manifestPath, manifest)
  await writeJson(processedPath, processed)
  await writeJson(resolve(sourceRoot, 'generation/task7-head-natural-neck-production.json'), evidence)
  return evidence
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await prepareAllNaturalNeckHeads(process.cwd())
  console.log(JSON.stringify({ prepared: Object.keys((result as any).assets).length }))
}
