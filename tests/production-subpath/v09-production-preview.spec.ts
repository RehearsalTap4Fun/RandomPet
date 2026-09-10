import { expect, test } from '@playwright/test'

test('production preview resolves exact content identities below the configured base path', async ({ page }) => {
  const contentResponses: string[] = []
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.includes('/v09-resources/')) contentResponses.push(path)
  })

  await page.goto('v09-preview-test.html')
  await expect(page.locator('body')).toHaveAttribute('data-preview-status', 'committed', { timeout: 120_000 })
  expect(contentResponses.length).toBeGreaterThan(0)
  expect(contentResponses.every(path => /^\/qmonster\/v09-resources\/[a-f0-9]{64}$/u.test(path))).toBe(true)
})
