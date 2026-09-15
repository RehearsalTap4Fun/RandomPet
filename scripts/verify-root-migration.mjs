import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const read = file => fs.readFile(path.join(root, file))
const json = async file => JSON.parse(await read(file))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const migration = await json('docs/releases/v0.10.0/migration.json')
const snapshot = await json('docs/integration/feline-combination-snapshot.json')
const catalog = await json(snapshot.catalogFile)
const baseline = await json('docs/releases/v0.10.0/render-baseline.json')
const previous = await json('docs/releases/v0.10.0/previous-snapshot.json')
const approval = await json(migration.originalApproval)
for (const resource of snapshot.resources) {
  assert.equal(hash(await read(resource.path)), resource.sha256, resource.id)
  assert.equal(previous.resources.find(old => old.id === resource.id).sha256, resource.sha256)
}
for (const file of Object.values(migration.provenance)) {
  assert.equal(hash(await read(file)), path.basename(file, path.extname(file)), file)
}
for (const resource of Object.values(catalog.resources)) for (const file of Object.values(resource.provenance)) await fs.access(path.join(root, file))
for (const file of approval.files) {
  const migrated = migration.entries.find(entry => entry.from === file.file)
  assert.equal(hash(await read(migrated.to)), file.sha256, 'Approved resource preserved')
}
for (const [file, sha256] of Object.entries(approval.sourceHashes)) assert.equal(hash(await read(migration.provenance[file])), sha256)
assert.equal(hash(await read(migration.originalRenderReport)), approval.renderReport.sha256)
for (const name of ['vite', 'vitest', '@qmonster/generator-core', '@qmonster/incubator-adapter']) {
  const real = await fs.realpath(path.join(root, 'node_modules', name))
  assert.ok(real.startsWith(root + path.sep) && !real.includes(path.sep + '.worktrees' + path.sep), real)
}
const report = { checkedAt: new Date().toISOString(), resourceHashesPreserved: 39, approvalEvidencePreserved: true,
  dependenciesInRoot: true, combinationsCompared: 0, productionChecks: [], errors: [] }
const browser = await chromium.launch({ headless: true })
let server
try {
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  const origin = process.env.QMONSTER_VERIFY_URL || 'http://127.0.0.1:4184'
  const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
  await page.goto(origin)
  await page.addScriptTag({ type: 'module', content: `
    import * as core from '${prefix}packages/generator-core/src/feline-combination.ts';
    import * as assets from '${prefix}packages/asset-catalog/src/feline-combination-catalog.ts';
    import * as renderer from '${prefix}packages/renderer-canvas/src/feline-combination-render.ts';
    window.migrationApi = {core,assets,renderer};` })
  await page.waitForFunction(() => window.migrationApi)
  await page.exposeFunction('migrationProgress', count => console.log(`Compared ${count}/864 combinations`))
  report.combinationsCompared = await page.evaluate(async ({ catalog, baseline, prefix }) => {
    const { core, assets, renderer } = window.migrationApi
    const canvas = document.createElement('canvas')
    const load = renderer.createFelineCombinationResourceResolver(resource => prefix + resource.path)
    const cache = new Map()
    const resolve = async resource => {
      if (!cache.has(resource.sha256)) {
        const bitmap = await load(resource)
        const cached = document.createElement('canvas'); cached.width = cached.height = 1254
        cached.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close()
        cache.set(resource.sha256, cached)
      }
      return cache.get(resource.sha256)
    }
    let count = 0
    for (const sample of baseline.samples) {
      const spec = core.parseFelineCombinationSpec(sample.spec)
      if (!spec.ok) throw new Error('Previous spec rejected: ' + sample.index)
      await renderer.renderFelineCombination(canvas, assets.resolveFelineCombination(spec.value, catalog), resolve)
      const bytes = canvas.getContext('2d').getImageData(0, 0, 1254, 1254).data
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
      if (sha256 !== sample.rgbaSha256) throw new Error('Migration changed pixels: ' + sample.index)
      count++
      if (count % 144 === 0) await window.migrationProgress(count)
    }
    return count
  }, { catalog, baseline, prefix })
  assert.equal(report.combinationsCompared, 864)
  await page.close()

  // Serve only built files. Neither source files nor the old worktree are exposed.
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = path.resolve(root, 'dist', relative.startsWith('hatchery/') ? relative : 'creator/' + (relative || 'index.html'))
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(403).end(); return }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' })
      response.end(await fs.readFile(file))
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const production = await browser.newPage()
  production.on('pageerror', error => report.errors.push(error.message))
  await production.goto(`http://127.0.0.1:${server.address().port}/`)
  await production.waitForFunction(() => document.querySelector('.feline-primary')?.disabled === false)
  report.productionChecks.push('Built Creator renders without any source/worktree access')
  const result = await production.evaluate(async previous => {
    const sdk = await import('/hatchery/qmonster.js')
    const snapshot = await (await fetch('/hatchery/snapshot.json')).json()
    const hatchery = await sdk.createFelineHatchery({ catalogUrl: '/hatchery/' + snapshot.catalogFile, resourceBaseUrl: '/hatchery/' })
    const fresh = await hatchery.hatch('migration-production', { coat: 'calico', expression: 'tongue-tip', ...sdk.mutationSelectionsFromList(['antlers', 'small-lion-mane', 'forked-tail-tip']) })
    const restored = await hatchery.restore(JSON.parse(JSON.stringify(fresh.visual)))
    const imported = await hatchery.restore({ ...fresh.visual, catalogSha256: previous.catalogSha256, runtimeRevision: previous.runtimeRevision })
    const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('')
    return { bytes: fresh.image.blob.size, sameRestore: await hash(fresh.image.blob) === await hash(restored.image.blob),
      samePrevious: await hash(fresh.image.blob) === await hash(imported.image.blob), normalized: imported.visual.runtimeRevision === snapshot.runtimeRevision }
  }, previous)
  assert.ok(result.bytes > 0 && result.sameRestore && result.samePrevious && result.normalized)
  report.productionChecks.push('Built hatchery SDK loads deployed catalog/assets and restores current JSON exactly',
    'Previous integration envelope restores unchanged pixels and normalizes to the root snapshot')
  await production.screenshot({ path: path.join(root, 'docs/qa/root-workbench.png'), fullPage: true })
  assert.deepEqual(report.errors, [])
  report.status = 'passed'
} finally {
  await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await fs.writeFile(path.join(root, 'docs/qa/root-migration-verification.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
