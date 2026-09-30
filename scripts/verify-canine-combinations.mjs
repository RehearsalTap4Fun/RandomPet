import fs from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {once} from 'node:events'
import {createGzip} from 'node:zlib'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {resolveCanine,composeCanine,slots,canonicalJson} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const style=process.argv[2],pack='packages/asset-catalog/canine/v1',dir='docs/qa/canine-v1/combinations'
assert.ok(['pixel','plush'].includes(style));await fs.mkdir(dir,{recursive:true})
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),c=JSON.parse(await fs.readFile(`${pack}/${style}/catalog.candidate.json`))
assert.equal(sha(await fs.readFile(`${pack}/runtime.mjs`)),c.runtimeSha256)
const{revision,...content}=c;assert.equal(sha(canonicalJson(content)),revision)
const rgba={},inputHashes={}
for(const[id,r]of Object.entries(c.resources)){
 const png=await fs.readFile(`${pack}/${r.path}`);assert.equal(sha(png),r.sha256)
 const d=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 assert.equal(d.info.width,c.size);assert.equal(d.info.height,c.size);assert.equal(sha(d.data),r.rgbaSha256)
 rgba[id]=d.data;inputHashes[id]=sha(d.data)
}
const output=`${dir}/${style}.jsonl.gz`,gzip=createGzip({level:9}),file=createWriteStream(output),finished=once(file,'close');gzip.pipe(file)
let count=0,visibleMin=Infinity,transparentMin=Infinity
const digest=crypto.createHash('sha256'),bodyCounts={}
function* combinations(bodyId,profile,i=0,selection={bodyId}){
 if(i===slots.length){yield selection;return}
 const slot=slots[i]
 for(const trait of ['none',...Object.keys(profile.slots[slot])])yield* combinations(bodyId,profile,i+1,{...selection,[slot]:trait})
}
for(const[bodyId,body]of Object.entries(c.bodies)){
 let bodyCount=0
 for(const selection of combinations(bodyId,c.profiles[body.profile])){
  const plan=resolveCanine(c,selection,{allowCandidate:true}),out=composeCanine(plan,rgba)
  let visible=0,transparent=0
  for(let i=3;i<out.length;i+=4){const a=out[i];if(a>127)visible++;if(a===0){transparent++;assert.equal(out[i-1]|out[i-2]|out[i-3],0)}if(style==='pixel')assert.ok(a===0||a===255)}
  assert.ok(visible>0&&transparent>0)
  for(let x=0;x<c.size;x++)for(const i of [x,(c.size-1)*c.size+x,x*c.size,x*c.size+c.size-1])assert.ok(out[i*4+3]<=127,'edge clipping '+JSON.stringify(selection))
  const record={selection,rgbaSha256:sha(out)},line=JSON.stringify(record)+'\n';digest.update(line)
  if(!gzip.write(line))await once(gzip,'drain')
  visibleMin=Math.min(visibleMin,visible);transparentMin=Math.min(transparentMin,transparent);count++;bodyCount++
 }
 bodyCounts[bodyId]=bodyCount;console.log(`${style} ${bodyId}: ${bodyCount} (${count})`)
}
gzip.end();await finished
for(const[id,input]of Object.entries(rgba))assert.equal(sha(input),inputHashes[id],'Renderer mutated input '+id)
assert.equal(count,style==='pixel'?92160:5184)
assert.equal(sha(await fs.readFile(`${pack}/${style}/catalog.candidate.json`)),sha(JSON.stringify(c,null,2)+'\n'),'Catalog changed during verification')
const report={schemaVersion:'canine-exhaustive-render-v1',style,decision:'pass',catalogRevision:c.revision,runtimeSha256:c.runtimeSha256,resources:Object.keys(c.resources).length,combinations:count,bodyCounts,visibleMin,transparentMin,checks:['all legal selections resolved','every legal selection rendered at native size','non-empty and transparent margin','no opaque canvas edge clipping','zero RGB under zero alpha','binary alpha for pixel','source buffers unchanged'],visualScope:'Technical exhaustive replay only; AI visual reviews are separately recorded in composition reports.',coveragePath:output,coverageSha256:sha(await fs.readFile(output)),uncompressedSha256:digest.digest('hex')}
await fs.writeFile(`${dir}/${style}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({style,combinations:count,decision:'pass'}))
if(process.argv[3]){
 const prior=JSON.parse(await fs.readFile(process.argv[3]));assert.equal(prior.uncompressedSha256,report.uncompressedSha256,'Legal rendered outputs changed')
 report.revalidatedFrom={path:process.argv[3],sha256:sha(await fs.readFile(process.argv[3])),allLegalOutputsUnchanged:true}
 await fs.writeFile(`${dir}/${style}.json`,JSON.stringify(report,null,2)+'\n')
 console.log('All legal output hashes match the pre-fix exhaustive run')
}
