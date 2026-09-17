import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/qa/pixel-tail-layers')
const approvedRoot = path.join(root, 'packages/asset-catalog/pixel/v2/approved-1.2.1')
const catalog = JSON.parse(await fs.readFile(path.join(approvedRoot, 'catalog.approved.json'), 'utf8'))
const size = 64

function insidePolygon(x, y, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
    if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < (xj - xi) * (y + 0.5 - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function extractClearFootprint(pixels, polygons) {
  const out = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!polygons.some(polygon => insidePolygon(x, y, polygon))) continue
    const i = (y * size + x) * 4
    out.set(pixels.subarray(i, i + 4), i)
  }
  return out
}

function outline(source) {
  const out = new Uint8ClampedArray(source)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    if (source[i + 3]) continue
    let r = 0, g = 0, b = 0, count = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue
      const j = (ny * size + nx) * 4
      if (!source[j + 3]) continue
      r += source[j]; g += source[j + 1]; b += source[j + 2]; count++
    }
    if (count) out.set([Math.round(r / count * 0.36), Math.round(g / count * 0.36), Math.round(b / count * 0.36), 255], i)
  }
  return out
}

function metrics(pixels) {
  const xs = [], ys = []
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3]) { xs.push(x); ys.push(y) }
  return { pixels: xs.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
}

async function readLayer(file) {
  return new Uint8ClampedArray(await sharp(file).ensureAlpha().raw().toBuffer())
}

const rows = []
for (const profileId of ['slender-tall-round-small-fangs', 'slender-tall-sleepy-almond-small-fangs']) {
  const profile = catalog.profiles.find(item => item.id === profileId)
  const bodyStep = profile.steps.find(item => item.slot === 'body')
  const tailStep = profile.steps.find(item => item.slot === 'tailTip')
  const resource = catalog.resources[bodyStep.resources['small-fangs']]
  const pixels = await readLayer(path.join(approvedRoot, resource.path))
  rows.push({
    id: profileId.includes('sleepy') ? 'default-tail-sleepy' : 'default-tail-round',
    label: profileId.includes('sleepy') ? '默认尾巴擦除足迹 · 困倦眼体型' : '默认尾巴擦除足迹 · 圆眼体型',
    note: '从一体式身体 PNG 中按当前 tailTip clear 多边形提取；可见擦除范围同时包含少量臀部／右后腿像素。',
    pixels: extractClearFootprint(pixels, tailStep.clear),
  })
}

rows.push({
  id: 'flame-tail', label: '火焰尾 · flame-tail',
  note: 'v2 已发布独立尾巴层；实际绘制在 frame，并由渲染器添加 1px 外轮廓。',
  pixels: await readLayer(path.join(approvedRoot, catalog.resources['layer-f43b645bd12e6f68'].path)),
})
rows.push({
  id: 'forked-tail-tip', label: '分叉尾尖 · forked-tail-tip',
  note: '本批已通过美术验收的独立尾巴层；实际绘制在 frame，并使用同一尾巴擦除区域。',
  pixels: await readLayer(path.join(root, 'docs/qa/pixel-parts-batch/layers/orange-white-forked-tail-tip.png')),
})

const mutationRows = rows.filter(row => ['flame-tail', 'forked-tail-tip'].includes(row.id))
const tailLeftAnchor = metrics(mutationRows.find(row => row.id === 'flame-tail').pixels).bbox[0]
for (const row of mutationRows) assert.equal(metrics(row.pixels).bbox[0], tailLeftAnchor, `${row.id} must use tail left anchor x=${tailLeftAnchor}`)

await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(path.join(output, 'layers'), { recursive: true })
for (const row of rows) {
  row.metrics = metrics(row.pixels)
  for (const [suffix, pixels] of [['raw', row.pixels], ['outlined', outline(row.pixels)]]) {
    await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } }).png({ palette: true }).toFile(path.join(output, 'layers', `${row.id}-${suffix}.png`))
  }
}

const cards = rows.map(row => `<article><h2>${row.label}</h2><div class="views"><figure><div class="checker"><img src="layers/${row.id}-raw.png"></div><figcaption>透明原图层</figcaption></figure><figure><div class="checker"><img src="layers/${row.id}-outlined.png"></div><figcaption>frame 实际轮廓</figcaption></figure><img class="native" src="layers/${row.id}-outlined.png" title="64px 实际尺寸"></div><p>${row.note}</p><code>bbox [${row.metrics.bbox.join(', ')}] · ${row.metrics.pixels} 个非透明像素</code></article>`).join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>像素尾巴独立图层对比</title><style>*{box-sizing:border-box}body{margin:0;background:#eee9dc;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 26px;background:#fffef5ed;border-bottom:1px solid #d7cfbf}h1{margin:0 0 6px;font-size:24px}header p{margin:0;color:#59675f}main{max-width:1300px;margin:auto;padding:22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:16px}article{background:#fffef8;border:1px solid #d7cfbf;border-radius:12px;padding:16px}h2{font-size:17px;margin:0 0 12px}.views{display:flex;align-items:end;gap:14px}.checker{width:256px;height:256px;background-color:#e9e6df;background-image:linear-gradient(45deg,#ccd3d0 25%,transparent 25%),linear-gradient(-45deg,#ccd3d0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccd3d0 75%),linear-gradient(-45deg,transparent 75%,#ccd3d0 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}.checker img{width:256px;height:256px;image-rendering:pixelated}figure{margin:0}figcaption{margin-top:5px;color:#68756d}.native{width:64px;height:64px;image-rendering:pixelated;background:#e9e6df}article p{margin:12px 0 8px}code{color:#68756d}</style><header><h1>像素尾巴独立图层对比</h1><p>默认尾巴来自一体式身体的实际擦除足迹；两种异变尾巴展示透明资源和 frame 渲染轮廓。</p></header><main>${cards}</main></html>`
await fs.writeFile(path.join(output, 'index.html'), html)
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ schemaVersion: 'pixel-tail-layer-comparison-v1', rows: rows.map(({ id, label, note, metrics }) => ({ id, label, note, ...metrics })) }, null, 2) + '\n')
console.log(`Tail comparison: wrote ${rows.length} rows to docs/qa/pixel-tail-layers/index.html`)
