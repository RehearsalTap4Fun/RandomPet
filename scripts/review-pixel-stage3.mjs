// Offline candidate production. Nutri stays read-only; no missing-source fallback.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const qa = path.join(root, 'docs/qa/flat-source-trial/stage3')
const profileFile = 'docs/art/flat-source-trial/stage3/profiles.json'
const cache = path.join(root, 'node_modules/.cache/stage3')
const sha = b => createHash('sha256').update(b).digest('hex')
const read = async p => JSON.parse(await fs.readFile(path.resolve(root, p), 'utf8'))
const inputHashes = {}
async function pin(file, expected) {
  const b = await fs.readFile(path.resolve(root, file))
  const hash = sha(b)
  if (expected) assert.equal(hash, expected, `Changed named input: ${file}`)
  inputHashes[file] = hash
  return b
}
const config = await read(profileFile)
assert.deepEqual(config.profiles.map(p => p.id), ['standard', 'shortleg-round', 'slender-tall'])
const polygon = p => Array.isArray(p) && p.length >= 3 && p.every(pt => pt.length === 2 && pt.every(Number.isFinite))
for (const p of config.profiles) {
  assert.equal(p.canvas, 1254); assert.equal(p.pixelSize, 64)
  assert.equal(p.earClear.length, 2); assert.ok(p.earClear.every(polygon))
  assert.ok(polygon(p.tailClear)); assert.ok(polygon(p.faceOcclusion))
  assert.ok(p.bodies['sleepy-almond'], `Missing named body mapping: ${p.id}/sleepy-almond`)
  if (p.id === 'slender-tall') assert.ok(p.bodies.round, 'Missing named body mapping: slender-tall/round')
}
// Fixed authorization boundary: these are the previously recorded native rectangles, inclusive.
const authorizedEyes = {
  standard: [[14,15,23,23],[25,15,38,24]],
  'shortleg-round': [[14,15,23,23],[25,15,38,24]],
  'slender-tall': [[16,14,25,23],[26,14,38,23]],
}
for (const p of config.profiles) assert.deepEqual(p.eyeRectangles, authorizedEyes[p.id], 'Eye authorization boundary changed')
await pin(profileFile)
const generation = await read('docs/art/flat-source-trial/stage3/generation.json')
assert.equal(generation.items.length, 4)
assert.deepEqual(config.profiles.flatMap(p => Object.values(p.bodies)).sort(), generation.items.map(i => i.path).sort())
for (const item of generation.items) {
  const bytes = await pin(item.path, item.sha256), meta = await sharp(bytes).metadata()
  assert.equal(meta.width, 1254); assert.equal(meta.height, 1254)
}
const revisions = await read('docs/art/flat-source-trial/stage3/revisions.json')
assert.equal(revisions.downstreamAlphaAuthorization.authorizedBy, 'user')
await pin('docs/art/flat-source-trial/stage3/generation.json')
await pin('docs/art/flat-source-trial/stage3/revisions.json')
await fs.mkdir(cache, { recursive: true })
await fs.mkdir(path.join(qa, 'samples'), { recursive: true })
await fs.mkdir(path.join(qa, 'calibration'), { recursive: true })

// Extract the exact upstream revision without changing any tracked Nutri file.
const nutri = path.resolve(process.env.NUTRI_DIR || path.join(root, '.worktrees/nutri-pixel-reference'))
function git(args) {
  const r = spawnSync('git', ['-C', nutri, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const nutriCommit = git(['rev-parse', process.env.NUTRI_REF || '385bdfae615547c509da331efeeaacd96f94e463']).trim()
git(['merge-base', '--is-ancestor', '9868de3', nutriCommit])
const nutriBefore = git(['diff', 'HEAD', '--'])
const upstreamFiles = ['scripts/pixelCat.ts','src/core/pixelize.ts','src/core/pixelcat.ts','src/core/rng.ts','src/assets/pixelcat/manifest.json']
const extracted = path.join(cache, 'nutri'), nutriSourceHashes = {}
for (const file of upstreamFiles) {
  const bytes = Buffer.from(git(['show', `${nutriCommit}:${file}`]))
  nutriSourceHashes[file] = sha(bytes)
  await fs.mkdir(path.dirname(path.join(extracted, file)), { recursive: true })
  await fs.writeFile(path.join(extracted, file), bytes)
}
let code = await fs.readFile(path.join(extracted, 'scripts/pixelCat.ts'), 'utf8')
const dispatch = code.lastIndexOf("const pv = argOf('--preview')")
assert.ok(dispatch > 0, 'Unknown upstream CLI dispatch')
// Export original functions; exclude CLI dispatch (which otherwise permits plush fallbacks).
code = code.slice(0, dispatch) + '\nexport {pixelate,loadFlatSource,placeLayer}; export {composePlan,clearPolygon,insidePolygon} from "../src/core/pixelize";'
process.env.RANDOMPET_DIR = root
await build({ stdin: { contents: code, loader: 'ts', resolveDir: path.join(extracted, 'scripts') }, outfile: path.join(cache, 'nutri.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { pixelate, loadFlatSource, placeLayer, composePlan, clearPolygon, insidePolygon } = await import(pathToFileURL(path.join(cache, 'nutri.mjs')).href)
await build({ stdin: { contents: "export {composePixelArt} from './packages/renderer-canvas/src/pixel-art-render.ts'; export {resolvePixelArt} from './packages/asset-catalog/src/pixel-art-catalog.ts'", resolveDir: root }, outfile: path.join(cache, 'renderer.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { composePixelArt, resolvePixelArt } = await import(pathToFileURL(path.join(cache, 'renderer.mjs')).href)
const decode = async b => {
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 64); assert.equal(info.height, 64)
  for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255, 'Non-binary alpha')
  return new Uint8ClampedArray(data)
}
const encode = pixels => sharp(Buffer.from(pixels), { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer()
const inRect = (x,y,r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]
function normalize(sleepy, round, eyes) {
  const after = new Uint8ClampedArray(sleepy), mismatch = []
  for (let i = 0; i < after.length; i += 4) {
    const x = i / 4 % 64, y = Math.floor(i / 256), inside = eyes.some(r => inRect(x,y,r))
    if (!inside) {
      if (sleepy[i+3] !== round[i+3]) mismatch.push([x,y,sleepy[i+3],round[i+3]])
      after[i+3] = round[i+3]
    }
    for (let c = 0; c < 3; c++) assert.equal(after[i+c], sleepy[i+c], 'RGB normalization forbidden')
    assert.equal(after[i+3], inside ? sleepy[i+3] : round[i+3])
  }
  return { after, mismatch }
}
function measure(pixels) {
  let count=0,minX=64,minY=64,maxX=-1,maxY=-1
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(pixels[(y*64+x)*4+3]){
    count++;minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY)
  }
  const rowRuns={}
  for(const y of [10,22,32,40,48,56,60]){
    const runs=[];let start=-1
    for(let x=0;x<=64;x++){
      const opaque=x<64&&pixels[(y*64+x)*4+3]>0
      if(opaque&&start<0)start=x
      if(!opaque&&start>=0){runs.push([start,x-1]);start=-1}
    }
    rowRuns[y]=runs
  }
  return {opaquePixels:count,bounds:[minX,minY,maxX,maxY],rowRuns}
}
const catalogPath = 'packages/asset-catalog/pixel/v1/catalog.approved.json'
const approved = await read(catalogPath)
assert.equal(approved.artVersion, '1.1.0')
await pin(catalogPath)
const approvedLayers = {}
for (const [id,r] of Object.entries(approved.resources)) approvedLayers[id] = await decode(await pin(`packages/asset-catalog/pixel/v1/${r.path}`, r.sha256))
for (const c of approved.coverage) assert.equal(sha(composePixelArt(resolvePixelArt(c.phenotype, approved), approvedLayers)), c.rgbaSha256, `v1 replay drift: ${c.id}`)
const scale = poly => poly.map(([x,y]) => [x * 62 / 1254 + 1, y * 62 / 1254 + 1])
const samples = [], controls = [], normalization = [], profileData = {}, checks = []
const allLayers = {}, baselineLayers = {}
const mutationIds = { crown: 'dragon-horns', ears: 'orange-white-fin-ears', neck: 'orange-white-small-lion-mane', tailTip: 'flame-tail' }
const secondReport = await read('docs/qa/flat-source-trial/stage2/report.json')
const secondProfiles = await read('docs/art/flat-source-trial/stage2/profiles.json')
await pin('docs/qa/flat-source-trial/stage2/report.json')
await pin('docs/art/flat-source-trial/stage2/profiles.json')
for (const p of config.profiles) {
  const out = path.join(qa, 'layers', p.id)
  await fs.mkdir(out, { recursive: true })
  const layers = {}, evidence = {}
  async function saveLayer(id, bytes) {
    const px = await decode(bytes)
    // The layer's reserved transparent border supports the unchanged 1px runtime outline.
    for (let t = 0; t < 64; t++) for (const [x,y] of [[t,0],[t,63],[0,t],[63,t]]) assert.equal(px[(y*64+x)*4+3],0)
    await fs.writeFile(path.join(out, id + '.png'), bytes)
    layers[id] = px
    evidence[id] = { path: `docs/qa/flat-source-trial/stage3/layers/${p.id}/${id}.png`, pngSha256: sha(bytes), rgbaSha256: sha(px) }
    return px
  }
  let round
  if (p.id === 'slender-tall') {
    const bytes = await pixelate(await loadFlatSource(path.join(root,p.bodies.round)),12,true)
    assert.equal(sha(bytes),sha(await pixelate(await loadFlatSource(path.join(root,p.bodies.round)),12,true)))
    round = await saveLayer('orange-white-round-small-fangs-slender-tall',bytes)
  } else {
    const old = approved.profiles.find(q => q.id === `${p.id}-small-fangs`)
    const bodyId = old.steps.find(s => s.slot === 'body').resources['small-fangs']
    round = approvedLayers[bodyId]
  }
  baselineLayers[p.id] = round
  const source = p.bodies['sleepy-almond'], raw = await pixelate(await loadFlatSource(path.join(root,source)),12,true)
  assert.equal(sha(raw),sha(await pixelate(await loadFlatSource(path.join(root,source)),12,true)))
  const before = await decode(raw), { after, mismatch } = normalize(before,round,p.eyeRectangles)
  assert.equal(sha(after),sha(normalize(before,round,p.eyeRectangles).after),'Nondeterministic normalization')
  const bytes = await encode(after)
  assert.deepEqual(await decode(bytes),after,'PNG encoding changed normalized RGB/alpha')
  const bodyId = `orange-white-sleepy-almond-small-fangs-${p.id}`
  await saveLayer(bodyId,bytes)
  await fs.writeFile(path.join(qa,'calibration',`${p.id}-before-alpha.png`),raw)
  const post = normalize(after,round,p.eyeRectangles).mismatch
  assert.equal(post.length,0,'Outside-eye alpha still differs')
  normalization.push({body:p.id,source,eyeRectangles:p.eyeRectangles,baselineRgbaSha256:sha(round),beforePngSha256:sha(raw),beforeRgbaSha256:sha(before),beforeMismatches:mismatch,afterMismatches:post,rgbBytesPreserved:true,insideEyeAlphaPreserved:true,pngSha256:sha(bytes),rgbaSha256:sha(after)})
  // Reuse approved mutation PNGs for established bodies; slender ears/mane derive from the same approved flat-source artwork with independent placement.
  for (const [slot,id] of Object.entries(mutationIds)) {
    const oldBody = p.id === 'shortleg-round' ? p.id : 'standard'
    const file = `docs/qa/flat-source-trial/stage2/layers/${oldBody}/${id}.png`
    let b = await pin(file,secondReport.profiles[oldBody].layerHashes[id])
    if (p.id === 'slender-tall' && ['ears','neck'].includes(slot)) {
      const source = `docs/art/flat-source-trial/stage2/solid/${id}.png`
      await pin(source,secondReport.sourceAssets[id+'.png'])
      const keyed = await loadFlatSource(path.join(root,source))
      const temporary = path.join(cache,id+'.png'); await fs.writeFile(temporary,keyed)
      b = await pixelate(await placeLayer(temporary,slot === 'ears' ? p.earTransform : p.maneTransform),6,true)
    }
    if (p.id === 'slender-tall' && slot === 'tailTip') {
      // Native integer translation retains the approved flame geometry and palette.
      const px = await decode(b), translated = new Uint8ClampedArray(px.length)
      const dx = p.tailTranslation[0], dy = p.tailTranslation[1]
      for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(x+dx>0&&x+dx<63&&y+dy>0&&y+dy<63)translated.set(px.subarray((y*64+x)*4,(y*64+x)*4+4),((y+dy)*64+x+dx)*4)
      b = await encode(translated)
    }
    await saveLayer(id,b)
  }
  allLayers[p.id] = layers
  profileData[p.id] = { bodyId, clear:{ears:p.earClear.map(scale),tailTip:scale(p.tailClear)}, faceOcclusion:scale(p.faceOcclusion), layers:evidence, geometrySource:profileFile, nativeSilhouette:measure(after) }
}
function phenotype(body, eyes='sleepy-almond', mutations=[]) {
  return {schemaVersion:'feline-phenotype-v2',body,coat:'orange-white',eyes,expression:'small-fangs',crown:mutations.includes('dragon-horns')?'dragon-horns':'none',ears:mutations.includes('fin-ears')?'fin-ears':'none',neck:mutations.includes('small-lion-mane')?'small-lion-mane':'none',back:'none',tailTip:mutations.includes('flame-tail')?'flame-tail':'none'}
}
function plan(p, spec, legacy=false) {
  const g=profileData[p.id], draw=(slot,target,occlusion=[])=>({kind:'draw',resource:mutationIds[slot],target,occlusion}), ops=[]
  if(spec.crown!=='none')ops.push(draw('crown','frame'))
  const resource=spec.eyes==='round'?'round-control':g.bodyId
  ops.push({kind:'draw',resource,target:'subject',occlusion:[]})
  const clear=legacy?secondReport.profiles.standard.clear:g.clear
  if(spec.ears!=='none'){ops.push({kind:'clear',polygons:clear.ears});ops.push(draw('ears','subject'))}
  if(spec.tailTip!=='none'){ops.push({kind:'clear',polygons:[clear.tailTip]});ops.push(draw('tailTip','frame'))}
  if(spec.neck!=='none')ops.push(draw('neck','subject',[legacy?secondProfiles.profiles[0].faceOcclusion.map(pt=>pt.map(n=>n*62/1254+1)):g.faceOcclusion]))
  return {size:64,operations:ops}
}
function render(p,spec,legacy=false) {
  const layers={...allLayers[p.id],'round-control':baselineLayers[p.id]}
  if(legacy)for(const id of Object.values(mutationIds))layers[id]=allLayers.standard[id]
  const before=Object.fromEntries(Object.entries(layers).map(([k,v])=>[k,sha(v)])), pl=plan(p,spec,legacy)
  const pixels=composePixelArt(pl,layers)
  const upstream=composePlan(pl.operations.map(o=>o.kind==='draw'?{...o,layer:o.resource}:o),id=>layers[id],64)
  assert.deepEqual(pixels,upstream,'Nutri/SDK renderer mismatch')
  assert.deepEqual(before,Object.fromEntries(Object.entries(layers).map(([k,v])=>[k,sha(v)])),'Renderer mutated input')
  return pixels
}
async function saveSample(id,p,spec,list,legacy=false) {
  const pixels=render(p,spec,legacy);assert.equal(sha(pixels),sha(render(p,spec,legacy)))
  const bytes=await encode(pixels), previews={}
  for(const size of [64,128,256]){
    const b=size===64?bytes:await sharp(bytes).resize(size,size,{kernel:'nearest'}).png().toBuffer()
    const file=`samples/${id}${size===64?'':`-${size}`}.png`;await fs.writeFile(path.join(qa,file),b)
    const raw=await sharp(b).ensureAlpha().raw().toBuffer()
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)assert.deepEqual(raw.subarray((y*size+x)*4,(y*size+x)*4+4),Buffer.from(pixels.subarray((Math.floor(y/(size/64))*64+Math.floor(x/(size/64)))*4,(Math.floor(y/(size/64))*64+Math.floor(x/(size/64)))*4+4)))
    previews[size]={path:file,pngSha256:sha(b)}
  }
  const record={id,profileId:`${p.id}-${spec.eyes}-small-fangs`,profileFamily:p.id,phenotype:spec,review:id.endsWith('round-control')?'approved':'pending',pngSha256:sha(bytes),rgbaSha256:sha(pixels),previews,replayEqual:true}
  list.push(record);return pixels
}
const caseDefs=[['standard-sleepy-base','standard',[]],['shortleg-sleepy-base','shortleg-round',[]],['slender-round-base','slender-tall',[],'round'],['slender-sleepy-base','slender-tall',[]],['standard-sleepy-ears-mane','standard',['fin-ears','small-lion-mane']],['shortleg-sleepy-horns-flame','shortleg-round',['dragon-horns','flame-tail']],['slender-sleepy-stack','slender-tall',['dragon-horns','fin-ears','small-lion-mane','flame-tail']]]
for(const [id,body,mutations,eyes] of caseDefs){
  const p=config.profiles.find(p=>p.id===body),spec=phenotype(body,eyes,mutations),pixels=await saveSample(id,p,spec,samples)
  if(spec.neck!=='none'){
    const noMane=render(p,{...spec,neck:'none'}),r=p.faceRectangle
    for(let y=r[1];y<=r[3];y++)for(let x=r[0];x<=r[2];x++)assert.deepEqual(pixels.subarray((y*64+x)*4,(y*64+x)*4+4),noMane.subarray((y*64+x)*4,(y*64+x)*4+4),`${id}: face hidden ${x},${y}`)
    checks.push({id,faceRectangle:r,faceBytesUnchanged:true})
  }
  for(const [slot,polys] of [['ears',profileData[body].clear.ears],['tailTip',[profileData[body].clear.tailTip]]])if(spec[slot]!=='none'){
    const base=allLayers[body][profileData[body].bodyId],part=allLayers[body][mutationIds[slot]]
    let cleared=new Uint8ClampedArray(base),removed=0,exposed=0,outsideOriginal=0
    for(const poly of polys)cleared=clearPolygon(cleared,64,poly)
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const i=(y*64+x)*4
      if(polys.some(poly=>insidePolygon(x+.5,y+.5,poly))){assert.equal(cleared[i+3],0);if(base[i+3])removed++}
      if(part[i+3]&&!cleared[i+3]&&pixels[i+3])exposed++
      if(part[i+3]&&!base[i+3]&&pixels[i+3])outsideOriginal++
    }
    assert.ok(removed>10,`${id}/${slot}: old part not cleared`);assert.ok(exposed>10,`${id}/${slot}: replacement hidden`)
    assert.ok(outsideOriginal>0,`${id}/${slot}: no pixels beyond original silhouette`)
    checks.push({id,slot,removedOpaquePixels:removed,opaqueOutsideClearedBody:exposed,opaqueOutsideOriginalBody:outsideOriginal})
  }
}
for(const p of config.profiles.slice(0,2))await saveSample(`${p.id}-round-control`,p,phenotype(p.id,'round'),controls)
const calibration=[]
const slender=config.profiles[2],stack=phenotype(slender.id,'sleepy-almond',['dragon-horns','fin-ears','small-lion-mane','flame-tail'])
await saveSample('slender-before-geometry',slender,stack,calibration,true)
await saveSample('slender-after-geometry',slender,stack,calibration)
for(const [file,hash] of Object.entries(inputHashes))assert.equal(sha(await fs.readFile(path.resolve(root,file))),hash,`Input changed during run: ${file}`)
assert.equal(git(['diff','HEAD','--']),nutriBefore,'Nutri tracked files changed')
const report={schemaVersion:'pixel-stage3-qa-v1',status:'candidate-review-pending',rendererVersion:'pixel-rgba-v1',nutriCommit,nutriDirectory:nutri,nutriSourceHashes,nutriTrackedFilesUnchanged:true,profileFile,profileSha256:inputHashes[profileFile],sourceAssets:Object.fromEntries(generation.items.map(i=>[i.path,i.sha256])),inputHashes,normalization,settings:{size:64,threshold:90,erosion:3,flat:true,bodyPalette:12,partPalette:6,dither:0,border:1},profiles:profileData,samples,controls,calibration,checks,legacyReplayCount:approved.coverage.length,inputsUnchanged:true,reviewScriptSha256:sha(await fs.readFile(import.meta.filename))}
await fs.writeFile(path.join(qa,'report.json'),JSON.stringify(report,null,2)+'\n')
const card=s=>`<article><h3>${s.id}</h3><p>${s.review} · ${s.phenotype.body} · ${s.phenotype.eyes}</p><div class="sprite">${[64,128,256].map(n=>`<figure><img src="${s.previews[n].path}" width="${n}" height="${n}" alt="${s.id} ${n}px"><figcaption>${n}px</figcaption></figure>`).join('')}</div></article>`
const silhouettes=`<h2>三档轮廓</h2><div class="row">${[controls[0],controls[1],samples[2]].map(card).join('')}</div>`
const pairs=config.profiles.map(p=>{const r=p.id==='slender-tall'?samples[2]:controls.find(c=>c.profileFamily===p.id);const s=samples.find(s=>s.profileFamily===p.id&&s.id.endsWith('sleepy-base'));return `<h2>${p.id}: round → sleepy</h2><div class="row">${card(r)}${card(s)}</div>`}).join('')
await fs.writeFile(path.join(qa,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>像素体型与眼型 · 7 个候选</title><style>body{font:15px system-ui;background:#f1eee6;color:#282522;margin:24px auto;max-width:1400px;padding:0 20px}h1{font-size:26px}h3{font-size:15px}article{background:#fff;padding:14px;border-radius:12px;min-width:0}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.sprite{background:#263340;display:flex;align-items:end;gap:10px;padding:12px;justify-content:center;color:white}.light .sprite{background:#f9f5ea;color:#282522}figure{margin:0;text-align:center}img{image-rendering:pixelated}button{padding:10px 18px;cursor:pointer}.notice{padding:16px;background:#fff1c8}a{color:#135982}</style><h1>三种体型 × 圆眼／半眯眼</h1><p class="notice">7 个新候选均待验收。64px alpha 仅按用户授权在眼区外对齐同体型圆眼；RGB、眼区 alpha 和全部 1254px 源图保持不变。</p><button id="background" onclick="document.body.classList.toggle('light')">切换深／浅背景</button><p id="load-status">正在检查图片…</p>${silhouettes}${pairs}<h2>异化层级</h2><div class="row">${samples.slice(4).map(card).join('')}</div><h2>修长几何：校准前 → 校准后</h2><div class="row">${calibration.map(card).join('')}</div><p><a href="comparison.png">完整总览</a> · <a href="report.json">摘要和检查证据</a></p><script>Promise.all([...document.images].map(i=>i.decode())).then(()=>document.getElementById('load-status').textContent='图片已加载：'+document.images.length+'/'+document.images.length).catch(()=>document.getElementById('load-status').textContent='图片加载失败')</script></html>`)
const tiles=[],all=[controls[0],samples[0],controls[1],samples[1],samples[2],samples[3],...samples.slice(4)]
for(const [i,s] of all.entries()){
 const x=i%3*450,y=Math.floor(i/3)*350
 tiles.push({input:Buffer.from(`<svg width="450" height="38"><text x="12" y="25" fill="#eee" font-size="15">${s.id}</text></svg>`),left:x,top:y})
 tiles.push({input:await fs.readFile(path.join(qa,s.previews[256].path)),left:x+95,top:y+42})
 tiles.push({input:await fs.readFile(path.join(qa,s.previews[64].path)),left:x+15,top:y+220})
}
await sharp({create:{width:1350,height:1050,channels:4,background:'#263340'}}).composite(tiles).png().toFile(path.join(qa,'comparison.png'))
await fs.writeFile(path.join(qa,'light-review.html'),`<!doctype html><meta charset="utf-8"><title>浅色底 · 七个像素候选</title><style>body{font:15px system-ui;background:#f9f5ea;color:#282522;max-width:1050px;margin:16px auto}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}article{padding:12px;text-align:center;border:1px solid #ccc}h2{font-size:14px}img{image-rendering:pixelated;margin:8px}</style><h1>浅色底 · 七个像素候选（待验收）</h1><p>64px 与 128px 最近邻预览</p><main>${samples.map(s=>`<article><h2>${s.id}</h2><img alt="${s.id} 64px" src="${s.previews[64].path}" width="64"><img alt="${s.id} 128px" src="${s.previews[128].path}" width="128"></article>`).join('')}</main>`)
console.log(JSON.stringify({status:report.status,samples:samples.length,normalization:normalization.map(n=>({body:n.body,changedAlpha:n.beforeMismatches.length})),legacyReplayCount:report.legacyReplayCount,checks:checks.length,gallery:path.join(qa,'index.html')},null,2))
