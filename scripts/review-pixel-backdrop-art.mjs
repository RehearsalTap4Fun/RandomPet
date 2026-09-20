import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { BACKDROP_DEFINITIONS, analyzeBackdrop, validateBackdrop } from './lib/pixel-backdrop-art.mjs'

const root = path.resolve(import.meta.dirname, '..')
const catalogPath = 'packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json'
const catalogRoot = path.dirname(catalogPath)
const qaRoot = path.join(root, 'docs/qa/pixel-backdrop-batch')
const layerRoot = path.join(qaRoot, 'layers')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-backdrop-review')
await fs.mkdir(temp, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' },
  outdir: temp,
  bundle: true,
  format: 'esm',
  platform: 'node',
})
const { requirePixelArtCatalogV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalogBytes = await read(catalogPath)
const catalog = requirePixelArtCatalogV3(JSON.parse(catalogBytes))

const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  const bytes = await read(`${catalogRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}

const candidates = []
for (const definition of BACKDROP_DEFINITIONS) {
  const file = path.join(layerRoot, `${definition.id}.png`)
  const bytes = await fs.readFile(file)
  const pixels = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
  const stats = validateBackdrop(definition, pixels)
  assert.deepEqual(analyzeBackdrop(pixels), {
    bounds: stats.bounds,
    opaquePixels: stats.opaquePixels,
    components: stats.components,
    edgeClear: stats.edgeClear,
    alphaValues: stats.alphaValues,
    palette: stats.palette,
  })
  const resourceId = `candidate-${definition.id}`
  layers[resourceId] = pixels
  candidates.push({
    id: definition.id,
    name: definition.name,
    rarity: definition.rarity,
    file: `layers/${definition.id}.png`,
    resourceId,
    sha256: sha(bytes),
    stats,
  })
}

function planFor(phenotype) {
  const profile = catalog.profiles.find(item =>
    item.body === phenotype.body && item.coat === phenotype.coat &&
    item.eyes === phenotype.eyes && item.expression === phenotype.expression)
  assert.ok(profile, `Missing profile: ${JSON.stringify(phenotype)}`)
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
  return {
    profileId: profile.id,
    plan: { size: 64, key: JSON.stringify(phenotype), operations, resources: {} },
  }
}

function composeWithBackdrop(phenotype, backdropId) {
  const { profileId, plan } = planFor(phenotype)
  const resource = `candidate-${backdropId}`
  plan.operations.unshift({ kind: 'draw', resource, target: 'frame', occlusion: [] })
  assert.equal(plan.operations[0].resource, resource)
  assert.equal(plan.operations[0].target, 'frame')
  return { profileId, plan, pixels: composePixelArt(plan, layers) }
}

const coats = ['orange-white', 'brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const basePhenotype = {
  body: 'standard',
  coat: 'orange-white',
  eyes: 'round',
  expression: 'parted-mouth',
  crown: 'none',
  ears: 'none',
  neck: 'none',
  back: 'none',
  tailTip: 'none',
}
const samples = []
for (const definition of BACKDROP_DEFINITIONS) {
  for (const coat of coats) {
    samples.push({
      section: definition.rarity,
      label: `${definition.rarity} · ${definition.name} · ${coat}`,
      backdropId: definition.id,
      phenotype: { ...basePhenotype, coat },
    })
  }
}
for (const definition of BACKDROP_DEFINITIONS) {
  samples.push({
    section: 'full-stack',
    label: `${definition.rarity} · ${definition.name} · 满配压力测试`,
    backdropId: definition.id,
    phenotype: {
      ...basePhenotype,
      crown: 'halo',
      neck: 'frill-neck',
      back: 'feathered-wings',
      tailTip: 'flame-tail',
    },
  })
}

assert.equal(samples.length, 21)
for (const definition of BACKDROP_DEFINITIONS) {
  const matrixCoats = samples.filter(sample => sample.section === definition.rarity).map(sample => sample.phenotype.coat)
  assert.deepEqual(matrixCoats, coats, `${definition.id}: coat matrix`)
  assert.equal(samples.filter(sample => sample.section === 'full-stack' && sample.backdropId === definition.id).length, 1)
}

await fs.rm(path.join(qaRoot, 'samples'), { recursive: true, force: true })
await fs.mkdir(path.join(qaRoot, 'samples'), { recursive: true })
for (const [index, sample] of samples.entries()) {
  const first = composeWithBackdrop(sample.phenotype, sample.backdropId)
  const replay = composeWithBackdrop(structuredClone(sample.phenotype), sample.backdropId)
  assert.equal(first.profileId, replay.profileId)
  assert.ok(Buffer.from(first.pixels).equals(Buffer.from(replay.pixels)), sample.label)
  assert.equal(first.plan.operations[0].resource, `candidate-${sample.backdropId}`)
  const file = `samples/${String(index + 1).padStart(2, '0')}.png`
  const png = await sharp(Buffer.from(first.pixels), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ palette: true, colours: 256, dither: 0 })
    .toBuffer()
  await fs.writeFile(path.join(qaRoot, file), png)
  sample.profileId = first.profileId
  sample.file = file
  sample.pngSha256 = sha(png)
  sample.rgbaSha256 = sha(first.pixels)
}

const coatLabels = {
  'orange-white': '橘白',
  'brown-tabby': '棕色虎斑',
  tuxedo: '燕尾服',
  calico: '三花',
  colorpoint: '重点色',
  rosetted: '金豹点',
}
const card = sample => `<article><div class="pixels"><img src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label}"><img class="native" src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label} 64px"></div><b>${sample.section === 'full-stack' ? sample.label : coatLabels[sample.phenotype.coat]}</b><small>${sample.backdropId}<br>${sample.profileId}${sample.section === 'full-stack' ? '<br>halo / frill-neck / feathered-wings / flame-tail' : ''}</small></article>`
const section = (id, title, note) => `<section><h2>${title}</h2><p>${note}</p><div class="grid">${samples.filter(sample => sample.section === id).map(card).join('')}</div></section>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>不规则涂鸦背景 · 21 格验收</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9ef;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p,section p{margin:4px 0;color:#5b685f}button{font:inherit;padding:7px 12px}main{max-width:1440px;margin:auto;padding:24px}section{margin:0 0 32px}.grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;justify-content:center;gap:14px;min-height:216px;background:#f7f4ec;padding:8px}.pixels img{width:192px;height:192px;image-rendering:pixelated}.pixels .native{width:64px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}body.dark header p,body.dark section p,body.dark small{color:#b8c4bd}@media(max-width:800px){.grid{grid-template-columns:1fr}.pixels img{width:160px;height:160px}}</style><header><h1>不规则涂鸦背景 · 21 格验收</h1><p>三档背景 × 六种毛色 18 格，加三档满配压力测试 3 格。候选背景尚未新增表现型字段或登记正式像素包。</p><p>背景作为临时第一个 frame 操作，复用正式 1.5.0 与 pixel-rgba-v1。左侧 ×3，右侧 64px。 <button onclick="document.body.classList.toggle('dark')">深／浅页面底色</button></p></header><main>${section('N', 'N · 随手地平线', '参考以太猫的米白横向涂抹块与两笔短弧，检查基础轮廓与六种毛色对比度。')}${section('R', 'R · 叶影涂鸦', '浅绿横向涂抹块和三组叶影，重点检查金豹点花纹。')}${section('L', 'L · 虹弧星轨', '浅紫横向涂抹块、青橙虹弧和米白星轨，重点检查燕尾服与传说档明度。')}${section('full-stack', '满配压力测试', '光环、颈膜、羽翼和焰尾允许自然溢出背景，检查所有部件仍位于背景前方。')}</main></html>`
await fs.writeFile(path.join(qaRoot, 'index.html'), html)

const report = {
  schemaVersion: 'pixel-backdrop-review-v1',
  status: 'art-approved-registration-pending',
  baseCatalog: catalogPath,
  baseCatalogSha256: sha(catalogBytes),
  rendererVersion: catalog.rendererVersion,
  productionSchemaChanged: false,
  candidates: candidates.map(({ resourceId, ...candidate }) => candidate),
  sampling: { total: samples.length, coatMatrix: 18, fullStack: 3, rows: samples },
}
await fs.writeFile(path.join(qaRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log('QA: wrote 21 samples to docs/qa/pixel-backdrop-batch/index.html')
