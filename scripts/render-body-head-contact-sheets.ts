import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { InterfaceRigId, InterfaceSourceManifest } from './interface-source-schema.js'
import { structuralVariants } from './interface-source-schema.js'
import {
  MAX_VISIBLE_TONGUE_AREA_RATIO,
  MAX_VISIBLE_TONGUE_DEPTH_RATIO,
  MAX_CENTRAL_LOBE_DEPTH_RATIO,
  composeBodyHeadMetricEvidence,
} from './body-head-contact-metrics.js'

const ROOT = process.cwd()
const REVIEW_ROOT = join(ROOT, 'packages', 'asset-catalog', 'review', 'v0.3.0')
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const HEAD_IDS = ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood']

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`) }

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
  return composeBodyHeadMetricEvidence({ root: ROOT, body, head })
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
  const record = {
    rigId,
    entries,
    thresholds: {
      largestComponentRatio: 0.99,
      centerlineGapPx: 2,
      visibleTongueDepthRatio: MAX_VISIBLE_TONGUE_DEPTH_RATIO,
      visibleTongueAreaRatio: MAX_VISIBLE_TONGUE_AREA_RATIO,
      centralLobeDepthRatio: MAX_CENTRAL_LOBE_DEPTH_RATIO,
    },
    sheetSha256: sha256(sheet),
    sheet256Sha256: sha256(sheet256),
    status: entries.every(item => (
      item.largestComponentRatio >= 0.99
      && item.centerlineGapPx <= 2
      && item.visibleTongueDepthRatio <= MAX_VISIBLE_TONGUE_DEPTH_RATIO
      && item.visibleTongueAreaRatio <= MAX_VISIBLE_TONGUE_AREA_RATIO
      && item.centralLobeDepthRatio <= MAX_CENTRAL_LOBE_DEPTH_RATIO
    )) ? 'machine-pass-awaiting-user-approval' : 'machine-fail',
  }
  await writeJson(join(REVIEW_ROOT, `body-head-contact-sheet-${rigId}-manifest.json`), record)
  return record
}

const manifest = JSON.parse(await readFile(join(ROOT, 'asset-source', 'v0.3.0', 'interface-manifest.json'), 'utf8')) as InterfaceSourceManifest
const records = []
for (const rigId of ['blob', 'biped', 'floating'] as const) records.push(await renderRig(manifest, rigId))
const evidencePath = join(ROOT, 'asset-source', 'v0.3.0', 'generation', 'production-evidence.json')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8')); evidence.matrices = Object.fromEntries(records.map(record => [record.rigId, record])); await writeJson(evidencePath, evidence)
console.log(JSON.stringify(records.map(record => ({ rigId: record.rigId, entries: record.entries.length, status: record.status }))))
