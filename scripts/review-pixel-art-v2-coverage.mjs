import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, 'docs/qa/pixel-standard-small-fangs-coverage')
const catalogPath = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round/catalog.candidate.json'
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-coverage-qa')
await fs.mkdir(temp, { recursive: true }); await fs.mkdir(path.join(qa, 'renders'), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['packages/incubator-adapter/src/pixel-art-sdk.ts'], outfile: path.join(temp, 'sdk.mjs'), bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV2, resolvePixelArtV2, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.mjs')).href)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = await fs.readFile(path.join(root, catalogPath)), catalog = requirePixelArtCatalogV2(JSON.parse(bytes)), layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) layers[id] = new Uint8ClampedArray(await sharp(path.join(root, 'packages/asset-catalog/pixel/v2', resource.path)).ensureAlpha().raw().toBuffer())
const profile = catalog.profiles.find(p => p.id === 'standard-small-fangs-round')
const slots = ['crown', 'ears', 'neck', 'tailTip']
const mask = row => slots.map(slot => row.phenotype[slot] === 'none' ? '0' : '1').join('')
const rows = catalog.coverage.filter(row => row.profileId === profile.id).sort((a, b) => mask(a).localeCompare(mask(b)))
assert.equal(rows.length, 16)
const rendered = new Map(rows.map(row => [mask(row), composePixelArt(resolvePixelArtV2(row.phenotype, catalog), layers)]))
const pixel = (pixels, x, y) => Array.from(pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4))
const difference = (a, b) => { let count = 0; for (let i = 0; i < a.length; i += 4) if (a.slice(i, i + 4).some((v, j) => v !== b[i + j])) count++; return count }
const report = { schemaVersion: 'pixel-coverage-qa-v1', status: 'technical-replay-passed-art-review-pending', runtimeEnabled: false,
  catalog: { path: catalogPath, sha256: sha(bytes), artVersion: catalog.artVersion, revision: catalog.revision },
  rendererVersion: catalog.rendererVersion, profileId: profile.id, binaryOrder: slots, faceRegion: { x: 16, y: 14, width: 21, height: 18 },
  coverageCount: 32, approvedCount: 21, pendingCount: 11, generatableCount: 21, resourceCount: 15, samples: [], files: {} }
report.evidence = {}
for (const file of ['scripts/build-pixel-art-v2-coverage.mjs', 'scripts/review-pixel-art-v2-coverage.mjs', 'packages/renderer-canvas/src/pixel-art-render.ts']) report.evidence[file] = sha(await fs.readFile(path.join(root, file)))
const entries = []
for (const row of rows) {
  const binary = mask(row), rgba = rendered.get(binary), plan = resolvePixelArtV2(row.phenotype, catalog)
  assert.equal(sha(rgba), row.rgbaSha256, row.id)
  assert.equal(sha(composePixelArt(plan, layers)), row.rgbaSha256, `Replay: ${row.id}`)
  for (let i = 3; i < rgba.length; i += 4) assert.ok(rgba[i] === 0 || rgba[i] === 255)
  for (let y = 14; y <= 31; y++) for (let x = 16; x <= 36; x++) assert.deepEqual(pixel(rgba, x, y), pixel(rendered.get(`0${binary[1]}00`), x, y), `Face changed: ${row.id} ${x},${y}`)
  const checks = { faceReference: binary[1] === '1' ? 'standard-ears' : 'standard-base', facePixelsUnchanged: true, binaryAlpha: true, deterministicReplay: true }
  // Counterfactual renders establish that the retained geometry still actively
  // clears old ears/tail and masks the mane instead of merely existing in JSON.
  for (const [name, slot] of [['ears', 'ears'], ['oldTail', 'tailTip']]) {
    if (row.phenotype[slot] === 'none') continue
    const step = profile.steps.find(s => s.slot === slot)
    const altered = { ...plan, operations: plan.operations.filter(op => !(op.kind === 'clear' && JSON.stringify(op.polygons) === JSON.stringify(step.clear))) }
    const changedPixels = difference(rgba, composePixelArt(altered, layers))
    assert.ok(changedPixels > 0, `Inactive ${name} clear: ${row.id}`)
    checks[`${name}ClearChangedPixels`] = changedPixels
  }
  if (row.phenotype.neck !== 'none') {
    const resource = profile.steps.find(s => s.slot === 'neck').resources['small-lion-mane']
    const altered = { ...plan, operations: plan.operations.map(op => op.kind === 'draw' && op.resource === resource ? { ...op, occlusion: [] } : op) }
    checks.maneOcclusionChangedPixels = difference(rgba, composePixelArt(altered, layers))
    assert.ok(checks.maneOcclusionChangedPixels > 0)
  }
  if (row.phenotype.crown !== 'none' && row.phenotype.ears !== 'none') {
    const ears = layers[profile.steps.find(s => s.slot === 'ears').resources['fin-ears']]
    const horns = layers[profile.steps.find(s => s.slot === 'crown').resources['dragon-horns']]
    const withoutHorns = rendered.get(`0${binary.slice(1)}`)
    let overlap = 0
    for (let i = 0; i < rgba.length; i += 4) if (ears[i + 3] && horns[i + 3]) {
      overlap++; assert.deepEqual(Array.from(rgba.slice(i, i + 4)), Array.from(withoutHorns.slice(i, i + 4)), `Ear foreground: ${row.id}`)
    }
    checks.hornsEarsOverlapPixels = overlap
    checks.earForegroundPreserved = true
  }
  const images = []
  for (const size of [64, 128, 256]) {
    const png = await sharp(Buffer.from(rgba), { raw: { width: 64, height: 64, channels: 4 } }).resize(size, size, { kernel: 'nearest' }).png().toBuffer()
    const file = `renders/${row.id}-${size}.png`
    await fs.writeFile(path.join(qa, file), png); report.files[file] = sha(png)
    for (const background of ['dark', 'light']) images.push(`<figure class="${background}"><img src="${file}" width="${size}" height="${size}" alt="${row.id} ${size}px ${background}"><figcaption>${size}px · ${background}</figcaption></figure>`)
  }
  report.samples.push({ id: row.id, binary, phenotype: row.phenotype, review: row.review, rgbaSha256: row.rgbaSha256, checks })
  entries.push(`<article><h2>${binary} · ${row.id}</h2><p>${row.label} · ${row.review}</p><div class="sizes">${images.join('')}</div><code>${row.rgbaSha256}</code></article>`)
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>标准圆眼小尖牙 · 16 格覆盖候选 QA</title><style>body{background:#e9e4da;color:#252833;font:14px system-ui;margin:24px}header{max-width:1000px}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}article{background:white;padding:14px;border:1px solid #bbb;border-radius:10px;min-width:0}h2{font-size:15px;overflow-wrap:anywhere}.sizes{display:grid;grid-template-columns:1fr 1fr;gap:5px}figure{margin:0;display:flex;align-items:center;flex-direction:column;padding:5px}img{image-rendering:pixelated;max-width:100%;object-fit:contain}figcaption{font-size:11px}.dark{background:#292c31;color:white}.light{background:#f4f0e8}code{display:block;font-size:9px;overflow-wrap:anywhere}</style><header><h1>标准圆眼小尖牙 · 16 格覆盖候选</h1><p>1.2.1-candidate.1 · 32 coverage / 21 approved & generatable / 11 pending · Nutri runtime disabled</p><p>二进制顺序：龙角 / 鳍耳 / 鬃毛 / 焰尾。技术回放通过不代表美术验收；全部新增项保持 pending。每格展示原生 64px、最近邻 128px / 256px 的深浅背景。</p><p>Revision: ${catalog.revision}</p></header><main>${entries.join('')}</main></html>\n`
await fs.writeFile(path.join(qa, 'gallery.html'), html)
report.files['gallery.html'] = sha(html)
await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`QA: ${rows.length} cells / ${Object.keys(report.files).length - 1} PNGs / face, clearing, occlusion, overlap and replay verified; art review pending.`)
