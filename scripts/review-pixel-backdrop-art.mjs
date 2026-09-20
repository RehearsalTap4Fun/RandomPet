import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import {
  BACKDROP_DEFINITIONS,
  BACKDROP_HEIGHT,
  BACKDROP_WIDTH,
  analyzeBackdrop,
  validateBackdrop,
} from './lib/pixel-backdrop-art.mjs'

const root = path.resolve(import.meta.dirname, '..')
const catalogPath = 'packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json'
const catalogRoot = path.dirname(catalogPath)
const qaRoot = path.join(root, 'docs/qa/pixel-backdrop-batch')
const layerRoot = path.join(qaRoot, 'layers')
const CAT_SIZE = 64
const CAT_OFFSET_X = (BACKDROP_WIDTH - CAT_SIZE) / 2
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
const backdropLayers = {}
for (const definition of BACKDROP_DEFINITIONS) {
  const file = path.join(layerRoot, `${definition.id}.png`)
  const bytes = await fs.readFile(file)
  const pixels = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
  const stats = validateBackdrop(definition, pixels)
  assert.deepEqual(analyzeBackdrop(pixels), {
    width: stats.width,
    height: stats.height,
    bounds: stats.bounds,
    opaquePixels: stats.opaquePixels,
    components: stats.components,
    edgeClear: stats.edgeClear,
    alphaValues: stats.alphaValues,
    palette: stats.palette,
  })
  backdropLayers[definition.id] = pixels
  candidates.push({
    id: definition.id,
    name: definition.name,
    rarity: definition.rarity,
    file: `layers/${definition.id}.png`,
    sha256: sha(bytes),
    stats,
  })
}

function outlineBackdrop(source) {
  const output = new Uint8ClampedArray(source)
  for (let y = 0; y < BACKDROP_HEIGHT; y++) for (let x = 0; x < BACKDROP_WIDTH; x++) {
    const offset = (y * BACKDROP_WIDTH + x) * 4
    if (source[offset + 3]) continue
    let red = 0; let green = 0; let blue = 0; let count = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + dx; const nextY = y + dy
      if (nextX < 0 || nextX >= BACKDROP_WIDTH || nextY < 0 || nextY >= BACKDROP_HEIGHT) continue
      const next = (nextY * BACKDROP_WIDTH + nextX) * 4
      if (!source[next + 3]) continue
      red += source[next]; green += source[next + 1]; blue += source[next + 2]; count++
    }
    if (count) output.set([
      Math.round(red / count * 0.36),
      Math.round(green / count * 0.36),
      Math.round(blue / count * 0.36),
      255,
    ], offset)
  }
  return output
}

function overCat(scene, cat) {
  assert.equal(cat.length, CAT_SIZE * CAT_SIZE * 4)
  for (let y = 0; y < CAT_SIZE; y++) for (let x = 0; x < CAT_SIZE; x++) {
    const source = (y * CAT_SIZE + x) * 4
    if (!cat[source + 3]) continue
    const target = (y * BACKDROP_WIDTH + x + CAT_OFFSET_X) * 4
    scene.set(cat.subarray(source, source + 4), target)
  }
}

function visibleBackdropPixels(backdrop, cat) {
  let visible = 0
  for (let y = 0; y < BACKDROP_HEIGHT; y++) for (let x = 0; x < BACKDROP_WIDTH; x++) {
    if (!backdrop[(y * BACKDROP_WIDTH + x) * 4 + 3]) continue
    const catX = x - CAT_OFFSET_X
    if (catX < 0 || catX >= CAT_SIZE || !cat[(y * CAT_SIZE + catX) * 4 + 3]) visible++
  }
  return visible
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

function composeScene(phenotype, backdropId) {
  const { profileId, plan } = planFor(phenotype)
  const backdrop = backdropLayers[backdropId]
  assert.ok(backdrop, `Missing backdrop: ${backdropId}`)
  const pixels = outlineBackdrop(backdrop)
  const cat = composePixelArt(plan, layers)
  const visible = visibleBackdropPixels(backdrop, cat)
  overCat(pixels, cat)
  return { profileId, plan, pixels, visibleBackdropPixels: visible }
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
  const first = composeScene(sample.phenotype, sample.backdropId)
  const replay = composeScene(structuredClone(sample.phenotype), sample.backdropId)
  assert.equal(first.profileId, replay.profileId)
  assert.ok(Buffer.from(first.pixels).equals(Buffer.from(replay.pixels)), sample.label)
  assert.equal(first.visibleBackdropPixels, replay.visibleBackdropPixels)
  if (sample.section === 'full-stack') assert.ok(first.visibleBackdropPixels >= 700, `${sample.label}: backdrop exposure`)
  const file = `samples/${String(index + 1).padStart(2, '0')}.png`
  const png = await sharp(Buffer.from(first.pixels), { raw: { width: BACKDROP_WIDTH, height: BACKDROP_HEIGHT, channels: 4 } })
    .png({ palette: true, colours: 256, dither: 0 })
    .toBuffer()
  await fs.writeFile(path.join(qaRoot, file), png)
  sample.profileId = first.profileId
  sample.file = file
  sample.pngSha256 = sha(png)
  sample.rgbaSha256 = sha(first.pixels)
  sample.visibleBackdropPixels = first.visibleBackdropPixels
}

const coatLabels = {
  'orange-white': '橘白',
  'brown-tabby': '棕色虎斑',
  tuxedo: '燕尾服',
  calico: '三花',
  colorpoint: '重点色',
  rosetted: '金豹点',
}
const card = sample => `<article><div class="pixels"><img src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label}"><img class="native" src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.label} 96×64"></div><b>${sample.section === 'full-stack' ? sample.label : coatLabels[sample.phenotype.coat]}</b><small>${sample.backdropId}<br>${sample.profileId}${sample.section === 'full-stack' ? '<br>halo / frill-neck / feathered-wings / flame-tail' : ''}</small></article>`
const section = (id, title, note) => `<section><h2>${title}</h2><p>${note}</p><div class="grid">${samples.filter(sample => sample.section === id).map(card).join('')}</div></section>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>独立涂鸦背景 · 21 格验收</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9ef;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p,section p{margin:4px 0;color:#5b685f}button{font:inherit;padding:7px 12px}main{max-width:1680px;margin:auto;padding:24px}section{margin:0 0 32px}.grid{display:grid;grid-template-columns:repeat(3,minmax(340px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;justify-content:center;gap:14px;min-height:216px;background:#f7f4ec;padding:8px}.pixels img{width:288px;height:192px;image-rendering:pixelated}.pixels .native{width:96px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}body.dark header p,body.dark section p,body.dark small{color:#b8c4bd}@media(max-width:1050px){.grid{grid-template-columns:1fr}.pixels img{width:240px;height:160px}}</style><header><h1>独立涂鸦背景 · 21 格验收</h1><p>三档背景 × 六种毛色 18 格，加三档满配压力测试 3 格。候选背景尚未新增表现型字段或登记正式像素包。</p><p>场景为 96×64：独立背景先描边，正式 1.5.0 的 64×64 猫图水平居中叠加，偏移 x=16。左侧 ×3，右侧原生场景。 <button onclick="document.body.classList.toggle('dark')">深／浅页面底色</button></p></header><main>${section('N', 'N · 随手地平线', '米白横向涂抹块与左右成组的波浪涂线，检查基础轮廓与六种毛色对比度。')}${section('R', 'R · 叶影涂鸦', '浅绿横向涂抹块和左右带叶脉枝条，重点检查金豹点花纹。')}${section('L', 'L · 虹弧星轨', '浅紫横向涂抹块、两侧双层青橙虹弧和米白星芒，重点检查燕尾服与传说档明度。')}${section('full-stack', '满配压力测试', '光环、颈膜、羽翼和焰尾保持在原始 64×64 猫图内；独立背景从两侧露出。')}</main></html>`
await fs.writeFile(path.join(qaRoot, 'index.html'), html)

const report = {
  schemaVersion: 'pixel-backdrop-review-v2',
  status: 'art-approved-registration-pending',
  baseCatalog: catalogPath,
  baseCatalogSha256: sha(catalogBytes),
  rendererVersion: catalog.rendererVersion,
  sceneRendererVersion: 'pixel-scene-preview-v1',
  productionSchemaChanged: false,
  scene: {
    mode: 'separate-backdrop-layer',
    width: BACKDROP_WIDTH,
    height: BACKDROP_HEIGHT,
    catWidth: CAT_SIZE,
    catHeight: CAT_SIZE,
    catOffsetX: CAT_OFFSET_X,
    catOffsetY: 0,
  },
  candidates,
  sampling: { total: samples.length, coatMatrix: 18, fullStack: 3, rows: samples },
}
await fs.writeFile(path.join(qaRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log('QA: wrote 21 samples to docs/qa/pixel-backdrop-batch/index.html')
