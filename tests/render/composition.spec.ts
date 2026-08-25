import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { generateMonster, parseCatalog } from '@qmonster/generator-core'

const hashPath = fileURLToPath(new URL('./golden/first-hatch-v0.2.rgba.sha256', import.meta.url))
const reviewPath = fileURLToPath(new URL('./golden/first-hatch-v0.2.review.png', import.meta.url))
const catalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.2.0/catalog.json', import.meta.url))
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
