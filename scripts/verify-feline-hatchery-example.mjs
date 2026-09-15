import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
const origin = process.env.QMONSTER_VERIFY_URL || 'http://127.0.0.1:4184'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const snapshot = JSON.parse(await read('docs/integration/feline-combination-snapshot.json'))
for (const [file, hash] of Object.entries(snapshot.sourceHashes)) assert.equal(digest(await read(file)), hash, file)
assert.equal(digest(JSON.stringify(Object.fromEntries(Object.entries(snapshot.sourceHashes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))), snapshot.runtimeRevision)
for (const resource of snapshot.resources) assert.equal(digest(await read(resource.path)), resource.sha256, resource.id)
const catalog = JSON.parse(await read(snapshot.catalogFile))
for (const resource of Object.values(catalog.resources)) {
  await fs.access(path.join(root, resource.provenance.reference))
  await fs.access(path.join(root, resource.provenance.prompt))
}
const report = { runtimeRevision: snapshot.runtimeRevision, resourceHashes: snapshot.resources.length, checks: [] }
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(origin + '/')
  await page.addScriptTag({ type: 'module', content: `
    import {createFelineHatchery} from '${prefix}docs/integration/examples/feline-hatchery.ts';
    import {mutationSelectionsFromList} from '${prefix}packages/generator-core/src/feline-combination.ts';
    window.integrationApi = {createFelineHatchery, mutationSelectionsFromList};` })
  await page.waitForFunction(() => window.integrationApi)
  const config = { catalogUrl: origin + prefix + snapshot.catalogFile, resourceBaseUrl: origin + prefix }
  report.checks = await page.evaluate(async config => {
    const { createFelineHatchery, mutationSelectionsFromList } = window.integrationApi
    const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name) }
    const checks = []
    const rejects = async (action, pattern, name) => {
      try { await action() } catch (error) { check(pattern.test(String(error)), name); return }
      throw new Error('Did not reject: ' + name)
    }
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
    const pixels = async blob => {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close()
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      return { width: canvas.width, height: canvas.height, alpha: data[3], hash: await hash(data) }
    }
    const hatchery = await createFelineHatchery(config)
    const selections = { coat: 'brown-tabby', expression: 'small-fangs',
      ...mutationSelectionsFromList(['dragon-horns', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip']) }
    const first = await hatchery.hatch('integration-smoke-20260915', selections)
    window.integrationSaved = JSON.parse(JSON.stringify(first.visual))
    const restored = await hatchery.restore(window.integrationSaved)
    check(JSON.stringify(first.visual.spec.selections) === JSON.stringify(selections), 'explicit cross-slot selections retained')
    check(first.image.cacheKey === restored.image.cacheKey, 'JSON save/restore cache identity matches')
    const initialPixels = await pixels(first.image.blob)
    check(initialPixels.width === 1254 && initialPixels.height === 1254 && initialPixels.alpha === 0, 'export is 1254px with transparent background')
    check(initialPixels.hash === (await pixels(restored.image.blob)).hash, 'JSON save/restore decoded pixels match')
    check(first.image.mime === first.image.blob.type && /image\/(webp|png)/.test(first.image.mime), 'export metadata matches actual MIME')
    const [concurrentA, concurrentB] = await Promise.all([
      hatchery.restore(window.integrationSaved),
      hatchery.hatch('integration-other', { coat: 'tuxedo', expression: 'tongue-tip', ...mutationSelectionsFromList([]) }),
    ])
    check((await pixels(concurrentA.image.blob)).hash === initialPixels.hash
      && (await pixels(concurrentB.image.blob)).hash !== initialPixels.hash, 'concurrent renders keep independent canvases')
    await rejects(() => hatchery.restore({ ...window.integrationSaved, catalogSha256: 'wrong' }), /unsupported visual snapshot/, 'wrong catalog identity rejected')
    await rejects(() => hatchery.restore({ ...window.integrationSaved, runtimeRevision: 'wrong' }), /unsupported visual snapshot/, 'wrong runtime identity rejected')
    await rejects(() => hatchery.restore({ ...window.integrationSaved, spec: { ...window.integrationSaved.spec, genome: {} } }), /SPEC:/, 'mixed legacy spec rejected')
    await rejects(() => mutationSelectionsFromList(['dragon-horns', 'antlers']), /conflict|crown/i, 'same-position mutations rejected')
    await rejects(() => createFelineHatchery({ ...config, resourceBaseUrl: config.resourceBaseUrl.slice(0, -1) }), /must end with/, 'incorrect resource base rejected')
    return checks
  }, config)
  const targetResource = snapshot.resources.find(resource => resource.id === 'brown-tabby-small-fangs')
  assert.ok(targetResource)
  const resourceUrl = origin + prefix + targetResource.path
  for (const [name, response, pattern] of [
    ['missing resource blocks result', { status: 404, body: 'missing' }, '404'],
    ['corrupt resource blocks result', { status: 200, contentType: 'image/png', body: await read(snapshot.resources.find(resource => resource.id === 'dragon-horns').path) }, 'hash|sha-?256|digest'],
  ]) {
    await page.route(resourceUrl, route => route.fulfill(response))
    const error = await page.evaluate(async config => {
      try { await (await window.integrationApi.createFelineHatchery(config)).restore(window.integrationSaved); return null }
      catch (error) { return String(error) }
    }, config)
    assert.match(error || '', new RegExp(pattern, 'i'), name)
    report.checks.push(name)
    await page.unroute(resourceUrl)
  }
  await page.route(config.catalogUrl, route => route.fulfill({ status: 200, body: '{}' }))
  const catalogError = await page.evaluate(async config => {
    try { await window.integrationApi.createFelineHatchery(config); return null } catch (error) { return String(error) }
  }, config)
  assert.match(catalogError || '', /snapshot hash mismatch/)
  report.checks.push('modified catalog bytes rejected')
} finally { await browser.close() }
report.status = 'passed'
report.checkedAt = new Date().toISOString()
await fs.mkdir(path.join(root, 'docs/qa'), { recursive: true })
await fs.writeFile(path.join(root, 'docs/qa/integration-verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
