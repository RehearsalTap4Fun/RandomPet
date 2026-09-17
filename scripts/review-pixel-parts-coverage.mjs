import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const candidatePath = 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0/catalog.candidate.json'
const packageRoot = path.dirname(candidatePath)
const outputRoot = path.join(root, 'docs/qa/pixel-parts-coverage')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const candidateBytes = await read(candidatePath)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-parts-review')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, resolvePixelArtV3, composePixelArt, phenotypeKeyV2 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalog = requirePixelArtCatalogV3(JSON.parse(candidateBytes))
assert.equal(catalog.coverage.length, 2016)
assert.equal(catalog.generatable.length, 20)
const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  const bytes = await read(`${packageRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const coverageByKey = new Map(catalog.coverage.map(row => [phenotypeKeyV2(row.phenotype), row]))
for (const row of catalog.coverage) {
  const pixels = composePixelArt(resolvePixelArtV3(row.phenotype, catalog), layers)
  assert.equal(sha(pixels), row.rgbaSha256, row.id)
}

const samples = []
function add(section, profile, mutations, label) {
  const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
    expression: profile.expression, crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none', ...mutations }
  const row = coverageByKey.get(phenotypeKeyV2(phenotype))
  assert.ok(row, `Missing sample coverage: ${label}`)
  samples.push({ section, label, profileId: profile.id, row })
}
const standard = catalog.profiles.find(profile => profile.id === 'standard-small-fangs-round')
assert.ok(standard)
for (const neck of ['none', 'small-lion-mane', 'frill-neck']) for (const back of ['none', 'small-wings', 'feathered-wings', 'dragon-wings']) {
  add('neck-back', standard, { neck, back }, `颈 ${neck} × 背 ${back}`)
}
for (const crown of ['none', 'dragon-horns', 'antlers', 'halo']) for (const ears of ['none', 'fin-ears']) {
  add('crown-ears', standard, { crown, ears }, `冠饰 ${crown} × 耳型 ${ears}`)
}
for (const profile of catalog.profiles) {
  add('profiles', profile, { crown: 'antlers', ears: 'fin-ears', neck: 'frill-neck', back: 'small-wings' }, `${profile.id} · 鹿角/鳍耳/颈膜/小翅膀`)
  add('profiles', profile, { crown: 'halo', back: 'dragon-wings', tailTip: 'forked-tail-tip' }, `${profile.id} · 光环/龙翼/分叉尾尖`)
}
assert.equal(samples.length, 34)
await fs.rm(outputRoot, { recursive: true, force: true })
await fs.mkdir(path.join(outputRoot, 'samples'), { recursive: true })
const files = {}
for (const [index, sample] of samples.entries()) {
  const pixels = composePixelArt(resolvePixelArtV3(sample.row.phenotype, catalog), layers)
  const replay = composePixelArt(resolvePixelArtV3(structuredClone(sample.row.phenotype), structuredClone(catalog)), layers)
  assert.ok(Buffer.from(pixels).equals(Buffer.from(replay)), `Replay mismatch: ${sample.row.id}`)
  const file = `samples/${String(index + 1).padStart(2, '0')}.png`
  const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true }).toBuffer()
  await fs.writeFile(path.join(outputRoot, file), png)
  files[file] = sha(png)
  sample.file = file
  sample.rgbaSha256 = sha(pixels)
}
const sections = [
  ['neck-back', '颈部 × 背部：12 格逐一检查', '重点确认颈膜与三档翅膀的剪影重叠是否仍可接受。'],
  ['crown-ears', '冠饰 × 耳型：8 格逐一检查', '重点确认鹿角、光环与鳍耳的连接、遮挡和悬浮感。'],
  ['profiles', '7 个 profile：14 格跨体型抽样', '每个 profile 两格，分别检查头颈组合与背翼/尾尖组合的坐标兼容性。'],
]
const cards = sample => `<article><div class="pixels"><img src="${sample.file}?v=${files[sample.file].slice(0, 12)}" alt="${sample.label}"><img class="native" src="${sample.file}?v=${files[sample.file].slice(0, 12)}" alt="${sample.label} 64px"></div><b>${sample.label}</b><small>${sample.row.id}<br>${sample.profileId}</small></article>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>像素部件登记 · 34 格组合验收</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9eF;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p{margin:4px 0}button{font:inherit;padding:7px 12px}main{max-width:1440px;margin:auto;padding:24px}section{margin:0 0 32px}h2{margin:0 0 4px}.note{margin:0 0 14px;color:#5b685f}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;gap:12px;min-height:206px;background:#f7f4ec;padding:8px}.pixels img{width:192px;height:192px;image-rendering:pixelated}.pixels .native{width:64px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}</style><header><h1>像素部件登记 · 34 格组合验收</h1><p>候选包 ${catalog.artVersion} · catalog v3 · 7 profile × 288 = 2,016 状态 · 运行时关闭</p><p>左侧为 ×3 像素预览，右侧为 64px 实际尺寸。<button onclick="document.body.classList.toggle('dark')">深／浅背景</button></p></header><main>${sections.map(([id, title, note]) => `<section><h2>${title}</h2><p class="note">${note}</p><div class="grid">${samples.filter(sample => sample.section === id).map(cards).join('')}</div></section>`).join('')}</main></html>`
await fs.writeFile(path.join(outputRoot, 'index.html'), html)
files['index.html'] = sha(Buffer.from(html))
const readme = [
  '# 像素部件 2,016 状态登记候选',
  '',
  '状态：工程回放通过，等待组合美术验收；运行时保持关闭。',
  '',
  `- 候选包：\`${catalog.artVersion}\``,
  '- 契约：`pixel-art-catalog-v3`',
  '- 登记范围：7 profile × 288 状态 = 2,016 条 coverage',
  `- 已批准且可生成：沿用 1.2.1 的 ${catalog.generatable.length} 条`,
  `- 本批待验收：${catalog.coverage.length - catalog.generatable.length} 条`,
  `- 资源：${Object.keys(catalog.resources).length} 张（旧 15 张 + 已批准新部件 7 张）`,
  '',
  'v3 是加法版本，用于让同一槽位的不同性状选择各自的渲染层级：`small-lion-mane` 继续位于主体前，`frill-neck` 位于主体后。独立尾巴统一以已发布火焰尾的非透明左边界 `x=40` 为注册锚点；分叉尾尖整体左移后与其对齐。v1/v2 的源码、catalog 与 SDK 证据不变。',
  '',
  '打开 `index.html` 查看 34 格抽样：颈×背 12 格、冠饰×耳型 8 格、7 个 profile 跨体型 14 格。每格同时展示 ×3 预览和 64px 实际尺寸。',
  '',
  '生成与复核：',
  '',
  '```powershell',
  'npm run build:pixel-parts',
  'npm run review:pixel-parts',
  '```',
  '',
].join('\n')
await fs.writeFile(path.join(outputRoot, 'README.md'), readme)
files['README.md'] = sha(Buffer.from(readme))
const report = { schemaVersion: 'pixel-parts-coverage-review-v1', status: 'engineering-passed-art-review-pending', runtimeEnabled: false,
  candidate: { path: candidatePath, artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(candidateBytes) },
  registration: { profiles: 7, statesPerProfile: 288, coverage: 2016, approved: catalog.generatable.length, pending: catalog.coverage.length - catalog.generatable.length, resources: Object.keys(catalog.resources).length },
  sampling: { total: samples.length, sections: Object.fromEntries(sections.map(([id]) => [id, samples.filter(sample => sample.section === id).length])),
    rows: samples.map(({ section, label, profileId, row, file, rgbaSha256 }) => ({ section, label, profileId, coverageId: row.id, phenotype: row.phenotype, file, rgbaSha256 })) }, files }
await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`QA: verified 2016/2016 registrations and wrote ${samples.length} samples to docs/qa/pixel-parts-coverage/index.html`)
