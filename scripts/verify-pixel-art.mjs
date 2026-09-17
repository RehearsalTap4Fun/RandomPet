import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, 'docs/qa/pixel-production')
await fs.mkdir(qa, { recursive: true })
const candidate = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/candidate/catalog.json'), 'utf8'))
const approved = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/approved/catalog.json'), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const errors = [], networkErrors = []
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const consumer = pathname.startsWith('/relocated/'), base = path.resolve(root, consumer ? 'dist/pixel-art' : 'dist/creator')
    const relative = consumer ? pathname.slice('/relocated/'.length) || 'index.html' : ['/', '/pixel'].includes(pathname) ? 'index.html' : pathname.slice(1)
    const file = path.resolve(base, relative)
    if (!file.startsWith(base + path.sep)) throw new Error('Invalid path')
    const bytes = await fs.readFile(file)
    response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream')
    response.end(bytes)
  } catch { response.writeHead(404); response.end('Missing file') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`) })
const canvasHash = async (selector = 'canvas') => sha(Buffer.from(await page.locator(selector).evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 64, 64).data))))
async function downloadAndCheck(button, size, expectedHash) {
  const promise = page.waitForEvent('download')
  await button.click()
  const download = await promise, file = path.join(qa, download.suggestedFilename())
  await download.saveAs(file)
  const bytes = await fs.readFile(file), { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, size); assert.equal(info.height, size)
  assert.ok(data.some((value, i) => i % 4 === 3 && value === 0), 'Transparent background missing')
  for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255, 'Unexpected export anti-aliasing')
  const native = size === 64 ? data : await sharp(bytes).resize(64, 64, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer()
  assert.equal(sha(native), expectedHash)
  if (size === 128) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const target = (y * 128 + x) * 4, source = (Math.floor(y / 2) * 64 + Math.floor(x / 2)) * 4
    assert.ok(data.subarray(target, target + 4).equals(native.subarray(source, source + 4)), '128px export is not exact 2x replication')
  }
  return { filename: download.suggestedFilename(), size, sha256: sha(bytes), rgbaNativeSha256: sha(native) }
}
const checks = [], downloads = []
try {
  await page.goto(`${base}/pixel`)
  await page.getByRole('button', { name: '导出 64px PNG', exact: true }).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await page.getByRole('combobox', { name: '资源范围' }).inputValue(), 'approved')
  assert.equal(approved.generatable.length, 14)
  for (const sample of approved.coverage) {
    await page.getByRole('button', { name: `${sample.label} ${sample.review === 'approved' ? '已验收' : '待验收'}`, exact: true }).click()
    await page.waitForFunction(label => document.querySelector('.pixel-title')?.textContent === label, sample.label)
    assert.equal(await canvasHash(), sample.rgbaSha256, `browser: ${sample.id}`)
    checks.push({ sample: sample.id, rgbaSha256: sample.rgbaSha256 })
  }
  const last = approved.coverage.at(-1)
  downloads.push(await downloadAndCheck(page.getByRole('button', { name: '导出 64px PNG', exact: true }), 64, last.rgbaSha256))
  downloads.push(await downloadAndCheck(page.getByRole('button', { name: '导出 128px PNG', exact: true }), 128, last.rgbaSha256))
  const savePromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存形象 JSON' }).click()
  const saveDownload = await savePromise, savedFile = path.join(qa, 'appearance.json')
  await saveDownload.saveAs(savedFile)
  const saved = JSON.parse(await fs.readFile(savedFile, 'utf8'))
  assert.equal(saved.phenotype.body, 'shortleg-round'); assert.equal(saved.art.revision, approved.revision)
  await page.screenshot({ path: path.join(qa, 'pixel-workbench.png'), fullPage: true })
  await page.reload(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await canvasHash(), last.rgbaSha256, 'Saved appearance changed after reload')
  await page.locator('summary').click()
  const editor = page.getByRole('textbox', { name: '导入形象 JSON' })
  const apply = page.getByRole('button', { name: '应用形象' })
  const oldSave = { ...saved, art: { styleId: candidate.styleId, artVersion: candidate.artVersion, revision: candidate.revision } }
  await editor.fill(JSON.stringify(oldSave)); await apply.click()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await page.getByRole('combobox', { name: '资源范围' }).inputValue(), 'candidate')
  assert.equal(await canvasHash(), last.rgbaSha256, 'Historical candidate save no longer replays')
  await editor.fill(JSON.stringify(saved)); await apply.click()
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  await editor.fill(JSON.stringify({ ...saved, art: { ...saved.art, revision: '0'.repeat(64) } })); await apply.click()
  assert.match(await page.getByRole('alert').innerText(), /revision/)
  assert.equal(await canvasHash(), last.rgbaSha256, 'Failed import changed appearance')
  const first = candidate.coverage[0]
  const { body, schemaVersion, ...selections } = first.phenotype
  const legacy = { schemaVersion: 'feline-combination-v1', catalogVersion: '0.10.0-candidate.1', seed: 'pixel-legacy-import', selections,
    rolls: Object.fromEntries(Object.keys(selections).map(k => [k, 0])), locks: [] }
  await editor.fill(JSON.stringify(legacy)); await apply.click()
  // Legacy specs now migrate to v2, which may load its assets for the first time.
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await canvasHash(), first.rgbaSha256, 'Legacy resolved traits not preserved')
  await editor.fill(JSON.stringify({ ...legacy, selections: { ...selections, coat: 'calico' } })); await apply.click()
  assert.match(await page.getByRole('alert').innerText(), /Unsupported/)
  assert.equal(await canvasHash(), first.rgbaSha256)
  await page.getByRole('combobox', { name: '资源范围' }).selectOption('approved')
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await page.getByRole('group', { name: '组合样例' }).getByRole('button').count(), 14)
  await page.getByRole('combobox', { name: '资源范围' }).selectOption('legacy-approved')
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '导出 64px PNG')?.disabled)
  assert.equal(await page.getByRole('group', { name: '组合样例' }).getByRole('button').count(), 4)
  assert.equal(await canvasHash(), first.rgbaSha256)
  await page.goto(`${base}/`)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导出透明 PNG' && !b.disabled))
  assert.equal(await page.locator('canvas').getAttribute('width'), '1254')
  await page.goto(`${base}/relocated/index.html`)
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  assert.equal(await canvasHash('#cat'), approved.coverage[0].rgbaSha256)
  await page.selectOption('#bundle', 'candidate')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 14)
  await page.selectOption('#sample', last.id)
  assert.equal(await canvasHash('#cat'), last.rgbaSha256)
  downloads.push(await downloadAndCheck(page.locator('#save'), 128, last.rgbaSha256))
  await page.screenshot({ path: path.join(qa, 'portable-consumer.png'), fullPage: true })
  assert.deepEqual(errors, []); assert.deepEqual(networkErrors, [])
  // Corruption must be detected by the real loader, without showing a stale sprite.
  const resourcePath = Object.values(approved.resources)[0].path
  await page.route(`**/approved/${resourcePath}`, async route => {
    const response = await route.fetch(), bytes = Buffer.from(await response.body())
    bytes[bytes.length - 1] ^= 1
    await route.fulfill({ response, body: bytes })
  })
  await page.selectOption('#bundle', 'approved')
  await page.waitForFunction(() => document.querySelector('#error').textContent.includes('SHA-256'))
  assert.equal(await page.locator('#save').isDisabled(), true)
  assert.equal(await canvasHash('#cat'), sha(new Uint8Array(64 * 64 * 4)))
  const report = { status: 'passed', approvedCombinations: 14, historicalCandidateCombinations: 14, generatableCombinations: 14, approvedRevision: approved.revision, candidateRevision: candidate.revision, historicalCandidateSaveReplays: true,
    browserReplays: checks, downloads, savedAppearanceReload: true, legacyImportPreservesTraits: true, unsupportedImportRejected: true, revisionMismatchRejected: true,
    corruptedPngRejected: true, relocatedConsumer: true, legacyWorkbenchLoads: true, pageErrors: errors, networkErrors }
  await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, browserReplays: checks.length, downloads: downloads.length, relocatedConsumer: true }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
