import sharp, { type OverlayOptions } from 'sharp'

export interface V08ContactSheetEntry {
  index: number
  seed: string
  themeId: string
  pngBytes: Buffer
  raritySummary: string
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function buildV08ContactSheet(
  entries: readonly V08ContactSheetEntry[],
): Promise<{ bytes: Buffer, width: number, height: number }> {
  const columns = 5
  const rows = Math.ceil(entries.length / columns)
  const artSize = 256
  const labelHeight = 62
  const gutter = 12
  const cellWidth = artSize + gutter * 2
  const cellHeight = artSize + labelHeight + gutter * 2
  const overlays: OverlayOptions[] = []

  for (const [offset, entry] of entries.entries()) {
    const left = (offset % columns) * cellWidth + gutter
    const top = Math.floor(offset / columns) * cellHeight + gutter
    const art = await sharp(entry.pngBytes)
      .resize(artSize, artSize, { fit: 'contain' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${artSize}" height="${labelHeight}">
      <rect width="100%" height="100%" rx="8" fill="#151827"/>
      <text x="10" y="20" font-family="Segoe UI, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${escapeXml(`${String(entry.index).padStart(3, '0')} · ${entry.themeId}`)}</text>
      <text x="10" y="39" font-family="Segoe UI, sans-serif" font-size="11" fill="#f4c86a">${escapeXml(entry.raritySummary)}</text>
      <text x="10" y="55" font-family="Segoe UI, sans-serif" font-size="10" fill="#9ca8c7">${escapeXml(entry.seed)}</text>
    </svg>`)
    overlays.push({ input: art, left, top })
    overlays.push({ input: label, left, top: top + artSize })
  }

  const width = columns * cellWidth
  const height = rows * cellHeight
  const bytes = await sharp({
    create: { width, height, channels: 4, background: '#f3efe5ff' },
  })
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  return { bytes, width, height }
}
