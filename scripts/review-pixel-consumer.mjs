// Run the actual Nutri pipeline from a local reference checkout; do not modify its tracked sources.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const nutri = path.resolve(process.env.NUTRI_DIR || path.join(root, '.worktrees/nutri-pixel-reference'))
const qa = path.join(root, 'docs/qa/flat-source-trial/consumer')
const scratch = path.join(nutri, '.codex-pixel-probe')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const ids = ['orange-white-parted-mouth', 'dragon-horns', 'flame-tail']
await fs.mkdir(scratch, { recursive: true })
const entry = path.join(nutri, 'scripts/pixelCat.ts')
// Preserve import.meta.url-relative ROOT by compiling beside the original entry.
const executable = path.join(nutri, 'scripts/.codex-pixelCat.mjs')
await build({ absWorkingDir: root, entryPoints: [entry], outfile: executable, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const control = path.join(scratch, 'plush-final-coordinates')
await fs.mkdir(control, { recursive: true })
for (const id of ids) await fs.copyFile(path.join(root, id === ids[0] ? `packages/asset-catalog/assets/v0.10.0/${id}.png` : `docs/art/flat-source-trial/reference/${id}.png`), path.join(control, id + '.png'))
const modes = [
  { id: 'plush', label: 'A 毛绒源＋毛绒参数', source: null },
  { id: 'control', label: 'B 毛绒源＋平涂参数', source: control },
  { id: 'flat', label: 'C 平涂源＋平涂参数', source: path.join(root, 'docs/art/flat-source-trial/solid') },
]
const manifests = {}
for (const mode of modes) {
  const out = path.resolve(qa, mode.id)
  assert.ok(out.startsWith(qa + path.sep), 'Consumer removes output PNG files: target must remain inside review folder.')
  await fs.mkdir(out, { recursive: true })
  const args = [executable, '--size', '64', '--out', out, ...(mode.source ? ['--source', mode.source] : [])]
  const run = spawnSync(process.execPath, args, { cwd: nutri, env: { ...process.env, RANDOMPET_DIR: root }, encoding: 'utf8' })
  process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || '')
  assert.equal(run.status, 0, `Nutri generation failed: ${mode.id}`)
  manifests[mode.id] = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'))
  assert.equal(Object.keys(manifests[mode.id].layers).length, 44)
  assert.equal(manifests[mode.id].size, 64)
  if (mode.source) assert.deepEqual([...manifests[mode.id].source.flatLayers].sort(), [...ids].sort())
}
const moduleFile = path.join(scratch, 'runtime.mjs')
await build({ absWorkingDir: nutri, stdin: { contents: "export {composeSprite,countOpaqueColors} from './src/core/pixelize.ts'; export {renderOps} from './src/core/pixelcat.ts'", resolveDir: nutri, sourcefile: 'probe.ts' }, outfile: moduleFile, bundle: true, platform: 'node', format: 'esm' })
const { composeSprite, renderOps, countOpaqueColors } = await import(pathToFileURL(moduleFile).href)
const cases = [['base', '基础主体', false, false], ['horns', '龙角', true, false], ['flame', '焰尾', false, true], ['both', '龙角＋焰尾', true, true]]
const samples = [], layerHashes = {}, composites = []
const title = (text, width, height = 38) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="12" y="26" fill="#292624" font-family="Microsoft YaHei, sans-serif" font-size="17">${text}</text></svg>`)
for (const [column, mode] of modes.entries()) {
  const layers = {}, hashes = {}
  for (const id of Object.keys(manifests[mode.id].layers)) {
    const bytes = await fs.readFile(path.join(qa, mode.id, id + '.png'))
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.width, 64); assert.equal(info.height, 64)
    for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255, `Nonbinary alpha: ${mode.id}/${id}`)
    layers[id] = new Uint8ClampedArray(data); hashes[id] = sha(bytes)
  }
  layerHashes[mode.id] = hashes
  composites.push({ input: title(mode.label, 352), left: column * 352, top: 0 })
  for (const [row, [id, label, horns, flame]] of cases.entries()) {
    const spec = { coat: 'orange-white', expression: 'parted-mouth', crown: horns ? 'dragon-horns' : 'none', ears: 'none', neck: 'none', back: 'none', tailTip: flame ? 'flame-tail' : 'none' }
    const render = () => composeSprite(renderOps(spec), id => layers[id], 64, manifests[mode.id].clear)
    const pixels = render(); assert.equal(sha(pixels), sha(render()))
    const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()
    const file = `${mode.id}-${id}`
    await fs.mkdir(path.join(qa, 'samples'), { recursive: true })
    await fs.writeFile(path.join(qa, 'samples', file + '-64.png'), png)
    const large = await sharp(png).resize(256, 256, { kernel: 'nearest' }).png().toBuffer()
    await fs.writeFile(path.join(qa, 'samples', file + '-256.png'), large)
    composites.push({ input: title(label, 352), left: column * 352, top: 42 + row * 370 })
    composites.push({ input: large, left: column * 352 + 48, top: 80 + row * 370 })
    composites.push({ input: png, left: column * 352 + 24, top: 337 + row * 370 })
    samples.push({ mode: mode.id, id, spec, pngSha256: sha(png), rgbaSha256: sha(pixels), replayEqual: true, opaqueColors: countOpaqueColors(pixels) })
  }
}
const unchanged = Object.keys(layerHashes.plush).filter(id => !ids.includes(id))
for (const mode of ['control', 'flat']) for (const id of unchanged) assert.equal(layerHashes.plush[id], layerHashes[mode][id], `Fallback changed: ${mode}/${id}`)
await sharp({ create: { width: 1056, height: 1530, channels: 4, background: '#ede6d6' } }).composite(composites).png().toFile(path.join(qa, 'comparison.png'))
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: nutri, encoding: 'utf8' }); assert.equal(git.status, 0)
const sources = ['scripts/pixelCat.ts', 'src/core/pixelize.ts', 'src/core/pixelcat.ts', 'src/assets/pixelcat/manifest.json']
const report = { status: 'consumer-rendered-art-review-pending', repository: 'git@github.com:RehearsalTap4Fun/Nutri.git', commit: git.stdout.trim(),
  sourceHashes: Object.fromEntries(await Promise.all(sources.map(async file => [file, sha(await fs.readFile(path.join(nutri, file)))]))),
  sourceAssets: Object.fromEntries(await Promise.all(ids.map(async id => [id, sha(await fs.readFile(path.join(root, 'docs/art/flat-source-trial/solid', id + '.png')))]))),
  method: 'Unmodified Nutri TS entry bundled as ESM beside original file; original renderOps + composeSprite used for selected 4 combinations.',
  comparison: 'A vs C: actual end-to-end routes. B vs C: same flat processing settings, different art sources. All use 64px output.',
  limitations: ['Stage 1 only: one body/coat/expression and two mutations', 'Nutri built-in preview sample list does not cover the new orange-white-parted-mouth body; custom cases use its original runtime functions', 'Local provisional gallery is not this consumer result'],
  unchangedFallbackLayers: unchanged.length, layerHashes, samples }
await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const rows = cases.map(([id, label]) => `<section><h2>${label}</h2><div class="row">${modes.map(mode => `<article><h3>${mode.label}</h3><div class="bg"><img width="256" height="256" src="samples/${mode.id}-${id}-64.png"></div><p>64px <img width="64" src="samples/${mode.id}-${id}-64.png">　128px <img width="128" src="samples/${mode.id}-${id}-64.png"></p></article>`).join('')}</div></section>`).join('')
await fs.writeFile(path.join(qa, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Nutri 像素路线 · 首批实测</title><style>body{font:16px system-ui;max-width:1180px;margin:32px auto;padding:0 16px;background:#eee9e1;color:#292624}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}article{background:white;padding:14px;border-radius:14px}h3{font-size:16px}.bg{background:#28303b;text-align:center;padding:12px;border-radius:10px}img{image-rendering:pixelated;vertical-align:middle}.notice{padding:16px;background:#fff1c9;line-height:1.7;border-radius:12px}button{padding:10px;margin-top:12px}a{color:#365d7e}</style><h1>Nutri 实际流水线 · 首批对照</h1><p>主体、龙角、焰尾 / 64px 输出 / 128px 实际展示与 256px 放大</p><div class="notice">使用 Nutri ${report.commit.slice(0, 7)} 的原始像素化脚本与运行时合成函数。A/C 对比实际路线；B/C 使用相同平涂参数，仅更换源图。只新增 3 张源图，其余 41 张旧资源回退结果逐文件一致。当前待美术验收，尚未进入第二阶段。</div><button onclick="document.querySelectorAll('.bg').forEach(e=>e.style.background=e.style.background==='rgb(245, 242, 235)'?'#28303b':'#f5f2eb')">切换深浅背景</button>${rows}<p><a href="comparison.png">下载总览图</a> · <a href="report.json">复现与校验报告</a> · <a href="../index.html">早期临时预检（非消费端）</a></p></html>`)
console.log(JSON.stringify({ status: report.status, nutriCommit: report.commit, samples: samples.length, unchangedFallbackLayers: unchanged.length, gallery: path.join(qa, 'index.html') }, null, 2))
