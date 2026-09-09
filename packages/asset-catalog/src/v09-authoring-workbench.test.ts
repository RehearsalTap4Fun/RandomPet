import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { decodedPngSha256, V09CatalogError } from './v09-content-identity.js'
import { enforceAuthoringZone, injectFixedRootStencil } from './v09-authoring-workbench.js'

const SIZE = 2048

async function png(points: readonly (readonly [number, number, number, number, number])[], size = SIZE): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size * 4)
  for (const [x, y, r, g, b] of points) {
    const offset = (y * size + x) * 4
    pixels[offset] = r
    pixels[offset + 1] = g
    pixels[offset + 2] = b
    pixels[offset + 3] = 255
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

function rejected(code: string): { asymmetricMatch(value: unknown): boolean } {
  return {
    asymmetricMatch(value: unknown): boolean {
      return value instanceof V09CatalogError && value.code === code
    },
  }
}

describe('v0.9 full-master authoring workbench', () => {
  it('rejects one changed full-context pixel outside its zone', async () => {
    const zone = await png([[10, 10, 0, 0, 0]])
    const neutral = await png([])
    const candidate = await png([[11, 10, 1, 2, 3]])

    await expect(enforceAuthoringZone({ mode: 'full-context', candidate, authoringZone: zone, neutralMaster: neutral }))
      .rejects.toEqual(rejected('AUTHORING_ZONE_VIOLATION'))
  })

  it('rejects one visible exported-layer pixel outside its zone', async () => {
    const zone = await png([[10, 10, 0, 0, 0]])
    const candidate = await png([[11, 10, 1, 2, 3]])

    await expect(enforceAuthoringZone({ mode: 'exported-layer', candidate, authoringZone: zone }))
      .rejects.toEqual(rejected('AUTHORING_ZONE_VIOLATION'))
  })

  it('rejects a non-binary, empty, or wrongly sized authoring zone', async () => {
    const candidate = await png([])
    const empty = await png([])
    const raw = Buffer.alloc(SIZE * SIZE * 4)
    raw[3] = 4
    const nonBinary = await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer()
    const wrong = await png([], 8)

    await expect(enforceAuthoringZone({ mode: 'exported-layer', candidate, authoringZone: empty }))
      .rejects.toEqual(rejected('AUTHORING_ZONE_VIOLATION'))
    await expect(enforceAuthoringZone({ mode: 'exported-layer', candidate, authoringZone: nonBinary }))
      .rejects.toEqual(rejected('AUTHORING_ZONE_VIOLATION'))
    await expect(enforceAuthoringZone({ mode: 'exported-layer', candidate, authoringZone: wrong }))
      .rejects.toEqual(rejected('AUTHORING_ZONE_VIOLATION'))
  })

  it('injects a fixed root stencil pixel-exactly and deterministically', async () => {
    const layer = await png([[10, 10, 1, 2, 3]])
    const stencil = await png([[10, 10, 20, 30, 40], [11, 10, 50, 60, 70]])

    const first = await injectFixedRootStencil(layer, stencil)
    const second = await injectFixedRootStencil(layer, stencil)
    const firstPixels = await sharp(first).raw().toBuffer()
    const offset = (10 * SIZE + 10) * 4

    expect(firstPixels.subarray(offset, offset + 8)).toEqual(Buffer.from([20, 30, 40, 255, 50, 60, 70, 255]))
    expect(await decodedPngSha256(first)).toBe(await decodedPngSha256(second))
  })
})
