import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('production bundle renders a ready creature and exports a real WebP', async ({ page }) => {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', error => pageErrors.push(error))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', request => failedRequests.push(request.url()))
  await page.addInitScript(() => {
    const nativeCreateObjectUrl = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) {
        ;(window as typeof window & { __qmonsterLastExportMime?: string }).__qmonsterLastExportMime = object.type
      }
      return nativeCreateObjectUrl(object)
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(pageErrors.map(error => error.message)).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
  await expect(page.getByRole('heading', { name: '怪奇生物生成器' })).toBeVisible()
  // Exercise a deterministic production-safe structural path rather than
  // coupling the smoke test to whichever optional tail/extra parts a seed rolls.
  await page.locator('#slot-control-tail').selectOption('tail_none')
  await page.locator('#slot-control-extraAppendage').selectOption('extra_appendage_none')
  await expect(page.getByText('组合状态良好')).toBeVisible()
  const preview = page.getByRole('img', { name: '生物预览' })
  await expect(preview).toBeVisible()
  expect(await preview.evaluate(canvas => {
    const element = canvas as HTMLCanvasElement
    const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data
    return pixels !== undefined && pixels.some((value, index) => index % 4 === 3 && value > 0)
  })).toBe(true)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出透明 WebP' }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(download.suggestedFilename()).toMatch(/^qmonster-.+\.webp$/u)
  const bytes = await readFile(await download.path())
  expect(bytes.byteLength).toBeGreaterThan(12)
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  expect(await page.evaluate(() => (
    window as typeof window & { __qmonsterLastExportMime?: string }
  ).__qmonsterLastExportMime)).toBe('image/webp')
})
