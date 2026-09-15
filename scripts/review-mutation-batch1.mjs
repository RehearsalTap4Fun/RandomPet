import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
const root = path.resolve(import.meta.dirname, '..')
const folder = path.join(root, 'docs/qa/mutation-batch1')
await fs.mkdir(path.join(folder, 'samples'), { recursive: true })
const prefix = '/@fs/' + root.replaceAll('\\', '/') + '/'
const catalog = JSON.parse(await fs.readFile(path.join(root, 'packages/asset-catalog/catalog/v0.10.0/catalog.json'), 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 1000 } })
  await page.goto('http://127.0.0.1:4184/')
  await page.addScriptTag({ type: 'module', content: `import * as core from '${prefix}packages/generator-core/src/index.ts'; import * as assets from '${prefix}packages/asset-catalog/src/index.ts'; import * as renderer from '${prefix}packages/renderer-canvas/src/index.ts'; window.reviewApi={core,assets,renderer};` })
  await page.waitForFunction(() => window.reviewApi)
  await page.exposeFunction('saveSpotImage', async (filename, data) => {
    if (!/^[a-z-]+\.png$/.test(filename)) throw new Error('Invalid preview filename')
    await fs.writeFile(path.join(folder, 'samples', filename), Buffer.from(data.split(',')[1], 'base64'))
  })
  const cards = await page.evaluate(async ({ catalog, prefix }) => {
    const { core, assets, renderer } = window.reviewApi
    const mutations = ['halo', 'dragon-wings', 'feathered-wings', 'frill-neck', 'flame-tail']
    const cards = []
    const load = renderer.createFelineCombinationResourceResolver(resource => prefix + resource.path)
    const cache = new Map()
    const resolve = async resource => {
      if (!cache.has(resource.sha256)) { const image = await load(resource), c = document.createElement('canvas'); c.width = c.height = 1254; c.getContext('2d').drawImage(image, 0, 0); image.close(); cache.set(resource.sha256, c) }
      return cache.get(resource.sha256)
    }
    for (const coat of core.COMBINATION_OPTIONS.coat) {
      for (const mutation of [...mutations, 'combined']) {
        const selected = mutation === 'combined' ? ['halo', 'fin-ears', 'frill-neck', 'dragon-wings', 'flame-tail'] : [mutation]
        const spec = core.generateFelineCombination('batch1-visual-review', { coat, expression: 'parted-mouth', ...core.mutationSelectionsFromList(selected) })
        const canvas = document.createElement('canvas')
        await renderer.renderFelineCombination(canvas, assets.resolveFelineCombination(spec, catalog), resolve)
        const filename = coat + '-' + mutation + '.png'
        await window.saveSpotImage(filename, canvas.toDataURL('image/png'))
        cards.push({ coat, mutation, filename })
      }
    }
    return cards
  }, { catalog, prefix })
  const labels = { halo: 'L · 光环', 'dragon-wings': 'L · 龙翼', 'feathered-wings': 'R · 羽翼', 'frill-neck': 'R · 伞蜥颈膜', 'flame-tail': 'R · 焰尾', combined: '多位置组合' }
  const reviewLabel = Object.values(catalog.resources).filter(r => ["halo", "dragon-wings", "feathered-wings", "frill-neck", "flame-tail"].includes(r.id)).every(r => r.review === "approved") ? "本批五件新素材已通过人工验收。" : "新素材均待人工验收。"
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>异变批次 1 · 素材对照</title><style>body{margin:0;font:15px system-ui;color:#29332d;background:#f4f1e9}header{padding:22px;background:white}h1{margin:0 0 8px;font-size:24px}button,a{font:inherit;margin-right:16px}main{display:grid;grid-template-columns:repeat(6,200px);gap:12px;padding:20px;justify-content:center}article{background:#fff;border-radius:10px;overflow:hidden}article img{width:200px;height:200px;display:block;background:#eee9df;cursor:zoom-in}article b,small{display:block;padding:4px 10px}small{color:#677268}body.dark article img,body.dark dialog{background:#1c232b}dialog{border:0;border-radius:12px;background:#eee9df}dialog img{width:min(80vw,950px);display:block}dialog button{padding:8px} @media(max-width:1000px){main{grid-template-columns:repeat(auto-fit,200px)}}</style><header><h1>异变批次 1 · 六花纹对照</h1><p>每张缩略图为 200px；点击看原生 1254px 图。${reviewLabel}</p><button id="theme">切换深浅背景</button><a href="index.html">18 个代表样本回放检查</a><a href="/">工作台</a></header><main>${cards.map(card => `<article><img loading="lazy" src="samples/${card.filename}" alt="${card.coat} ${labels[card.mutation]}"><b>${labels[card.mutation]}</b><small>${card.coat}</small></article>`).join('')}</main><dialog><button onclick="this.parentElement.close()">关闭</button><img></dialog><script>document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');document.querySelectorAll('article img').forEach(img=>img.onclick=()=>{const d=document.querySelector('dialog');d.querySelector('img').src=img.src;d.showModal()});</script></html>`
  await fs.writeFile(path.join(folder, 'spot-check.html'), html)
  await page.goto('http://127.0.0.1:4184' + prefix + 'docs/qa/mutation-batch1/spot-check.html')
  await page.locator('article img').evaluateAll(images => images.forEach(img => img.loading = 'eager'))
  await page.waitForFunction(() => [...document.images].filter(img => img.closest('article')).every(img => img.complete && img.naturalWidth > 0))
  await page.screenshot({ path: path.join(folder, 'light.png'), fullPage: true })
  await page.locator('#theme').click()
  await page.screenshot({ path: path.join(folder, 'dark.png'), fullPage: true })
  console.log('Saved 36 native-resolution composites and light/dark 200px review sheets.')
} finally { await browser.close() }
