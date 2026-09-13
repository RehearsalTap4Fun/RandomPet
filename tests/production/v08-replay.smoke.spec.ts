import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { generateMonster, parseCatalog } from '@qmonster/generator-core'

test('explicit historical v0.8 fixture preserves PNG identity and real WebP encoding', async ({ page }) => {
  test.setTimeout(120_000)
  const parsed = parseCatalog(JSON.parse(await readFile('packages/asset-catalog/catalog/v0.8.0/catalog.json', 'utf8')))
  if (!parsed.ok) throw new Error('Invalid immutable v0.8 catalog')
  const generated = generateMonster({ seed: 'qmonster-v08-review-001', themeId: 'deep-sea', mode: 'normal', archetypeId: 'feline' }, parsed.value)
  expect(generated.blocked).toBe(false)
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const result = await page.evaluate(spec => window.renderAcceptanceMonster(spec, '0.8.0'), generated.spec)
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  const pngSha256 = createHash('sha256').update(Buffer.from(result.dataUrl.split(',')[1]!, 'base64')).digest('hex')
  console.info('Historical v0.8 replay PNG:', pngSha256)
  // Frozen from clean committed c0c400f before v0.9 activation; legacy pixels are untouched.
  expect(pngSha256).toBe('9bc20b5a768a0968dcd1c9cb3dc840b2294b4c928527437ad48a3380ade9114a')
  const webp = await page.evaluate(async dataUrl => {
    const image = new Image(); image.src = dataUrl; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    canvas.getContext('2d')!.drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp')
  }, result.dataUrl)
  expect(webp).toMatch(/^data:image\/webp;base64,/u)
  const bytes = Buffer.from(webp.split(',')[1]!, 'base64')
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
})
