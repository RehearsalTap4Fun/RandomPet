import assert from 'node:assert/strict'

const SIZE = 64

const rgba = hex => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]
}

const shapes = {
  N: [
    { cx: 32, cy: 16, rx: 22, ry: 7 }, { cx: 29, cy: 27, rx: 27, ry: 8 },
    { cx: 35, cy: 38, rx: 27, ry: 8 }, { cx: 28, cy: 48, rx: 21, ry: 5 },
  ],
  R: [
    { cx: 32, cy: 15, rx: 22, ry: 6 }, { cx: 28, cy: 24, rx: 26, ry: 7 },
    { cx: 35, cy: 34, rx: 27, ry: 8 }, { cx: 27, cy: 43, rx: 25, ry: 7 },
    { cx: 36, cy: 49, rx: 20, ry: 4 },
  ],
  L: [
    { cx: 32, cy: 14, rx: 22, ry: 6 }, { cx: 28, cy: 23, rx: 27, ry: 8 },
    { cx: 35, cy: 33, rx: 27, ry: 8 }, { cx: 28, cy: 42, rx: 26, ry: 8 },
    { cx: 37, cy: 49, rx: 24, ry: 5 },
  ],
}

export const BACKDROP_DEFINITIONS = [
  { id: 'doodle-horizon', name: '随手地平线', rarity: 'N', base: '#EEE7D7', decorations: ['#CBBFAE', '#E6B981'], shape: shapes.N, expectedOpaquePixels: 1928 },
  { id: 'doodle-leaf-shadow', name: '叶影涂鸦', rarity: 'R', base: '#CDE4CB', decorations: ['#91BA91', '#F4EEDC'], shape: shapes.R, expectedOpaquePixels: 1996 },
  { id: 'doodle-rainbow-trail', name: '虹弧星轨', rarity: 'L', base: '#DCCFF1', decorations: ['#78CAD0', '#F0A66D', '#F4EBD0'], shape: shapes.L, expectedOpaquePixels: 2175 },
]

function scanline(shape, y) {
  const intervals = shape.flatMap(band => {
    const dy = y - band.cy
    if (Math.abs(dy) > band.ry) return []
    const span = Math.round(band.rx * Math.sqrt(1 - (dy / band.ry) ** 2))
    return [[band.cx - span, band.cx + span]]
  })
  assert.ok(intervals.length, `No brush band at y=${y}`)
  return [Math.min(...intervals.map(interval => interval[0])), Math.max(...intervals.map(interval => interval[1]))]
}

function paintInside(pixels, x, y, color) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return
  const offset = (y * SIZE + x) * 4
  if (pixels[offset + 3] === 255) pixels.set(color, offset)
}

function line(pixels, x0, y0, x1, y1, color, thickness = 1) {
  let dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1
  let error = dx + dy
  const radius = Math.floor(thickness / 2)
  while (true) {
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      paintInside(pixels, x0 + ox, y0 + oy, color)
    }
    if (x0 === x1 && y0 === y1) break
    const twice = 2 * error
    if (twice >= dy) { error += dy; x0 += sx }
    if (twice <= dx) { error += dx; y0 += sy }
  }
}

function decorate(definition, pixels) {
  const colors = definition.decorations.map(rgba)
  if (definition.rarity === 'N') {
    line(pixels, 4, 21, 17, 17, colors[0], 2)
    line(pixels, 49, 37, 60, 34, colors[1], 2)
    return
  }
  if (definition.rarity === 'R') {
    for (const [x, y, lean] of [[9, 31, -3], [31, 45, 4], [55, 29, 3]]) {
      line(pixels, x, y, x + lean, y - 15, colors[0], 2)
      line(pixels, x + Math.round(lean * 0.35), y - 6, x - 5, y - 10, colors[1], 2)
      line(pixels, x + Math.round(lean * 0.65), y - 10, x + 5, y - 14, colors[1], 2)
    }
    return
  }
  for (let x = 3; x <= 60; x++) {
    const t = (x - 3) / 57
    paintInside(pixels, x, Math.round(36 - 20 * Math.sin(Math.PI * t)), colors[0])
    paintInside(pixels, x, Math.round(40 - 17 * Math.sin(Math.PI * t)), colors[1])
  }
  for (const [x, y] of [[15, 18], [49, 18], [12, 20], [6, 41], [58, 34]]) {
    paintInside(pixels, x - 1, y, colors[2]); paintInside(pixels, x + 1, y, colors[2])
    paintInside(pixels, x, y - 1, colors[2]); paintInside(pixels, x, y + 1, colors[2])
  }
}

export function renderBackdrop(definition) {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4)
  const base = rgba(definition.base)
  const top = Math.min(...definition.shape.map(band => band.cy - band.ry))
  const bottom = Math.max(...definition.shape.map(band => band.cy + band.ry))
  for (let y = top; y <= bottom; y++) {
    const [left, right] = scanline(definition.shape, y)
    for (let x = left; x <= right; x++) pixels.set(base, (y * SIZE + x) * 4)
  }
  decorate(definition, pixels)
  return pixels
}

export function relativeLuminance(hex) {
  const channels = rgba(hex).slice(0, 3).map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function analyzeBackdrop(pixels) {
  assert.equal(pixels.length, SIZE * SIZE * 4)
  const opaque = new Set(); const alphaValues = new Set(); const palette = new Set()
  let left = SIZE; let top = SIZE; let right = -1; let bottom = -1
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const offset = (y * SIZE + x) * 4
    const alpha = pixels[offset + 3]
    alphaValues.add(alpha)
    if (!alpha) continue
    opaque.add(y * SIZE + x)
    palette.add(`#${[pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`)
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  let components = 0
  const unseen = new Set(opaque)
  while (unseen.size) {
    components++
    const first = unseen.values().next().value
    const queue = [first]
    unseen.delete(first)
    while (queue.length) {
      const value = queue.pop(); const x = value % SIZE; const y = Math.floor(value / SIZE)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx; const nextY = y + dy
        if (nextX < 0 || nextX >= SIZE || nextY < 0 || nextY >= SIZE) continue
        const next = nextY * SIZE + nextX
        if (!unseen.has(next)) continue
        unseen.delete(next); queue.push(next)
      }
    }
  }
  return {
    bounds: { left, top, right, bottom },
    opaquePixels: opaque.size,
    components,
    edgeClear: left >= 1 && top >= 1 && right <= 62 && bottom <= 59,
    alphaValues: [...alphaValues].sort((a, b) => a - b),
    palette: [...palette].sort(),
  }
}

export function validateBackdrop(definition, pixels) {
  const stats = analyzeBackdrop(pixels)
  assert.deepEqual(stats.alphaValues, [0, 255], `${definition.id}: alpha must be binary`)
  assert.equal(stats.components, 1, `${definition.id}: expected one component`)
  assert.ok(stats.edgeClear, `${definition.id}: opaque pixels touch a forbidden edge`)
  assert.ok(stats.opaquePixels >= 1900 && stats.opaquePixels <= 2450, `${definition.id}: area ${stats.opaquePixels}`)
  if (definition.expectedOpaquePixels !== undefined) {
    assert.equal(stats.opaquePixels, definition.expectedOpaquePixels, `${definition.id}: silhouette changed`)
  }
  if (definition.rarity === 'L') {
    assert.ok(relativeLuminance(definition.base) >= 0.55, `${definition.id}: dark base`)
    for (const color of definition.decorations) {
      assert.ok(relativeLuminance(color) >= 0.35, `${definition.id}: dark decoration ${color}`)
    }
  }
  return {
    ...stats,
    luminance: {
      base: relativeLuminance(definition.base),
      decorations: definition.decorations.map(relativeLuminance),
    },
  }
}
