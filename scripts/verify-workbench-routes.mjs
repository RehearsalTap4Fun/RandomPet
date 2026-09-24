import assert from 'node:assert/strict'
import path from 'node:path'
import { preview } from 'vite'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const server = await preview({ root: path.join(root, 'apps/creator-web'), configFile: path.join(root, 'apps/creator-web/vite.config.ts'),
  preview: { host: '127.0.0.1', port: 0, strictPort: false } })
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ headless: true }), errors = [], checks = []
async function newPage() {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage(), requests = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, requests }
}
const ready = (page, label) => page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent === label && !button.disabled), label)
const pixelReady = page => ready(page, '导出 64px PNG')
async function download(page, label) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  const stream = await (await pending).createReadStream(), chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
try {
  const feline = await newPage()
  await feline.page.goto(base); await ready(feline.page, '导出透明 PNG')
  assert.ok(feline.requests.some(url => /\/feline-workbench-[^/]+\.js/.test(url)))
  assert.ok(!feline.requests.some(url => /\/pixel-workbench-[^/]+\.js/.test(url)), 'Feline route must not download the pixel workbench')
  const png = await download(feline.page, '导出透明 PNG'), meta = await sharp(png).metadata()
  assert.equal(meta.width, 1254); assert.equal(meta.height, 1254); assert.equal(meta.hasAlpha, true)
  await feline.page.getByRole('button', { name: '小龙角', exact: true }).click(); await ready(feline.page, '导出透明 PNG')
  await feline.page.locator('details').evaluate(node => { node.open = true })
  const saved = JSON.parse(await download(feline.page, '导出规格 JSON'))
  assert.equal(saved.selections.crown, 'dragon-horns')
  await feline.page.reload(); await ready(feline.page, '导出透明 PNG')
  assert.deepEqual(await feline.page.evaluate(() => JSON.parse(localStorage.getItem('qmonster.feline-combination-candidate.v1'))), saved)
  await feline.page.getByRole('link', { name: '进入像素工坊 →' }).click(); await pixelReady(feline.page)
  assert.ok(feline.requests.some(url => /\/pixel-workbench-[^/]+\.js/.test(url)))
  checks.push('feline-only download, 1254px PNG, JSON persistence and navigation to pixel')
  await feline.context.close()

  const pixel = await newPage()
  await pixel.page.goto(new URL('pixel', base).href); await pixelReady(pixel.page)
  assert.ok(pixel.requests.some(url => /\/pixel-workbench-[^/]+\.js/.test(url)))
  assert.ok(!pixel.requests.some(url => /\/feline-workbench-[^/]+\.js/.test(url)), 'Pixel route must not download the feline workbench')
  checks.push('cold pixel route downloads no feline workbench')
  await pixel.context.close()

  const recovery = await newPage()
  await recovery.page.route('**/pixel-workbench-*.js', route => route.fulfill({ status: 503, body: 'temporary module outage' }))
  await recovery.page.goto(new URL('pixel', base).href)
  await recovery.page.getByRole('alert').filter({ hasText: '工坊载入失败' }).waitFor()
  await recovery.page.unroute('**/pixel-workbench-*.js')
  await recovery.page.getByRole('button', { name: '重新加载', exact: true }).click(); await pixelReady(recovery.page)
  checks.push('failed lazy module displays a recoverable error and reload succeeds')
  await recovery.context.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
