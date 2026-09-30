// Fail-closed release gate. This consumes signed-by-hash evidence; it never invents an art pass.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {gunzipSync} from 'node:zlib'
import {canonicalJson} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const pack='packages/asset-catalog/canine/v1',qa='docs/qa/canine-v1',sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const json=async p=>JSON.parse(await fs.readFile(p)),write=async(p,v)=>fs.writeFile(p,JSON.stringify(v,null,2)+'\n')
const sources=await json('docs/art/canine-v1/manifest.json'),parts=await json('docs/art/canine-v1/parts-manifest.json')
const provenance=[],sourceEvidence=[]
for(const j of [...sources.jobs,...parts.jobs]){
 assert.equal(j.status,'ai-reviewed');const prefix=`${qa}/visual/${j.style}/${j.id}`
 const review=await json(`${prefix}.json`),attemptId=j.acceptedAttempt??j.id,attempt=await json(`docs/art/canine-v1/attempts/${j.style}/${attemptId}.json`)
 const technicalPath=`${qa}/technical/${j.style}/${j.id}.json`,technical=await json(technicalPath)
 assert.equal(technical.sha256,j.sha256);assert.ok(technical.technicalPass&&Object.values(technical.checks).every(Boolean))
 assert.equal(review.decision,'pass');assert.equal(review.resourceSha256,j.sha256)
 assert.equal(sha(await fs.readFile(review.evidence)),review.evidenceSha256)
 assert.equal(sha(await fs.readFile(`${pack}/${j.style}/assets/${j.id}.png`)),j.sha256)
 assert.equal(sha(await fs.readFile(attempt.rawPath)),attempt.rawSha256)
 assert.ok(Number(attemptId.match(/-r(\d+)$/)?.[1]??0)<=3)
 const promptPath=`docs/art/canine-v1/prompts/${j.style}-${attemptId}.txt`,promptBytes=await fs.readFile(promptPath)
 assert.ok(promptBytes.length>100);assert.equal(promptBytes.toString('utf8').trim(),attempt.prompt.trim())
 provenance.push({style:j.style,id:j.id,kind:j.kind??'part',sourceMode:'new-independent-generation',acceptedAttempt:attemptId,canonicalPath:`${pack}/${j.style}/assets/${j.id}.png`,sha256:j.sha256,rawPath:attempt.rawPath,rawSha256:attempt.rawSha256,promptPath:`docs/art/canine-v1/prompts/${j.style}-${attemptId}.txt`,reviewPath:`${prefix}.json`,reviewSha256:sha(await fs.readFile(`${prefix}.json`))})
 sourceEvidence.push({path:`${prefix}.json`,sha256:sha(await fs.readFile(`${prefix}.json`))})
 sourceEvidence.at(-1).technical={path:technicalPath,sha256:sha(await fs.readFile(technicalPath))}
 provenance.at(-1).promptSha256=sha(promptBytes)
}
assert.equal(provenance.length,117)
const candidates={},compositionEvidence=[],exhaustiveEvidence=[],fixtures=[]
let visualCount=0
for(const style of ['pixel','plush']){
 const c=await json(`${pack}/${style}/catalog.candidate.json`);candidates[style]=c
 assert.equal(Object.keys(c.bodies).length,style==='pixel'?72:18)
 assert.equal(Object.keys(c.profiles).length,style==='pixel'?18:6)
 assert.equal(Object.keys(c.resources).length,style==='pixel'?414:102)
 const{revision,...content}=c;assert.equal(sha(canonicalJson(content)),revision)
 assert.equal(c.runtimeSha256,sha(await fs.readFile(`${pack}/runtime.mjs`)))
 assert.equal(c.registrationSha256,sha(await fs.readFile('docs/art/canine-v1/registration.json')))
 for(const r of Object.values(c.resources))assert.equal(sha(await fs.readFile(`${pack}/${r.path}`)),r.sha256)
 const p=`${qa}/combinations/${style}.json`,e=await json(p),compressed=await fs.readFile(e.coveragePath)
 assert.equal(e.decision,'pass');assert.equal(e.catalogRevision,c.revision);assert.equal(e.runtimeSha256,c.runtimeSha256)
 assert.equal(sha(compressed),e.coverageSha256);const raw=gunzipSync(compressed);assert.equal(sha(raw),e.uncompressedSha256)
 const rows=raw.toString('utf8').trimEnd().split('\n').map(JSON.parse)
 assert.equal(rows.length,style==='pixel'?92160:5184)
 assert.equal(new Set(rows.map(r=>canonicalJson(r.selection))).size,rows.length)
 const coverage=new Map(rows.map(r=>[canonicalJson(r.selection),r.rgbaSha256]))
 exhaustiveEvidence.push({style,path:p,sha256:sha(await fs.readFile(p)),combinations:rows.length})
 for(const[id,b]of Object.entries(c.bodies)){
  const f=`${qa}/composition/${style}/${id}.json`,r=await json(f)
  assert.equal(r.decision,'pass');assert.equal(r.catalogRevision,c.revision);assert.equal(r.runtimeSha256,c.runtimeSha256)
  assert.equal(r.userArtApproval,false);assert.equal(sha(await fs.readFile(r.contactPath)),r.contactSha256)
  if(r.revalidatedFrom)assert.equal(sha(await fs.readFile(r.revalidatedFrom.path)),r.revalidatedFrom.sha256)
  const baseline=b.expression==='parted-mouth'&&(style==='plush'||b.eyes==='round')
  assert.equal(r.visuallyInspectedCases.length,baseline?r.cases.length:5)
  for(const t of r.cases){
   assert.ok(t.checks.nonEmpty&&t.checks.noEdgeClipping)
   const selection={bodyId:id,...Object.fromEntries(['back','tailTip','ears','neck','crown'].map(k=>[k,t.selection[k]??'none']))}
   assert.equal(coverage.get(canonicalJson(selection)),t.rgbaSha256,'Exhaustive replay disagrees with review '+id+'/'+t.id)
   if(t.path)assert.equal(sha(await fs.readFile(t.path)),t.pngSha256)
   fixtures.push({style,id:`${id}/${t.id}`,selection:t.selection,rgbaSha256:t.rgbaSha256})
  }
  visualCount+=r.visuallyInspectedCases.length
  compositionEvidence.push({style,bodyId:id,path:f,sha256:sha(await fs.readFile(f)),visuallyInspectedCases:r.visuallyInspectedCases})
 }
}
assert.equal(compositionEvidence.length,90);assert.equal(visualCount,804);assert.equal(fixtures.length,1800)
const gate={schemaVersion:'canine-release-gate-v1',decision:'pass',assetProductionComplete:true,reviewer:'Codex AI',userArtApproval:false,userAuthorizedAutomaticReview:true,counts:{bodies:90,pixelBodies:72,plushBodies:18,independentGrowthSources:27,pixelGrowthTypes:16,plushGrowthTypes:11,profiles:24,registeredGrowthLayers:354,replacementAndHeadMasks:72,registeredResources:516,renderedLegalCombinations:97344,reviewFixtures:1800,visuallyInspectedCompositions:804},candidateRevisions:Object.fromEntries(Object.entries(candidates).map(([k,c])=>[k,c.revision])),runtimeSha256:candidates.pixel.runtimeSha256,sourceEvidence,compositionEvidence,exhaustiveEvidence,consumerIntegration:{status:'awaiting-Claude-replay',runtimeEnabled:false},visualCoverage:'24 breed/body profile sheets cover every single growth trait and four full combinations; remaining 66 expression variants cover none and four full combinations. Exhaustive technical render is separate from visual review.'}
await write(`${qa}/release-gate.json`,gate)
const gateSha=sha(await fs.readFile(`${qa}/release-gate.json`)),delivery={artVersion:'canine-1.0.0',runtimeEnabled:false,gateSha256:gateSha,files:[]}
await write(`${pack}/provenance.json`,{schemaVersion:'canine-provenance-v1',sourceCount:117,sources:provenance})
await write(`${pack}/fixtures.json`,{schemaVersion:'canine-replay-fixtures-v1',runtimeSha256:gate.runtimeSha256,rows:fixtures})
for(const[style,c]of Object.entries(candidates)){
 const{revision,...candidate}=c,content={...candidate,status:'approved',candidateRevision:revision,releaseGateSha256:gateSha,runtimeEnabled:false}
 const approved={...content,revision:sha(canonicalJson(content))};await write(`${pack}/${style}/catalog.approved.json`,approved)
 console.log(JSON.stringify({style,revision:approved.revision,resources:Object.keys(approved.resources).length,legalCombinations:gate.exhaustiveEvidence.find(e=>e.style===style).combinations}))
 for(const r of Object.values(approved.resources))delivery.files.push({path:r.path,sha256:r.sha256})
 delivery.files.push({path:`${style}/catalog.approved.json`,sha256:sha(await fs.readFile(`${pack}/${style}/catalog.approved.json`))})
}
for(const p of ['runtime.mjs','provenance.json','fixtures.json','README.md'])delivery.files.push({path:p,sha256:sha(await fs.readFile(`${pack}/${p}`))})
await write(`${pack}/delivery.json`,delivery)
const dist='dist/canine/approved-1.0.0';await fs.mkdir(dist,{recursive:true})
for(const f of [...delivery.files,{path:'delivery.json'}]){const destination=path.join(dist,f.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(pack,f.path),destination)}
console.log(JSON.stringify({gate:'pass',files:delivery.files.length,dist,visualCount,fixtures:fixtures.length}))
