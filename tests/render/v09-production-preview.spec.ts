import { expect, test } from '@playwright/test'

test('PreviewCanvas renders the explicit candidate through the production resolver', async ({ page }) => {
  await page.goto('/v09-preview-test.html')
  await expect(page.locator('body')).toHaveAttribute('data-preview-status', 'committed', { timeout: 120_000 })
  await expect(page.getByRole('img', { name: '生物预览' })).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-preview-diagnostics', '[]')
})
