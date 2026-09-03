import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { generateMonster, parseCatalog } from '@qmonster/generator-core'

const hashPath = fileURLToPath(new URL('./golden/first-hatch-v0.2.rgba.sha256', import.meta.url))
const reviewPath = fileURLToPath(new URL('./golden/first-hatch-v0.2.review.png', import.meta.url))
const v03HashPath = fileURLToPath(new URL('./golden/first-hatch-v0.3.rgba.sha256', import.meta.url))
const v03ReviewPath = fileURLToPath(new URL('./golden/first-hatch-v0.3.review.png', import.meta.url))
const catalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.2.0/catalog.json', import.meta.url))
const v03CatalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.3.0/catalog.json', import.meta.url))
const v04CatalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.4.0/catalog.json', import.meta.url))
const v05CatalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.5.0/catalog.json', import.meta.url))
const parsedCatalog = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
if (!parsedCatalog.ok) throw new Error('Production v0.2.0 catalog is invalid.')
const firstHatch = generateMonster({
  seed: 'qmonster-v0.1-first-hatch',
  themeId: 'fungal',
  mode: 'normal',
}, parsedCatalog.value)
if (firstHatch.blocked || firstHatch.diagnostics.length > 0) {
  throw new Error(`First-hatch generation failed: ${JSON.stringify(firstHatch.diagnostics)}`)
}
const parsedV03Catalog = parseCatalog(JSON.parse(readFileSync(v03CatalogPath, 'utf8')))
if (!parsedV03Catalog.ok) throw new Error('Production v0.3.0 catalog is invalid.')
const firstHatchV03 = generateMonster({
  seed: 'qmonster-v0.1-first-hatch',
  themeId: 'fungal',
  mode: 'normal',
}, parsedV03Catalog.value)
if (firstHatchV03.blocked || firstHatchV03.diagnostics.length > 0) {
  throw new Error(`First-hatch v0.3 generation failed: ${JSON.stringify(firstHatchV03.diagnostics)}`)
}
const parsedV04Catalog = parseCatalog(JSON.parse(readFileSync(v04CatalogPath, 'utf8')))
if (!parsedV04Catalog.ok) throw new Error('Production v0.4.0 catalog is invalid.')
const firstHatchV04 = generateMonster({
  seed: 'qmonster-v0.1-first-hatch',
  themeId: 'fungal',
  mode: 'normal',
}, parsedV04Catalog.value)
if (firstHatchV04.blocked || firstHatchV04.diagnostics.length > 0) {
  throw new Error(`First-hatch v0.4 generation failed: ${JSON.stringify(firstHatchV04.diagnostics)}`)
}
const parsedV05Catalog = parseCatalog(JSON.parse(readFileSync(v05CatalogPath, 'utf8')))
if (!parsedV05Catalog.ok) throw new Error('Production v0.5.0 catalog is invalid.')
const firstHatchV05 = generateMonster({
  seed: 'qmonster-v0.1-first-hatch',
  themeId: 'fungal',
  mode: 'normal',
}, parsedV05Catalog.value)
if (firstHatchV05.blocked || firstHatchV05.diagnostics.length > 0) {
  throw new Error(`First-hatch v0.5 generation failed: ${JSON.stringify(firstHatchV05.diagnostics)}`)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

test('matches the reviewed first-hatch decoded RGBA golden', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Reviewed first-hatch golden belongs to bundled Chromium')
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const rendered = await page.evaluate(async spec => window.renderAcceptanceMonster(spec), firstHatch.spec)
  expect(rendered.diagnostics).toEqual([])
  expect(rendered.compositionMetrics).toEqual(expect.objectContaining({
    eyesInsideRatio: expect.any(Number),
    eyesVisibleRatio: expect.any(Number),
    mouthInsideRatio: expect.any(Number),
    mouthVisibleRatio: expect.any(Number),
    oralDetailInsideRatio: expect.any(Number),
    oralDetailVisibleRatio: expect.any(Number),
  }))

  const canvas = page.getByRole('img', { name: '生物预览' })
  const decoded = await canvas.evaluate(element => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('2d')
    if (context === null) throw new Error('2D context unavailable.')
    const pixels = context.getImageData(0, 0, target.width, target.height).data
    let binary = ''
    for (let offset = 0; offset < pixels.length; offset += 32_768) {
      binary += String.fromCharCode(...pixels.subarray(offset, offset + 32_768))
    }
    return { width: target.width, height: target.height, rgbaBase64: btoa(binary) }
  })
  expect(decoded).toMatchObject({ width: 1024, height: 1024 })
  const actualHash = createHash('sha256')
    .update(Buffer.from(decoded.rgbaBase64, 'base64'))
    .digest('hex')
  console.log(`QM_FIRST_HATCH_RGBA_SHA256=${actualHash}`)

  if (!await fileExists(hashPath)) {
    await canvas.screenshot({ path: reviewPath, omitBackground: true })
  }
  const expectedHash = (await readFile(hashPath, 'utf8')).trim()
  expect(actualHash).toBe(expectedHash)
})

test('matches the reviewed v0.3 first-hatch decoded RGBA golden with connector evidence [current-machine]', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Reviewed v0.3 first-hatch golden belongs to bundled Chromium')
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const rendered = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.3.0')
  ), firstHatchV03.spec)
  expect(rendered.diagnostics).toEqual([])
  expect(rendered.connectorMetrics).not.toBeNull()
  expect(rendered.connectorMetrics?.length).toBeGreaterThan(0)
  expect(rendered.connectorMetrics?.every(metric => (
    metric.receiverCoverage >= 0.62
    && metric.plugCoverage >= 0.9
    && metric.largestComponentRatio >= 0.99
    && metric.centerlineGapPixels <= 2
    && (!/^(shoulder|hip)/u.test(metric.connectorId)
      || (metric.childOutsideBodyRatio ?? 0) >= 0.614)
  ))).toBe(true)
  expect(rendered.compositionMetrics).toEqual(expect.objectContaining({
    eyesInsideRatio: expect.any(Number),
    eyesVisibleRatio: expect.any(Number),
    mouthInsideRatio: expect.any(Number),
    mouthVisibleRatio: expect.any(Number),
    oralDetailInsideRatio: expect.any(Number),
    oralDetailVisibleRatio: expect.any(Number),
    visibleBounds: expect.any(Object),
  }))
  console.log(`QM_FIRST_HATCH_V03_METRICS=${JSON.stringify({
    compositionMetrics: rendered.compositionMetrics,
    connectorMetrics: rendered.connectorMetrics,
  })}`)
  expect(rendered.resolvedAssetPaths.length).toBeGreaterThan(0)

  const canvas = page.getByRole('img', { name: '生物预览' })
  const decoded = await canvas.evaluate(element => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('2d')
    if (context === null) throw new Error('2D context unavailable.')
    const pixels = context.getImageData(0, 0, target.width, target.height).data
    let binary = ''
    for (let offset = 0; offset < pixels.length; offset += 32_768) {
      binary += String.fromCharCode(...pixels.subarray(offset, offset + 32_768))
    }
    return { width: target.width, height: target.height, rgbaBase64: btoa(binary) }
  })
  expect(decoded).toMatchObject({ width: 1024, height: 1024 })
  const actualHash = createHash('sha256')
    .update(Buffer.from(decoded.rgbaBase64, 'base64'))
    .digest('hex')
  console.log(`QM_FIRST_HATCH_V03_RGBA_SHA256=${actualHash}`)

  if (!await fileExists(v03HashPath)) {
    await canvas.screenshot({ path: v03ReviewPath, omitBackground: true })
  }
  const expectedHash = (await readFile(v03HashPath, 'utf8')).trim()
  expect(actualHash).toBe(expectedHash)
})

test('resolves v0.5, v0.4, and v0.3 specs only from their exact versioned assets', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  const renderedV05 = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.5.0')
  ), firstHatchV05.spec)
  expect(firstHatchV05.spec.visualSlots.tail.partId).toBe('tail_cat_long')
  expect(renderedV05.diagnostics).toEqual([])
  expect(renderedV05.resolvedAssetUrls.length).toBeGreaterThan(0)
  expect(renderedV05.resolvedAssetUrls.every(url => url.includes('/v0.5.0/'))).toBe(true)
  expect(renderedV05.resolvedAssetUrls.some(url => url.includes('/v0.4.0/') || url.includes('/v0.3.0/'))).toBe(false)

  const renderedV04 = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.4.0')
  ), firstHatchV04.spec)
  expect(renderedV04.resolvedAssetUrls.length).toBeGreaterThan(0)
  expect(renderedV04.resolvedAssetUrls.every(url => url.includes('/v0.4.0/'))).toBe(true)
  expect(renderedV04.resolvedAssetUrls.some(url => url.includes('/v0.3.0/'))).toBe(false)

  const renderedV03 = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.3.0')
  ), firstHatchV03.spec)
  expect(renderedV03.resolvedAssetUrls.length).toBeGreaterThan(0)
  expect(renderedV03.resolvedAssetUrls.every(url => url.includes('/v0.3.0/'))).toBe(true)
  expect(renderedV03.resolvedAssetUrls.some(url => url.includes('/v0.4.0/'))).toBe(false)
})

test('rejects a renderer version mismatch for the exact acceptance catalog', async ({ page }) => {
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const mismatchedRendererSpec = {
    ...firstHatchV04.spec,
    rendererVersion: '0.3.0' as const,
  }

  await expect(page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.4.0')
  ), mismatchedRendererSpec)).rejects.toThrow(/exact renderer 0\.4\.0/u)
})

test('reports exact asset URLs again on acceptance image cache hits', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  const firstRender = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.4.0')
  ), firstHatchV04.spec)
  const cachedRender = await page.evaluate(async spec => (
    window.renderAcceptanceMonster(spec, '0.4.0')
  ), firstHatchV04.spec)

  expect(firstRender.resolvedAssetUrls.length).toBeGreaterThan(0)
  expect(cachedRender.resolvedAssetUrls).toEqual(firstRender.resolvedAssetUrls)
})

test('keeps the fixed shadow acceptance mouth above the visibility gate', async ({ page }) => {
  const generated = generateMonster({ seed: '2026082106', themeId: 'shadow', mode: 'normal' }, parsedCatalog.value)
  expect(generated.diagnostics).toEqual([])
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  const rendered = await page.evaluate(async spec => window.renderAcceptanceMonster(spec), generated.spec)

  expect(rendered.diagnostics).toEqual([])
  expect(rendered.compositionMetrics?.mouthVisibleRatio).toBeGreaterThanOrEqual(0.85)
})

test('keeps the fixed fungal floating acceptance eyes above the visibility gate', async ({ page }) => {
  const generated = generateMonster({ seed: '2026082120', themeId: 'fungal', mode: 'normal' }, parsedCatalog.value)
  expect(generated.diagnostics).toEqual([])
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  const rendered = await page.evaluate(async spec => window.renderAcceptanceMonster(spec), generated.spec)

  expect(rendered.diagnostics).toEqual([])
  expect(rendered.compositionMetrics?.eyesVisibleRatio).toBeGreaterThanOrEqual(0.85)
})
