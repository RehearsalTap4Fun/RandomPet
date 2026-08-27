import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { expect, test } from '@playwright/test'

const repositoryRoot = process.cwd()
const catalogPath = join(repositoryRoot, 'packages', 'asset-catalog', 'catalog', 'v0.2.0', 'catalog.json')
const assetRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.2.0')
const catalogBytes = await readFile(catalogPath)

test('production review uses composition metrics and resolves both mushroom-leg nodes', async ({ page }) => {
  await page.route('**/production-catalog.json', route => route.fulfill({
    contentType: 'application/json', body: catalogBytes,
  }))
  await page.route('**/production-assets/**', route => {
    const asset = decodeURIComponent(new URL(route.request().url()).pathname.split('/production-assets/')[1] ?? '')
    const resolved = normalize(join(assetRoot, asset))
    const remainder = relative(assetRoot, resolved)
    if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error(`Asset route escaped root: ${asset}`)
    return route.fulfill({ path: resolved })
  })

  await page.goto('/production-render-test.html?contact=1&rig=biped&part=legs_mushroom')
  await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)

  expect(await page.evaluate(() => document.body.dataset.renderError)).toBeUndefined()
  expect(await page.evaluate(() => document.body.dataset.rendererVersion)).toBe('0.2.0')
  const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.renderEvidence))!)
  expect(evidence.compositionMetrics).not.toBeNull()
  expect(evidence.resolvedAssetPaths).toEqual(expect.arrayContaining([
    'nodes/legs_mushroom/left.webp',
    'nodes/legs_mushroom/right.webp',
  ]))
})
