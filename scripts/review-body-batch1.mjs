import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const folder = path.join(root, 'docs/qa/body-batch1')
const read = async file => JSON.parse((await fs.readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const profile = await read('docs/art/body-batch1/profile.json')
const catalog = await read('packages/asset-catalog/catalog/v0.10.0/catalog.json')
const baseline = await read('docs/releases/v0.10.0/render-baseline.json')
const cases = [
  ['基础主体', []], ['小龙角', ['dragon-horns']], ['鹿角', ['antlers']], ['光环', ['halo']],
  ['鳍耳', ['fin-ears']], ['小狮鬃', ['small-lion-mane']], ['伞蜥颈膜', ['frill-neck']],
  ['小翅膀', ['small-wings']], ['羽翼', ['feathered-wings']], ['龙翼', ['dragon-wings']],
  ['分叉尾', ['forked-tail-tip']], ['火焰尾', ['flame-tail']],
  ['小龙角＋鳍耳', ['dragon-horns', 'fin-ears']], ['伞蜥颈膜＋龙翼', ['frill-neck', 'dragon-wings']],
  ['羽翼＋火焰尾', ['feathered-wings', 'flame-tail']],
  ['五部位叠加', ['antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip']],
]
await fs.mkdir(path.join(folder, 'samples'), { recursive: true })
const resources = [profile.body, ...Object.values(profile.mutations).map(x => x.resource)]
const resourceChecks = []
for (const resource of resources) {
  const bytes = await fs.readFile(path.join(root, resource.path)), metadata = await sharp(bytes).metadata()
  assert.equal(hash(bytes), resource.sha256, `Resource changed: ${resource.id}`)
  assert.equal(metadata.width, 1254); assert.equal(metadata.height, 1254); assert.equal(metadata.hasAlpha, true)
  const alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer()
  let transparent = 0, fractional = 0, visible = 0
  for (const a of alpha) { if (a === 0) transparent++; else { visible++; if (a < 255) fractional++ } }
  assert.ok(transparent > 0 && visible > 0, `Invalid alpha coverage: ${resource.id}`)
  resourceChecks.push({ id: resource.id, sha256: resource.sha256, transparent, fractional, visible })
}
const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
const origin = process.env.QMONSTER_VERIFY_URL || 'http://127.0.0.1:4184'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  await page.route(origin + '/__body-study-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Body study checks</title>' }))
  await page.goto(origin + '/__body-study-check')
  await page.addScriptTag({ type: 'module', content: `import * as assets from '${prefix}packages/asset-catalog/src/index.ts'; import * as renderer from '${prefix}packages/renderer-canvas/src/index.ts'; window.bodyStudyApi={assets,renderer};` })
  await page.waitForFunction(() => window.bodyStudyApi)
  await page.exposeFunction('saveBodySample', async (index, url) => {
    assert.ok(Number.isInteger(index) && index >= 0 && index < 16)
    await fs.writeFile(path.join(folder, 'samples', String(index + 1).padStart(2, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'))
  })
  const results = await page.evaluate(async ({ profile, catalog, baseline, cases, prefix }) => {
    const { assets, renderer } = window.bodyStudyApi
    const make = () => Object.assign(document.createElement('canvas'), { width: 1254, height: 1254 })
    const load = renderer.createFelineCombinationResourceResolver(r => prefix + r.path), cache = new Map()
    const resolve = async r => {
      if (!cache.has(r.sha256)) { const bitmap = await load(r), c = make(); c.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); cache.set(r.sha256, c) }
      return cache.get(r.sha256)
    }
    const digest = async canvas => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d').getImageData(0, 0, 1254, 1254).data)), x => x.toString(16).padStart(2, '0')).join('')
    const samples = [], output = make(), replay = make()
    for (const [index, [label, mutations]] of cases.entries()) {
      const spec = { schemaVersion: 'feline-body-study-v1', profileId: profile.id, phenotype: profile.phenotype, mutations }
      await renderer.renderFelineBodyStudy(output, spec, profile, resolve)
      await renderer.renderFelineBodyStudy(replay, JSON.parse(JSON.stringify(spec)), JSON.parse(JSON.stringify(profile)), resolve)
      const rgbaSha256 = await digest(output), replaySha256 = await digest(replay)
      if (rgbaSha256 !== replaySha256) throw new Error('Replay mismatch: ' + label)
      const pixels = output.getContext('2d').getImageData(0, 0, 1254, 1254).data
      let visible = 0, edgePixels = 0
      for (let i = 0; i < 1254 * 1254; i++) {
        if (pixels[i * 4 + 3] > 0) visible++
        const x = i % 1254, y = Math.floor(i / 1254)
        if (pixels[i * 4 + 3] > 8 && (x === 0 || y === 0 || x === 1253 || y === 1253)) edgePixels++
      }
      if (!visible) throw new Error('Empty sample: ' + label)
      await window.saveBodySample(index, output.toDataURL('image/png'))
      samples.push({ index: index + 1, label, spec, rgbaSha256, replayEqual: true, visiblePixels: visible, canvasEdgePixels: edgePixels })
    }
    // Bounded regression: 3 representative legacy combinations per coat.
    const legacy = []
    for (const coat of Object.keys(catalog.bodies)) {
      for (const variant of ['base', 'ears-tail', 'stack']) {
        const sample = baseline.samples.find(s => {
          const p = s.spec.selections
          if (p.coat !== coat) return false
          if (variant === 'base') return ['crown', 'ears', 'neck', 'back', 'tailTip'].every(k => p[k] === 'none')
          if (variant === 'ears-tail') return p.ears === 'fin-ears' && p.tailTip === 'forked-tail-tip' && p.back === 'none'
          return p.crown === 'antlers' && p.neck === 'small-lion-mane' && p.back === 'small-wings'
        })
        if (!sample) throw new Error('Missing old baseline sample: ' + coat + '/' + variant)
        await renderer.renderFelineCombination(output, assets.resolveFelineCombination(sample.spec, catalog), resolve)
        const rgbaSha256 = await digest(output)
        if (rgbaSha256 !== sample.rgbaSha256) throw new Error('Legacy pixels changed: ' + coat + '/' + variant)
        legacy.push({ coat, variant, baselineIndex: sample.index, rgbaSha256, equal: true })
      }
    }
    return { samples, legacy }
  }, { profile, catalog, baseline, cases, prefix })
  const sourceFiles = ['packages/renderer-canvas/src/feline-canvas-compositor.ts', 'packages/renderer-canvas/src/feline-combination-render.ts',
    'packages/renderer-canvas/src/feline-body-study.ts', 'scripts/prepare-body-batch1.mjs', 'scripts/review-body-batch1.mjs']
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async p => [p, hash(await fs.readFile(path.join(root, p)))])))
  const report = { scope: '16 body study samples and 18 representative legacy regressions; not exhaustive combinations',
    status: 'engineering-passed-art-review-pending', profileSha256: hash(await fs.readFile(path.join(root, 'docs/art/body-batch1/profile.json'))),
    sourceHashes, resourceChecks, ...results }
  const beforeMane = await read('docs/qa/body-batch1/mane-fix/before-report.json')
  report.maneFix = { changedSamples: results.samples.filter((sample, i) => sample.rgbaSha256 !== beforeMane.samples[i].rgbaSha256).map(s => s.index),
    facePixelsPreserved: [], scope: 'Foreground mane with face occlusion; legacy body art unchanged.' }
  assert.deepEqual(report.maneFix.changedSamples, [6, 16])
  // Eyes, nose, mouth and central cheeks must remain the original body pixels.
  const face = async file => sharp(path.join(folder, file)).extract({ left: 275, top: 290, width: 530, height: 280 }).raw().toBuffer()
  for (const n of ['06', '16']) {
    // The stacked sample has fin ears; compare each sample to its own prior
    // render so the assertion isolates this mane fix rather than other traits.
    assert.equal(hash(await face(`samples/${n}.png`)), hash(await face(`mane-fix/before-${n}.png`)), `Face changed in sample ${n}`)
    report.maneFix.facePixelsPreserved.push(Number(n))
  }
  const approvalFile = 'docs/releases/v0.10.0/body-batch1/approval.json'
  let approval
  try { approval = await read(approvalFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const approved = approval?.status === 'approved'
    && approval.profileSha256 === report.profileSha256
    && Object.entries(report.sourceHashes).every(([file, digest]) => approval.sourceHashes?.[file] === digest)
    && approval.samples?.length === results.samples.length
    && results.samples.every(sample => approval.samples.some(saved => saved.index === sample.index
      && saved.rgbaSha256 === sample.rgbaSha256 && JSON.stringify(saved.spec) === JSON.stringify(sample.spec)))
    && approval.resources?.length === resourceChecks.length
    && resourceChecks.every(resource => approval.resources.some(saved => saved.id === resource.id && saved.sha256 === resource.sha256))
  if (approved) { report.status = 'approved'; report.approvalRecord = approvalFile }
  const reviewLabel = approved ? '本批 16 个组合已通过用户美术验收（含小狮鬃修正）。' : '基础体型已确认，组合美术待验收。'
  await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await fs.writeFile(path.join(folder, 'profile-snapshot.json'), JSON.stringify(profile, null, 2) + '\n')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>短腿圆身 · 第一批 16 样本</title><style>
  :root{--card:256px;--bg:#eee9df}*{box-sizing:border-box}body{margin:0;background:#f5f3ee;color:#2d342f;font:15px system-ui}header{padding:24px 32px;background:white;border-bottom:1px solid #ddd}h1{font-size:26px;margin:0 0 8px}p{margin:8px 0;line-height:1.6}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:15px}button,a{font:inherit;cursor:pointer}button{padding:7px 13px;border:1px solid #bbb;border-radius:6px;background:white}a{color:#236052}main{display:grid;grid-template-columns:repeat(4,var(--card));gap:16px;padding:24px;justify-content:center}article{background:white;border:1px solid #dedbd2;border-radius:10px;overflow:hidden}article img{display:block;width:100%;aspect-ratio:1;background:var(--bg);cursor:zoom-in}article b{display:block;font-size:14px;padding:10px 8px}.dark{--bg:#1c232b}.small{--card:128px}dialog{padding:12px;border:0;border-radius:10px;max-width:98vw;background:var(--bg)}dialog img{display:block;width:min(88vw,1000px)}dialog button{margin-bottom:8px}@media(max-width:1120px){main{grid-template-columns:repeat(auto-fit,var(--card))}}
  </style><header><h1>短腿圆身 · 第一批</h1><p>固定橘白毛色与两颗小牙：1 个主体、11 个单异变、4 个叠加组合。基础体型已确认，组合美术待验收。</p><p>16 / 16 序列化回放一致 · 18 / 18 旧样本像素一致 · 点击图片查看原图。</p><div class="controls"><button id="theme">深／浅背景</button><button id="size">128／256 像素</button><a href="report.json">验证记录</a><a href="../../art/body-batch1/shortleg-round-orange-white-small-fangs-v1.png">批准的造型参考</a><a href="${prefix}packages/asset-catalog/assets/v0.10.0/orange-white-small-fangs.png">旧体型参考</a></div></header><main>${cases.map(([name], i) => `<article><img src="samples/${String(i + 1).padStart(2, '0')}.png" alt="${name}"><b>${String(i + 1).padStart(2, '0')} · ${name}</b></article>`).join('')}</main><dialog><button id="close">关闭</button><img alt="组合原图"></dialog><script>document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');document.querySelector('#size').onclick=()=>document.body.classList.toggle('small');const d=document.querySelector('dialog');document.querySelector('#close').onclick=()=>d.close();document.querySelectorAll('article img').forEach(img=>img.onclick=()=>{d.querySelector('img').src=img.src;d.showModal()});</script></html>`
  await fs.writeFile(path.join(folder, 'index.html'), html)
  const galleryFile = path.join(folder, 'index.html')
  await fs.writeFile(galleryFile, html.replace('基础体型已确认，组合美术待验收。', reviewLabel)
    .replace('<a href="report.json">', '<a href="mane-fix/index.html">小狮鬃修正前后</a><a href="report.json">')
    .replace(/src="samples\/(\d+)\.png"/g, (_, n) => `src="samples/${n}.png?v=${results.samples[Number(n) - 1].rgbaSha256.slice(0, 12)}"`))
  const comparison = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小狮鬃 · 修正前后</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#27352e;font:16px system-ui}header{padding:20px 30px;background:#fff}h1{margin:0 0 8px;font-size:26px}p{margin:8px 0;line-height:1.6}button,a{font:inherit;margin-right:16px}main{max-width:940px;margin:auto;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:16px}article{background:white;border-radius:10px;overflow:hidden}img{display:block;width:100%;background:#eee9df}body.dark img{background:#1c232b}b{display:block;padding:10px}</style><header><h1>小狮鬃 · 修正前后</h1><p>鬃毛覆盖肩胸，脸颊和下巴位于前方，翅膀位于后方；同步恢复鬃毛的纵向比例。</p><button onclick="document.body.classList.toggle('dark')">深／浅背景</button><a href="../index.html">返回 16 个样本</a></header><main>${['06', '16'].map(n => `<article><img src="before-${n}.png" alt="${n} 修正前"><b>${n} · 修正前</b></article><article><img src="../samples/${n}.png?v=${results.samples[Number(n) - 1].rgbaSha256.slice(0, 12)}" alt="${n} 修正后"><b>${n} · 修正后</b></article>`).join('')}</main></html>`
  await fs.writeFile(path.join(folder, 'mane-fix/index.html'), comparison)
  await page.goto(origin + prefix + 'docs/qa/body-batch1/index.html')
  await page.waitForFunction(() => [...document.querySelectorAll('article img')].every(img => img.complete && img.naturalWidth > 0))
  await page.screenshot({ path: path.join(folder, 'light-256.png'), fullPage: true })
  await page.locator('#theme').click()
  await page.screenshot({ path: path.join(folder, 'dark-256.png'), fullPage: true })
  await page.locator('#size').click()
  await page.screenshot({ path: path.join(folder, 'dark-128.png'), fullPage: true })
  await page.setViewportSize({ width: 980, height: 1000 })
  await page.goto(origin + prefix + 'docs/qa/body-batch1/mane-fix/index.html')
  await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0))
  await page.screenshot({ path: path.join(folder, 'mane-fix/comparison.png'), fullPage: true })
  console.log(JSON.stringify({ samples: results.samples.length, replayPassed: results.samples.filter(x => x.replayEqual).length,
    legacyUnchanged: results.legacy.length, edges: results.samples.filter(x => x.canvasEdgePixels).map(x => [x.index, x.canvasEdgePixels]),
    gallery: origin + prefix + 'docs/qa/body-batch1/index.html' }, null, 2))
} finally { await browser.close() }
