import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('acceptance uses the production resolver and consumes a seed only once', async ({ page }) => {
  test.setTimeout(120_000)
  const pointer = JSON.parse(await readFile('packages/asset-catalog/releases/candidate-v0.9.0.json', 'utf8'))
  await page.goto('/v09-user-review.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const identity = await page.evaluate(pointer => window.initializeV09Review(pointer), pointer)
  expect(identity.manifestHash).toBe('e9ec104f13c2fcc2559cfddb648f3e5af18daf910a890d4c3c7ed80aecb6fb21')
  const output = await page.evaluate(() => window.renderV09ReviewOnce('task12-lifecycle-probe'))
  expect(output.trace).toHaveLength(21)
  expect(output.identityTransforms).toBe(true)
  expect(output.dataUrl).toMatch(/^data:image\/png;base64,/u)
  expect(JSON.stringify(output.incubator)).toContain(identity.manifestHash)
  await expect(page.evaluate(() => window.renderV09ReviewOnce('task12-lifecycle-probe'))).rejects.toThrow(/already consumed/)
})
