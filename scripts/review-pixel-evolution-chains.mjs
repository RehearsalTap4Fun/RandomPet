import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const catalogPath = 'packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json'
const catalogRoot = path.dirname(catalogPath)
const qaRoot = path.join(root, 'docs/qa/pixel-evolution-chains')
const layerRoot = path.join(qaRoot, 'layers')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-review')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalog = requirePixelArtCatalogV3(JSON.parse(await read(catalogPath)))

const candidates = [
  { id: 'crystal-horns', name: '晶角', slot: 'crown', rarity: 'R', file: 'crystal-horns.png', target: 'frame' },
  { id: 'feathered-ears', name: '羽翅耳', slot: 'ears', rarity: 'R', file: 'feathered-ears.png', target: 'subject' },
  { id: 'celestial-ears', name: '星辉翼耳', slot: 'ears', rarity: 'L', file: 'celestial-ears.png', target: 'subject' },
  { id: 'sunburst-ruff', name: '日冕颈饰', slot: 'neck', rarity: 'L', file: 'sunburst-ruff.png', target: 'frame' },
  { id: 'phoenix-tail', name: '凤凰尾', slot: 'tailTip', rarity: 'L', file: 'phoenix-tail.png', target: 'frame' },
]

const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  const bytes = await read(`${catalogRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
for (const candidate of candidates) {
  const bytes = await fs.readFile(path.join(layerRoot, candidate.file))
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 64); assert.equal(metadata.height, 64); assert.equal(metadata.hasAlpha, true)
  const resourceId = `candidate-${candidate.id}`
  candidate.resourceId = resourceId
  candidate.sha256 = sha(bytes)
  layers[resourceId] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}

const profiles = new Map(catalog.profiles.map(profile => [profile.id, structuredClone(profile)]))
for (const profile of profiles.values()) {
  for (const candidate of candidates) {
    const step = profile.steps.find(item => item.slot === candidate.slot)
    step.resources[candidate.id] = candidate.resourceId
    if (candidate.target !== step.target) {
      step.variants ??= {}
      step.variants[candidate.id] = { target: candidate.target, clear: candidate.slot === 'tailTip' || candidate.slot === 'ears' ? step.clear : [], occlusion: [] }
    }
  }
}

const basePhenotype = {
  body: 'standard', coat: 'orange-white', eyes: 'round', expression: 'parted-mouth',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
}
const profileFor = phenotype => {
  const id = `${phenotype.coat === 'orange-white' ? phenotype.body : 'standard'}-${phenotype.expression}-${phenotype.eyes}`
  const direct = profiles.get(id)
  if (direct?.coat === phenotype.coat) return direct
  return [...profiles.values()].find(profile => profile.body === phenotype.body && profile.coat === phenotype.coat && profile.eyes === phenotype.eyes && profile.expression === phenotype.expression)
}
const planFor = phenotype => {
  const profile = profileFor(phenotype)
  assert.ok(profile, `Missing profile for ${JSON.stringify(phenotype)}`)
  const operations = []
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const rendering = step.variants?.[selected] ?? step
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `Missing ${step.slot}/${selected} in ${profile.id}`)
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
  }
  return { size: 64, key: JSON.stringify(phenotype), operations, resources: {} }
}

const samples = [
  ['额顶 N · 龙角', { crown: 'dragon-horns' }],
  ['额顶 R · 晶角', { crown: 'crystal-horns' }],
  ['额顶 L · 光环', { crown: 'halo' }],
  ['耳部 N · 鳍耳', { ears: 'fin-ears' }],
  ['耳部 R · 羽翅耳', { ears: 'feathered-ears' }],
  ['耳部 L · 星辉翼耳', { ears: 'celestial-ears' }],
  ['颈部 N · 小狮鬃', { neck: 'small-lion-mane' }],
  ['颈部 R · 颈膜', { neck: 'frill-neck' }],
  ['颈部 L · 日冕颈饰', { neck: 'sunburst-ruff' }],
  ['尾端 N · 分叉尾', { tailTip: 'forked-tail-tip' }],
  ['尾端 R · 焰尾', { tailTip: 'flame-tail' }],
  ['尾端 L · 凤凰尾', { tailTip: 'phoenix-tail' }],
  ['标准体型 · 新部件满配', { crown: 'crystal-horns', ears: 'celestial-ears', neck: 'sunburst-ruff', back: 'feathered-wings', tailTip: 'phoenix-tail' }],
  ['短腿体型 · 新部件满配', { body: 'shortleg-round', expression: 'small-fangs', crown: 'crystal-horns', ears: 'celestial-ears', neck: 'sunburst-ruff', back: 'feathered-wings', tailTip: 'phoenix-tail' }],
  ['细长体型 · 新部件满配', { body: 'slender-tall', expression: 'small-fangs', crown: 'crystal-horns', ears: 'celestial-ears', neck: 'sunburst-ruff', back: 'feathered-wings', tailTip: 'phoenix-tail' }],
].map(([label, patch]) => ({ label, phenotype: { ...basePhenotype, ...patch } }))

await fs.rm(path.join(qaRoot, 'samples'), { recursive: true, force: true })
await fs.mkdir(path.join(qaRoot, 'samples'), { recursive: true })
for (const [index, sample] of samples.entries()) {
  const pixels = composePixelArt(planFor(sample.phenotype), layers)
  const replay = composePixelArt(planFor(structuredClone(sample.phenotype)), layers)
  assert.ok(Buffer.from(pixels).equals(Buffer.from(replay)), sample.label)
  const file = `samples/${String(index + 1).padStart(2, '0')}.png`
  const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  await fs.writeFile(path.join(qaRoot, file), png)
  sample.file = file
  sample.pngSha256 = sha(png)
  sample.rgbaSha256 = sha(pixels)
}

const card = sample => `<article><div class="pixels"><img src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label}"><img class="native" src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label} 64px"></div><b>${sample.label}</b><small>${Object.entries(sample.phenotype).filter(([, value]) => value !== 'none').map(([key, value]) => `${key}=${value}`).join(' · ')}</small></article>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>五条进化链补阶 · 美术验收</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9ef;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p{margin:4px 0;color:#5b685f}button{font:inherit;padding:7px 12px}main{max-width:1280px;margin:auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;justify-content:center;gap:14px;min-height:216px;background:#f7f4ec;padding:8px}.pixels img{width:192px;height:192px;image-rendering:pixelated}.pixels .native{width:64px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}body.dark header p,body.dark small{color:#b8c4bd}@media(max-width:800px){.grid{grid-template-columns:1fr}.pixels img{width:160px;height:160px}}</style><header><h1>五条进化链补阶 · 15 格验收</h1><p>前 12 格逐链比较 N／R／L；后 3 格检查标准、短腿、细长体型的满配衔接。候选资源尚未登记进正式像素包。</p><p>新增部件全部不绑毛色；凤凰尾左边界固定 x=40。左侧 ×3，右侧 64px。 <button onclick="document.body.classList.toggle('dark')">深／浅背景</button></p></header><main><div class="grid">${samples.map(card).join('')}</div></main></html>`
await fs.writeFile(path.join(qaRoot, 'index.html'), html)
const report = {
  schemaVersion: 'pixel-evolution-chain-review-v1', status: 'art-approved-registration-pending', baseCatalog: catalogPath,
  candidates: candidates.map(({ resourceId, ...candidate }) => candidate), invariants: { canvas: [64, 64], rendererVersion: catalog.rendererVersion, coatBound: false, phoenixTailOpaqueLeft: 40 },
  sampling: { total: samples.length, rows: samples },
}
await fs.writeFile(path.join(qaRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`QA: wrote ${samples.length} samples to docs/qa/pixel-evolution-chains/index.html`)
