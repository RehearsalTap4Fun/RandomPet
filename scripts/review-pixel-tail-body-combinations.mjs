import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const packageRoot = path.join(root, 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0')
const output = path.join(root, 'docs/qa/pixel-tail-body-comparison')
const catalogInput = JSON.parse(await fs.readFile(path.join(packageRoot, 'catalog.candidate.json'), 'utf8'))
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-tail-body-review')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, resolvePixelArtV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalog = requirePixelArtCatalogV3(catalogInput)
const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  layers[id] = new Uint8ClampedArray(await sharp(path.join(packageRoot, resource.path)).ensureAlpha().raw().toBuffer())
}

function leftEdge(pixels) {
  let left = 64
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (pixels[(y * 64 + x) * 4 + 3]) left = Math.min(left, x)
  return left
}

const profiles = [
  ['标准体型', 'standard-small-fangs-round'],
  ['短腿体型', 'shortleg-round-small-fangs-round'],
  ['细长体型', 'slender-tall-round-small-fangs'],
]
const tails = [['火焰尾', 'flame-tail'], ['分叉尾', 'forked-tail-tip']]
const rows = []
for (const [bodyLabel, profileId] of profiles) for (const [tailLabel, tailTip] of tails) {
  const profile = catalog.profiles.find(item => item.id === profileId)
  assert.ok(profile, profileId)
  const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
    expression: profile.expression, crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip }
  const plan = resolvePixelArtV3(phenotype, catalog)
  const tailOperation = plan.operations.find(operation => operation.kind === 'draw' && operation.target === 'frame')
  assert.ok(tailOperation, `${profileId}/${tailTip} missing frame tail operation`)
  const anchor = leftEdge(layers[tailOperation.resource])
  assert.equal(anchor, 40, `${profileId}/${tailTip} tail anchor`)
  rows.push({ bodyLabel, profileId, tailLabel, tailTip, anchor, review: plan.review, pixels: composePixelArt(plan, layers) })
}

await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(path.join(output, 'samples'), { recursive: true })
for (const [index, row] of rows.entries()) {
  const png = await sharp(Buffer.from(row.pixels), { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true }).toBuffer()
  const id = String(index + 1).padStart(2, '0')
  row.file = `samples/${id}.png`
  row.crop = `samples/${id}-contact.png`
  await fs.writeFile(path.join(output, row.file), png)
  await sharp(png).extract({ left: 28, top: 18, width: 36, height: 46 }).png({ palette: true }).toFile(path.join(output, row.crop))
}

const cards = rows.map(row => `<article><h2>${row.bodyLabel} × ${row.tailLabel}</h2><div class="views"><figure><div class="checker full"><img src="${row.file}"></div><figcaption>完整 64px</figcaption></figure><figure><div class="checker contact"><img src="${row.crop}"></div><figcaption>尾根放大</figcaption></figure></div><code>${row.profileId}<br>${row.tailTip} · left x=${row.anchor} · ${row.review}</code></article>`).join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三种体型 × 两种尾巴</title><style>*{box-sizing:border-box}body{margin:0;background:#eee9dc;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 26px;background:#fffef5ed;border-bottom:1px solid #d7cfbf}h1{margin:0 0 6px;font-size:24px}header p{margin:0;color:#59675f}main{max-width:1360px;margin:auto;padding:22px;display:grid;grid-template-columns:repeat(2,minmax(520px,1fr));gap:16px}article{background:#fffef8;border:1px solid #d7cfbf;border-radius:12px;padding:16px}h2{font-size:18px;margin:0 0 12px}.views{display:flex;align-items:end;gap:14px}.checker{background-color:#f6f2e9;background-image:linear-gradient(45deg,#d5dbd8 25%,transparent 25%),linear-gradient(-45deg,#d5dbd8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d5dbd8 75%),linear-gradient(-45deg,transparent 75%,#d5dbd8 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}.checker img{display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated}.full{width:256px;height:256px}.contact{width:216px;height:276px}.contact img{object-fit:fill}figure{margin:0}figcaption{margin-top:5px;color:#68756d}code{display:block;margin-top:12px;color:#68756d}@media(max-width:1100px){main{grid-template-columns:1fr}}</style><header><h1>三种体型 × 两种尾巴</h1><p>所有独立尾巴统一使用非透明左边界 x=40；无冠饰、耳型、颈部与背部部件干扰。</p></header><main>${cards}</main></html>`
await fs.writeFile(path.join(output, 'index.html'), html)
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ schemaVersion: 'pixel-tail-body-comparison-v1', tailLeftAnchor: 40, rows: rows.map(({ bodyLabel, profileId, tailLabel, tailTip, anchor, review, file, crop }) => ({ bodyLabel, profileId, tailLabel, tailTip, anchor, review, file, crop })) }, null, 2) + '\n')
console.log(`Tail/body comparison: wrote ${rows.length} samples to docs/qa/pixel-tail-body-comparison/index.html`)
