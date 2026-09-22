import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const sceneRoot = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0'
const sceneCatalogPath = `${sceneRoot}/catalog.candidate.json`
const catRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.1'
const catCatalogPath = `${catRoot}/catalog.approved.json`
const qaRoot = 'docs/qa/pixel-scene-backdrops'
const sampleRoot = `${qaRoot}/samples`
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const read = file => fs.readFile(path.join(root, file))

const matrix = [
  ['doodle-horizon', 'standard', 'orange-white', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-horizon', 'shortleg-round', 'orange-white', 'round', 'small-fangs', 'antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
  ['doodle-horizon', 'standard', 'tuxedo', 'sleepy-almond', 'parted-mouth', 'crystal-horns', 'feathered-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
  ['doodle-leaf-shadow', 'standard', 'brown-tabby', 'sleepy-almond', 'small-fangs', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-leaf-shadow', 'slender-tall', 'orange-white', 'sleepy-almond', 'small-fangs', 'halo', 'celestial-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
  ['doodle-leaf-shadow', 'standard', 'colorpoint', 'round', 'small-fangs', 'dragon-horns', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
  ['doodle-rainbow-trail', 'standard', 'calico', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
  ['doodle-rainbow-trail', 'standard', 'rosetted', 'sleepy-almond', 'small-fangs', 'crystal-horns', 'celestial-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
  ['doodle-rainbow-trail', 'standard', 'orange-white', 'round', 'parted-mouth', 'antlers', 'feathered-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
]

const names = {
  'doodle-horizon': 'N · 随手地平线',
  'doodle-leaf-shadow': 'R · 叶影涂鸦',
  'doodle-rainbow-trail': 'L · 虹弧星轨',
}

async function loadLayers(catalog, base, resourceIds = Object.keys(catalog.resources)) {
  const layers = {}
  await Promise.all(resourceIds.map(async id => {
    const resource = catalog.resources[id]
    assert.ok(resource, `Missing declared resource: ${id}`)
    const bytes = await read(`${base}/${resource.path}`)
    assert.equal(sha(bytes), resource.sha256, `${id}: resource hash`)
    const image = sharp(bytes, { failOn: 'error' })
    const metadata = await image.metadata()
    assert.equal(metadata.width, resource.width, `${id}: width`)
    assert.equal(metadata.height, resource.height, `${id}: height`)
    const pixels = new Uint8ClampedArray(await image.ensureAlpha().raw().toBuffer())
    for (let index = 3; index < pixels.length; index += 4) {
      assert.ok(pixels[index] === 0 || pixels[index] === 255, `${id}: nonbinary alpha`)
    }
    layers[id] = pixels
  }))
  return layers
}

function phenotypeFrom(row) {
  const [backdrop, body, coat, eyes, expression, crown, ears, neck, back, tailTip] = row
  return {
    backdrop,
    phenotype: {
      schemaVersion: 'feline-phenotype-v2', body, coat, eyes, expression, crown, ears, neck, back, tailTip,
    },
  }
}

function planForValidatedCatalog(catalog, phenotype, phenotypeKey) {
  const coverage = catalog.coverage.find(item => phenotypeKey(item.phenotype) === phenotypeKey(phenotype))
  assert.ok(coverage, `Missing approved coverage: ${phenotypeKey(phenotype)}`)
  const profile = catalog.profiles.find(item => item.id === coverage.profileId)
  assert.ok(profile, `Missing profile: ${coverage.profileId}`)
  const operations = []
  const resources = {}
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `${profile.id}/${step.slot}/${selected}`)
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = catalog.resources[resourceId]
  }
  return { coverage, plan: { size: 64, operations, resources, key: coverage.id, review: coverage.review } }
}

function visibleBackdropPixels(backdrop, cat) {
  let visible = 0
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    if (!backdrop[(y * 96 + x) * 4 + 3]) continue
    const catX = x - 16
    if (catX < 0 || catX >= 64 || !cat[(y * 64 + catX) * 4 + 3]) visible++
  }
  return visible
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function page(report) {
  const sections = report.scene.growthOrder.map(backdrop => {
    const cards = report.samples.filter(sample => sample.backdrop === backdrop).map(sample => {
      const p = sample.phenotype
      const traits = `body=${p.body} · coat=${p.coat} · eyes=${p.eyes} · expression=${p.expression} · crown=${p.crown} · ears=${p.ears} · neck=${p.neck} · back=${p.back} · tailTip=${p.tailTip}`
      return `<article class="card"><div class="preview"><img class="large" src="samples/${sample.id}.png" width="288" height="192"><img class="native" src="samples/${sample.id}.png" width="96" height="64"></div><h3>${escapeHtml(sample.id)} · ${escapeHtml(p.body)} · ${escapeHtml(p.coat)}</h3><p>${escapeHtml(traits)}</p><code>${escapeHtml(sample.coverageId)} · visible=${sample.visibleBackdropPixels}</code></article>`
    }).join('')
    return `<section><h2>${escapeHtml(names[backdrop])}</h2><div class="grid">${cards}</div></section>`
  }).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Scene Backdrops · Candidate QA</title>
<style>
:root{color-scheme:light;--page:#f3efe6;--card:#fffaf0;--ink:#231f20;--edge:#c9bea9}body.dark{color-scheme:dark;--page:#17212a;--card:#26333d;--ink:#f5ead8;--edge:#52616b}*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 ui-monospace,Consolas,monospace}main{max-width:1120px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:20px}button{padding:8px 12px;border:1px solid var(--edge);background:var(--card);color:var(--ink);border-radius:8px}section{margin:30px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{border:1px solid var(--edge);border-radius:12px;padding:12px;background:var(--card)}.preview{min-height:218px;display:flex;align-items:flex-end;justify-content:center;gap:14px;padding:10px;background:repeating-conic-gradient(#0001 0 25%,transparent 0 50%) 50%/16px 16px}.preview img{image-rendering:pixelated;object-fit:contain}.native{border:1px solid var(--edge)}h1,h2,h3{margin:.3em 0}p{overflow-wrap:anywhere}code{font-size:11px;overflow-wrap:anywhere}@media(max-width:850px){.grid{grid-template-columns:1fr}}
</style></head><body><main><header><div><h1>96×64 Scene Backdrop Candidate</h1><p>猫保持 64×64，锚点 (16,0)；每档 3 个代表组合。</p></div><button id="theme">切换深浅底</button></header>${sections}</main><script>document.getElementById('theme').onclick=()=>document.body.classList.toggle('dark')</script></body></html>\n`
}

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-scene-review')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { art: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts', scene: 'packages/incubator-adapter/src/pixel-scene-sdk.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const artSdk = await import(pathToFileURL(path.join(temp, 'art.js')).href)
const sceneSdk = await import(pathToFileURL(path.join(temp, 'scene.js')).href)
const sceneCatalogBytes = await read(sceneCatalogPath)
const catCatalogBytes = await read(catCatalogPath)
const sceneCatalog = sceneSdk.requirePixelSceneCatalogV1(JSON.parse(sceneCatalogBytes))
const catCatalog = artSdk.requirePixelArtCatalogV3(JSON.parse(catCatalogBytes))
const prepared = matrix.map(row => {
  const { backdrop, phenotype } = phenotypeFrom(row)
  const { coverage, plan } = planForValidatedCatalog(catCatalog, phenotype, artSdk.phenotypeKeyV2)
  assert.equal(coverage.review, 'approved')
  assert.ok(catCatalog.generatable.includes(coverage.id), `${coverage.id}: not generatable`)
  return { backdrop, phenotype, coverage, plan }
})
const requiredCatResources = [...new Set(prepared.flatMap(item => item.plan.operations.flatMap(operation =>
  operation.kind === 'draw' ? [operation.resource] : [],
)))]
const catLayers = await loadLayers(catCatalog, catRoot, requiredCatResources)
const sceneLayers = await loadLayers(sceneCatalog, sceneRoot)
const subjectMeta = {
  schemaVersion: catCatalog.schemaVersion, rendererVersion: catCatalog.rendererVersion, size: catCatalog.size,
  artVersion: catCatalog.artVersion, revision: catCatalog.revision,
}

await fs.rm(path.join(root, sampleRoot), { recursive: true, force: true })
await fs.mkdir(path.join(root, sampleRoot), { recursive: true })
const samples = []
let firstCat
for (const [index, { backdrop, phenotype, coverage, plan }] of prepared.entries()) {
  const cat = artSdk.composePixelArt(plan, catLayers)
  const scene = sceneSdk.composePixelScene(
    { schemaVersion: 'pixel-scene-state-v1', backdrop }, sceneCatalog, subjectMeta, cat, sceneLayers,
  )
  if (!firstCat) firstCat = cat
  const id = String(index + 1).padStart(2, '0')
  const file = `${sampleRoot}/${id}.png`
  const png = await sharp(Buffer.from(scene), { raw: { width: 96, height: 64, channels: 4 } })
    .png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  await fs.writeFile(path.join(root, file), png)
  const resourceId = sceneCatalog.backdrops[backdrop].resourceId
  samples.push({
    id,
    backdrop,
    phenotype,
    coverageId: coverage.id,
    catRgbaSha256: sha(cat),
    sceneRgbaSha256: sha(scene),
    pngSha256: sha(png),
    file,
    visibleBackdropPixels: visibleBackdropPixels(sceneLayers[resourceId], cat),
  })
}

const none = sceneSdk.composePixelScene(
  { schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, sceneCatalog, subjectMeta, firstCat, sceneLayers,
)
const report = {
  schemaVersion: 'pixel-scene-backdrop-review-v1',
  status: 'candidate-visual-review',
  runtimeEnabled: false,
  scene: {
    path: sceneCatalogPath,
    version: sceneCatalog.sceneVersion,
    revision: sceneCatalog.revision,
    catalogSha256: sha(sceneCatalogBytes),
    rendererVersion: sceneCatalog.rendererVersion,
    canvas: sceneCatalog.canvas,
    subjectAnchor: sceneCatalog.subject.anchor,
    outline: sceneCatalog.outline,
    growthOrder: sceneCatalog.growth.order,
  },
  subject: {
    path: catCatalogPath,
    artVersion: catCatalog.artVersion,
    revision: catCatalog.revision,
    catalogSha256: sha(catCatalogBytes),
    rendererVersion: catCatalog.rendererVersion,
    size: catCatalog.size,
  },
  samples,
  noneCase: {
    sourceSample: '01',
    outputWritten: false,
    width: 96,
    height: 64,
    sceneRgbaSha256: sha(none),
  },
}
await fs.mkdir(path.join(root, qaRoot), { recursive: true })
await fs.writeFile(path.join(root, `${qaRoot}/report.json`), serialized(report))
await fs.writeFile(path.join(root, `${qaRoot}/index.html`), page(report))
console.log(`Built ${samples.length} scene samples for ${sceneCatalog.sceneVersion} / ${sceneCatalog.revision}`)
