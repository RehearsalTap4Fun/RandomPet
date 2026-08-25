import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportCanvas, primeCanvasExport } from './export.js'

function makeCanvasProbe(resultType: string | null): {
  canvas: HTMLCanvasElement
  toBlob: ReturnType<typeof vi.fn>
} {
  const toBlob = vi.fn((callback: BlobCallback) => {
    callback(resultType === null ? null : new Blob(['pixels'], { type: resultType }))
  })
  return {
    canvas: { toBlob } as unknown as HTMLCanvasElement,
    toBlob,
  }
}

describe('export capabilities', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('always exposes PNG and reports WebP by the browser probe result', async () => {
    const { detectExportCapabilities } = await import('./export.js')
    const fallback = makeCanvasProbe('image/png')

    const capabilities = await detectExportCapabilities(() => fallback.canvas)

    expect(capabilities).toEqual({ png: true, webp: false })
    expect(fallback.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp')
  })

  it('caches the WebP probe promise for the browser session', async () => {
    const { detectExportCapabilities } = await import('./export.js')
    const supported = makeCanvasProbe('image/webp')
    const createCanvas = vi.fn(() => supported.canvas)

    const first = detectExportCapabilities(createCanvas)
    const second = detectExportCapabilities(createCanvas)

    await expect(first).resolves.toEqual({ png: true, webp: true })
    expect(second).toBe(first)
    expect(createCanvas).toHaveBeenCalledTimes(1)
    expect(supported.toBlob).toHaveBeenCalledTimes(1)
  })
})

describe('canvas export', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses a PNG blob primed outside the export click path', async () => {
    const blob = new Blob(['pixels'], { type: 'image/png' })
    const drawImage = vi.fn()
    const convertToBlob = vi.fn(async () => blob)
    class FakeOffscreenCanvas {
      public constructor(_width: number, _height: number) {}
      public getContext() { return { drawImage } }
      public convertToBlob = convertToBlob
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    const canvas = { width: 1024, height: 1024 } as HTMLCanvasElement

    await primeCanvasExport(canvas, 'image/png')
    const exported = await exportCanvas(canvas, 'image/png')

    expect(exported).toBe(blob)
    expect(convertToBlob).toHaveBeenCalledTimes(1)
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0)
  })

  it('exports PNG through toBlob', async () => {
    const png = makeCanvasProbe('image/png')

    const blob = await exportCanvas(png.canvas, 'image/png')

    expect(blob.type).toBe('image/png')
    expect(png.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
  })

  it('rejects unsupported WebP without affecting non-image workflows', async () => {
    const unsupported = makeCanvasProbe('image/png')

    await expect(exportCanvas(unsupported.canvas, 'image/webp')).rejects.toMatchObject({
      code: 'WEBP_EXPORT_UNSUPPORTED',
    })
  })

  it.each([
    ['image/png', 'PNG_EXPORT_FAILED'],
    ['image/webp', 'WEBP_EXPORT_UNSUPPORTED'],
  ] as const)('rejects a null %s blob explicitly', async (mime, code) => {
    const failed = makeCanvasProbe(null)

    await expect(exportCanvas(failed.canvas, mime)).rejects.toMatchObject({ code })
  })
})
