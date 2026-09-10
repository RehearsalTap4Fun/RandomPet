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
  await page.addInitScript(() => {
    const counts = { created: 0, closed: 0, duplicateCloses: 0 }
    Object.assign(window, { bitmapLifecycle: counts })
    const create = window.createImageBitmap.bind(window)
    const close = ImageBitmap.prototype.close
    const owned = new WeakSet<ImageBitmap>()
    const closed = new WeakSet<ImageBitmap>()
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await create(...args)
      owned.add(bitmap); counts.created += 1
      return bitmap
    }) as typeof createImageBitmap
    ImageBitmap.prototype.close = function () {
      if (owned.has(this)) {
        if (closed.has(this)) counts.duplicateCloses += 1
        else { closed.add(this); counts.closed += 1 }
      }
      close.call(this)
    }
  })
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/v09-resources/')) contentResponses.push(path)
  })
  await page.goto('/v09-preview-test.html')
  await expect(page.locator('body')).toHaveAttribute('data-preview-status', 'committed', { timeout: 120_000 })
  expect(contentResponses.length).toBeGreaterThan(0)
  expect(contentResponses.every(path => /^\/v09-resources\/[a-f0-9]{64}$/u.test(path))).toBe(true)
  const lifecycle = await page.evaluate(() => (window as unknown as { bitmapLifecycle: { created: number; closed: number; duplicateCloses: number } }).bitmapLifecycle)
  console.info('Single-frame ImageBitmap lifecycle:', lifecycle)
  expect(lifecycle.created).toBeGreaterThan(0)
  expect(lifecycle.closed).toBe(lifecycle.created)
  expect(lifecycle.duplicateCloses).toBe(0)
})
