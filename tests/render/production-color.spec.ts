import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const repositoryRoot = process.cwd()
const catalogPath = join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.1.0', 'catalog.json')
const assetRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.1.0')

async function serveProduction(page: Page): Promise<void> {
  await page.route('**/production-catalog.json', async route => {
    await route.fulfill({ contentType: 'application/json', body: await readFile(catalogPath) })
  })
  await page.route('**/production-assets/**', async route => {
    const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/production-assets/')[1] ?? '')
    const resolved = normalize(join(assetRoot, relativePath))
    if (!resolved.startsWith(normalize(assetRoot))) throw new Error(`Asset route escaped root: ${relativePath}`)
    await route.fulfill({ path: resolved })
  })
}

test('all production color schemes preserve compatible-rig alpha and luminance volume', async ({ page }) => {
  await serveProduction(page)
  const combinations = [
    ['color_deep_sea_coral', 'blob'], ['color_deep_sea_coral', 'biped'], ['color_deep_sea_coral', 'floating'],
    ['color_fungal_amber', 'blob'], ['color_fungal_amber', 'biped'], ['color_fungal_amber', 'floating'],
    ['color_shadow_violet', 'blob'], ['color_shadow_violet', 'biped'], ['color_shadow_violet', 'floating'],
  ] as const
  for (const [partId, rigId] of combinations) {
    await page.goto(`/production-render-test.html?rig=${rigId}&part=${partId}`)
    await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
    const renderError = await page.evaluate(() => document.body.dataset.renderError)
    expect(renderError, `${partId}/${rigId}`).toBeUndefined()
    const metrics = await page.evaluate(() => {
      const rendered = document.querySelector<HTMLCanvasElement>('#render-target')!
      const base = document.querySelector<HTMLCanvasElement>('#base-target')!
      const renderedPixels = rendered.getContext('2d')!.getImageData(0, 0, rendered.width, rendered.height).data
      const basePixels = base.getContext('2d')!.getImageData(0, 0, base.width, base.height).data
      let outsideBodyPixels = 0
      let alphaDeltaPixels = 0
      let changedOpaquePixels = 0
      let maxLuminanceDelta = 0
      for (let offset = 0; offset < renderedPixels.length; offset += 4) {
        const renderedAlpha = renderedPixels[offset + 3]!
        const baseAlpha = basePixels[offset + 3]!
        if (renderedAlpha > 0 && baseAlpha === 0) outsideBodyPixels += 1
        if (renderedAlpha !== baseAlpha) alphaDeltaPixels += 1
        if (renderedAlpha !== 255 || baseAlpha !== 255) continue
        const baseRgb = [basePixels[offset]!, basePixels[offset + 1]!, basePixels[offset + 2]!]
        const renderedRgb = [renderedPixels[offset]!, renderedPixels[offset + 1]!, renderedPixels[offset + 2]!]
        if (baseRgb.some((value, channel) => Math.abs(value - renderedRgb[channel]!) > 4)) changedOpaquePixels += 1
        const luminance = (rgb: number[]) => rgb[0]! * 0.3 + rgb[1]! * 0.59 + rgb[2]! * 0.11
        maxLuminanceDelta = Math.max(maxLuminanceDelta, Math.abs(luminance(baseRgb) - luminance(renderedRgb)))
      }
      return { outsideBodyPixels, alphaDeltaPixels, changedOpaquePixels, maxLuminanceDelta }
    })
    expect(metrics, `${partId}/${rigId}`).toMatchObject({
      outsideBodyPixels: 0,
      alphaDeltaPixels: 0,
    })
    expect(metrics.changedOpaquePixels, `${partId}/${rigId}`).toBeGreaterThan(250_000)
    expect(metrics.maxLuminanceDelta, `${partId}/${rigId}`).toBeLessThanOrEqual(2)
  }
})
