import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'docs/art/pixel-evolution-chains/sources/imagegen')
const outputRoot = path.join(root, 'docs/qa/pixel-evolution-chains/layers')

const assets = [
  { id: 'crystal-horns', source: 'crystal-horns.png', box: { left: 17, top: 0, width: 30, height: 15 }, palette: ['#8c4618', '#d3771d', '#f2b632', '#54bfd0', '#a5edf2', '#efffff'] },
  { id: 'feathered-ears', source: 'feathered-ears.png', box: { left: 10, top: 4, width: 38, height: 16 }, earBoundaries: true, palette: ['#d9584f', '#f27b6d', '#f2ab7f', '#ffe0b2', '#fff4d8', '#ffffff'] },
  { id: 'celestial-ears', source: 'celestial-ears.png', box: { left: 9, top: 3, width: 40, height: 16 }, earBoundaries: true, palette: ['#8878c9', '#b5a6e8', '#d9d0fa', '#ffffff', '#e6b840', '#79d6ea'] },
  { id: 'sunburst-ruff', source: 'sunburst-ruff.png', box: { left: 6, top: 16, width: 52, height: 32 }, palette: ['#bd3435', '#e84b44', '#f36b4e', '#f39b3f', '#f8c248', '#ffe29a'] },
  { id: 'phoenix-tail', source: 'phoenix-tail.png', box: { left: 40, top: 10, width: 23, height: 49 }, palette: ['#c92e28', '#e9492c', '#f46a25', '#f59220', '#f8bd32', '#fff0a0'] },
]

const rgb = hex => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const earRootBoundary = {
  left: { start: [11.88, 15.34], end: [24.24, 10.39] },
  right: { start: [33.63, 10.89], end: [45.5, 21.27] },
}

function crossesEarRoot(side, x, y) {
  const centerX = x + 0.5; const centerY = y + 0.5
  const edge = earRootBoundary[side]
  if (side === 'left' && centerX < edge.start[0]) return false
  if (side === 'right' && centerX > edge.end[0]) return false
  const sampleX = Math.max(edge.start[0], Math.min(edge.end[0], centerX))
  const ratio = (sampleX - edge.start[0]) / (edge.end[0] - edge.start[0])
  const boundaryY = edge.start[1] + (edge.end[1] - edge.start[1]) * ratio
  return centerY > boundaryY
}

function nearestColor(r, g, b, palette) {
  let best = palette[0]
  let distance = Number.POSITIVE_INFINITY
  for (const color of palette) {
    const dr = r - color[0]; const dg = g - color[1]; const db = b - color[2]
    const next = dr * dr + dg * dg + db * db
    if (next < distance) { distance = next; best = color }
  }
  return best
}

async function thresholdBounds(file, threshold = 128) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width; let top = info.height; let right = -1; let bottom = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < threshold) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  assert.ok(right >= left && bottom >= top, `No opaque pixels in ${file}`)
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

await fs.rm(outputRoot, { recursive: true, force: true })
await fs.mkdir(outputRoot, { recursive: true })
for (const asset of assets) {
  const source = path.join(sourceRoot, asset.source)
  const bounds = await thresholdBounds(source)
  const resized = await sharp(source)
    .extract(bounds)
    .resize(asset.box.width, asset.box.height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const palette = asset.palette.map(rgb)
  for (let offset = 0; offset < resized.length; offset += 4) {
    if (resized[offset + 3] < 128) {
      resized[offset] = 0; resized[offset + 1] = 0; resized[offset + 2] = 0; resized[offset + 3] = 0
      continue
    }
    const color = nearestColor(resized[offset], resized[offset + 1], resized[offset + 2], palette)
    resized[offset] = color[0]; resized[offset + 1] = color[1]; resized[offset + 2] = color[2]; resized[offset + 3] = 255
  }
  let canvas = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, raw: { width: asset.box.width, height: asset.box.height, channels: 4 }, left: asset.box.left, top: asset.box.top }])
    .raw()
    .toBuffer()
  if (asset.earBoundaries) {
    const halves = { left: { left: 64, top: 64, right: -1, bottom: -1 }, right: { left: 64, top: 64, right: -1, bottom: -1 } }
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (!canvas[(y * 64 + x) * 4 + 3]) continue
      const half = x < 29 ? halves.left : halves.right
      half.left = Math.min(half.left, x); half.top = Math.min(half.top, y); half.right = Math.max(half.right, x); half.bottom = Math.max(half.bottom, y)
    }
    const shifts = {
      left: { x: 25 - halves.left.right, y: Math.min(0, 15 - halves.left.bottom) },
      right: { x: 32 - halves.right.left, y: Math.min(0, 21 - halves.right.bottom) },
    }
    const shifted = Buffer.alloc(canvas.length)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const sourceOffset = (y * 64 + x) * 4
      if (!canvas[sourceOffset + 3]) continue
      const shift = x < 29 ? shifts.left : shifts.right
      const nextX = x + shift.x; const nextY = y + shift.y
      if (nextX < 0 || nextX >= 64 || nextY < 0 || nextY >= 64) continue
      const targetOffset = (nextY * 64 + nextX) * 4
      canvas.copy(shifted, targetOffset, sourceOffset, sourceOffset + 4)
    }
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4
      if (!shifted[offset + 3]) continue
      const side = x < 29 ? 'left' : 'right'
      if (!crossesEarRoot(side, x, y)) continue
      shifted[offset] = 0; shifted[offset + 1] = 0; shifted[offset + 2] = 0; shifted[offset + 3] = 0
    }
    canvas = shifted
  }
  const layer = await sharp(canvas, { raw: { width: 64, height: 64, channels: 4 } })
    .png({ palette: true, colours: 16, dither: 0 })
    .toBuffer()
  const output = path.join(outputRoot, `${asset.id}.png`)
  await fs.writeFile(output, layer)
  const { data, info } = await sharp(layer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 64); assert.equal(info.height, 64)
  let opaqueLeft = 64
  const halves = { left: { left: 64, right: -1, bottom: -1 }, right: { left: 64, right: -1, bottom: -1 } }
  let earRootViolations = 0
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3]
    assert.ok(alpha === 0 || alpha === 255, `${asset.id} alpha must be binary`)
    if (alpha) opaqueLeft = Math.min(opaqueLeft, x)
    if (alpha && asset.earBoundaries) {
      const half = x < 29 ? halves.left : halves.right
      half.left = Math.min(half.left, x); half.right = Math.max(half.right, x); half.bottom = Math.max(half.bottom, y)
      if (crossesEarRoot(x < 29 ? 'left' : 'right', x, y)) earRootViolations++
    }
  }
  assert.notEqual(opaqueLeft, 64, `${asset.id} must not be empty`)
  if (asset.id === 'phoenix-tail') assert.equal(opaqueLeft, 40, 'phoenix-tail must keep tail anchor x=40')
  if (asset.earBoundaries) {
    assert.ok(halves.left.right <= 25 && halves.left.right >= 23, `${asset.id} left ear must remain close to the original left-ear inner boundary`)
    assert.ok(halves.left.bottom <= 15, `${asset.id} left ear must not cross the original left-ear lower boundary`)
    assert.ok(halves.right.left >= 32 && halves.right.left <= 35, `${asset.id} right ear must remain close to the original right-ear inner boundary`)
    assert.ok(halves.right.bottom <= 21, `${asset.id} right ear must not cross the original right-ear lower boundary`)
    assert.equal(earRootViolations, 0, `${asset.id} must not enter the triangular region below the original ear-root diagonals`)
  }
}

console.log(`Built ${assets.length} evolution-chain layers in ${path.relative(root, outputRoot)}`)
