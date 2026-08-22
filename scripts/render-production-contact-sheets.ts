import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { Catalog, RenderLayer, RigDefinition, RigId, VisualPartDefinition, VisualSlotId } from '@qmonster/generator-core'
import { buildProductionCatalog } from './build-production-catalog.js'

export interface ContactSheetPlan {
  rigId: RigId
  partIds: string[]
}

interface ContactSheetResult extends ContactSheetPlan {
  outputPath: string
  sha256: string
  width: number
  height: number
}

const reviewDirectory = 'packages/asset-catalog/review/v0.1.0'
const assetsDirectory = 'packages/asset-catalog/assets/v0.1.0'
const columns = 4
const cellWidth = 300
const cellHeight = 340
const artSize = 280
const headerHeight = 82

export function planContactSheets(catalog: Catalog): ContactSheetPlan[] {
  return catalog.rigs.map(rig => ({
    rigId: rig.id,
    partIds: catalog.parts.filter(part => part.compatibleRigs.includes(rig.id)).map(part => part.id),
  }))
}

export function contactCompositeOrder(
  layer: RenderLayer,
  slotId: VisualSlotId,
): Array<'candidate' | 'base'> {
  if (slotId === 'bodyFrame') return ['candidate']
  return layer === 'rearAppendage' ? ['candidate', 'base'] : ['base', 'candidate']
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function checkerboard(): Buffer {
  const cells: string[] = []
  const size = 128
  for (let y = 0; y < 2048; y += size) {
    for (let x = 0; x < 2048; x += size) {
      cells.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${(x / size + y / size) % 2 === 0 ? '#eef1f4' : '#dfe4e8'}"/>`)
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048">${cells.join('')}</svg>`)
}

export function contactPlacement(
  part: VisualPartDefinition,
  rig: RigDefinition,
): { left: number; top: number } {
  const socket = part.socket === null ? { x: 1024, y: 1024 } : rig.sockets[part.socket]
  if (socket === undefined) throw new Error(`Rig ${rig.id} is missing contact-sheet socket ${part.socket}`)
  return { left: socket.x - part.origin.x, top: socket.y - part.origin.y }
}

export async function renderContactCell(catalog: Catalog, rigId: RigId, partId: string): Promise<Buffer> {
  const part = catalog.parts.find(candidate => candidate.id === partId)!
  const rig = catalog.rigs.find(candidate => candidate.id === rigId)!
  const basePath = join(assetsDirectory, 'rigs', `base_${rigId}_v1.png`)
  const partPath = join(assetsDirectory, part.pngPath ?? part.assetPath.replace(/\.webp$/u, '.png'))
  const base = await readFile(basePath)
  const candidate = await readFile(partPath)
  const placement = contactPlacement(part, rig)
  const composites: sharp.OverlayOptions[] = [
    { input: checkerboard(), left: 0, top: 0 },
    ...contactCompositeOrder(part.layer, part.slotId).map(kind => ({
      input: kind === 'base' ? base : candidate,
      left: kind === 'base' ? 512 : placement.left,
      top: kind === 'base' ? 512 : placement.top,
    })),
  ]
  const stage = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#ffffffff' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const art = await sharp(stage)
    .resize(artSize, artSize)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="${cellHeight - artSize}">
    <rect width="100%" height="100%" fill="#151922"/>
    <text x="12" y="24" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="15" font-weight="600" fill="#ffffff">${escapeXml(part.id)}</text>
    <text x="12" y="47" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="14" fill="#b9c5d4">${escapeXml(`${part.slotId} · ${part.displayName ?? ''}`)}</text>
  </svg>`)
  return sharp({ create: { width: cellWidth, height: cellHeight, channels: 4, background: '#151922ff' } })
    .composite([{ input: art, left: 10, top: 0 }, { input: label, left: 0, top: artSize }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
}

async function renderOne(catalog: Catalog, plan: ContactSheetPlan): Promise<ContactSheetResult> {
  const rows = Math.ceil(plan.partIds.length / columns)
  const width = columns * cellWidth
  const height = headerHeight + rows * cellHeight
  const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${headerHeight}">
    <rect width="100%" height="100%" fill="#0d1118"/>
    <text x="24" y="34" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="25" font-weight="700" fill="#ffffff">QMonster v0.1 · ${escapeXml(plan.rigId)} compatible-rig contact sheet</text>
    <text x="24" y="64" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="16" fill="#9fb0c4">${plan.partIds.length} candidates · checker reveals alpha · bodyFrame shown standalone · all other layers composited on locked base</text>
  </svg>`)
  const cells = await Promise.all(plan.partIds.map(partId => renderContactCell(catalog, plan.rigId, partId)))
  const outputPath = join(reviewDirectory, `contact-sheet-${plan.rigId}.png`)
  await mkdir(dirname(outputPath), { recursive: true })
  await sharp({ create: { width, height, channels: 4, background: '#0d1118ff' } })
    .composite([
      { input: header, left: 0, top: 0 },
      ...cells.map((input, index) => ({
        input,
        left: (index % columns) * cellWidth,
        top: headerHeight + Math.floor(index / columns) * cellHeight,
      })),
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(outputPath)
  const bytes = await readFile(outputPath)
  return { ...plan, outputPath: outputPath.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), width, height }
}

export async function generateContactSheets(catalog: Catalog): Promise<ContactSheetResult[]> {
  const results: ContactSheetResult[] = []
  for (const plan of planContactSheets(catalog)) results.push(await renderOne(catalog, plan))
  await writeFile(join(reviewDirectory, 'contact-sheet-index.json'), `${JSON.stringify({
    catalogVersion: catalog.version,
    generatedAt: '2026-08-22',
    candidates: catalog.parts.length,
    compatibleRigPlacements: results.reduce((count, result) => count + result.partIds.length, 0),
    sheets: results,
  }, null, 2)}\n`)
  return results
}

if (process.argv[1]?.endsWith('render-production-contact-sheets.ts')) {
  const { catalog } = await buildProductionCatalog({ write: false })
  const results = await generateContactSheets(catalog)
  console.log(JSON.stringify(results.map(result => ({ rigId: result.rigId, candidates: result.partIds.length, width: result.width, height: result.height, outputPath: result.outputPath }))))
}
