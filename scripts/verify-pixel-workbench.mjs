import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createServer, preview } from 'vite'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
const latest = await read('packages/asset-catalog/pixel/v3/approved-1.6.1/catalog.approved.json')
const save = (catalog, row) => ({ schemaVersion: catalog.schemaVersion === 'pixel-art-catalog-v1' ? 'feline-appearance-v1' : 'feline-appearance-v2',
  phenotype: row.phenotype, art: { styleId: catalog.styleId, artVersion: catalog.artVersion, revision: catalog.revision } })
const production = process.argv.includes('--production')
const serverOptions = { root: path.join(root, 'apps/creator-web'), configFile: path.join(root, 'apps/creator-web/vite.config.ts') }
const server = production
  ? await preview({ ...serverOptions, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  : await createServer({ ...serverOptions, server: { host: '127.0.0.1', port: 0, strictPort: false } })
if (!production) await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage(), errors = [], checks = []
page.setDefaultTimeout(30000)
page.on('pageerror', error => errors.push(error.message))
const ready = async (target = page) => { await target.getByRole('button', { name: '导出 64px PNG', exact: true }).waitFor();
  await target.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导出 64px PNG' && !b.disabled)) }
const pixels = async () => Buffer.from(await page.locator('canvas').evaluate(c => Array.from(c.getContext('2d').getImageData(0, 0, 64, 64).data)))
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('qmonster.pixel-appearance.v2')))
async function importState(input) {
  await page.locator('details').evaluate(node => { node.open = true })
  await page.getByLabel('导入形象 JSON').fill(JSON.stringify(input))
  await page.getByRole('button', { name: '应用形象', exact: true }).click()
  await ready()
}
async function download(name) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const stream = await (await pending).createReadStream(), chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
try {
  await page.goto(new URL('pixel', base).href); await ready()
  console.log('Loaded latest workbench')
  assert.equal(await page.getByLabel('资源范围').inputValue(), 'v3-approved-1.6.1')
  assert.equal(await page.locator('[data-coverage-id]').count(), 0, 'Latest release must not create 35,840 sample buttons')
  const samples = (await read('docs/qa/pixel-evolution-chain-registration/report.json')).sampling.rows
  for (const sample of samples) {
    const row = latest.coverage.find(c => c.id === sample.coverageId)
    await importState(save(latest, row))
    assert.equal(sha(await pixels()), row.rgbaSha256, row.id)
  }
  checks.push('latest default and 13 approved representative RGBA replays')
  console.log(checks.at(-1))
  // Reach a known phenotype through the actual trait controls, preserving valid later choices.
  await page.getByLabel('体型', { exact: true }).selectOption('standard')
  await page.getByLabel('毛色', { exact: true }).selectOption('calico')
  await page.getByLabel('眼型', { exact: true }).selectOption('sleepy-almond')
  await page.getByLabel('表情', { exact: true }).selectOption('small-fangs')
  await page.getByLabel('额顶', { exact: true }).selectOption('crystal-horns')
  await ready()
  const selected = await state(), row = latest.coverage.find(c => JSON.stringify(c.phenotype) === JSON.stringify(selected.phenotype))
  assert.ok(row); assert.equal(sha(await pixels()), row.rgbaSha256)
  assert.equal(selected.phenotype.coat, 'calico'); assert.equal(selected.phenotype.crown, 'crystal-horns')
  for (const size of [64, 128]) {
    const bytes = await download(`导出 ${size}px PNG`)
    const meta = await sharp(bytes).metadata(); assert.equal(meta.width, size); assert.equal(meta.height, size); assert.equal(meta.hasAlpha, true)
    const native = await sharp(bytes).resize(64, 64, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer()
    assert.equal(sha(native), row.rgbaSha256)
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer()
    assert.ok(raw.some((value, index) => index % 4 === 3 && value === 0), 'Transparent pixels must be present')
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dest = (y * size + x) * 4, source = (Math.floor(y * 64 / size) * 64 + Math.floor(x * 64 / size)) * 4
      assert.ok(raw.subarray(dest, dest + 4).equals(native.subarray(source, source + 4)), `Integer pixel replication at ${x},${y}`)
      assert.ok(raw[dest + 3] === 0 || raw[dest + 3] === 255, 'Binary alpha must be preserved')
    }
  }
  assert.deepEqual(JSON.parse(await download('保存形象 JSON')), selected)
  await page.reload(); await ready(); assert.deepEqual(await state(), selected); assert.equal(sha(await pixels()), row.rgbaSha256)
  await importState({ ...selected, art: { ...selected.art, revision: '0'.repeat(64) } })
  assert.match(await page.getByRole('alert').innerText(), /revision/)
  assert.deepEqual(await state(), selected); assert.equal(sha(await pixels()), row.rgbaSha256)
  await page.getByLabel('体型', { exact: true }).selectOption('shortleg-round'); await ready()
  assert.deepEqual(await page.getByLabel('毛色', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(n => n.value)), ['orange-white'])
  checks.push('legal trait selection, 64/128 PNG, JSON roundtrip, reload and rejected import preserve identity')
  for (const [bundle, file] of Object.entries({
    'legacy-approved': 'v1/catalog.legacy-approved.json', approved: 'v1/catalog.approved.json', candidate: 'v1/catalog.candidate.json',
    'v2-candidate': 'v2/catalog.candidate.json', 'v2-approved': 'v2/catalog.approved.json',
    'v2-coverage-standard-small-fangs-round': 'v2/coverage-standard-small-fangs-round/catalog.candidate.json',
    'v2-approved-1.2.1': 'v2/approved-1.2.1/catalog.approved.json',
  })) {
    const catalog = await read(`packages/asset-catalog/pixel/${file}`), oldRow = catalog.coverage.at(-1)
    await importState(save(catalog, oldRow)); assert.equal(await page.getByLabel('资源范围').inputValue(), bundle)
    assert.equal(sha(await pixels()), oldRow.rgbaSha256)
    await page.reload(); await ready(); assert.equal(await page.getByLabel('资源范围').inputValue(), bundle)
  }
  checks.push('all seven historical identities restore without upgrade')
  console.log(checks.at(-1))
  const compiled = await build({ absWorkingDir: root, entryPoints: ['packages/generator-core/src/feline-combination.ts'], bundle: true, format: 'esm', platform: 'node', write: false })
  const { generateFelineCombination } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'))
  const legacy = generateFelineCombination('migration', { coat: 'orange-white', expression: 'small-fangs', crown: 'dragon-horns', ears: 'none', neck: 'none', back: 'none', tailTip: 'none' })
  await importState(legacy); assert.equal(await page.getByLabel('资源范围').inputValue(), 'v3-approved-1.6.1')
  assert.equal((await state()).phenotype.crown, 'dragon-horns')
  checks.push('legacy horn combination migrates into current approved coverage')
  // Development URLs allow network fault injection; production may inline small PNGs.
  if (!production) {
    const retry = await context.newPage(); await retry.route('**/*.png*', route => route.request().resourceType() === 'fetch' ? route.fulfill({ status: 503, body: 'temporary failure' }) : route.continue())
    await retry.goto(new URL('pixel', base).href)
    await retry.getByRole('alert').filter({ hasText: '503' }).waitFor()
    await retry.unroute('**/*.png*'); await retry.getByRole('button', { name: '重试加载', exact: true }).click(); await ready(retry)
    checks.push('transient resource failure recovers through explicit retry')
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, mode: production ? 'production' : 'development', checks }, null, 2))
} finally {
  await context.close(); await browser.close()
  if (production) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  else await server.close()
}
