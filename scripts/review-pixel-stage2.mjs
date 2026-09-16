// Experimental per-body art profiles on top of the unmodified Nutri pixel pipeline.
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
const art = path.join(root, 'docs/art/flat-source-trial'), qa = path.join(root, 'docs/qa/flat-source-trial/stage2')
const scratch = path.join(nutri, '.codex-pixel-probe/stage2')
await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(path.join(qa, 'samples'), { recursive: true })
const sha = b => createHash('sha256').update(b).digest('hex')
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'))
const config = await read(path.join(art, 'stage2/profiles.json'))
const shortProfile = await read(path.join(root, 'docs/art/body-batch1/profile.json'))
const approval = await read(path.join(root, 'docs/qa/flat-source-trial/consumer/approval.json'))
for (const [id, hash] of Object.entries(approval.sourceAssets)) assert.equal(sha(await fs.readFile(path.join(art, 'solid', id + '.png'))), hash, 'Approved stage1 source changed')
const moduleFile = path.join(scratch, 'runtime.mjs')
await build({ absWorkingDir: nutri, stdin: { contents: "export {composeSprite,clearPolygon,keyBackgroundRgba} from './src/core/pixelize.ts'; export {renderOps} from './src/core/pixelcat.ts'", resolveDir: nutri, sourcefile: 'stage2.ts' }, outfile: moduleFile, bundle: true, platform: 'node', format: 'esm' })
const { composeSprite, clearPolygon, keyBackgroundRgba, renderOps } = await import(pathToFileURL(moduleFile).href)
const executable = path.join(nutri, 'scripts/.codex-pixelCat.mjs')
await build({ absWorkingDir: root, entryPoints: [path.join(nutri, 'scripts/pixelCat.ts')], outfile: executable, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
async function place(id, transform, out) {
  const file = path.join(art, 'stage2/solid', id + '.png')
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 1254); assert.equal(info.height, 1254)
  const keyed = keyBackgroundRgba(new Uint8ClampedArray(data), 1254, 1254, { threshold: 90, erode: 3 })
  const w = Math.round(1254 * transform.scaleX), h = Math.round(1254 * transform.scaleY)
  const tx = Math.round(transform.translateX), ty = Math.round(transform.translateY)
  const left = Math.max(0, tx), top = Math.max(0, ty), right = Math.min(1254, tx + w), bottom = Math.min(1254, ty + h)
  const part = await sharp(Buffer.from(keyed), { raw: { width: 1254, height: 1254, channels: 4 } }).resize(w, h, { fit: 'fill' }).extract({ left: left - tx, top: top - ty, width: right - left, height: bottom - top }).png().toBuffer()
  await sharp({ create: { width: 1254, height: 1254, channels: 4, background: '#00000000' } }).composite([{ input: part, left, top }]).png().toFile(path.join(out, id + '.png'))
}
const cases = [
  ['base', '基础／小尖牙', []], ['ears', '鳍耳替换', ['fin-ears']], ['mane', '前胸小狮鬃', ['small-lion-mane']],
  ['ears-mane', '鳍耳＋鬃毛', ['fin-ears', 'small-lion-mane']],
  ['stack', '龙角＋鳍耳＋鬃毛＋焰尾', ['dragon-horns', 'fin-ears', 'small-lion-mane', 'flame-tail']],
]
const samples = [], layerChecks = [], profileData = {}, sheet = []
const label = (text, width) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="40"><text x="10" y="28" fill="#302920" font-family="Microsoft YaHei,sans-serif" font-size="17">${text}</text></svg>`)
for (const [column, profile] of config.profiles.entries()) {
  const source = path.join(scratch, profile.id), out = path.resolve(qa, 'layers', profile.id)
  assert.ok(out.startsWith(qa + path.sep))
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(out, { recursive: true })
  for (const id of Object.keys(approval.sourceAssets)) await fs.copyFile(path.join(art, 'solid', id + '.png'), path.join(source, id + '.png'))
  await fs.copyFile(path.join(root, profile.body), path.join(source, 'orange-white-small-fangs.png'))
  await place('orange-white-fin-ears', profile.earTransform, source)
  await place('orange-white-small-lion-mane', profile.maneTransform, source)
  const run = spawnSync(process.execPath, [executable, '--source', source, '--out', out, '--size', '64'], { cwd: nutri, env: { ...process.env, RANDOMPET_DIR: root }, encoding: 'utf8' })
  process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || ''); assert.equal(run.status, 0)
  const manifest = await read(path.join(out, 'manifest.json')), layers = {}, hashes = {}
  assert.equal(manifest.source.flatLayers.length, 6)
  for (const id of Object.keys(manifest.layers)) {
    const bytes = await fs.readFile(path.join(out, id + '.png'))
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(info.width, 64); assert.equal(info.height, 64)
    for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255)
    layers[id] = new Uint8ClampedArray(data); hashes[id] = sha(bytes)
  }
  const stage1Report = await read(path.join(root, 'docs/qa/flat-source-trial/consumer/report.json'))
  const fallbackIds = Object.keys(manifest.layers).filter(id => !manifest.source.flatLayers.includes(id))
  for (const id of fallbackIds) assert.equal(hashes[id], stage1Report.layerHashes.plush[id], `Unrelated layer changed: ${profile.id}/${id}`)
  layerChecks.push({ body: profile.id, unchangedFallbackLayers: fallbackIds.length })
  const scale = poly => poly.map(([x, y]) => [x * 62 / 1254 + 1, y * 62 / 1254 + 1])
  const clear = structuredClone(manifest.clear)
  if (profile.tailRemoval === 'shortleg-body-study') clear.tailTip = scale(shortProfile.removal.tailTip[0])
  const maneId = 'orange-white-small-lion-mane'
  const maskedMane = clearPolygon(new Uint8ClampedArray(layers[maneId]), 64, scale(profile.faceOcclusion))
  const makeSpec = mutations => ({ coat: 'orange-white', expression: 'small-fangs', crown: mutations.includes('dragon-horns') ? 'dragon-horns' : 'none', ears: mutations.includes('fin-ears') ? 'fin-ears' : 'none', neck: mutations.includes('small-lion-mane') ? 'small-lion-mane' : 'none', back: 'none', tailTip: mutations.includes('flame-tail') ? 'flame-tail' : 'none' })
  const render = (spec, adjusted) => {
    const ops = renderOps(spec).map(op => adjusted && op.kind === 'draw' && op.layer === maneId ? { ...op, target: 'subject' } : op)
    return composeSprite(ops, id => adjusted && id === maneId ? maskedMane : layers[id], 64, adjusted ? clear : manifest.clear)
  }
  const saveSample = async (id, spec, adjusted, title) => {
    const pixels = render(spec, adjusted)
    assert.equal(sha(pixels), sha(render(spec, adjusted)))
    const png = await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()
    const file = `${profile.id}-${id}`
    await fs.writeFile(path.join(qa, 'samples', file + '.png'), png)
    await fs.writeFile(path.join(qa, 'samples', file + '-256.png'), await sharp(png).resize(256, 256, { kernel: 'nearest' }).png().toBuffer())
    samples.push({ body: profile.id, id, title, artProfile: profile.id, spec, experimentalGeometry: adjusted, pngSha256: sha(png), rgbaSha256: sha(pixels), replayEqual: true })
    return { pixels, png }
  }
  sheet.push({ input: label(column === 0 ? '原体型 · 实验美术配置' : '短腿体型 · 实验美术配置', 400), left: column * 400, top: 0 })
  for (const [row, [id, title, mutations]] of cases.entries()) {
    const spec = makeSpec(mutations), sample = await saveSample(id, spec, true, title)
    const big = await sharp(sample.png).resize(256, 256, { kernel: 'nearest' }).png().toBuffer()
    sheet.push({ input: label(title, 400), left: column * 400, top: 42 + row * 355 })
    sheet.push({ input: big, left: column * 400 + 72, top: 82 + row * 355 })
    sheet.push({ input: sample.png, left: column * 400 + 5, top: 170 + row * 355 })
    if (mutations.includes('small-lion-mane')) {
      const noMane = render(makeSpec(mutations.filter(x => x !== 'small-lion-mane')), true)
      // Eyes/nose/mouth and central cheek pixels must survive foreground mane unchanged.
      for (let y = 14; y <= 31; y++) for (let x = 16; x <= 36; x++) {
        const p = (y * 64 + x) * 4
        assert.deepEqual(sample.pixels.slice(p, p + 4), noMane.slice(p, p + 4), `${profile.id}/${id}: face occluded at ${x},${y}`)
      }
    }
  }
  await saveSample('mane-legacy', makeSpec(['small-lion-mane']), false, '同源图／Nutri 现有后层鬃毛')
  await saveSample('stack-legacy', makeSpec(['dragon-horns', 'fin-ears', 'small-lion-mane', 'flame-tail']), false, '同源图／Nutri 现有几何')
  if (profile.id === 'standard') {
    const parted = { ...makeSpec([]), expression: 'parted-mouth' }
    await saveSample('parted-mouth', parted, true, '微张嘴对照')
    const fangs = render(makeSpec([]), true), mouth = render(parted, true)
    let mouthDiff = 0
    for (let y = 25; y <= 30; y++) for (let x = 19; x <= 26; x++) {
      const p = (y * 64 + x) * 4
      if (!Buffer.from(fangs.slice(p, p + 4)).equals(Buffer.from(mouth.slice(p, p + 4)))) mouthDiff++
    }
    assert.ok(mouthDiff > 0, 'Small fangs disappeared completely')
    layerChecks.push({ body: profile.id, mouthRegionChangedPixels: mouthDiff })
  }
  profileData[profile.id] = { body: profile.body, bodySha256: sha(await fs.readFile(path.join(root, profile.body))), clear, layerHashes: hashes }
}
await sharp({ create: { width: 800, height: 1820, channels: 4, background: '#ede6d6' } }).composite(sheet).png().toFile(path.join(qa, 'comparison.png'))
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: nutri, encoding: 'utf8' }).stdout.trim()
const report = { status: 'experimental-combination-review-pending', nutriCommit: commit, profileFile: 'docs/art/flat-source-trial/stage2/profiles.json', profileSha256: sha(await fs.readFile(path.join(art, 'stage2/profiles.json'))),
  scope: '2 bodies, orange-white coat only; 5 adapted combinations per body plus legacy geometry controls and parted-mouth expression control',
  productionCompatibility: 'NOT DROP-IN: profile controls foreground mane target, face occlusion and shortleg tail clear. These are QA adapter overrides; Nutri tracked source is unchanged.',
  faceProtection: 'All six mane-containing adapted samples retain the no-mane eyes/nose/mouth rectangle x16..36,y14..31 byte-for-byte; outside this rectangle visual checks cover cheek/chin boundaries',
  stage1SourcesUnchanged: true, layerChecks, profiles: profileData, samples }
report.sourceAssets = Object.fromEntries(await Promise.all((await fs.readdir(path.join(art, 'stage2/solid'))).filter(file => file.endsWith('.png')).map(async file => [file, sha(await fs.readFile(path.join(art, 'stage2/solid', file)))])))
report.nutriSourceHashes = Object.fromEntries(await Promise.all(['scripts/pixelCat.ts', 'src/core/pixelize.ts', 'src/core/pixelcat.ts'].map(async file => [file, sha(await fs.readFile(path.join(nutri, file)))])))
report.reviewScriptSha256 = sha(await fs.readFile(path.join(root, 'scripts/review-pixel-stage2.mjs')))
await fs.writeFile(path.join(qa, 'report.json'), JSON.stringify(report, null, 2) + '\n')
const card = (body, id, text) => `<article><h3>${text}</h3><div class="bg"><img width="256" src="samples/${body}-${id}.png"></div><p>64px <img width="64" src="samples/${body}-${id}.png"> 128px <img width="128" src="samples/${body}-${id}.png"></p></article>`
const rows = cases.map(([id, title]) => `<h2>${title}</h2><div class="row">${config.profiles.map(p => card(p.id, id, p.id === 'standard' ? '原体型' : '短腿圆体型')).join('')}</div>`).join('')
const controls = config.profiles.map(p => `<h2>${p.id} · 鬃毛层级对照</h2><div class="row">${card(p.id, 'mane-legacy', 'Nutri 现有：鬃毛在身体后面')}${card(p.id, 'mane', '实验配置：鬃毛在前胸，遮罩保护脸')}</div>`).join('')
await fs.writeFile(path.join(qa, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>像素第二阶段 · 组合验证</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 16px;background:#eee9e1;color:#292624}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{padding:16px;background:white;border-radius:14px}h3{font-size:16px}.bg{background:#28303b;text-align:center;border-radius:10px;padding:16px}img{image-rendering:pixelated;vertical-align:middle}.notice{background:#fff1cb;padding:16px;line-height:1.7;border-radius:12px}button{padding:10px;margin:12px 0}</style><h1>第二阶段：器官替换、遮挡、表情与体型</h1><div class="notice">继续使用 Nutri 原始像素化脚本。这里测试独立美术配置：部件坐标校准、前胸鬃毛＋脸部遮罩、短腿专用尾部清除区。它们是实验适配，尚未接入 Nutri 正式运行时。首批已批准的三张源图保持不变。</div><button onclick="document.querySelectorAll('.bg').forEach(e=>e.style.background=e.style.background==='rgb(245, 242, 235)'?'#28303b':'#f5f2eb')">切换深浅底</button><h2>表情对照</h2><div class="row">${card('standard','parted-mouth','微张嘴')}${card('standard','base','小尖牙')}</div>${rows}${controls}<p><a href="comparison.png">组合总览</a> · <a href="report.json">检查报告</a> · <a href="../consumer/index.html">已确认的首批</a></p></html>`)
console.log(JSON.stringify({ status: report.status, samples: samples.length, faceChecks: 6, gallery: path.join(qa, 'index.html') }, null, 2))
