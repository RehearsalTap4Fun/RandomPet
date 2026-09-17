import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const qa = path.join(root, 'docs/qa/pixel-standard-small-fangs-coverage')
const candidate = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/v2-coverage-standard-small-fangs-round/catalog.json'), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const prefix = pathname.startsWith('/relocated/') ? '/relocated/' : pathname.startsWith('/qa/') ? '/qa/' : '/'
    const directory = prefix === '/relocated/' ? 'dist/pixel-art' : prefix === '/qa/' ? 'docs/qa/pixel-standard-small-fangs-coverage' : 'dist/creator'
    const base = path.join(root, directory), relative = ['/', '/pixel'].includes(pathname) ? 'index.html' : pathname.slice(prefix.length)
    const file = path.resolve(base, relative)
    assert.ok(file.startsWith(base + path.sep))
    const bytes = await fs.readFile(file)
    response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream')
    response.end(bytes)
  } catch { response.writeHead(404); response.end('Missing file') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const page = await context.newPage(), pageErrors = [], networkErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('response', response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`) })
const report = { schemaVersion: 'pixel-coverage-browser-qa-v1', status: 'running', artVersion: candidate.artVersion, revision: candidate.revision, workbench: [], portable: [], raceChecks: [], pageErrors, networkErrors }
const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导出 64px PNG' && !b.disabled))
const canvasHash = async selector => sha(Buffer.from(await page.locator(selector).evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 64, 64).data))))
try {
  await page.goto(`${base}/pixel`); await ready()
  const bundle = page.getByLabel('资源范围')
  assert.equal(await bundle.inputValue(), 'v2-approved', 'Fresh-user default must remain approved 1.2.0')
  assert.equal(await bundle.locator('option[value="v2-coverage-standard-small-fangs-round"]').count(), 1, 'New coverage candidate must be selectable')
  report.defaultApproved = true
  await bundle.selectOption('v2-coverage-standard-small-fangs-round'); await ready()
  assert.equal(await page.locator('[data-coverage-id]').count(), 32)
  assert.equal(await page.locator('[data-review="pending"]').count(), 11)
  for (const row of candidate.coverage) {
    await page.locator(`[data-coverage-id="${row.id}"]`).click(); await ready()
    assert.equal(await canvasHash('canvas'), row.rgbaSha256, `Workbench: ${row.id}`)
    report.workbench.push({ id: row.id, rgbaSha256: row.rgbaSha256, review: row.review })
  }
  const selected = candidate.coverage.at(-1)
  await page.screenshot({ path: path.join(qa, 'workbench.png'), fullPage: true })
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2')))
  assert.equal(saved.art.artVersion, '1.2.1-candidate.1'); assert.equal(saved.art.revision, candidate.revision)
  await page.reload(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-coverage-standard-small-fangs-round')
  assert.equal(await canvasHash('canvas'), selected.rgbaSha256)
  await page.getByLabel('仅显示已验收').check()
  assert.equal(await page.locator('[data-coverage-id]').count(), 21)
  assert.equal(await page.locator('[data-review="pending"]').count(), 0)
  await page.getByLabel('仅显示已验收').uncheck()
  await bundle.selectOption('v2-approved'); await ready()
  await page.locator('summary').click()
  await page.getByLabel('导入形象 JSON').fill(JSON.stringify(saved)); await page.getByRole('button', { name: '应用形象', exact: true }).click(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-coverage-standard-small-fangs-round')
  assert.equal(await canvasHash('canvas'), selected.rgbaSha256)
  report.importAndReload = true; report.approvedFilterCount = 21
  // A fresh context ensures layer loading is actually in flight. Delay PNG decode;
  // switch to a different selection/version and prove stale completion cannot win.
  const racing = await browser.newContext(), racePage = await racing.newPage()
  await racePage.addInitScript(() => {
    const original = window.createImageBitmap.bind(window)
    let release
    const gate = new Promise(resolve => { release = resolve })
    window.releaseBitmaps = release; window.delayedBitmaps = 0
    window.createImageBitmap = async (...args) => { window.delayedBitmaps++; await gate; return original(...args) }
  })
  await racePage.goto(`${base}/pixel`)
  await racePage.waitForFunction(() => window.delayedBitmaps > 0)
  await racePage.getByLabel('资源范围').selectOption('v2-coverage-standard-small-fangs-round')
  await racePage.locator('[data-coverage-id="standard-horns-ears-flame"]').click()
  await racePage.getByLabel('资源范围').selectOption('v2-approved')
  await racePage.locator('[data-coverage-id="standard-stack"]').click()
  assert.equal(await racePage.getByRole('button', { name: '导出 64px PNG', exact: true }).isDisabled(), true)
  await racePage.evaluate(() => window.releaseBitmaps())
  await racePage.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG').disabled)
  await racePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const raceHash = sha(Buffer.from(await racePage.locator('canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 64, 64).data))))
  assert.equal(raceHash, candidate.coverage.find(r => r.id === 'standard-stack').rgbaSha256)
  assert.equal(await racePage.getByLabel('资源范围').inputValue(), 'v2-approved')
  assert.equal(JSON.parse(await racePage.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2'))).art.artVersion, '1.2.0')
  report.raceChecks.push('delayed PNG completions preserve latest approved selection and storage; export disabled while pending')
  await racing.close()
  await page.goto(`${base}/relocated/coverage.html`)
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  assert.equal(await page.locator('#bundle').inputValue(), 'v2-approved')
  await page.selectOption('#bundle', 'v2-coverage-standard-small-fangs-round')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 32)
  for (const row of candidate.coverage) {
    await page.selectOption('#sample', row.id)
    assert.equal(await canvasHash('#cat'), row.rgbaSha256, `Portable: ${row.id}`)
    report.portable.push({ id: row.id, rgbaSha256: row.rgbaSha256 })
  }
  assert.deepEqual(JSON.parse(await page.locator('#appearance').innerText()), saved)
  await page.screenshot({ path: path.join(qa, 'portable.png'), fullPage: true })
  await page.goto(`${base}/qa/gallery.html`)
  await page.setViewportSize({ width: 2560, height: 1400 })
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await page.locator('article').count(), 16)
  assert.equal(await page.locator('article img').count(), 96)
  assert.ok(await page.locator('article img').evaluateAll(images => images.every(image => image.getBoundingClientRect().width === image.naturalWidth)), 'QA must display exact 64/128/256 pixel sizes')
  await page.screenshot({ path: path.join(qa, 'gallery-browser.png'), fullPage: true })
  report.galleryCells = 16; report.galleryImages = 96
  assert.deepEqual(pageErrors, []); assert.deepEqual(networkErrors, [])
  report.status = 'passed'
} catch (error) { report.status = 'failed'; report.error = String(error); throw error }
finally {
  report.verifierSha256 = sha(await fs.readFile(import.meta.filename))
  report.browserVersion = browser.version()
  await fs.writeFile(path.join(qa, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close(); await new Promise(resolve => server.close(resolve))
  console.log(JSON.stringify({ status: report.status, workbench: report.workbench.length, portable: report.portable.length, races: report.raceChecks.length }))
}
