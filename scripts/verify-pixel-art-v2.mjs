import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, 'docs/qa/pixel-standard-small-fangs-approved/regressions/v2')
await fs.mkdir(qa, { recursive: true })
const candidate = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/v2-candidate/catalog.json'), 'utf8'))
const current = JSON.parse(await fs.readFile(path.join(root, 'dist/pixel-art/v2-approved/catalog.json'), 'utf8'))
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
const report = {
  status: 'running', candidateVersion: candidate.artVersion, candidateRevision: candidate.revision,
  approvedVersion: current.artVersion, approvedRevision: current.revision,
  coverageCount: current.coverage.length, generatableCount: current.generatable.length,
  pendingCount: current.coverage.filter(c => c.review === 'pending').length,
  candidateGeneratableCount: candidate.generatable.length, candidatePendingCount: candidate.coverage.filter(c => c.review === 'pending').length,
  approvedBrowserReplays: [],
  browserReplays: [], v1Replays: [], downloads: [], negativeImports: [], portableSamples: [],
}
const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导出 64px PNG' && !b.disabled))
const state = () => page.evaluate(() => ({
  bundle: document.querySelector('select[aria-label="资源范围"]').value,
  selected: document.querySelector('[data-coverage-id][aria-pressed=true]').dataset.coverageId,
  saved: localStorage.getItem('qmonster.pixel-appearance.v2'),
}))
async function checkCanvas(expected, message, selector = 'canvas') {
  await page.waitForFunction(selector => {
    const canvas = document.querySelector(selector)
    return canvas && canvas.getContext('2d').getImageData(0, 0, 64, 64).data.some((n, i) => i % 4 === 3 && n)
  }, selector)
  assert.equal(await canvasHash(selector), expected, message)
}
async function apply(input) {
  await page.getByRole('textbox', { name: '导入形象 JSON' }).fill(typeof input === 'string' ? input : JSON.stringify(input))
  await page.getByRole('button', { name: '应用形象', exact: true }).click()
}
async function reject(name, input, message) {
  const before = await canvasHash(), beforeState = await state()
  await apply(input)
  const error = await page.getByRole('alert').innerText()
  assert.match(error, message)
  const after = await canvasHash()
  assert.equal(after, before, `${name}: failed import changed canvas`)
  assert.deepEqual(await state(), beforeState, `${name}: failed import changed saved/selected state`)
  report.negativeImports.push({ name, error, beforeRgbaSha256: before, afterRgbaSha256: after, canvasPreserved: true, statePreserved: true })
}
try {
  assert.equal(report.coverageCount, 21); assert.equal(report.generatableCount, 21); assert.equal(report.pendingCount, 0)
  await page.goto(`${base}/pixel`); await ready()
  const bundle = page.getByRole('combobox', { name: '资源范围' })
  assert.equal(await bundle.inputValue(), 'v2-approved-1.2.1')
  await bundle.selectOption('v2-approved'); await ready()
  assert.match(await page.locator('.pixel-filter').innerText(), /21 个可生成组合/)
  assert.equal(await page.locator('[data-review=pending]').count(), 0)
  for (const sample of current.coverage) {
    await page.locator(`[data-coverage-id="${sample.id}"]`).click(); await ready()
    await checkCanvas(sample.rgbaSha256, `approved v2 browser: ${sample.id}`)
    report.approvedBrowserReplays.push({ id: sample.id, review: sample.review, rgbaSha256: sample.rgbaSha256 })
  }
  const approvedSaved = JSON.parse((await state()).saved)
  assert.equal(approvedSaved.art.artVersion, '1.2.0')
  assert.equal(approvedSaved.art.revision, current.revision)
  await fs.writeFile(path.join(qa, 'appearance-v2-approved.json'), JSON.stringify(approvedSaved, null, 2) + '\n')
  await page.screenshot({ path: path.join(qa, 'pixel-workbench-approved.png'), fullPage: true })
  await page.reload(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-approved')
  await checkCanvas(current.coverage.at(-1).rgbaSha256, 'approved reload')
  report.approvedSavedAppearanceReload = true
  await bundle.selectOption('v2-candidate'); await ready()
  assert.match(await bundle.locator('option:checked').innerText(), /候选包 1.2.0 · 21 个组合/)
  assert.match(await page.locator('.pixel-filter').innerText(), /14 个可生成组合/)
  assert.equal(await page.locator('[data-review=pending]').count(), 7)
  for (const sample of candidate.coverage) {
    await page.locator(`[data-coverage-id="${sample.id}"]`).click(); await ready()
    await checkCanvas(sample.rgbaSha256, `v2 browser: ${sample.id}`)
    report.browserReplays.push({ id: sample.id, review: sample.review, rgbaSha256: sample.rgbaSha256 })
  }
  const stack = candidate.coverage.find(c => c.id === 'slender-sleepy-stack')
  assert.match(await page.locator('.pixel-traits').innerText(), /修长高挑 · 半眯杏仁眼/)
  assert.match(await page.locator('.pixel-review').innerText(), /待美术验收/)
  await page.getByLabel('仅显示已验收').check()
  assert.equal(await page.locator('[data-coverage-id]').count(), 14)
  assert.equal(await page.locator('[data-review=pending]').count(), 0)
  await page.getByLabel('仅显示已验收').uncheck()
  report.pendingFilter = true
  report.downloads.push(await downloadAndCheck(page.getByRole('button', { name: '导出 64px PNG', exact: true }), 64, stack.rgbaSha256))
  report.downloads.push(await downloadAndCheck(page.getByRole('button', { name: '导出 128px PNG', exact: true }), 128, stack.rgbaSha256))
  const pendingSave = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存形象 JSON', exact: true }).click()
  const saveDownload = await pendingSave
  await saveDownload.saveAs(path.join(qa, 'appearance-v2.json'))
  const saved = JSON.parse(await fs.readFile(path.join(qa, 'appearance-v2.json'), 'utf8'))
  assert.equal(saved.schemaVersion, 'feline-appearance-v2')
  assert.deepEqual(saved.phenotype, stack.phenotype); assert.equal(saved.art.revision, candidate.revision)
  await page.screenshot({ path: path.join(qa, 'pixel-workbench.png'), fullPage: true })
  await page.reload(); await ready()
  assert.equal(await bundle.inputValue(), 'v2-candidate')
  await checkCanvas(stack.rgbaSha256, 'v2 reload')
  report.savedAppearanceReload = true
  await page.locator('summary').click()
  await bundle.selectOption('approved'); await ready()
  await apply(saved); await ready()
  await checkCanvas(stack.rgbaSha256, 'v2 explicit import')
  report.appearanceV2Import = true
  assert.equal(await bundle.inputValue(), 'v2-candidate')
  await apply(approvedSaved); await ready()
  assert.equal(await bundle.inputValue(), 'v2-approved')
  await checkCanvas(stack.rgbaSha256, 'approved explicit import')
  report.approvedAppearanceV2Import = true
  await reject('wrong revision', { ...saved, art: { ...saved.art, revision: '0'.repeat(64) } }, /revision/)
  await reject('unsupported eyes', { ...saved, phenotype: { ...saved.phenotype, eyes: 'wide-open' } }, /Unsupported/)
  await reject('unsupported exact combination', { ...saved, phenotype: { ...saved.phenotype, expression: 'parted-mouth' } }, /Unsupported/)
  await reject('unknown appearance schema', { ...saved, schemaVersion: 'feline-appearance-v99' }, /不支持的形象版本/)
  await reject('unknown art version', { ...saved, art: { ...saved.art, artVersion: '99.0.0' } }, /未载入此美术版本/)
  await reject('v1 phenotype inside v2 appearance', { ...saved, phenotype: approved.coverage[0].phenotype }, /feline-phenotype-v2/)
  await reject('malformed JSON', '{broken', /导入未应用/)

  // Exercise every retained v1 bundle through its original schema/identity.
  for (const name of ['approved', 'candidate', 'legacy-approved']) {
    const catalog = JSON.parse(await fs.readFile(path.join(root, `dist/pixel-art/${name}/catalog.json`), 'utf8'))
    await bundle.selectOption(name); await ready()
    for (const sample of catalog.coverage) {
      await page.locator(`[data-coverage-id="${sample.id}"]`).click(); await ready()
      await checkCanvas(sample.rgbaSha256, `${name}: ${sample.id}`)
      report.v1Replays.push({ bundle: name, id: sample.id, rgbaSha256: sample.rgbaSha256 })
    }
    const sample = catalog.coverage.at(-1)
    const v1Saved = { schemaVersion: 'feline-appearance-v1', phenotype: sample.phenotype,
      art: { styleId: catalog.styleId, artVersion: catalog.artVersion, revision: catalog.revision } }
    await bundle.selectOption('v2-candidate'); await ready()
    await apply(v1Saved); await ready()
    assert.equal(await bundle.inputValue(), name)
    await checkCanvas(sample.rgbaSha256, `${name} appearance import`)
    await page.reload(); await ready()
    await checkCanvas(sample.rgbaSha256, `${name} appearance reload`)
    await page.locator('summary').click()
  }
  report.appearanceV1ImportAndReload = true
  // Existing local v1 saves remain readable when the new storage slot is absent.
  const first = approved.coverage[0]
  const v1Saved = { schemaVersion: 'feline-appearance-v1', phenotype: first.phenotype,
    art: { styleId: approved.styleId, artVersion: approved.artVersion, revision: approved.revision } }
  await page.evaluate(saved => { localStorage.removeItem('qmonster.pixel-appearance.v2'); localStorage.setItem('qmonster.pixel-appearance.v1', JSON.stringify(saved)) }, v1Saved)
  await page.reload(); await ready(); await checkCanvas(first.rgbaSha256, 'old local storage replay')
  report.legacyStorageReplay = true
  await page.locator('summary').click()
  const { body, schemaVersion, ...selections } = first.phenotype
  const legacy = { schemaVersion: 'feline-combination-v1', catalogVersion: '0.10.0-candidate.1', seed: 'pixel-legacy-import', selections,
    rolls: Object.fromEntries(Object.keys(selections).map(k => [k, 0])), locks: [] }
  await apply(legacy); await ready()
  await checkCanvas(first.rgbaSha256, 'legacy migration')
  const migrated = JSON.parse((await state()).saved)
  assert.equal(migrated.schemaVersion, 'feline-appearance-v2'); assert.equal(migrated.phenotype.eyes, 'round')
  for (const [key, value] of Object.entries(selections)) assert.equal(migrated.phenotype[key], value)
  report.legacyImportPreservesTraits = true
  await reject('unsupported legacy coat', { ...legacy, selections: { ...selections, coat: 'calico' } }, /Unsupported/)
  await page.goto(`${base}/`)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导出透明 PNG' && !b.disabled))
  assert.equal(await page.locator('canvas').getAttribute('width'), '1254')
  report.plushWorkbenchLoads = true

  await page.goto(`${base}/relocated/index.html`)
  await page.waitForFunction(() => !document.querySelector('#save').disabled)
  assert.equal(await page.locator('#bundle').inputValue(), 'v2-approved')
  assert.match(await page.locator('#status').innerText(), /21 个可生成组合/)
  for (const sample of current.coverage) {
    await page.selectOption('#sample', sample.id)
    await checkCanvas(sample.rgbaSha256, `portable approved: ${sample.id}`, '#cat')
    report.portableSamples.push({ bundle: 'v2-approved', schema: 'feline-appearance-v2', id: sample.id, rgbaSha256: sample.rgbaSha256 })
  }
  assert.deepEqual(JSON.parse(await page.locator('#appearance').innerText()), approvedSaved)
  await page.screenshot({ path: path.join(qa, 'portable-consumer-approved.png'), fullPage: true })
  await page.selectOption('#bundle', 'approved')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 14)
  await checkCanvas(first.rgbaSha256, 'portable v1', '#cat')
  assert.equal(JSON.parse(await page.locator('#appearance').innerText()).schemaVersion, 'feline-appearance-v1')
  report.portableSamples.push({ schema: 'feline-appearance-v1', id: first.id, rgbaSha256: first.rgbaSha256 })
  await page.selectOption('#bundle', 'v2-candidate')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 21)
  await page.selectOption('#sample', stack.id)
  await checkCanvas(stack.rgbaSha256, 'portable v2', '#cat')
  assert.deepEqual(JSON.parse(await page.locator('#appearance').innerText()), saved)
  report.portableSamples.push({ schema: 'feline-appearance-v2', id: stack.id, rgbaSha256: stack.rgbaSha256 })
  report.downloads.push(await downloadAndCheck(page.locator('#save'), 128, stack.rgbaSha256))
  await page.screenshot({ path: path.join(qa, 'portable-consumer.png'), fullPage: true })
  // Verify v2's actual PNG loader rejects tampered bytes and clears stale output.
  const resource = Object.values(candidate.resources)[0]
  await page.selectOption('#bundle', 'approved')
  await page.waitForFunction(() => !document.querySelector('#save').disabled && document.querySelectorAll('#sample option').length === 14)
  await page.route(`**/v2-candidate/${resource.path}`, async route => {
    const response = await route.fetch(), bytes = Buffer.from(await response.body())
    bytes[bytes.length - 1] ^= 1
    await route.fulfill({ response, body: bytes })
  })
  await page.selectOption('#bundle', 'v2-candidate')
  await page.waitForFunction(() => document.querySelector('#error').textContent.includes('SHA-256'))
  assert.equal(await page.locator('#save').isDisabled(), true)
  assert.equal(await canvasHash('#cat'), sha(new Uint8Array(64 * 64 * 4)))
  report.corruptedV2PngRejected = true
  assert.deepEqual(errors, []); assert.deepEqual(networkErrors, [])
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = String(error); throw error
} finally {
  report.pageErrors = errors; report.networkErrors = networkErrors
  await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close(); await new Promise(resolve => server.close(resolve))
  console.log(JSON.stringify({ status: report.status, approvedV2Replays: report.approvedBrowserReplays.length, candidateV2Replays: report.browserReplays.length, v1Replays: report.v1Replays.length, negativeImports: report.negativeImports.length, portableSamples: report.portableSamples.length }))
}
