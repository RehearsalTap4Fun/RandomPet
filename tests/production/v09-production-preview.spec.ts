import { expect, test } from '@playwright/test'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const DIST = join(process.cwd(), 'apps', 'creator-web', 'dist')

async function distFiles(directory = DIST): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? distFiles(path) : [path]
  }))).flat()
}

test('production preview renders v0.9 through the single content store', async ({ page }) => {
  const files = await distFiles()
  const relativeFiles = files.map(path => relative(DIST, path).replaceAll('\\', '/'))
  const contentFiles = relativeFiles.filter(path => /^v09-resources\/[a-f0-9]{64}$/u.test(path))
  const totalBytes = (await Promise.all(files.map(path => stat(path)))).reduce((sum, item) => sum + item.size, 0)

  expect(relativeFiles.filter(path => /_raw-[^/]+\.js$/u.test(path))).toEqual([])
  expect(contentFiles).toHaveLength(1_588)
  expect(totalBytes).toBeLessThan(2_000_000_000)

  const contentResponses: string[] = []
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/v09-resources/')) contentResponses.push(path)
  })
  await page.goto('/v09-preview-test.html')
  await expect(page.locator('body')).toHaveAttribute('data-preview-status', 'committed', { timeout: 120_000 })
  expect(contentResponses.length).toBeGreaterThan(0)
  expect(contentResponses.every(path => /^\/v09-resources\/[a-f0-9]{64}$/u.test(path))).toBe(true)
})
