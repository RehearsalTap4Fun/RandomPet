import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('active production bundle renders its exact version through the default resolver', async ({ page }) => {
  test.setTimeout(120_000)
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
  await expect.poll(() => page.evaluate(() => (
    performance.getEntriesByName('qmonster-preview-commit', 'mark').length
  )), { timeout: 120_000 }).toBeGreaterThan(0)

  expect(pageErrors.map(error => error.message)).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(failedRequests).toEqual([])
  await expect(page.getByRole('heading', { name: '怪奇生物生成器' })).toBeVisible()
  const active = await readFile('packages/asset-catalog/releases/active-release.json', 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (active !== undefined) {
    const hash = JSON.parse(active).releaseManifestSha256
    await expect(page.getByRole('region', { name: 'v0.9 外观控制' }).locator('fieldset')).toHaveCount(12)
    await expect(page.getByRole('group', { name: '完整骨架', exact: true })).toBeVisible()
    const preview = page.getByRole('img', { name: '生物预览' })
    expect(await preview.evaluate(canvas => {
      const element = canvas as HTMLCanvasElement
      return element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data.some((value, index) => index % 4 === 3 && value > 0)
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('qmonster.creator.session.v1'))).toContain(hash)
    await page.goto('/catalog-report.html')
    await expect(page.getByRole('heading', { name: 'v0.9 原子骨架图鉴' })).toBeVisible({ timeout: 120_000 })
    await expect(page.locator('header code')).toHaveText(hash)
    await expect(page.getByRole('region', { name: 'v0.9 外观槽位' }).getByRole('button', { name: /8\/4\/1/u })).toHaveCount(12)
    expect(pageErrors.map(error => error.message)).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(failedRequests).toEqual([])
    console.info(`Creator and catalog-report active identity: ${hash}`)
    return
  }
  // Exercise a deterministic production-safe structural path rather than
  // coupling the smoke test to whichever optional tail/extra parts a seed rolls.
  // Legacy v0.8 has immutable trait pools, not the pre-v0.8 structural sentinel IDs.
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
