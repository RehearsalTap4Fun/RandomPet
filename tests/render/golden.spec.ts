import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  assertGoldenUpdateProject,
  isGoldenUpdateRequested,
  replaceGoldenPair,
  resolveGoldenPaths,
} from '../../scripts/render-golden-update.js'

const goldenPaths = resolveGoldenPaths(import.meta.url)
const updateRequested = isGoldenUpdateRequested(process.env)

test.beforeEach(({}, testInfo) => {
  assertGoldenUpdateProject(updateRequested, testInfo.project.name)
})

async function waitForRender(page: Page, size = 1024): Promise<void> {
  await page.goto(`/render-test.html?size=${size}`)
  await page.waitForFunction(() => (
    document.body.dataset.renderComplete === 'true'
    || document.body.dataset.renderError !== undefined
  ))
  const renderError = await page.evaluate(() => document.body.dataset.renderError)
  if (renderError !== undefined) throw new Error(renderError)
}

async function renderedRgbaHash(page: Page): Promise<{
  width: number
  height: number
  hash: string
}> {
  const rendered = await page.locator('#render-target').evaluate((element) => {
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
  return {
    width: rendered.width,
    height: rendered.height,
    hash: createHash('sha256').update(Buffer.from(rendered.rgbaBase64, 'base64')).digest('hex'),
  }
}

test('matches the reviewed RGBA golden', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Reviewed RGBA golden belongs to bundled Chromium')
  await waitForRender(page)
  const target = page.locator('#render-target')
  const rendered = await renderedRgbaHash(page)
  expect(rendered).toMatchObject({ width: 1024, height: 1024 })

  if (updateRequested) {
    await replaceGoldenPair({
      hashPath: goldenPaths.hash,
      reviewPath: goldenPaths.review,
      hash: rendered.hash,
      async writeReview(temporaryPath) {
        await target.screenshot({ path: temporaryPath, omitBackground: true })
      },
    })
  }

  const expectedHash = (await readFile(goldenPaths.hash, 'utf8')).trim()
  expect(rendered.hash).toBe(expectedHash)
})

test('renders deterministic RGBA pixels within the current browser engine', async ({ context, page }) => {
  await waitForRender(page)
  const first = await renderedRgbaHash(page)
  const secondPage = await context.newPage()
  try {
    await waitForRender(secondPage)
    const second = await renderedRgbaHash(secondPage)
    expect(second).toEqual(first)
  } finally {
    await secondPage.close()
  }
})

test('surfaces renderer diagnostics without waiting for a timeout', async ({ page }) => {
  page.setDefaultTimeout(1_500)
  await page.route('**/render-fixtures/synthetic-spec.json', async (route) => {
    const response = await route.fetch()
    const spec = await response.json() as {
      visualSlots: { eyes: { partId: string } }
    }
    spec.visualSlots.eyes.partId = 'missing-synthetic-eyes'
    await route.fulfill({ response, json: spec })
  })

  await expect(waitForRender(page)).rejects.toThrow('SPEC_PART_MISSING')
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
