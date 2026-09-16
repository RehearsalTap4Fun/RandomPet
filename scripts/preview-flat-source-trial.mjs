// Local art probe only. This is NOT nutri/scripts/pixelCat.ts or its acceptance result.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const art = 'docs/art/flat-source-trial'
const qa = 'docs/qa/flat-source-trial'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const save = async (file, bytes) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes) }
const ids = ['orange-white-parted-mouth', 'dragon-horns', 'flame-tail']
const resources = { flat: {}, plush: {} }
const checks = []
function bounds(data) {
  let x0 = 1254, y0 = 1254, x1 = -1, y1 = -1, count = 0
  for (let p = 0; p < 1254 * 1254; p++) if (data[p * 4 + 3] >= 128) {
    const x = p % 1254, y = Math.floor(p / 1254)
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); count++
  }
  assert.ok(count > 0)
  return { x0, y0, x1, y1, count }
}
for (const id of ids) {
  const input = `${art}/solid/${id}.png`, bytes = await fs.readFile(path.join(root, input))
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 1254); assert.equal(info.height, 1254)
  const mask = new Uint8Array(1254 * 1254)
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4
    // Wide key catches antialiased magenta edges; colors inside the art avoid magenta.
    mask[p] = data[i] - data[i + 1] > 65 && data[i + 2] - data[i + 1] > 65 ? 0 : 255
  }
  for (let y = 0; y < 1254; y++) for (let x = 0; x < 1254; x++) {
    let a = mask[y * 1254 + x]
    for (let dy = -3; dy <= 3 && a; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (x + dx < 0 || x + dx >= 1254 || y + dy < 0 || y + dy >= 1254 || !mask[(y + dy) * 1254 + x + dx]) { a = 0; break }
    }
    data[(y * 1254 + x) * 4 + 3] = a
    if (!a) data.fill(0, (y * 1254 + x) * 4, (y * 1254 + x) * 4 + 3)
  }
  const alphaPath = `${art}/alpha/${id}.png`
  const alphaPng = await sharp(data, { raw: { width: 1254, height: 1254, channels: 4 } }).png().toBuffer()
  await save(alphaPath, alphaPng)
  const oldPath = id === ids[0] ? `packages/asset-catalog/assets/v0.10.0/${id}.png` : `${art}/reference/${id}.png`
  const oldBytes = await fs.readFile(path.join(root, oldPath)), old = await sharp(oldBytes).ensureAlpha().raw().toBuffer()
  let union = 0, intersection = 0
  for (let p = 0; p < mask.length; p++) {
    const a = data[p * 4 + 3] >= 128, b = old[p * 4 + 3] >= 128
    if (a || b) union++
    if (a && b) intersection++
  }
  checks.push({ id, sourceSha256: sha(bytes), alphaSha256: sha(alphaPng), oldSha256: sha(oldBytes), flatBounds: bounds(data), plushBounds: bounds(old), silhouetteIoU: intersection / union })
  console.log('Prepared', id)
  for (const [style, file, content] of [['flat', alphaPath, alphaPng], ['plush', oldPath, oldBytes]]) {
    resources[style][id] = { id, path: file, sha256: sha(content), width: 1254, height: 1254, mediaType: 'image/png', hasAlpha: true }
  }
}

const server = await createServer({ configFile: path.join(root, 'apps/creator-web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, open: false } })
await server.listen()
let browser
const cases = [['base', '基础主体', false, false], ['horns', '龙角', true, false], ['flame', '焰尾', false, true], ['both', '龙角＋焰尾', true, true]]
const samples = []
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  console.log('Preview server', origin)
  const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
  const bootstrap = `import {composeFelineLayers} from '${prefix}packages/renderer-canvas/src/feline-canvas-compositor.ts'; import {FELINE_COMBINATION_TEMPLATE_V1,createFelineCombinationResourceResolver} from '${prefix}packages/renderer-canvas/src/feline-combination-render.ts'; window.api={composeFelineLayers,FELINE_COMBINATION_TEMPLATE_V1,createFelineCombinationResourceResolver};`
  await page.route(origin + '/__flat-trial', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local art probe</title><script type="module">' + bootstrap + '</script>' }))
  page.on('pageerror', error => console.error(error.message))
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()) })
  page.on('requestfailed', req => console.error(req.url(), req.failure()))
  await page.goto(origin + '/__flat-trial')
  await page.waitForFunction(() => window.api)
  for (const style of ['plush', 'flat']) for (const [id, label, horns, flame] of cases) {
    const url = await page.evaluate(async ({ resources, horns, flame, prefix }) => {
      const a = window.api, canvas = document.createElement('canvas')
      const layers = []
      if (horns) layers.push({ kind: 'draw', surface: 'frame', resource: resources['dragon-horns'] })
      layers.push({ kind: 'draw', surface: 'subject', resource: resources['orange-white-parted-mouth'] })
      if (flame) {
        layers.push({ kind: 'clear', polygons: [a.FELINE_COMBINATION_TEMPLATE_V1.tailTip], feather: true })
        layers.push({ kind: 'draw', surface: 'frame', resource: resources['flame-tail'] })
      }
      await a.composeFelineLayers(canvas, () => layers, a.createFelineCombinationResourceResolver(r => prefix + r.path))
      return canvas.toDataURL('image/png')
    }, { resources: resources[style], horns, flame, prefix })
    const full = Buffer.from(url.split(',')[1], 'base64')
    const file = `${style}-${id}`
    await save(`${qa}/samples/${file}-source.png`, full)
    // Identical provisional settings on both styles. No claim of nutri parity.
    const intermediate = await sharp(full).resize(192, 192).median(3).png().toBuffer()
    const tiny = await sharp(intermediate).resize(64, 64).png({ palette: true, colours: 24, dither: 0 }).toBuffer()
    await save(`${qa}/samples/${file}-64.png`, tiny)
    await save(`${qa}/samples/${file}-256.png`, await sharp(tiny).resize(256, 256, { kernel: 'nearest' }).png().toBuffer())
    samples.push({ style, id, label, sourceSha256: sha(full), pixelSha256: sha(tiny) })
  }
} finally { await browser?.close(); await server.close() }

const report = { status: 'local-preview-only-consumer-validation-pending', consumer: 'nutri/scripts/pixelCat.ts not available', processing: { key: 'magenta excess R/G and B/G > 65, square erosion radius 3', composition: 'existing shared compositor, original tail removal polygon, final-coordinate parts with identity transform', resize: '1254 -> 192 (median 3) -> 64', quantize: 'adaptive 24 colors including alpha, no dither', display: 'nearest-neighbor integer scaling' }, sourceChecks: checks, samples }
await save(`${qa}/report.json`, JSON.stringify(report, null, 2) + '\n')
const rows = cases.map(([id, label]) => `<section><h2>${label}</h2><div class="pair">${['plush', 'flat'].map(style => `<article><h3>${style === 'plush' ? '毛绒源图' : '平涂候选'} → 本地像素预览</h3><div class="stage"><img class="large" src="samples/${style}-${id}-64.png"></div><div class="sizes"><span>64px <img width="64" src="samples/${style}-${id}-64.png"></span><span>128px <img width="128" src="samples/${style}-${id}-64.png"></span></div><details><summary>查看合成源图</summary><img width="320" src="samples/${style}-${id}-source.png"></details></article>`).join('')}</div></section>`).join('')
await save(`${qa}/index.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>像素首批 · 本地预检</title><style>body{font:16px system-ui;margin:32px auto;max-width:1000px;background:#eee9e1;color:#292624}h1{margin-bottom:8px}.notice{background:#fff0cb;padding:16px;border-radius:12px;line-height:1.6}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{background:#fff;padding:18px;border-radius:16px}.stage{background:#28303b;text-align:center;border-radius:10px;padding:16px}.large{width:256px;height:256px;image-rendering:pixelated}.sizes{display:flex;gap:24px;align-items:center;margin:16px 0}.sizes img{image-rendering:pixelated;vertical-align:middle}summary{cursor:pointer}button{padding:8px 16px;margin:12px 0}h3{font-size:16px}</style><h1>平涂 → 像素：首批预检</h1><p>主体 · 龙角 · 焰尾 / 四种组合 / 64px 原尺寸与整数倍放大</p><div class="notice">这是本地临时预览，尚未运行 nutri/scripts/pixelCat.ts，不能据此宣告消费端验收通过。两种源图使用相同临时处理参数：192px 中间图、3px 中值滤波、64px、24 色、无抖动。生成图仍可能存在渐变与轮廓偏移；替换接缝沿用旧几何，需人工检查。</div><button onclick="document.querySelectorAll('.stage').forEach(e=>e.style.background=e.style.background==='rgb(245, 242, 235)'?'#28303b':'#f5f2eb')">切换深浅底</button>${rows}<p><a href="report.json">处理参数、文件指纹与轮廓测量</a></p></html>`)
console.log(JSON.stringify({ status: report.status, checks, sampleCount: samples.length, gallery: `${qa}/index.html` }, null, 2))
