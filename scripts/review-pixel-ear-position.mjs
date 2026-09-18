import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/qa/pixel-evolution-chains/ear-diagnostic')
const inputs = {
  original: path.join(root, 'docs/qa/pixel-parts-batch/layers/orange-white-fin-ears.png'),
  beforeR: path.join(output, 'axis-only-feathered-ears.png'),
  afterR: path.join(root, 'docs/qa/pixel-evolution-chains/layers/feathered-ears.png'),
  beforeL: path.join(output, 'axis-only-celestial-ears.png'),
  afterL: path.join(root, 'docs/qa/pixel-evolution-chains/layers/celestial-ears.png'),
}

async function raw(file) {
  return new Uint8ClampedArray(await sharp(file).ensureAlpha().raw().toBuffer())
}

const original = await raw(inputs.original)
async function overlay(candidatePath, name) {
  const candidate = await raw(candidatePath)
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  for (let index = 0; index < 64 * 64; index++) {
    const offset = index * 4
    const inOriginal = original[offset + 3] > 0
    const inCandidate = candidate[offset + 3] > 0
    if (!inOriginal && !inCandidate) continue
    const color = inOriginal && inCandidate ? [255, 245, 181] : inOriginal ? [61, 178, 196] : [231, 88, 91]
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255
  }
  const guide = (x, y) => {
    const offset = (y * 64 + x) * 4
    pixels[offset] = 126; pixels[offset + 1] = 229; pixels[offset + 2] = 126; pixels[offset + 3] = 255
  }
  const line = (x0, y0, x1, y1) => {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    let error = dx + dy
    while (true) {
      guide(x0, y0)
      if (x0 === x1 && y0 === y1) break
      const twice = 2 * error
      if (twice >= dy) { error += dy; x0 += sx }
      if (twice <= dx) { error += dx; y0 += sy }
    }
  }
  for (let y = 0; y <= 15; y++) guide(25, y)
  for (let x = 0; x <= 25; x++) guide(x, 15)
  for (let y = 0; y <= 21; y++) guide(32, y)
  for (let x = 32; x < 64; x++) guide(x, 21)
  line(12, 15, 24, 10)
  line(34, 11, 46, 21)
  await sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true, colours: 8, dither: 0 }).toFile(path.join(output, name))
}

await overlay(inputs.beforeR, 'overlay-before-r.png')
await overlay(inputs.afterR, 'overlay-after-r.png')
await overlay(inputs.beforeL, 'overlay-before-l.png')
await overlay(inputs.afterL, 'overlay-after-l.png')

const card = (title, image, note) => `<article><div class="pixels"><img src="${image}" alt="${title}"></div><b>${title}</b><small>${note}</small></article>`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>耳部位置单独对照</title><style>*{box-sizing:border-box}body{margin:0;background:#f1ede2;color:#26342d;font:15px/1.5 system-ui}header{padding:18px 28px;background:#fffef9;border-bottom:1px solid #d8d1c2}h1{font-size:24px;margin:0 0 6px}header p{margin:4px 0;color:#5b685f}main{max-width:1180px;margin:auto;padding:24px}h2{margin-top:28px}.grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px}article{background:#fffef9;border:1px solid #d8d1c2;border-radius:10px;padding:12px}.pixels{height:280px;display:grid;place-items:center;background:#26333c}.pixels img{width:256px;height:256px;image-rendering:pixelated}b,small{display:block;margin-top:8px}small{color:#68756d}.legend{display:flex;gap:16px;flex-wrap:wrap}.legend i{display:inline-block;width:12px;height:12px;margin-right:5px}.n{background:#3db2c4}.c{background:#e7585b}.o{background:#fff5b5}.g{background:#7ee57e}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style><header><h1>耳部位置单独对照</h1><p>左右耳独立注册，并沿原耳根多边形的下斜边裁切。绿色直角线表示外接边界，绿色斜线表示实际耳根边界；直角范围内、斜线下方的三角区同样不得占用。</p><p class="legend"><span><i class="n"></i>原鳍耳</span><span><i class="c"></i>新耳件独有区域</span><span><i class="o"></i>重合区域</span><span><i class="g"></i>原耳边界</span></p></header><main><h2>R 阶 · 羽翅耳</h2><div class="grid">${card('仅按直角边界', 'ear-diagnostic/overlay-before-r.png', '红色三角仍会越过原耳根斜边。')}${card('沿斜边裁切后', 'ear-diagnostic/overlay-after-r.png', '左：x=13~24、y=0~12；右：x=35~44、y=4~16。')}${card('修正后组合', 'samples/05.png', '根部收回原耳根多边形内，不再伸入眼部。')}</div><h2>L 阶 · 星辉翼耳</h2><div class="grid">${card('仅按直角边界', 'ear-diagnostic/overlay-before-l.png', '宽翼根部在斜边下方残留更明显。')}${card('沿斜边裁切后', 'ear-diagnostic/overlay-after-l.png', '左：x=8~24、y=0~13；右：x=34~48、y=4~17。')}${card('修正后组合', 'samples/06.png', '保留 L 阶宽外轮廓，同时遵守左右耳根斜边。')}</div><h2>原始位置</h2><div class="grid">${card('原鳍耳组合', 'samples/04.png', '现有 N 阶位置参考。')}${card('原鳍耳独立图层', '../pixel-parts-batch/layers/orange-white-fin-ears.png', '青色区域用于对照现有部件的实际占位。')}${card('三种体型满配', 'samples/15.png', '斜边裁切后的耳部与额顶、颈部、背翼和尾部同时出现。')}</div></main></html>`
await fs.writeFile(path.join(root, 'docs/qa/pixel-evolution-chains/ear-position.html'), html)
console.log('QA: wrote docs/qa/pixel-evolution-chains/ear-position.html')
