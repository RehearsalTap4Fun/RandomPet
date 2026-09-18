import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '../../..')
const qa = path.join(root, 'docs/qa/pixel-profile-gap')
const release = path.join(root, 'packages/asset-catalog/pixel/v3/approved-1.3.0')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const newLayerPath = path.join(qa, 'orange-white-standard-sleepy-almond-parted-mouth-64.png')
const newBytes = await fs.readFile(newLayerPath)
const cache = path.join(root, 'node_modules/.cache/pixel-profile-gap/sdk.mjs')

await build({
  absWorkingDir: root,
  entryPoints: ['packages/incubator-adapter/src/pixel-art-sdk-v3.ts'],
  outfile: cache,
  bundle: true,
  platform: 'node',
  format: 'esm',
})
const { requirePixelArtCatalogV3, resolvePixelArtV3, composePixelArt } = await import(pathToFileURL(cache).href)
const approved = JSON.parse(await fs.readFile(path.join(release, 'catalog.approved.json'), 'utf8'))
const source = approved.profiles.find(profile => profile.id === 'standard-sleepy-almond-small-fangs')
if (!source) throw Error('Missing sleepy standard profile')
const profile = structuredClone(source)
profile.id = 'standard-sleepy-almond-parted-mouth'
profile.expression = 'parted-mouth'
profile.steps.find(step => step.slot === 'body').resources['parted-mouth'] = 'layer-profile-gap-body'

const specs = [
  ['base', '无部件', {}],
  ['antlers-fin-ears', '鹿角＋鳍耳', { crown: 'antlers', ears: 'fin-ears' }],
  ['halo-fin-ears', '光环＋鳍耳', { crown: 'halo', ears: 'fin-ears' }],
  ['mane-small-wings-flame', '小狮鬃＋小翅膀＋火焰尾', { neck: 'small-lion-mane', back: 'small-wings', tailTip: 'flame-tail' }],
  ['frill-dragon-wings-forked', '颈膜＋龙翼＋分叉尾', { neck: 'frill-neck', back: 'dragon-wings', tailTip: 'forked-tail-tip' }],
  ['horns-feathered', '龙角＋羽翼', { crown: 'dragon-horns', back: 'feathered-wings' }],
]
const base = {
  schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'sleepy-almond', expression: 'parted-mouth',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
}
const rows = specs.map(([id, label, patch]) => ({
  id: `gap-${id}`, label, phenotype: { ...base, ...patch }, profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64),
}))
const catalog = requirePixelArtCatalogV3({
  ...approved,
  artVersion: '1.3.1-candidate.1',
  revision: '0'.repeat(64),
  resources: { ...approved.resources, 'layer-profile-gap-body': { path: 'assets/layer-profile-gap-body.png', sha256: sha(newBytes), width: 64, height: 64 } },
  profiles: [profile],
  coverage: rows,
  generatable: [],
})
const layers = {}
for (const [id, resource] of Object.entries(approved.resources)) {
  const bytes = await fs.readFile(path.join(release, resource.path))
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
layers['layer-profile-gap-body'] = new Uint8ClampedArray(await sharp(newBytes).ensureAlpha().raw().toBuffer())

await fs.mkdir(path.join(qa, 'samples'), { recursive: true })
const reportRows = []
for (const [index, row] of rows.entries()) {
  const rgba = composePixelArt(resolvePixelArtV3(row.phenotype, catalog), layers)
  const file = `samples/${String(index + 1).padStart(2, '0')}-${specs[index][0]}.png`
  const file256 = `samples/${String(index + 1).padStart(2, '0')}-${specs[index][0]}-256.png`
  const png = await sharp(Buffer.from(rgba), { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()
  await fs.writeFile(path.join(qa, file), png)
  await sharp(png).resize(256, 256, { kernel: 'nearest' }).png().toFile(path.join(qa, file256))
  reportRows.push({ id: row.id, label: row.label, phenotype: row.phenotype, file, file256, rgbaSha256: sha(rgba), pngSha256: sha(png) })
}
await fs.copyFile(path.join(root, 'docs/qa/flat-source-trial/stage2/layers/standard/orange-white-parted-mouth.png'), path.join(qa, 'comparison-round-parted-mouth.png'))
await fs.copyFile(path.join(root, 'docs/qa/flat-source-trial/stage3/layers/standard/orange-white-sleepy-almond-small-fangs-standard.png'), path.join(qa, 'comparison-sleepy-small-fangs.png'))
const report = {
  schemaVersion: 'pixel-profile-gap-review-v1', status: 'engineering-passed-art-review-pending', runtimeEnabled: false,
  nutri: { repository: 'git@github.com:RehearsalTap4Fun/Nutri.git', commit: '8394cc1', command: 'pixelCat.ts --source <one-file alias dir> --out <scratch> --size 64', sourceAlias: 'orange-white-small-fangs', manifest: 'nutri-manifest.json' },
  source: JSON.parse(await fs.readFile(path.join(root, 'docs/art/pixel-profile-gap/generation.json'), 'utf8')),
  layer: { path: 'docs/qa/pixel-profile-gap/orange-white-standard-sleepy-almond-parted-mouth-64.png', sha256: sha(newBytes) },
  samples: reportRows,
}
await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const cards = reportRows.map(row => `<article><h2>${row.label}</h2><div class="pair"><figure class="dark"><img src="${row.file256}"><figcaption>深色底</figcaption></figure><figure class="light"><img src="${row.file256}"><figcaption>浅色底</figcaption></figure></div><code>${row.id}<br>${row.rgbaSha256}</code></article>`).join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>困倦眼＋微张嘴 · 单图补洞验收</title><style>body{font:14px system-ui;margin:24px;background:#e9e4da;color:#24252a}header{max-width:1050px}section.compare{display:flex;gap:20px;align-items:end;background:white;padding:16px;border-radius:12px;margin:18px 0;max-width:820px}figure{margin:0;text-align:center;padding:8px;border-radius:8px}.compare img{width:128px;height:128px;image-rendering:pixelated}.compare figure:nth-child(3){outline:3px solid #26936f}.grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px}.grid article{background:white;padding:12px;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair img{width:100%;image-rendering:pixelated}.dark{background:#28303b;color:white}.light{background:#f5f2eb}h2{font-size:15px}code{font-size:9px;overflow-wrap:anywhere}figcaption{font-size:12px;margin-top:4px}</style><header><h1>standard / sleepy-almond / parted-mouth</h1><p>单图补洞候选 · Nutri 8394cc1 实际像素化 · 运行时关闭</p><p>只替换嘴部：矩形外保持已批准 sleepy 主体逐像素一致。先看三种主体差异，再看 6 个高风险部件叠加。</p></header><section class="compare"><figure><img src="comparison-round-parted-mouth.png"><figcaption>圆眼＋微张嘴</figcaption></figure><figure><img src="comparison-sleepy-small-fangs.png"><figcaption>困倦眼＋小尖牙</figcaption></figure><figure><img src="orange-white-standard-sleepy-almond-parted-mouth-64.png"><figcaption><b>本次：困倦眼＋微张嘴</b></figcaption></figure></section><main class="grid">${cards}</main><p><a href="report.json">机器报告</a></p></html>\n`
await fs.writeFile(path.join(qa, 'index.html'), html)
console.log(JSON.stringify({ status: report.status, layer: report.layer, samples: reportRows.length }, null, 2))
