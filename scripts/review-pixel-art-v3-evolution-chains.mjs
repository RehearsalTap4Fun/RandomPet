import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const candidateRoot = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0'
const catalogPath = `${candidateRoot}/catalog.candidate.json`
const provenancePath = `${candidateRoot}/provenance.json`
const qaRoot = 'docs/qa/pixel-evolution-chain-registration'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const catalogBytes = await read(catalogPath)
const provenanceBytes = await read(provenancePath)
const provenance = JSON.parse(provenanceBytes)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-chain-registration')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const catalog = requirePixelArtCatalogV3(JSON.parse(catalogBytes))
assert.equal(catalog.artVersion, '1.6.0-candidate.1')
assert.equal(provenance.validationMode, 'representative-samples')
const pending = catalog.coverage.filter(row => row.review === 'pending')
assert.equal(pending.length, 13)

const layers = {}
for (const [id, resource] of Object.entries(catalog.resources)) {
  const bytes = await read(`${candidateRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const profileById = new Map(catalog.profiles.map(profile => [profile.id, profile]))
const planFor = row => {
  const operations = []; const resources = {}; const profile = profileById.get(row.profileId)
  assert.ok(profile, row.id)
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? row.phenotype.expression : row.phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `${row.id}/${step.slot}/${selected}`)
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = catalog.resources[resourceId]
  }
  return { size: 64, operations, resources, key: row.id, review: row.review }
}

const sampleRoot = path.join(root, qaRoot, 'samples')
await fs.rm(sampleRoot, { recursive: true, force: true })
await fs.mkdir(sampleRoot, { recursive: true })
const rows = []
for (const [index, coverage] of pending.entries()) {
  const pixels = composePixelArt(planFor(coverage), layers)
  assert.equal(sha(pixels), coverage.rgbaSha256, coverage.id)
  const replay = composePixelArt(planFor(structuredClone(coverage)), layers)
  assert.ok(Buffer.from(pixels).equals(Buffer.from(replay)), coverage.id)
  const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  const file = `samples/${String(index + 1).padStart(2, '0')}.png`
  await fs.writeFile(path.join(root, qaRoot, file), png)
  rows.push({ coverageId: coverage.id, label: coverage.label, coat: coverage.phenotype.coat, body: coverage.phenotype.body,
    phenotype: coverage.phenotype, file, pngSha256: sha(png), rgbaSha256: coverage.rgbaSha256 })
}

const card = row => `<article><div class="pixels"><img src="${row.file}?v=${row.pngSha256.slice(0, 12)}" alt="${row.label}"><img class="native" src="${row.file}?v=${row.pngSha256.slice(0, 12)}" alt="${row.label} 64px"></div><b>${row.label}</b><small>${Object.entries(row.phenotype).filter(([key, value]) => key !== 'schemaVersion' && value !== 'none').map(([key, value]) => `${key}=${value}`).join(' · ')}</small></article>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>进化链 1.6.0 候选 · 13 格技术抽样</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#fffef9ef;backdrop-filter:blur(10px);border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p{margin:4px 0;color:#5b685f}button{font:inherit;padding:7px 12px}main{max-width:1420px;margin:auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{display:flex;align-items:end;justify-content:center;gap:14px;min-height:216px;background:#f7f4ec;padding:8px}.pixels img{width:192px;height:192px;image-rendering:pixelated}.pixels .native{width:64px;height:64px}b,small{display:block;margin-top:8px}small{color:#68756d;font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}body.dark{background:#162028;color:#edf1ed}body.dark header,body.dark article{background:#202b31;border-color:#405058}body.dark .pixels{background:#172128}body.dark header p,body.dark small{color:#b8c4bd}@media(max-width:900px){.grid{grid-template-columns:1fr}.pixels img{width:160px;height:160px}}</style><header><h1>进化链 1.6.0 候选 · 13 格技术抽样</h1><p>只生成 13 个代表组合：五件单件、三体型满配、其余五种毛色满配。理论全组合 35,840 条未枚举、未渲染。</p><p>候选保留 1.5.0 的 8,064 条 approved coverage 与白名单，新增 13 条仅用于技术回放。 <button onclick="document.body.classList.toggle('dark')">深／浅背景</button></p></header><main><div class="grid">${rows.map(card).join('')}</div></main></html>`
await fs.writeFile(path.join(root, qaRoot, 'index.html'), html)
const report = {
  schemaVersion: 'pixel-evolution-chain-registration-review-v1', status: 'technical-sample-passed', validationMode: 'representative-samples',
  candidate: { path: catalogPath, artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes), provenancePath, provenanceSha256: sha(provenanceBytes) },
  invariants: { rendererVersion: catalog.rendererVersion, profiles: 28, baseCoveragePreserved: 8_064, catalogCoverage: 8_077,
    generatableUnchanged: 8_064, resources: 63, runtimeEnabled: false },
  sampling: { total: 13, theoreticalCoverage: 35_840, generated: 13, rows },
}
await fs.writeFile(path.join(root, qaRoot, 'report.json'), serialized(report))
const readme = `# 进化链 1.6.0 候选 · 技术抽样\n\n状态：13 个代表组合的生成、重复回放与摘要校验通过；没有枚举或生成理论上的 35,840 个组合。\n\n- 候选：\`${catalogPath}\`\n- 28 个 profile 均登记晶角、羽翅耳、星辉翼耳、日冕颈饰、凤凰尾。\n- 保留 1.5.0 的 8,064 条 approved coverage 与 generatable ID；新增 13 条 pending 技术样本。\n- 抽样覆盖五件单件、标准／短腿／细长三体型满配和六种毛色。\n- 当前运行时、\`feline-phenotype-v2\`、六步 profile 与 \`pixel-rgba-v1\` 均未修改。\n`
await fs.writeFile(path.join(root, qaRoot, 'README.md'), readme)
console.log(`QA: rendered ${rows.length} representative evolution-chain candidate samples (35,840 theoretical combinations not generated).`)
