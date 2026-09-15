import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/qa/mutation-batch1')
const readJson = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
const catalog = await readJson('packages/asset-catalog/catalog/v0.10.0/catalog.json')
const baseline = await readJson('docs/releases/v0.10.0/render-baseline.json')
const additions = ['halo', 'dragon-wings', 'feathered-wings', 'frill-neck', 'flame-tail']
const approval = await readJson('docs/releases/v0.10.0/mutation-batch1/approval.json')
assert.equal(Object.keys(catalog.resources).length, 44)
for (const id of additions) {
  assert.equal(catalog.resources[id].review, 'approved')
  assert.equal(approval.status, 'approved')
  assert.equal(approval.resources.find(resource => resource.id === id)?.sha256, catalog.resources[id].sha256)
  for (const coat of Object.keys(catalog.bodies)) assert.equal(catalog.mutations[coat][id], id)
}
await fs.mkdir(path.join(output, 'representative-renders'), { recursive: true })
const origin = process.env.QMONSTER_VERIFY_URL || 'http://127.0.0.1:4184'
const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
const browser = await chromium.launch({ headless: true })
let report
try {
  const page = await browser.newPage()
  await page.goto(origin)
  await page.addScriptTag({ type: 'module', content: `import * as core from '${prefix}packages/generator-core/src/index.ts'; import * as catalog from '${prefix}packages/asset-catalog/src/index.ts'; import * as renderer from '${prefix}packages/renderer-canvas/src/index.ts'; window.batchApi={core,catalog,renderer};` })
  await page.waitForFunction(() => window.batchApi)
  await page.exposeFunction('saveBatchPreview', async (index, data) => {
    assert.ok(Number.isInteger(index) && index >= 0 && index < 18)
    await fs.writeFile(path.join(output, 'representative-renders', String(index + 1).padStart(4, '0') + '.webp'), Buffer.from(data.split(',')[1], 'base64'))
  })
  report = await page.evaluate(async ({ catalog, baseline, prefix }) => {
    const { core, catalog: assets, renderer } = window.batchApi
    const diagnostics = assets.auditFelineCombinationCatalog(catalog)
    if (diagnostics.length) throw new Error(JSON.stringify(diagnostics))
    const make = size => Object.assign(document.createElement('canvas'), { width: size, height: size })
    const output = make(1254), replay = make(1254), preview = make(200)
    const load = renderer.createFelineCombinationResourceResolver(resource => prefix + resource.path)
    const cache = new Map()
    const resolve = async resource => {
      if (!cache.has(resource.sha256)) {
        const bitmap = await load(resource), copy = make(1254)
        copy.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); cache.set(resource.sha256, copy)
      }
      return cache.get(resource.sha256)
    }
    const digest = async canvas => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d').getImageData(0, 0, 1254, 1254).data)), x => x.toString(16).padStart(2, '0')).join('')
    const key = spec => JSON.stringify(spec.selections)
    const old = new Map(baseline.samples.map(sample => [key(sample.spec), sample.rgbaSha256]))
    // Fixed, bounded coverage requested by the user: 10 single features, 2 stacks, 6 legacy samples.
    const specs = []
    const additions = ['halo', 'dragon-wings', 'feathered-wings', 'frill-neck', 'flame-tail']
    for (const coat of ['orange-white', 'tuxedo']) {
      for (const id of additions) specs.push(core.generateFelineCombination('batch1-single-' + id,
        { coat, expression: 'parted-mouth', ...core.mutationSelectionsFromList([id]) }))
    }
    specs.push(core.generateFelineCombination('batch1-stack-a', { coat: 'colorpoint', expression: 'small-fangs',
      ...core.mutationSelectionsFromList(['halo', 'fin-ears', 'frill-neck', 'dragon-wings', 'flame-tail']) }))
    specs.push(core.generateFelineCombination('batch1-stack-b', { coat: 'rosetted', expression: 'tongue-tip',
      ...core.mutationSelectionsFromList(['antlers', 'small-lion-mane', 'feathered-wings', 'flame-tail']) }))
    for (const [index, coat] of core.COMBINATION_OPTIONS.coat.entries()) {
      const sample = baseline.samples.find(s => s.spec.selections.coat === coat
        && s.spec.selections.expression === core.COMBINATION_OPTIONS.expression[index % 3]
        && s.spec.selections.tailTip === 'forked-tail-tip'
        && s.spec.selections.crown === 'antlers' && s.spec.selections.neck === 'small-lion-mane')
      if (!sample) throw new Error('Missing legacy sample: ' + coat)
      specs.push(sample.spec)
    }
    const samples = []
    let legacyMatched = 0
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index]
      await renderer.renderFelineCombination(output, assets.resolveFelineCombination(spec, catalog), resolve)
      const rgba = await digest(output)
      const parsed = core.parseFelineCombinationSpec(JSON.parse(JSON.stringify(spec)))
      if (!parsed.ok) throw new Error('Roundtrip failed')
      await renderer.renderFelineCombination(replay, assets.resolveFelineCombination(parsed.value, catalog), resolve)
      if (rgba !== await digest(replay)) throw new Error('Replay changed pixels: ' + index)
      if (old.has(key(spec))) {
        if (old.get(key(spec)) !== rgba) throw new Error('Legacy pixels changed: ' + index)
        legacyMatched++
      }
      const ctx = preview.getContext('2d'); ctx.clearRect(0, 0, 200, 200); ctx.drawImage(output, 0, 0, 200, 200)
      await window.saveBatchPreview(index, preview.toDataURL('image/webp', 0.92))
      samples.push({ index: index + 1, selections: spec.selections, rgbaSha256: rgba })
    }
    return { scope: 'representative-only', combinationSpace: 5184, expected: 18, rendered: samples.length, legacyMatched, uniqueRgba: new Set(samples.map(s => s.rgbaSha256)).size, samples }
  }, { catalog, baseline, prefix })
  assert.equal(report.rendered, 18)
  assert.equal(report.legacyMatched, 6)
  assert.equal(report.uniqueRgba, 18)
} finally { await browser.close() }
report.status = 'passed'
report.visualReview = 'approved'
report.approvalRecord = 'docs/releases/v0.10.0/mutation-batch1/approval.json'
report.checkedAt = new Date().toISOString()
report.catalogSha256 = createHash('sha256').update(await fs.readFile(path.join(root, 'packages/asset-catalog/catalog/v0.10.0/catalog.json'))).digest('hex')
await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
const data = JSON.stringify(report.samples.map(s => ({ index: s.index, ...s.selections })))
await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>异变批次 1 · 组合验收</title><style>
body{font:15px system-ui;background:#f4f1e9;color:#29332d;margin:0}header{position:sticky;top:0;background:#fff;padding:20px;z-index:1}h1{margin:0 0 8px;font-size:23px}nav{display:flex;gap:12px;flex-wrap:wrap}button,select{font:inherit;padding:8px}main{display:grid;grid-template-columns:repeat(auto-fill,220px);gap:16px;padding:20px}article{background:white;border-radius:12px;padding:10px}img{display:block;width:200px;height:200px;background:#eee9df}small{display:block;line-height:1.6}body.dark img{background:#202730}dialog{border:0;padding:20px;border-radius:12px;max-width:90vw}dialog img{width:600px;height:600px;max-width:80vw;max-height:80vw}footer{padding:20px}
</style><header><h1>异变批次 1 · 18 个代表样本</h1><p>18 个样本渲染与回放检查 · 其中 6 个旧样本与历史像素一致 · 本批五件新素材已通过人工验收。缩略图为实际 200px。</p><nav><a href="/">返回工作台</a><select id="coat"><option value="">全部花纹</option></select><select id="mutation"><option value="">全部异变</option></select><button id="theme">深浅背景</button><button id="prev">上一页</button><button id="next">下一页</button><span id="count"></span></nav></header><main></main><dialog><button onclick="this.parentElement.close()">关闭</button><img><p></p></dialog><footer>每页 72 张；放大预览基于 200px 图，原生图请在工作台导入同选项后查看。</footer><script>
const data=${data},slots=['crown','ears','neck','back','tailTip'],coat=document.querySelector('#coat'),mutation=document.querySelector('#mutation');let page=0;for(const x of [...new Set(data.map(s=>s.coat))])coat.add(new Option(x,x));for(const x of [...new Set(data.flatMap(s=>slots.map(k=>s[k])))].filter(x=>x!=='none'))mutation.add(new Option(x,x));function render(){const filtered=data.filter(s=>(!coat.value||s.coat===coat.value)&&(!mutation.value||slots.some(k=>s[k]===mutation.value))),pages=Math.ceil(filtered.length/72);page=Math.max(0,Math.min(page,pages-1));document.querySelector('main').innerHTML=filtered.slice(page*72,(page+1)*72).map(s=>'<article><img loading="lazy" src="representative-renders/'+String(s.index).padStart(4,'0')+'.webp"><b>'+s.index+' · '+s.coat+'</b><small>'+s.expression+'</small><small>'+slots.filter(k=>s[k]!=='none').map(k=>s[k]).join(' · ')+'</small></article>').join('');document.querySelector('#count').textContent=(page+1)+' / '+pages+' 页 · '+filtered.length+' 组合';document.querySelectorAll('article').forEach(a=>a.onclick=()=>{const d=document.querySelector('dialog');d.querySelector('img').src=a.querySelector('img').src;d.querySelector('p').textContent=a.innerText;d.showModal()});}coat.onchange=mutation.onchange=()=>{page=0;render()};document.querySelector('#prev').onclick=()=>{page--;render()};document.querySelector('#next').onclick=()=>{page++;render()};document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');render();</script></html>`)
console.log(JSON.stringify({ status: report.status, rendered: report.rendered, legacyMatched: report.legacyMatched, uniqueRgba: report.uniqueRgba }))
