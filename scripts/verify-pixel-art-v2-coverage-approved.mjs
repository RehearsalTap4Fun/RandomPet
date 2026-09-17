import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const qa = path.join(root, 'docs/qa/pixel-standard-small-fangs-approved')
const candidate = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/v2-approved-1.2.1/catalog.json'), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const prefix = pathname.startsWith('/relocated/') ? '/relocated/' : pathname.startsWith('/qa/') ? '/qa/' : '/'
    const directory = prefix === '/relocated/' ? 'dist/pixel-art' : prefix === '/qa/' ? 'docs/qa/pixel-standard-small-fangs-approved' : 'dist/creator'
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
  assert.equal(await bundle.inputValue(), 'v2-approved-1.2.1', 'Fresh-user default must use approved 1.2.1')
  assert.equal(await bundle.locator('option[value="v2-approved-1.2.1"]').count(), 1, 'Approved release must be selectable')
  report.defaultApproved = true
  await bundle.selectOption('v2-approved-1.2.1'); await ready()
  assert.equal(await page.locator('[data-coverage-id]').count(), 32)
  assert.equal(await page.locator('[data-review="pending"]').count(), 0)
  for (const row of candidate.coverage) {
    await page.locator(`[data-coverage-id="${row.id}"]`).click(); await ready()
    assert.equal(await canvasHash('canvas'), row.rgbaSha256, `Workbench: ${row.id}`)
    report.workbench.push({ id: row.id, rgbaSha256: row.rgbaSha256, review: row.review })
  }
  const selected = candidate.coverage.at(-1)
  await page.screenshot({ path: path.join(qa, 'workbench.png'), fullPage: true })
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2')))
  assert.equal(saved.art.artVersion, '1.2.1'); assert.equal(saved.art.revision, candidate.revision)
  await page.reload(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-approved-1.2.1')
  assert.equal(await canvasHash('canvas'), selected.rgbaSha256)
  await page.getByLabel('仅显示已验收').check()
  assert.equal(await page.locator('[data-coverage-id]').count(), 32)
  assert.equal(await page.locator('[data-review="pending"]').count(), 0)
  await page.getByLabel('仅显示已验收').uncheck()
  await bundle.selectOption('v2-approved'); await ready()
  await page.locator('summary').click()
  await page.getByLabel('导入形象 JSON').fill(JSON.stringify(saved)); await page.getByRole('button', { name: '应用形象', exact: true }).click(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-approved-1.2.1')
  assert.equal(await canvasHash('canvas'), selected.rgbaSha256)
  report.importAndReload = true; report.approvedFilterCount = 32
  report.restoredIdentities = []
  for (const name of ['legacy-approved', 'approved', 'candidate', 'v2-candidate', 'v2-approved', 'v2-coverage-standard-small-fangs-round', 'v2-approved-1.2.1']) {
    const catalog = JSON.parse(await fs.readFile(path.join(root, `dist/pixel-art/${name}/catalog.json`), 'utf8'))
    const sample = catalog.coverage.at(-1)
    await bundle.selectOption(name); await ready()
    await page.locator(`[data-coverage-id="${sample.id}"]`).click(); await ready()
    const snapshot = await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2'))
    await page.reload(); await ready()
    assert.equal(await bundle.inputValue(), name)
    assert.equal(await canvasHash('canvas'), sample.rgbaSha256)
    await bundle.selectOption(name === 'approved' ? 'v2-approved-1.2.1' : 'approved'); await ready()
    await page.locator('summary').click()
    await page.getByLabel('导入形象 JSON').fill(snapshot)
    await page.getByRole('button', { name: '应用形象', exact: true }).click(); await ready()
    assert.equal(await bundle.inputValue(), name)
    assert.equal(await canvasHash('canvas'), sample.rgbaSha256)
    assert.equal(await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2')), snapshot)
    report.restoredIdentities.push({ name, artVersion: catalog.artVersion, revision: catalog.revision, import: true, reload: true })
  }
  const savedBeforeFailure = await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2'))
  const malformed = structuredClone(saved); malformed.art.revision = '0'.repeat(64)
  const unsupported = structuredClone(saved); unsupported.phenotype.eyes = 'sleepy-almond'
  report.failedImports = []
  for (const value of ['{', JSON.stringify(malformed), JSON.stringify(unsupported)]) {
    await page.getByLabel('导入形象 JSON').fill(value)
    await page.getByRole('button', { name: '应用形象', exact: true }).click()
    assert.match(await page.getByRole('alert').innerText(), /导入未应用/)
    assert.equal(await bundle.inputValue(), 'v2-approved-1.2.1')
    assert.equal(await canvasHash('canvas'), selected.rgbaSha256)
    assert.equal(await page.evaluate(() => localStorage.getItem('qmonster.pixel-appearance.v2')), savedBeforeFailure)
    report.failedImports.push('rejected without changing canvas, selection or storage')
  }
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
  await racePage.getByLabel('资源范围').selectOption('v2-approved-1.2.1')
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
  await page.goto(`${base}/relocated/approved-1.2.1.html`)
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  assert.equal(await page.locator('#bundle').inputValue(), 'v2-approved-1.2.1')
  await page.selectOption('#bundle', 'v2-approved-1.2.1')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 32)
  for (const row of candidate.coverage) {
    await page.selectOption('#sample', row.id)
    assert.equal(await canvasHash('#cat'), row.rgbaSha256, `Portable: ${row.id}`)
    report.portable.push({ id: row.id, rgbaSha256: row.rgbaSha256 })
  }
  assert.deepEqual(JSON.parse(await page.locator('#appearance').innerText()), saved)
  await page.screenshot({ path: path.join(qa, 'portable.png'), fullPage: true })
  // Delay an old request, complete the newer selection, then release the old response.
  let releaseOld, oldRequested
  const oldGate = new Promise(resolve => { releaseOld = resolve })
  const requested = new Promise(resolve => { oldRequested = resolve })
  await page.route('**/v2-coverage-standard-small-fangs-round/catalog.json', async route => { oldRequested(); await oldGate; await route.continue() })
  await page.selectOption('#bundle', 'v2-coverage-standard-small-fangs-round')
  await requested
  assert.equal(await page.locator('#save').isDisabled(), true)
  await page.selectOption('#bundle', 'v2-approved-1.2.1')
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  releaseOld()
  await page.waitForResponse('**/v2-coverage-standard-small-fangs-round/catalog.json')
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => JSON.parse(document.querySelector('#appearance').textContent).art.artVersion === '1.2.1')
  assert.equal(await page.locator('#bundle').inputValue(), 'v2-approved-1.2.1')
  assert.equal(await canvasHash('#cat'), candidate.coverage[0].rgbaSha256)
  report.raceChecks.push('portable delayed candidate request preserves latest approved release')
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
