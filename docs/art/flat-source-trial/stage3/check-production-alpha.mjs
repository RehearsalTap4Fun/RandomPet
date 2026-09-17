// Exact production gate. Conversion is Nutri's unchanged exported functions.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import sharp from 'sharp'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
const dir=import.meta.dirname,root=path.resolve(dir,'../../../..')
const scratch=path.join(root,'.superpowers/sdd/2026-09-16-pixel-body-eye-batch/source-qa')
const original=await fs.readFile(path.join(scratch,'nutri/scripts/pixelCat.ts'),'utf8')
const dispatch=original.indexOf('\nconst pv = argOf(\'--preview\')')
assert.ok(dispatch>0,'Expected Nutri CLI dispatch boundary')
const output=path.join(scratch,'production-alpha.mjs')
await build({stdin:{contents:original.slice(0,dispatch)+'\nexport {pixelate,loadFlatSource}\n',resolveDir:path.join(scratch,'nutri/scripts'),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
process.env.RANDOMPET_DIR=root
const {pixelate,loadFlatSource}=await import(pathToFileURL(output).href)
const sha=b=>createHash('sha256').update(b).digest('hex')
const items=[
 {body:'standard',eyes:[[14,15,23,23],[25,15,38,24]],baseline:'docs/qa/flat-source-trial/stage2/layers/standard/orange-white-small-fangs.png'},
 {body:'shortleg-round',eyes:[[14,15,23,23],[25,15,38,24]],baseline:'docs/qa/flat-source-trial/stage2/layers/shortleg-round/orange-white-small-fangs.png'},
 {body:'slender-tall',eyes:[[16,14,25,23],[26,14,38,23]],baselineSource:'docs/art/flat-source-trial/stage3/solid/orange-white-round-small-fangs-slender-tall.png'}
]
const generation=JSON.parse(await fs.readFile(path.join(dir,'generation.json'),'utf8'))
const results=[]
for(const item of items){
 const selected=generation.items.find(x=>x.body===item.body&&x.eyes==='sleepy-almond')
 const candidate=await pixelate(await loadFlatSource(path.join(root,selected.path)),12,true)
 const baseline=item.baselineSource?await pixelate(await loadFlatSource(path.join(root,item.baselineSource)),12,true):await fs.readFile(path.join(root,item.baseline))
 const a=await sharp(candidate).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(baseline).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 assert.deepEqual([a.info.width,a.info.height,b.info.width,b.info.height],[64,64,64,64])
 const mismatches=[]
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4+3;assert.ok(a.data[i]===0||a.data[i]===255);if(item.eyes.some(([x0,y0,x1,y1])=>x>=x0&&x<=x1&&y>=y0&&y<=y1))continue;if(a.data[i]!==b.data[i])mismatches.push([x,y,a.data[i],b.data[i]])}
 results.push({body:item.body,source:selected.path,sourceSha256:selected.sha256,baseline:item.baseline||item.baselineSource,eyeRectangles:item.eyes,outsideEyeAlphaMismatches:mismatches,exactAlphaPass:mismatches.length===0,productionPngSha256:sha(candidate),productionRgbaSha256:sha(a.data),baselinePngSha256:sha(baseline)})
 await fs.writeFile(path.join(dir,'evidence',item.body+'-production-64.png'),candidate)
}
const report={schemaVersion:'pixel-body-eye-production-alpha-v1',method:'Unchanged Nutri 385bdfae pixelate/loadFlatSource; 64px, flat=true, colors=12; fixed Task 3 eye rectangles; no foreground correction',results}
await fs.writeFile(path.join(dir,'evidence/production-alpha.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
if(results.some(x=>!x.exactAlphaPass))process.exitCode=1
