import assert from 'node:assert/strict'

export const BACKDROP_WIDTH = 96
export const BACKDROP_HEIGHT = 64

const rgba = hex => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]
}

const shapes = {
  N: [
    { cx: 48, cy: 13, rx: 36, ry: 6 }, { cx: 42, cy: 23, rx: 38, ry: 7 },
    { cx: 55, cy: 33, rx: 37, ry: 7 }, { cx: 42, cy: 43, rx: 38, ry: 7 },
    { cx: 54, cy: 51, rx: 34, ry: 3 },
  ],
  R: [
    { cx: 47, cy: 13, rx: 38, ry: 6 }, { cx: 54, cy: 22, rx: 37, ry: 7 },
    { cx: 41, cy: 32, rx: 38, ry: 7 }, { cx: 55, cy: 42, rx: 36, ry: 7 },
    { cx: 42, cy: 51, rx: 38, ry: 4 },
  ],
  L: [
    { cx: 48, cy: 12, rx: 40, ry: 5 }, { cx: 41, cy: 22, rx: 37, ry: 7 },
    { cx: 55, cy: 32, rx: 37, ry: 7 }, { cx: 41, cy: 42, rx: 38, ry: 7 },
    { cx: 54, cy: 51, rx: 37, ry: 4 },
  ],
}

export const BACKDROP_DEFINITIONS = [
  { id: 'doodle-horizon', name: '随手地平线', rarity: 'N', base: '#EEE7D7', decorations: ['#CBBFAE', '#E6B981'], shape: shapes.N, expectedOpaquePixels: 3097 },
  { id: 'doodle-leaf-shadow', name: '叶影涂鸦', rarity: 'R', base: '#CDE4CB', decorations: ['#91BA91', '#F4EEDC'], shape: shapes.R, expectedOpaquePixels: 3213 },
  { id: 'doodle-rainbow-trail', name: '虹弧星轨', rarity: 'L', base: '#DCCFF1', decorations: ['#78CAD0', '#F0A66D', '#F4EBD0'], shape: shapes.L, expectedOpaquePixels: 3221 },
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
  if (x < 0 || x >= BACKDROP_WIDTH || y < 0 || y >= BACKDROP_HEIGHT) return
  const offset = (y * BACKDROP_WIDTH + x) * 4
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

function polyline(pixels, points, color, thickness = 1) {
  for (let index = 1; index < points.length; index++) {
    line(pixels, ...points[index - 1], ...points[index], color, thickness)
  }
}

function diamond(pixels, cx, cy, rx, ry, color) {
  for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    if (Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1) paintInside(pixels, x, y, color)
  }
}

function starburst(pixels, cx, cy, color) {
  line(pixels, cx - 3, cy, cx + 3, cy, color, 1)
  line(pixels, cx, cy - 3, cx, cy + 3, color, 1)
  paintInside(pixels, cx - 2, cy - 2, color)
  paintInside(pixels, cx + 2, cy - 2, color)
  paintInside(pixels, cx - 2, cy + 2, color)
  paintInside(pixels, cx + 2, cy + 2, color)
}

function decorate(definition, pixels) {
  const colors = definition.decorations.map(rgba)
  if (definition.rarity === 'N') {
    polyline(pixels, [[5, 25], [9, 21], [13, 25], [17, 29], [21, 25], [25, 21]], colors[0], 3)
    polyline(pixels, [[4, 36], [8, 32], [12, 36], [16, 40], [20, 36], [24, 32]], colors[1], 3)
    polyline(pixels, [[71, 22], [75, 18], [79, 22], [83, 26], [87, 22], [91, 18]], colors[0], 3)
    polyline(pixels, [[72, 38], [76, 34], [80, 38], [84, 42], [88, 38], [92, 34]], colors[1], 3)
    return
  }
  if (definition.rarity === 'R') {
    polyline(pixels, [[7, 45], [11, 37], [14, 29], [18, 21], [22, 15]], colors[0], 3)
    polyline(pixels, [[89, 45], [85, 37], [82, 29], [78, 21], [74, 15]], colors[0], 3)
    for (const [x, y] of [[9, 38], [16, 31], [17, 23], [22, 17], [87, 38], [80, 31], [79, 23], [74, 17]]) {
      diamond(pixels, x, y, 3, 2, colors[1])
      line(pixels, x - 2, y + 1, x + 2, y - 1, colors[0], 1)
    }
    return
  }
  polyline(pixels, [[4, 39], [7, 31], [12, 25], [18, 20], [24, 18]], colors[0], 3)
  polyline(pixels, [[5, 45], [9, 37], [14, 31], [20, 26], [25, 24]], colors[1], 3)
  polyline(pixels, [[92, 39], [89, 31], [84, 25], [78, 20], [72, 18]], colors[0], 3)
  polyline(pixels, [[91, 45], [87, 37], [82, 31], [76, 26], [71, 24]], colors[1], 3)
  for (const [x, y] of [[8, 17], [21, 42], [88, 17], [75, 42]]) starburst(pixels, x, y, colors[2])
}

export function renderBackdrop(definition) {
  const pixels = new Uint8ClampedArray(BACKDROP_WIDTH * BACKDROP_HEIGHT * 4)
  const base = rgba(definition.base)
  const top = Math.min(...definition.shape.map(band => band.cy - band.ry))
  const bottom = Math.max(...definition.shape.map(band => band.cy + band.ry))
  for (let y = top; y <= bottom; y++) {
    const [left, right] = scanline(definition.shape, y)
    for (let x = left; x <= right; x++) pixels.set(base, (y * BACKDROP_WIDTH + x) * 4)
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
  assert.equal(pixels.length, BACKDROP_WIDTH * BACKDROP_HEIGHT * 4)
  const opaque = new Set(); const alphaValues = new Set(); const palette = new Set()
  let left = BACKDROP_WIDTH; let top = BACKDROP_HEIGHT; let right = -1; let bottom = -1
  for (let y = 0; y < BACKDROP_HEIGHT; y++) for (let x = 0; x < BACKDROP_WIDTH; x++) {
    const offset = (y * BACKDROP_WIDTH + x) * 4
    const alpha = pixels[offset + 3]
    alphaValues.add(alpha)
    if (!alpha) continue
    opaque.add(y * BACKDROP_WIDTH + x)
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
      const value = queue.pop(); const x = value % BACKDROP_WIDTH; const y = Math.floor(value / BACKDROP_WIDTH)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx; const nextY = y + dy
        if (nextX < 0 || nextX >= BACKDROP_WIDTH || nextY < 0 || nextY >= BACKDROP_HEIGHT) continue
        const next = nextY * BACKDROP_WIDTH + nextX
        if (!unseen.has(next)) continue
        unseen.delete(next); queue.push(next)
      }
    }
  }
  return {
    width: BACKDROP_WIDTH,
    height: BACKDROP_HEIGHT,
    bounds: { left, top, right, bottom },
    opaquePixels: opaque.size,
    components,
    edgeClear: left >= 1 && top >= 1 && right <= BACKDROP_WIDTH - 2 && bottom <= BACKDROP_HEIGHT - 2,
    alphaValues: [...alphaValues].sort((a, b) => a - b),
    palette: [...palette].sort(),
  }
}

export function validateBackdrop(definition, pixels) {
  const stats = analyzeBackdrop(pixels)
  assert.deepEqual(stats.alphaValues, [0, 255], `${definition.id}: alpha must be binary`)
  assert.equal(stats.components, 1, `${definition.id}: expected one component`)
  assert.ok(stats.edgeClear, `${definition.id}: opaque pixels touch a forbidden edge`)
  assert.ok(stats.opaquePixels >= 3000 && stats.opaquePixels <= 3350, `${definition.id}: area ${stats.opaquePixels}`)
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
