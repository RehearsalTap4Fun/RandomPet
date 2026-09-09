/** Offline authoring repair, explicitly authorized by the owner after RGB generation.
 * This is never called by the release builder or the mask preparation script. */
import sharp from 'sharp'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Neutral checker background has no chroma. Retain the colored connected subject,
 * estimate coverage from local foreground chroma and remove gray edge contamination.
 * Interior pixels are copied verbatim; only the mixed foreground/background boundary
 * is unmatted. A multi-source nearest-interior map handles individual fur/whisker tips. */
export function extractCheckerAlpha(rgb: Buffer, width: number, height: number): Buffer {
  const count = width * height
  if (rgb.length !== count * 3) throw new Error('Expected RGB8 source')
  const chroma = new Uint8Array(count)
  const near = new Int32Array(count).fill(-1)
  const distance = new Uint16Array(count).fill(65535)
  const queue = new Int32Array(count)
  let written = 0
  for (let p = 0; p < count; p++) {
    const i = p * 3
    chroma[p] = Math.max(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) - Math.min(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)
    if (chroma[p]! >= 125) { near[p] = p; distance[p] = 0; queue[written++] = p }
  }
  for (let at = 0; at < written; at++) {
    const p = queue[at]!, x = p % width, y = Math.floor(p / width)
    for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
      if (q < 0 || distance[q] !== 65535) continue
      distance[q] = distance[p]! + 1; near[q] = near[p]!; queue[written++] = q
    }
  }
  // Flood only background neutral pixels from the border. Neutral highlights
  // enclosed by the creature (notably whiskers) remain opaque, avoiding holes.
  const outside = new Uint8Array(count)
  let tail = 0
  const enqueue = (p: number) => { if (!outside[p] && chroma[p]! <= 10) { outside[p] = 1; queue[tail++] = p } }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
  for (let at = 0; at < tail; at++) {
    const p = queue[at]!, x = p % width, y = Math.floor(p / width)
    for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) if (q >= 0) enqueue(q)
  }
  // Large enclosed neutral components are real background gaps (e.g. between
  // the curled tail and torso), not highlights. Do not fill those with RGB.
  const examined = new Uint8Array(outside)
  for (let seed = 0; seed < count; seed++) {
    if (examined[seed] || chroma[seed]! > 10) continue
    let size = 1; queue[0] = seed; examined[seed] = 1
    for (let at = 0; at < size; at++) {
      const p = queue[at]!, x = p % width, y = Math.floor(p / width)
      for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (q >= 0 && !examined[q] && chroma[q]! <= 10) { examined[q] = 1; queue[size++] = q }
      }
    }
    if (size > 64) for (let at = 0; at < size; at++) outside[queue[at]!] = 1
  }
  const output = Buffer.alloc(count * 4)
  for (let p = 0; p < count; p++) {
    if (outside[p]) continue
    const x = p % width, y = Math.floor(p / width)
    let boundary = false
    for (let dy = -5; dy <= 5 && !boundary; dy++) for (let dx = -5; dx <= 5; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || outside[ny * width + nx]) { boundary = true; break }
    }
    const fg = near[p]!
    const alpha = boundary && fg >= 0 ? Math.min(1, (chroma[p]! - 10) / (chroma[fg]! - 10)) : 1
    if (alpha < 0.04) continue
    const i = p * 3, o = p * 4
    output[o + 3] = Math.round(alpha * 255)
    // Straight foreground RGB from the nearest opaque sample avoids a white/gray
    // checker halo when composited on dark surfaces. Never alter opaque interiors.
    const source = alpha < 0.98 && fg >= 0 ? fg * 3 : i
    output[o] = rgb[source]!; output[o + 1] = rgb[source + 1]!; output[o + 2] = rgb[source + 2]!
  }
  return output
}

export async function extractMaster(source: string, destination: string): Promise<void> {
  const { data, info } = await sharp(await readFile(source)).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const rgba = extractCheckerAlpha(data, info.width, info.height)
  await mkdir(dirname(destination), { recursive: true })
  // Fixed authoring canvas normalization: complete original square, no crop,
  // 96-pixel safety margin. Masks are authored only after this normalization.
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(1856, 1856, { kernel: 'lanczos3' }).extend({ top: 96, bottom: 96, left: 96, right: 96, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toColourspace('srgb').png().toFile(destination)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const id of ['feline-sit-v2-core', 'feline-sit-v2-legendary-01']) {
    await extractMaster(`asset-source/v0.9.0/feline/sources/${id}-rgb.png`, `asset-source/v0.9.0/feline/masters/${id}.png`)
  }
}
