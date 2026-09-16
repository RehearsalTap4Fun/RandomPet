// Source QA only. Nutri is read-only; its pinned source is extracted to QMonster scratch.
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import sharp from 'sharp'
const dir = import.meta.dirname, root = path.resolve(dir,'../../../..')
const nutri = path.resolve(process.env.NUTRI_DIR || path.join(root,'.worktrees/nutri-pixel-reference'))
const scratch = path.join(root,'.superpowers/sdd/2026-09-16-pixel-body-eye-batch/source-qa')
const evidence = path.join(dir,'evidence')
const revision = '385bdfa'
const sha = b => createHash('sha256').update(b).digest('hex')
const read = async p => JSON.parse(await fs.readFile(p,'utf8'))
const git = (...args) => { const r=spawnSync('git',['-C',nutri,...args],{encoding:'utf8',maxBuffer:16e6}); assert.equal(r.status,0,r.stderr); return r.stdout }
const trackedBefore = git('diff','HEAD','--')
await fs.mkdir(evidence,{recursive:true})
const modules = ['scripts/pixelCat.ts','src/core/pixelize.ts','src/core/pixelcat.ts','src/core/rng.ts','src/assets/pixelcat/manifest.json']
const moduleHashes = {}
for(const file of modules) { const text=git('show',`${revision}:${file}`), out=path.join(scratch,'nutri',file); await fs.mkdir(path.dirname(out),{recursive:true}); await fs.writeFile(out,text); moduleHashes[file]=sha(text) }
const cli = path.join(scratch,'nutri/scripts/pixelCat.mjs')
await build({entryPoints:[path.join(scratch,'nutri/scripts/pixelCat.ts')],outfile:cli,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
const core = path.join(scratch,'nutri/core.mjs')
await build({entryPoints:[path.join(scratch,'nutri/src/core/pixelize.ts')],outfile:core,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
const {keyBackgroundRgba} = await import(pathToFileURL(core).href)
const generation = await read(path.join(dir,'generation.json'))
const source = async file => {const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1254);assert.equal(info.height,1254);return {data,info,keyed:Buffer.from(keyBackgroundRgba(new Uint8ClampedArray(data),1254,1254,{threshold:90,erode:3}))}}
const maskStats = data => {let count=0,sx=0,sy=0,minX=1254,minY=1254,maxX=-1,maxY=-1;for(let i=0;i<1254*1254;i++) if(data[i*4+3]>=128){const x=i%1254,y=Math.floor(i/1254);count++;sx+=x;sy+=y;minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY)}return {count,centroid:[sx/count,sy/count],bbox:[minX,minY,maxX,maxY]}}
const eyes = {standard:[[270,295,435,435],[510,295,720,435]],'shortleg-round':[[270,295,435,440],[510,295,720,440]],'slender-tall':[[320,280,465,410],[530,280,715,410]]}
const references = {standard:'docs/art/flat-source-trial/stage2/solid/orange-white-small-fangs.png','shortleg-round':'docs/art/flat-source-trial/stage2/solid/shortleg-round-orange-white-small-fangs.png','slender-tall':'docs/art/flat-source-trial/stage3/solid/orange-white-round-small-fangs-slender-tall.png'}
const results=[], comparison=[]
for(const item of generation.items) {
  const file=path.join(root,item.path), b=await fs.readFile(file);assert.equal(sha(b),item.sha256)
  const s=await source(file), corners=[0,1253,1254*1253,1254*1254-1].map(i=>[...s.data.subarray(i*4,i*4+4)])
  corners.forEach(c=>assert.deepEqual(c,[255,0,255,255]))
  const rawBytes=await fs.readFile(path.join(root,item.rawAttempt));assert.equal(sha(rawBytes),item.rawSha256)
  const raw=await sharp(rawBytes).ensureAlpha().raw().toBuffer()
  for(let i=0;i<raw.length;i+=4) {
    const expected=Math.hypot(raw[i]-255,raw[i+1],raw[i+2]-255)<90 ? Buffer.from([255,0,255,255]) : raw.subarray(i,i+4)
    assert.ok(s.data.subarray(i,i+4).equals(expected),'Source correction exceeded background normalization')
  }
  const colors=new Set();let ambiguous=0
  for(let i=0;i<s.data.length;i+=4){assert.equal(s.data[i+3],255);const d=Math.hypot(s.data[i]-255,s.data[i+1],s.data[i+2]-255);if(d>=50&&d<130)ambiguous++;if(s.keyed[i+3])colors.add(((s.keyed[i]>>2)<<12)|((s.keyed[i+1]>>2)<<6)|(s.keyed[i+2]>>2))}
  const row={id:item.id,sha256:sha(b),dimensions:[1254,1254],corners,rawSha256:sha(rawBytes),onlyBackgroundNormalized:true,colors6Bit:colors.size,ambiguousPct:ambiguous/(1254*1254)*100,mask:maskStats(s.keyed)}
  assert.ok(row.ambiguousPct<=1.5);assert.ok(row.colors6Bit<=10000)
  if(item.eyes==='sleepy-almond') {
    const ref=await source(path.join(root,references[item.body]));let inter=0,union=0,sq=0,changed=0,n=0
    for(let i=0;i<1254*1254;i++){const x=i%1254,y=Math.floor(i/1254);if(eyes[item.body].some(([x0,y0,x1,y1])=>x>=x0&&x<=x1&&y>=y0&&y<=y1))continue;const a=s.keyed[i*4+3]>=128,b=ref.keyed[i*4+3]>=128;if(a&&b)inter++;if(a||b)union++;if(a&&b){let different=false;for(let c=0;c<3;c++){const d=s.data[i*4+c]-ref.data[i*4+c];sq+=d*d;if(Math.abs(d)>12)different=true}if(different)changed++;n++}}
    const rs=maskStats(ref.keyed);row.comparison={reference:references[item.body],eyeExclusionRectangles:eyes[item.body],outsideEyeSilhouetteIoU:inter/union,centroidDelta64px:Math.hypot(...row.mask.centroid.map((v,i)=>v-rs.centroid[i]))*62/1254,outsideEyeForegroundRgbRmse:Math.sqrt(sq/n/3),outsideEyeForegroundPixelsChangedOver12:changed,outsideEyeForegroundPixels:n}
    assert.ok(row.comparison.outsideEyeSilhouetteIoU>=.98);assert.ok(row.comparison.centroidDelta64px<=1)
    comparison.push(row.comparison)
  }
  results.push(row)
}
// First prove native v2 identifiers are rejected by the unmodified checker.
const runCheck = async (sourceDir,rp,outputName) => {const r=spawnSync(process.execPath,[cli,'--check',sourceDir],{cwd:root,env:{...process.env,RANDOMPET_DIR:rp},encoding:'utf8'});assert.equal(r.status,0,r.stderr);await fs.writeFile(path.join(evidence,outputName+'.log'),r.stdout+r.stderr);const report=await read(path.join(sourceDir,'../check/check-report.json'));await fs.writeFile(path.join(evidence,outputName+'.json'),JSON.stringify(report,null,2)+'\n');return report}
const nativeDir=path.join(scratch,'native/solid');await fs.mkdir(nativeDir,{recursive:true});for(const item of generation.items)await fs.copyFile(path.join(root,item.path),path.join(nativeDir,item.id+'.png'))
const native=await runCheck(nativeDir,root,'nutri-native-identifiers');assert.ok(native.every(x=>x.issues.includes('文件名不是已知资源 id')))
const aliasReports=[]
for(const body of ['standard','shortleg-round']) {
  const item=generation.items.find(x=>x.body===body), rp=path.join(scratch,'aliases',body), src=path.join(rp,'solid'), catalogDir=path.join(rp,'packages/asset-catalog/catalog/v0.10.0')
  await fs.mkdir(src,{recursive:true});await fs.mkdir(catalogDir,{recursive:true});await fs.mkdir(path.join(rp,'packages/renderer-canvas/src'),{recursive:true})
  const ref=await source(path.join(root,references[body]));await sharp(ref.keyed,{raw:{width:1254,height:1254,channels:4}}).png().toFile(path.join(rp,'reference.png'))
  await fs.copyFile(path.join(root,item.path),path.join(src,'orange-white-small-fangs.png'))
  await fs.writeFile(path.join(catalogDir,'catalog.json'),JSON.stringify({resources:{'orange-white-small-fangs':{id:'orange-white-small-fangs',path:'reference.png'}}}))
  await fs.writeFile(path.join(rp,'packages/renderer-canvas/src/feline-combination-registration.json'),'{}')
  await fs.writeFile(path.join(rp,'package.json'),'{}')
  const check=await runCheck(src,rp,'nutri-'+body+'-mapped');assert.ok(check.every(x=>x.issues.length===0),JSON.stringify(check))
  await fs.copyFile(path.join(rp,'check/orange-white-small-fangs.png'),path.join(evidence,'nutri-'+body+'-overlay.png'))
  aliasReports.push({body,source:item.path,alias:'orange-white-small-fangs',reference:references[body],referenceProcessing:'Nutri keyBackgroundRgba threshold 90 erode 3',report:check})
}
const inputs=[references.standard,references['shortleg-round'],...generation.items.map(i=>i.path)]
const tiles=[]
for(const [i,input] of inputs.entries()){const s=await source(path.join(root,input));const p=await sharp(s.keyed,{raw:{width:1254,height:1254,channels:4}}).resize(64,64).png().toBuffer();await fs.writeFile(path.join(evidence,path.basename(input,'.png')+'-64-preview.png'),p);tiles.push({input:await sharp(p).resize(256,256,{kernel:'nearest'}).png().toBuffer(),left:(i%3)*280+12,top:Math.floor(i/3)*300+30})}
await sharp({create:{width:840,height:600,channels:4,background:'#eeeeee'}}).composite(tiles).png().toFile(path.join(evidence,'source-comparison.png'))
assert.equal(git('diff','HEAD','--'),trackedBefore,'Nutri tracked files changed')
const report={schemaVersion:'pixel-body-eye-source-check-v1',status:'passed-source-checks-art-review-pending',nutriCommit:git('rev-parse',revision).trim(),nutriModuleHashes:moduleHashes,nutriTrackedFilesUnchanged:true,nativeIdentifierLimitation:'Unmodified checker does not know v2 identifiers. Canonical rejection captured; mapped runs use same-body stage2 keyed references in QMonster scratch and preserve original Nutri code.',preview:'source-comparison.png is a simple source downsample for visual inspection, not the production pixel pipeline (Task 3). Order: standard round, shortleg round, standard sleepy / shortleg sleepy, slender round, slender sleepy.',results,aliasReports}
await fs.writeFile(path.join(evidence,'source-checks.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,sources:results.length,comparisons:comparison,nutriMappedChecks:aliasReports.map(x=>({body:x.body,issues:x.report[0].issues})),nutriTrackedFilesUnchanged:true},null,2))
