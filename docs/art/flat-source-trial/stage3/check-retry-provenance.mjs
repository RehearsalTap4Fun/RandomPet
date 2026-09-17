// Verify retained generation history without changing any source artwork.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import sharp from 'sharp'
const dir=import.meta.dirname,root=path.resolve(dir,'../../../..')
const sha=b=>createHash('sha256').update(b).digest('hex')
const assertProductionSource=async record=>{
 const bytes=await fs.readFile(path.join(root,record.source))
 assert.equal(sha(bytes),record.sourceSha256,'Production source path/hash mismatch: '+record.source)
}
const generation=JSON.parse(await fs.readFile(path.join(dir,'generation.json'),'utf8'))
const revisions=JSON.parse(await fs.readFile(path.join(dir,'revisions.json'),'utf8'))
const produced=revisions.items.filter(x=>x.normalizedAttempt)
const serviceErrors=revisions.items.filter(x=>x.status==='tool-error-no-image')
assert.equal(produced.length,5);assert.equal(serviceErrors.length,1)
assert.equal(produced.filter(x=>x.body==='standard').length,4)
assert.equal(produced.filter(x=>x.body==='slender-tall').length,1)
assert.ok(revisions.items.every(x=>x.selected===false))
const checked=[]
for(const item of produced){
 assert.ok(item.prompt&&item.editTarget&&item.generatedPath)
 const raw=await fs.readFile(path.join(root,item.rawAttempt)),solid=await fs.readFile(path.join(root,item.normalizedAttempt))
 assert.equal(sha(raw),item.rawSha256);assert.equal(sha(solid),item.normalizedSha256)
 const a=await sharp(raw).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(solid).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 assert.deepEqual([a.info.width,a.info.height,b.info.width,b.info.height],[1254,1254,1254,1254])
 for(let i=0;i<a.data.length;i+=4){const expected=Math.hypot(a.data[i]-255,a.data[i+1],a.data[i+2]-255)<90?Buffer.from([255,0,255,255]):a.data.subarray(i,i+4);assert.ok(expected.equals(b.data.subarray(i,i+4)),'Retry changed more than authorized source background')}
 assert.equal(item.sourceChecksPassed,true);assert.equal(item.productionAlpha.exactAlphaPass,false)
 assert.ok(item.productionAlpha.outsideEyeAlphaMismatches.length>0)
 assert.equal(item.productionAlpha.source,item.normalizedAttempt)
 await assertProductionSource(item.productionAlpha)
 const savedGate=JSON.parse(await fs.readFile(path.join(root,item.normalizedAttempt.replace('-solid.png','-production-check.json')),'utf8'))
 assert.deepEqual(savedGate.results.find(x=>x.body===item.body),item.productionAlpha)
 checked.push({body:item.body,attempt:item.attempt,rawSha256:sha(raw),normalizedSha256:sha(solid),productionSource:item.productionAlpha.source,productionSourceHashMatches:true,sourceChecksPassed:true,productionAlphaPassed:false,selected:false})
}
// Regression: the rejected record pointed to the selected original but carried a retry hash.
const firstRetry=produced[0]
const originalSelected=generation.items.find(x=>x.body===firstRetry.body&&x.eyes==='sleepy-almond')
await assert.rejects(()=>assertProductionSource({...firstRetry.productionAlpha,source:originalSelected.path}),/Production source path\/hash mismatch/)
assert.ok(serviceErrors[0].error.includes('403'));assert.equal(serviceErrors[0].rawAttempt,undefined)
const selected=[]
for(const item of generation.items){const bytes=await fs.readFile(path.join(root,item.path));assert.equal(sha(bytes),item.sha256);const original=spawnSync('git',['show',`571b3f4:${item.path}`],{cwd:root,maxBuffer:8e6});assert.equal(original.status,0);assert.ok(bytes.equals(original.stdout),'Selected source changed since initial commit');selected.push({id:item.id,sha256:sha(bytes),byteIdenticalTo:'571b3f4'})}
assert.deepEqual(generation.downstreamAlphaAuthorization,revisions.downstreamAlphaAuthorization)
assert.deepEqual(generation.downstreamAlphaAuthorization,{authorizedBy:'user',date:'2026-09-17',owner:'Task 3',operation:'At 64x64 only, copy alpha outside the existing eye rectangles from the same-body round baseline.',preserve:['RGB bytes','alpha inside eye rectangles','1254x1254 sources'],appliedByTask2:false})
const report={status:'passed',producedRetries:5,serviceErrorsWithoutImage:1,selectedRetries:0,productionSourcePathHashRegression:'original-selected-path-with-retry-hash-rejected',checked,selected,downstreamAlphaAuthorization:generation.downstreamAlphaAuthorization}
await fs.writeFile(path.join(dir,'evidence/retry-provenance.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,producedRetries:5,serviceErrorsWithoutImage:1,selectedRetries:0,selectedSourcesByteIdentical:4},null,2))
