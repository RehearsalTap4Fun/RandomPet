import { expect, test } from '@playwright/test'

test('production bundle starts the creator workbench without a page error', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(pageErrors.map(error => error.message)).toEqual([])
  expect(await page.locator('body').innerHTML()).not.toBe('')
  await expect(page.getByRole('heading', { name: '怪奇生物生成器' })).toBeVisible()
})
