import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const source = 'docs/art/body-batch1/shortleg-round-green.png'
const output = 'docs/art/body-batch1/shortleg-round-body.png'
const bytes = await fs.readFile(path.join(root, source))
const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
assert.equal(info.width, 1254); assert.equal(info.height, 1254)
const rgba = Buffer.alloc(info.width * info.height * 4)
const clamp = n => Math.max(0, Math.min(255, Math.round(n)))
let transparent = 0, fractional = 0, opaque = 0
for (let i = 0; i < info.width * info.height; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
  let alpha = Math.min(1, Math.max(0, (255 - g + Math.max(r, b)) / 255))
  if ((r < 35 && b < 35 && g > 175) || alpha < 0.025) alpha = 0
  if (!alpha) { transparent++; continue }
  // Estimate the foreground green/red-blue ratio at boundary pixels from the
  // nearest clean fur pixel. A generic max(R,B) key leaves yellow-green halos
  // around orange fur; this local color estimate also preserves white whiskers.
  const x = i % info.width, y = Math.floor(i / info.width)
  let nearGreen = false
  for (let dy = -5; dy <= 5 && !nearGreen; dy++) for (let dx = -5; dx <= 5; dx++) {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue
    const n = (ny * info.width + nx) * 3
    if (data[n] < 35 && data[n + 2] < 35 && data[n + 1] > 175) { nearGreen = true; break }
  }
  if (nearGreen) {
    let nearest = Infinity, ratio = r > b * 1.8 ? 0.6 : 1
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const nx = x + dx, ny = y + dy, distance = dx * dx + dy * dy
      if (!distance || distance >= nearest || nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue
      const n = (ny * info.width + nx) * 3, nr = data[n], ng = data[n + 1], nb = data[n + 2]
      // Green mixing preserves R/B. Do not choose a white whisker as the
      // clean-color reference for an adjacent orange fur pixel.
      if (Math.abs(nr / (nr + nb + 1) - r / (r + b + 1)) > 0.07) continue
      if (nr - ng > 85 || (Math.min(nr, nb) > 160 && Math.abs(ng - (nr + nb) / 2) < 10)) {
        nearest = distance; ratio = Math.min(1, ng / Math.max(nr, nb))
      }
    }
    alpha = Math.min(1, Math.max(0, (255 - g + ratio * Math.max(r, b)) / 255))
  }
  rgba[i * 4] = clamp(r / alpha)
  rgba[i * 4 + 1] = clamp((g - (1 - alpha) * 255) / alpha)
  rgba[i * 4 + 2] = clamp(b / alpha)
  rgba[i * 4 + 3] = clamp(alpha * 255)
  if (rgba[i * 4 + 3] < 255) fractional++; else opaque++
}
assert.ok(transparent > 100000 && opaque > 100000 && fractional > 0)
const png = await sharp(rgba, { raw: { width: 1254, height: 1254, channels: 4 } }).png().toBuffer()
await fs.writeFile(path.join(root, output), png)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const evidence = { source, output, sourceSha256: sha(bytes), sha256: sha(png), width: 1254, height: 1254,
  transparentPixels: transparent, fractionalPixels: fractional, opaquePixels: opaque,
  authorization: 'User explicitly approved pure green background plus local extraction on 2026-09-16.',
  processing: 'Green unmixing with local clean-fur color estimation at the boundary and fractional alpha; no scaling, positioning or anatomical edits.',
  visualReview: 'pending', userArtReview: 'pending' }
await fs.writeFile(path.join(root, 'docs/art/body-batch1/extraction.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
