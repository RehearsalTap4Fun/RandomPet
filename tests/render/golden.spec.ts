import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const goldenDirectory = path.join(process.cwd(), 'tests/render/golden')
const goldenHashPath = path.join(goldenDirectory, 'synthetic-1024.rgba.sha256')
const reviewImagePath = path.join(goldenDirectory, 'synthetic-1024.review.png')

async function waitForRender(page: Page, size = 1024): Promise<void> {
  await page.goto(`/render-test.html?size=${size}`)
  await page.waitForFunction(() => document.body.dataset.renderComplete === 'true')
}

test('matches the reviewed 1024 decoded-pixel golden', async ({ page }) => {
  await waitForRender(page)
  const target = page.locator('#render-target')
  const rendered = await target.evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2D context unavailable')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let binary = ''
    const chunkSize = 32_768
    for (let offset = 0; offset < pixels.length; offset += chunkSize) {
      binary += String.fromCharCode(...pixels.subarray(offset, offset + chunkSize))
    }
    return { width: canvas.width, height: canvas.height, rgbaBase64: btoa(binary) }
  })
  expect(rendered).toMatchObject({ width: 1024, height: 1024 })

  const rgba = Buffer.from(rendered.rgbaBase64, 'base64')
  const actualHash = createHash('sha256').update(rgba).digest('hex')

  if (process.env.UPDATE_GOLDENS === '1') {
    await mkdir(goldenDirectory, { recursive: true })
    await writeFile(goldenHashPath, `${actualHash}\n`)
    await target.screenshot({ path: reviewImagePath, omitBackground: true })
  }

  const expectedHash = (await readFile(goldenHashPath, 'utf8')).trim()
  expect(actualHash).toBe(expectedHash)
})

test('renders 2048 without clipping the transparent crop boundary', async ({ page }) => {
  await waitForRender(page, 2048)

  const metrics = await page.locator('#render-target').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2D context unavailable')
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let nonzeroAlphaPixels = 0
    let boundaryAlphaPixels = 0
    const alphaAt = (x: number, y: number) => data[(y * canvas.width + x) * 4 + 3] ?? 0
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (alphaAt(x, y) !== 0) nonzeroAlphaPixels += 1
      }
    }
    for (let x = 0; x < canvas.width; x += 1) {
      if (alphaAt(x, 0) !== 0) boundaryAlphaPixels += 1
      if (alphaAt(x, canvas.height - 1) !== 0) boundaryAlphaPixels += 1
    }
    for (let y = 1; y < canvas.height - 1; y += 1) {
      if (alphaAt(0, y) !== 0) boundaryAlphaPixels += 1
      if (alphaAt(canvas.width - 1, y) !== 0) boundaryAlphaPixels += 1
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonzeroAlphaPixels,
      boundaryAlphaPixels,
    }
  })

  expect(metrics).toMatchObject({
    width: 2048,
    height: 2048,
    boundaryAlphaPixels: 0,
  })
  expect(metrics.nonzeroAlphaPixels).toBeGreaterThan(0)
})
