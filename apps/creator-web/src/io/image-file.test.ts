import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeValidMonsterSpecFixture } from '@qmonster/generator-core/test-fixtures'
import { downloadRenderedImage } from './image-file.js'

function makeCanvas(encodedMime: string | null) {
  const canvas = document.createElement('canvas')
  const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback, requestedMime) => {
    callback(encodedMime === null ? null : new Blob(['pixels'], { type: encodedMime }))
  })
  return { canvas, toBlob }
}

function installDownloadSpies() {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:qmonster-image')
  const revokeObjectURL = vi.fn((_url: string) => undefined)
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  })
  let clickedAnchor: HTMLAnchorElement | undefined
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedAnchor = this
  })
  return {
    createObjectURL,
    revokeObjectURL,
    click,
    get clickedAnchor() { return clickedAnchor },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadRenderedImage', () => {
  it.each([
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ] as const)('propagates %s and downloads the exact %s filename', async (mime, extension) => {
    const spec = makeValidMonsterSpecFixture()
    const { canvas, toBlob } = makeCanvas(mime)
    const download = installDownloadSpies()

    await downloadRenderedImage(canvas, spec, mime)

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), mime)
    const blob = download.createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe(mime)
    const anchor = download.clickedAnchor!
    expect(anchor.download).toBe(`qmonster-fungal-84721937.${extension}`)
    expect(anchor.href).toBe('blob:qmonster-image')
    expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:qmonster-image')
    expect(download.click.mock.invocationCallOrder[0]).toBeLessThan(
      download.revokeObjectURL.mock.invocationCallOrder[0]!,
    )
  })

  it('revokes the object URL in finally when the synthetic click throws', async () => {
    const spec = makeValidMonsterSpecFixture()
    const { canvas } = makeCanvas('image/png')
    const { revokeObjectURL, click } = installDownloadSpies()
    const clickError = new Error('download blocked')
    click.mockImplementation(() => { throw clickError })

    await expect(downloadRenderedImage(canvas, spec, 'image/png')).rejects.toBe(clickError)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qmonster-image')
  })

  it('propagates WEBP_EXPORT_UNSUPPORTED without creating an object URL', async () => {
    const spec = makeValidMonsterSpecFixture()
    const { canvas } = makeCanvas('image/png')
    const { createObjectURL, revokeObjectURL, click } = installDownloadSpies()

    await expect(downloadRenderedImage(canvas, spec, 'image/webp')).rejects.toMatchObject({
      name: 'CanvasExportError',
      code: 'WEBP_EXPORT_UNSUPPORTED',
    })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
