import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const recordsFile = 'docs/art/mutation-batch1/generations.json'
const records = JSON.parse(await fs.readFile(path.join(root, recordsFile), 'utf8'))
// Offline authoring only. Runtime transformations remain identity for these five assets.
const placement = {
  halo: { background: 'black', left: 420, top: 15, width: 280, height: 70 },
  'dragon-wings': { background: 'green', left: 20, top: 120, width: 1220, height: 820 },
  'feathered-wings': { background: 'green', left: 100, top: 250, width: 1060, height: 630 },
  'frill-neck': { background: 'green', left: 140, top: 320, width: 870, height: 590 },
  'flame-tail': { background: 'black', left: 880, top: 380, width: 355, height: 755 },
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clamp = x => Math.max(0, Math.min(255, Math.round(x)))
const prepared = []
for (const [id, config] of Object.entries(placement)) {
  const record = records.findLast(record => record.id === id && record.stage === 'solid-background')
  if (!record) throw new Error('Missing solid-background generation: ' + id)
  const bytes = await fs.readFile(path.resolve(root, record.source))
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 1254 || info.height !== 1254 || info.channels !== 3) throw new Error('Unexpected authoring canvas: ' + id)
  const rgba = Buffer.alloc(1254 * 1254 * 4)
  let minX = 1254, minY = 1254, maxX = -1, maxY = -1
  for (let index = 0; index < 1254 * 1254; index++) {
    const r = data[index * 3], g = data[index * 3 + 1], b = data[index * 3 + 2]
    let alpha
    if (config.background === 'black') alpha = Math.max(r, g, b) < 8 ? 0 : Math.max(r, g, b) / 255
    else {
      alpha = Math.min(1, Math.max(0, (255 - g + Math.max(r, b)) / 255))
      if ((r < 35 && b < 35 && g > 175) || alpha < 0.025) alpha = 0
    }
    if (!alpha) continue
    rgba[index * 4] = clamp(r / alpha)
    rgba[index * 4 + 1] = clamp((g - (config.background === 'green' ? (1 - alpha) * 255 : 0)) / alpha)
    rgba[index * 4 + 2] = clamp(b / alpha)
    rgba[index * 4 + 3] = clamp(alpha * 255)
    if (rgba[index * 4 + 3] >= 8) {
      const x = index % 1254, y = Math.floor(index / 1254)
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Keying produced empty content: ' + id)
  const bounds = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  const layer = await sharp(rgba, { raw: { width: 1254, height: 1254, channels: 4 } }).extract(bounds)
    .resize(config.width, config.height, { fit: 'fill' }).png().toBuffer()
  const png = await sharp({ create: { width: 1254, height: 1254, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: layer, left: config.left, top: config.top }]).png().toBuffer()
  const alpha = await sharp(png).extractChannel('alpha').raw().toBuffer()
  let transparent = 0, fractional = 0, visible = 0
  for (const a of alpha) { if (a === 0) transparent++; else { visible++; if (a < 255) fractional++ } }
  if (!transparent || !visible || !fractional) throw new Error('Expected nonempty RGBA with feathered edges: ' + id)
  prepared.push({ id, png, source: record.source, sourceSha256: hash(bytes), sourceBounds: bounds,
    offlinePlacement: config, sha256: hash(png), transparentPixels: transparent, fractionalPixels: fractional, visiblePixels: visible })
}
const catalogFile = path.join(root, 'packages/asset-catalog/catalog/v0.10.0/catalog.json')
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'))
// Preserve approval only when offline preparation reproduces the exact approved bytes.
let approval
try { approval = JSON.parse(await fs.readFile(path.join(root, 'docs/releases/v0.10.0/mutation-batch1/approval.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
const finalRecords = records.filter(record => record.stage !== 'final')
for (const { id, png, ...evidence } of prepared) {
  const file = `packages/asset-catalog/assets/v0.10.0/${id}.png`
  const review = approval?.status === 'approved' && approval.resources.some(resource => resource.id === id && resource.sha256 === evidence.sha256) ? 'approved' : 'pending'
  await fs.writeFile(path.join(root, file), png)
  catalog.resources[id] = { id, path: file, sha256: evidence.sha256, width: 1254, height: 1254, mediaType: 'image/png', hasAlpha: true,
    review, provenance: { reference: 'packages/asset-catalog/assets/v0.10.0/orange-white-parted-mouth.png', prompt: recordsFile } }
  for (const coat of Object.keys(catalog.mutations)) catalog.mutations[coat][id] = id
  finalRecords.push({ id, stage: 'final', status: review, ...(review === 'approved' ? { approval: 'docs/releases/v0.10.0/mutation-batch1/approval.json' } : {}), output: file, ...evidence,
    processing: 'User-authorized offline background keying and final-coordinate placement; no runtime registration.' })
}
await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
await fs.writeFile(path.join(root, recordsFile), JSON.stringify(finalRecords, null, 2) + '\n')
console.log(JSON.stringify(prepared.map(({ png, ...record }) => record), null, 2))
