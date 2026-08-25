import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type { InterfaceRigId, InterfaceSourceManifest } from './interface-source-schema.js'
import { structuralVariants } from './interface-source-schema.js'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'packages', 'asset-catalog', 'review', 'v0.3.0')
const CATALOG_ROOT = join(ROOT, 'packages', 'asset-catalog')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const HEAD_IDS = ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood']

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`) }

async function maskSource(sourcePath: string, maskPath: string): Promise<Buffer> {
  const [source, mask] = await Promise.all([
    sharp(resolve(ROOT, sourcePath)).ensureAlpha().png(PNG).toBuffer(),
    sharp(resolve(CATALOG_ROOT, maskPath)).ensureAlpha().extractChannel('alpha').png(PNG).toBuffer(),
  ])
  return sharp(source).composite([{ input: mask, blend: 'dest-in' }]).png(PNG).toBuffer()
}

async function translated(source: Buffer, dx: number, dy: number): Promise<Buffer> {
  const sourceLeft = Math.max(0, -dx); const sourceTop = Math.max(0, -dy)
  const targetLeft = Math.max(0, dx); const targetTop = Math.max(0, dy)
  const width = Math.min(2048 - sourceLeft, 2048 - targetLeft)
  const height = Math.min(2048 - sourceTop, 2048 - targetTop)
  const cropped = await sharp(source).extract({ left: sourceLeft, top: sourceTop, width, height }).png(PNG).toBuffer()
  return sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: cropped, left: targetLeft, top: targetTop }]).png(PNG).toBuffer()
}

function largestComponentRatio(alpha: Buffer, width: number, height: number): number {
  const labels = new Int32Array(width * height); const queue = new Int32Array(width * height); const masses = [0]; let label = 0; let total = 0
  for (const value of alpha) total += value
  for (let first = 0; first < labels.length; first += 1) {
    if (labels[first] !== 0 || alpha[first] === 0) continue
    label += 1; labels[first] = label; queue[0] = first; let queued = 1; let mass = 0
    for (let cursor = 0; cursor < queued; cursor += 1) {
      const current = queue[cursor]!; mass += alpha[current]!
      const x = current % width; const y = Math.floor(current / width)
      for (const next of [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1]) {
        if (next < 0 || labels[next] !== 0 || alpha[next] === 0) continue
        labels[next] = label; queue[queued++] = next
      }
    }
    masses[label] = mass
  }
  return total === 0 ? 0 : Math.max(...masses) / total
}

async function metrics(image: Buffer, centerX: number, centerY: number, depth: number) {
  const alpha = await sharp(image).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  let maxGap = 0; let gap = 0
  for (let y = Math.max(0, Math.round(centerY - depth)); y <= Math.min(2047, Math.round(centerY + depth)); y += 1) {
    let opaque = false
    for (let x = centerX - 2; x <= centerX + 2; x += 1) if (alpha.data[y * alpha.info.width + x]! > 0) opaque = true
    if (opaque) gap = 0; else { gap += 1; maxGap = Math.max(maxGap, gap) }
  }
  return { largestComponentRatio: largestComponentRatio(alpha.data, alpha.info.width, alpha.info.height), centerlineGapPx: maxGap }
}

async function label(text: string, width: number, height: number): Promise<Buffer> {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#27233a"/><text x="16" y="32" fill="#ffffff" font-family="Arial,sans-serif" font-size="22">${escaped}</text></svg>`)
}

async function cell(composite: Buffer, title: string, size: number): Promise<Buffer> {
  const labelHeight = Math.round(size * 0.12); const artHeight = size - labelHeight
  const art = await sharp(composite).trim({ background: '#00000000' }).resize(size - 28, artHeight - 18, { fit: 'inside', withoutEnlargement: false }).png(PNG).toBuffer({ resolveWithObject: true })
  const checker = Buffer.from(`<svg width="${size}" height="${artHeight}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#f4f1e8"/><rect width="16" height="16" fill="#e8e4d9"/><rect x="16" y="16" width="16" height="16" fill="#e8e4d9"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`)
  return sharp({ create: { width: size, height: size, channels: 4, background: '#f4f1e8' } }).composite([
    { input: checker, left: 0, top: 0 },
    { input: art.data, left: Math.round((size - art.info.width) / 2), top: Math.round((artHeight - art.info.height) / 2) },
    { input: await label(title, size, labelHeight), left: 0, top: artHeight },
  ]).png(PNG).toBuffer()
}

async function compose(body: any, head: any) {
  const receiver = body.connectors.find((item: any) => item.id === 'neck')
  const plug = head.connectors.find((item: any) => item.id === 'neck')
  const bodyNode = body.renderNodes[0]; const headNode = head.renderNodes.find((node: any) => node.connectorId === 'neck')
  const dx = Math.round(receiver.origin.x - plug.origin.x); const dy = Math.round(receiver.origin.y - plug.origin.y)
  const [back, front, bodyPng] = await Promise.all([
    maskSource(headNode.sourcePngPath, plug.backgroundMaskPath), maskSource(headNode.sourcePngPath, plug.foregroundMaskPath), readFile(resolve(ROOT, bodyNode.sourcePngPath)),
  ])
  const [placedBack, placedFront] = await Promise.all([translated(back, dx, dy), translated(front, dx, dy)])
  const result = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } })
    .composite([{ input: placedBack }, { input: bodyPng }, { input: placedFront }]).png(PNG).toBuffer()
  return { result, metrics: await metrics(result, receiver.origin.x, receiver.origin.y, Math.max(receiver.depth, plug.depth)) }
}

async function renderRig(manifest: InterfaceSourceManifest, rigId: InterfaceRigId) {
  const variants = structuralVariants(manifest)
  const bodies = variants.filter(item => item.slotId === 'bodyFrame' && item.rigId === rigId)
  const heads = HEAD_IDS.map(id => variants.find(item => item.slotId === 'headShape' && item.rigId === rigId && item.partId === id)!)
  const originals: Buffer[] = []; const small: Buffer[] = []; const entries: any[] = []
  for (const body of bodies) for (const head of heads) {
    const pair = await compose(body, head); const title = `${body.partId} × ${head.partId}`
    originals.push(await cell(pair.result, title, 512)); small.push(await cell(pair.result, title, 256))
    entries.push({ rigId, bodyId: body.partId, headId: head.partId, ...pair.metrics })
  }
  const columns = 4; const rows = Math.ceil(entries.length / columns)
  const sheet = await sharp({ create: { width: columns * 512, height: rows * 512, channels: 4, background: '#eee9de' } })
    .composite(originals.map((input, index) => ({ input, left: index % columns * 512, top: Math.floor(index / columns) * 512 }))).png(PNG).toBuffer()
  const sheet256 = await sharp({ create: { width: columns * 256, height: rows * 256, channels: 4, background: '#eee9de' } })
    .composite(small.map((input, index) => ({ input, left: index % columns * 256, top: Math.floor(index / columns) * 256 }))).png(PNG).toBuffer()
  const path = join(REVIEW_ROOT, `body-head-contact-sheet-${rigId}.png`); const path256 = join(REVIEW_ROOT, `body-head-contact-sheet-${rigId}-256.png`)
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, sheet); await writeFile(path256, sheet256)
  const record = { rigId, entries, thresholds: { largestComponentRatio: 0.99, centerlineGapPx: 2 }, sheetSha256: sha256(sheet), sheet256Sha256: sha256(sheet256), status: entries.every(item => item.largestComponentRatio >= 0.99 && item.centerlineGapPx <= 2) ? 'machine-pass-awaiting-user-approval' : 'machine-fail' }
  await writeJson(join(REVIEW_ROOT, `body-head-contact-sheet-${rigId}-manifest.json`), record)
  return record
}

const manifest = JSON.parse(await readFile(join(ROOT, 'asset-source', 'v0.3.0', 'interface-manifest.json'), 'utf8')) as InterfaceSourceManifest
const records = []
for (const rigId of ['blob', 'biped', 'floating'] as const) records.push(await renderRig(manifest, rigId))
const evidencePath = join(ROOT, 'asset-source', 'v0.3.0', 'generation', 'production-evidence.json')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8')); evidence.matrices = Object.fromEntries(records.map(record => [record.rigId, record])); await writeJson(evidencePath, evidence)
console.log(JSON.stringify(records.map(record => ({ rigId: record.rigId, entries: record.entries.length, status: record.status }))))
