import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BACKDROP_DEFINITIONS,
  analyzeBackdrop,
  renderBackdrop,
  relativeLuminance,
  validateBackdrop,
} from './lib/pixel-backdrop-art.mjs'

const blank = () => new Uint8ClampedArray(64 * 64 * 4)
const put = (pixels, x, y, color = [255, 255, 255, 255]) => pixels.set(color, (y * 64 + x) * 4)

test('approved definitions satisfy every backdrop invariant', () => {
  assert.equal(BACKDROP_DEFINITIONS.length, 3)
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const stats = validateBackdrop(definition, pixels)
    assert.equal(stats.components, 1)
    assert.ok(stats.opaquePixels >= 1900 && stats.opaquePixels <= 2450)
    assert.deepEqual(stats.alphaValues, [0, 255])
  }
})

test('edge contact and a detached island are rejected', () => {
  const edge = blank(); put(edge, 0, 20)
  assert.throws(() => validateBackdrop(BACKDROP_DEFINITIONS[0], edge), /edge|component|area/i)
  const pixels = renderBackdrop(BACKDROP_DEFINITIONS[0]); put(pixels, 62, 1)
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
    for (let y = 8; y <= 20; y++) for (let x = 1; x <= 62; x++) {
      if (x > 18 && x < 45) continue
      const offset = (y * 64 + x) * 4
      const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(value => value.toString(16).padStart(2, '0')).join('')
      if (pixels[offset + 3] && decorationRgb.has(color)) visible++
    }
    assert.ok(visible >= 8, `${definition.id}: only ${visible} upper-side decoration pixels`)
  }
})

test('silhouettes read as wide brush backdrops behind the cat instead of tall badges', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const stats = analyzeBackdrop(renderBackdrop(definition))
    assert.ok(stats.bounds.top >= 8 && stats.bounds.top <= 12, `${definition.id}: top ${stats.bounds.top}`)
    assert.ok(stats.bounds.bottom >= 49 && stats.bounds.bottom <= 54, `${definition.id}: bottom ${stats.bounds.bottom}`)
    assert.ok(stats.bounds.right - stats.bounds.left + 1 >= 60, `${definition.id}: width`)
    assert.ok(stats.opaquePixels >= 1900 && stats.opaquePixels <= 2450, `${definition.id}: area ${stats.opaquePixels}`)
  }
})

test('brush ends use rounded pixel shoulders instead of straight triangular ramps', () => {
  for (const definition of BACKDROP_DEFINITIONS) {
    const pixels = renderBackdrop(definition)
    const rows = []
    for (let y = 0; y < 64; y++) {
      let left = 64; let right = -1
      for (let x = 0; x < 64; x++) if (pixels[(y * 64 + x) * 4 + 3]) {
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
