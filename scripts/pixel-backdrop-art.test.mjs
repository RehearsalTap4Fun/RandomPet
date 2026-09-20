import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BACKDROP_DEFINITIONS,
  BACKDROP_HEIGHT,
  BACKDROP_WIDTH,
  analyzeBackdrop,
  renderBackdrop,
  relativeLuminance,
  validateBackdrop,
} from './lib/pixel-backdrop-art.mjs'

const blank = () => new Uint8ClampedArray(BACKDROP_WIDTH * BACKDROP_HEIGHT * 4)
const put = (pixels, x, y, color = [255, 255, 255, 255]) => pixels.set(color, (y * BACKDROP_WIDTH + x) * 4)

test('candidate definitions satisfy every backdrop invariant', () => {
  assert.equal(BACKDROP_DEFINITIONS.length, 3)
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const stats = validateBackdrop(definition, pixels)
    assert.equal(stats.components, 1)
    assert.ok(stats.opaquePixels >= 3000 && stats.opaquePixels <= 3350)
    assert.deepEqual(stats.alphaValues, [0, 255])
  }
})

test('edge contact and a detached island are rejected', () => {
  const edge = blank(); put(edge, 0, 20)
  assert.throws(() => validateBackdrop(BACKDROP_DEFINITIONS[0], edge), /edge|component|area/i)
  const pixels = renderBackdrop(BACKDROP_DEFINITIONS[0]); put(pixels, 94, 1)
  assert.equal(analyzeBackdrop(pixels).components, 2)
  assert.throws(() => validateBackdrop(BACKDROP_DEFINITIONS[0], pixels), /component/i)
})

test('legendary palette meets explicit luminance floors', () => {
  const legendary = BACKDROP_DEFINITIONS.find(item => item.rarity === 'L')
  assert.ok(relativeLuminance(legendary.base) >= 0.55)
  for (const color of legendary.decorations) assert.ok(relativeLuminance(color) >= 0.35)
})

test('decorations never alter the alpha mask', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const stats = analyzeBackdrop(pixels)
    assert.equal(stats.opaquePixels, definition.expectedOpaquePixels)
    assert.equal(stats.components, 1)
  }
})

test('themes keep decoration pixels in the upper side regions visible around a cat', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const decorationRgb = new Set(definition.decorations.map(color => color.slice(1).toLowerCase()))
    let visible = 0
    for (let y = 7; y <= 20; y++) for (let x = 1; x <= 94; x++) {
      if (x > 33 && x < 62) continue
      const offset = (y * BACKDROP_WIDTH + x) * 4
      const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => value.toString(16).padStart(2, '0')).join('')
      if (pixels[offset + 3] && decorationRgb.has(color)) visible++
    }
    assert.ok(visible >= 8, `${definition.id}: only ${visible} upper-side decoration pixels`)
  }
})

test('each motif keeps a readable footprint in the exposed side panels', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const counts = new Map(definition.decorations.map(color => [color.slice(1).toLowerCase(), 0]))
    for (let y = 0; y < BACKDROP_HEIGHT; y++) for (let x = 0; x < BACKDROP_WIDTH; x++) {
      if (x > 22 && x < 73) continue
      const offset = (y * BACKDROP_WIDTH + x) * 4
      const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
        .map(value => value.toString(16).padStart(2, '0')).join('')
      if (counts.has(color)) counts.set(color, counts.get(color) + 1)
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    assert.ok(total >= 140, `${definition.id}: only ${total} side-panel motif pixels`)
    for (const [color, count] of counts) {
      assert.ok(count >= 24, `${definition.id}: only ${count} side-panel pixels for #${color}`)
    }
  }
})

test('silhouettes read as wide brush backdrops behind the cat instead of tall badges', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const stats = analyzeBackdrop(renderBackdrop(definition))
    assert.ok(stats.bounds.top === 7, `${definition.id}: top ${stats.bounds.top}`)
    assert.ok(stats.bounds.bottom >= 54 && stats.bounds.bottom <= 55, `${definition.id}: bottom ${stats.bounds.bottom}`)
    assert.ok(stats.bounds.right - stats.bounds.left + 1 >= 89, `${definition.id}: width`)
    assert.ok(stats.opaquePixels >= 3000 && stats.opaquePixels <= 3350, `${definition.id}: area ${stats.opaquePixels}`)
  }
})

test('brush ends use rounded pixel shoulders instead of straight triangular ramps', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const rows = []
    for (let y = 0; y < BACKDROP_HEIGHT; y++) {
      let left = BACKDROP_WIDTH; let right = -1
      for (let x = 0; x < BACKDROP_WIDTH; x++) if (pixels[(y * BACKDROP_WIDTH + x) * 4 + 3]) {
        left = Math.min(left, x); right = Math.max(right, x)
      }
      if (right >= 0) rows.push({ left, right })
    }
    let shoulderRows = 0
    for (let index = 1; index < rows.length; index++) {
      if (rows[index].left === rows[index - 1].left || rows[index].right === rows[index - 1].right) shoulderRows++
    }
    assert.ok(shoulderRows >= 8, `${definition.id}: only ${shoulderRows} rounded shoulder rows`)
  }
})

test('backdrops keep a broad exposed crown and outer-side area around full-stack parts', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    let crownPixels = 0
    let outerSidePixels = 0
    for (let y = 1; y < BACKDROP_HEIGHT - 1; y++) for (let x = 1; x < BACKDROP_WIDTH - 1; x++) {
      if (!pixels[(y * BACKDROP_WIDTH + x) * 4 + 3]) continue
      if (y <= 14) crownPixels++
      if (x <= 15 || x >= 80) outerSidePixels++
    }
    assert.ok(crownPixels >= 400, `${definition.id}: only ${crownPixels} exposed crown pixels`)
    assert.ok(outerSidePixels >= 300, `${definition.id}: only ${outerSidePixels} outer-side pixels`)
  }
})
