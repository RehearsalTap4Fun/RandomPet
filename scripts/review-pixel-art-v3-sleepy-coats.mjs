import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const candidatePath = 'packages/asset-catalog/pixel/v3/sleepy-coats-1.5.0/catalog.candidate.json'
const packageRoot = path.dirname(candidatePath)
const outputRoot = path.join(root, 'docs/qa/pixel-sleepy-coats')
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const coatNames = { 'brown-tabby': '棕色虎斑', tuxedo: '燕尾服', calico: '三花', colorpoint: '重点色', rosetted: '玫瑰斑' }
const seed = 'sleepy-coats-1.5.0-stratified-v1'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const candidateBytes = await read(candidatePath)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-sleepy-coats-review')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalog = requirePixelArtCatalogV3(JSON.parse(candidateBytes))
assert.equal(catalog.coverage.length, 8064)
assert.equal(catalog.generatable.length, 5184)
assert.equal(Object.keys(catalog.resources).length, 58)
const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  const bytes = await read(`${packageRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const profileById = new Map(catalog.profiles.map(profile => [profile.id, profile]))
const planFor = row => {
  const operations = []; const planResources = {}; const profile = profileById.get(row.profileId)
  assert.ok(profile)
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? row.phenotype.expression : row.phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    planResources[resourceId] = catalog.resources[resourceId]
  }
  return { size: 64, operations, resources: planResources, key: row.id, review: row.review }
}
for (const row of catalog.coverage) assert.equal(sha(composePixelArt(planFor(row), layers)), row.rgbaSha256, row.id)

function shuffled(rows, label) {
  const result = [...rows]
  let state = createHash('sha256').update(`${seed}:${label}`).digest().readUInt32LE(0)
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000 }
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

function coversRequired(rows) {
  const expressions = new Set(rows.map(row => row.phenotype.expression))
  return expressions.size === 2 && rows.some(row => row.phenotype.ears === 'fin-ears') &&
    rows.some(row => row.phenotype.neck === 'small-lion-mane') && rows.some(row => row.phenotype.tailTip === 'forked-tail-tip')
}

const samples = []
for (const coat of coats) {
  const rows = shuffled(catalog.coverage.filter(row => row.phenotype.coat === coat && row.phenotype.eyes === 'sleepy-almond'), coat)
  let selected
  const pool = rows.slice(0, 96)
  outer: for (let first = 0; first < pool.length - 2; first++) for (let second = first + 1; second < pool.length - 1; second++) for (let third = second + 1; third < pool.length; third++) {
    const group = [pool[first], pool[second], pool[third]]
    if (coversRequired(group)) { selected = group; break outer }
  }
  assert.ok(selected, `Unable to choose a stratified random sample for ${coat}.`)
  samples.push(...selected.map(row => ({ coat, row })))
}
assert.equal(samples.length, 15)
await fs.rm(path.join(outputRoot, 'samples'), { recursive: true, force: true })
await fs.mkdir(path.join(outputRoot, 'samples'), { recursive: true })
const files = {}
for (const [index, sample] of samples.entries()) {
  const pixels = composePixelArt(planFor(sample.row), layers)
  const replay = composePixelArt(planFor(structuredClone(sample.row)), layers)
  assert.ok(Buffer.from(pixels).equals(Buffer.from(replay)), `Replay mismatch: ${sample.row.id}`)
  const file = `samples/${String(index + 1).padStart(2, '0')}-${sample.coat}.png`
  const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  await fs.writeFile(path.join(outputRoot, file), png)
  files[file] = sha(png)
  sample.file = file
  sample.pngSha256 = files[file]
  sample.rgbaSha256 = sha(pixels)
}
const traits = phenotype => [phenotype.expression, phenotype.crown, phenotype.ears, phenotype.neck, phenotype.back, phenotype.tailTip].join(' / ')
const card = sample => `<article><div class="pixels"><img src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.coat}"><img class="native" src="${sample.file}?v=${sample.pngSha256.slice(0, 12)}" alt="${sample.coat} 64px"></div><b>${traits(sample.row.phenotype)}</b><small>${sample.row.id}<br>${sample.row.profileId}</small></article>`
const sections = coats.map(coat => `<section><h2>${coatNames[coat]} · ${coat}</h2><p>固定种子分层随机抽取 3 个 sleepy-almond 组合；三格合计覆盖两种表情，并抽查鳍耳、小狮鬃和分叉尾。</p><div class="grid">${samples.filter(sample => sample.coat === coat).map(card).join('')}</div></section>`).join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>五种毛色 sleepy-almond · 15 格抽查</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9ef;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p,section p{margin:4px 0;color:#5b685f}button{font:inherit;padding:7px 12px}main{max-width:1280px;margin:auto;padding:24px}section{margin:0 0 30px}.grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;justify-content:center;gap:14px;min-height:216px;background:#f7f4ec;padding:8px}.pixels img{width:192px;height:192px;image-rendering:pixelated}.pixels .native{width:64px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}body.dark header p,body.dark section p,body.dark small{color:#b8c4bd}@media(max-width:800px){.grid{grid-template-columns:1fr}.pixels img{width:160px;height:160px}}</style><header><h1>五种毛色 sleepy-almond · 15 格组合抽查</h1><p>候选包 ${catalog.artVersion} · 新增 5 毛色 × 2 表情 × 288 = 2,880 状态 · 运行时关闭</p><p>只在眼部范围迁移 sleepy-almond 造型；范围外 RGB 不变，alpha 继承已批准 sleepy 模板。左侧 ×3，右侧 64px。 <button onclick="document.body.classList.toggle('dark')">深／浅背景</button></p></header><main>${sections}</main></html>`
await fs.writeFile(path.join(outputRoot, 'index.html'), html)
files['index.html'] = sha(Buffer.from(html))
const report = { schemaVersion: 'pixel-sleepy-coats-review-v1', status: 'engineering-passed-art-review-pending', runtimeEnabled: false,
  candidate: { path: candidatePath, artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(candidateBytes) },
  registration: { profiles: 28, addedProfiles: 10, statesPerAddedProfile: 288, coverage: 8064, approved: 5184, pending: 2880, resources: 58 },
  invariants: { eyePatchOnly: true, alphaMatchesApprovedSleepyTemplates: true, canvas: [64, 64], layerRulesChanged: false },
  sampling: { total: samples.length, seed, method: 'deterministic shuffled sample, stratified across expression and coat-bound parts',
    perCoat: 3, rows: samples.map(sample => ({ coat: sample.coat, coverageId: sample.row.id, profileId: sample.row.profileId,
      phenotype: sample.row.phenotype, file: sample.file, pngSha256: sample.pngSha256, rgbaSha256: sample.rgbaSha256 })) }, files }
await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const readme = `# 五种毛色 sleepy-almond 组合抽查

状态：工程回放通过，等待 15 格美术抽查；运行时保持关闭。

- 5 种毛色 × sleepy-almond × 2 表情 = 10 张新主体
- 新增 2,880 条 pending coverage；既有 5,184 条 approved/generatable 原样保留
- 眼型迁移限制在固定眼部区域，区域外 RGB 不变；alpha 继承已批准 sleepy-almond 模板
- 固定种子分层随机抽查：每种 3 格，共 15 格
`
await fs.writeFile(path.join(outputRoot, 'README.md'), readme)
console.log(`QA: verified ${catalog.coverage.length}/${catalog.coverage.length} registrations and wrote ${samples.length} samples to docs/qa/pixel-sleepy-coats/index.html`)
