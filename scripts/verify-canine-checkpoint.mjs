import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root=path.resolve(import.meta.dirname,'..'),breed=process.argv[2]
const read=p=>fs.readFile(path.join(root,p))
const json=async p=>JSON.parse(await read(p))
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const manifest=await json('docs/art/canine-v1/manifest.json')
const isParts=breed==='parts'
let partsManifest={jobs:[]}
try{partsManifest=await json('docs/art/canine-v1/parts-manifest.json')}catch(e){if(e.code!=='ENOENT')throw e}
assert.equal(manifest.jobs.filter(j=>j.style==='pixel').length,72)
assert.equal(manifest.jobs.filter(j=>j.style==='plush').length,18)
assert.equal(new Set(manifest.jobs.map(j=>`${j.style}/${j.id}`)).size,90)
const selected=isParts?partsManifest.jobs:manifest.jobs.filter(j=>!breed||j.breed===breed)
if(isParts){assert.equal(selected.length,27);assert.equal(selected.filter(j=>j.style==='pixel').length,16);assert.equal(selected.filter(j=>j.style==='plush').length,11);assert.ok(selected.every(j=>j.status==='ai-reviewed'),'All 27 part sources must be reviewed')}
else if(breed){assert.equal(selected.length,15);assert.ok(selected.every(j=>j.status==='ai-reviewed'),'All 15 breed bodies must be reviewed')}
const rows=[]
for(const job of selected.filter(j=>j.status==='ai-reviewed')){
 const prefix=`docs/qa/canine-v1`,stem=`${job.style}/${job.id}`
 const technical=await json(`${prefix}/technical/${stem}.json`),review=await json(`${prefix}/visual/${stem}.json`)
 const bytes=await read(technical.path),meta=await sharp(bytes).metadata(),rgba=await sharp(bytes).ensureAlpha().raw().toBuffer()
 const size=job.style==='pixel'?64:1254
 assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,true)
 assert.equal(sha(bytes),job.sha256);assert.equal(sha(bytes),technical.sha256);assert.equal(sha(bytes),review.resourceSha256)
 assert.equal(sha(rgba),technical.rgbaSha256);assert.equal(review.decision,'pass');assert.equal(review.userArtApproval,false)
 assert.equal(sha(await read(review.evidence)),review.evidenceSha256)
 assert.ok(technical.technicalPass);assert.ok(Object.values(technical.checks).every(Boolean))
 let visible=0,transparent=0
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const a=rgba[(y*size+x)*4+3]
   if(job.style==='pixel')assert.ok(a===0||a===255,'Binary alpha')
   if(a>127){visible++;assert.ok(x>0&&y>0&&x<size-1&&y<size-1,'Unclipped content')}
   if(a===0)transparent++
 }
 assert.ok(visible>size*size*0.02);assert.ok(transparent>size*size*0.1)
 const attemptId=job.acceptedAttempt??job.id
 const attempt=await json(`docs/art/canine-v1/attempts/${job.style}/${attemptId}.json`)
 assert.equal(sha(await read(attempt.rawPath)),attempt.rawSha256)
 assert.ok(attempt.prompt.length>100);assert.equal(attempt.tool,'built-in image_gen')
 const rework=Number(attemptId.match(/-r(\d+)$/)?.[1]??0);assert.ok(rework<=3)
 if(job.style==='pixel'){
   const enlarged=await sharp(await read(`packages/asset-catalog/canine/v1/pixel/exports-128/${job.id}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
   assert.equal(enlarged.info.width,128);assert.equal(enlarged.info.height,128)
   for(let y=0;y<128;y++)for(let x=0;x<128;x++)for(let c=0;c<4;c++)assert.equal(enlarged.data[(y*128+x)*4+c],rgba[(Math.floor(y/2)*64+Math.floor(x/2))*4+c],'Exact 2x nearest-neighbor')
 }
 rows.push({style:job.style,id:job.id,body:job.body??job.trait,eyes:job.eyes??job.slot,expression:job.expression??'source-only',sha256:job.sha256,acceptedAttempt:attemptId,sourceSha256:attempt.rawSha256,path:technical.path})
}
assert.equal(new Set(rows.map(r=>r.sha256)).size,rows.length,'Every delivered body variant must be a distinct image')
const report={schemaVersion:'canine-production-checkpoint-v1',scope:isParts?'all-reviewed-part-sources':breed??'all-reviewed-bodies',status:'checkpoint-passed',goalComplete:false,bodyCounts:{planned:90,reviewed:manifest.jobs.filter(j=>j.status==='ai-reviewed').length,verifiedHere:isParts?0:rows.length},remainingBodies:manifest.jobs.filter(j=>j.status!=='ai-reviewed').length,partCounts:{planned:27,reviewed:partsManifest.jobs.filter(j=>j.status==='ai-reviewed').length,verifiedHere:isParts?rows.length:0},partsStatus:partsManifest.jobs.length?'registration-and-combination-review-pending':'not-yet-produced',claudeNotified:false,checks:['file-and-rgba-hashes','review-evidence-hashes','original-generation-provenance','real-alpha-and-size','unclipped-visible-content','distinct-variant-content','pixel-128-exact-nearest-neighbor','max-three-reworks'],rows}
const reportRoot=path.join(root,'docs/qa/canine-v1/checkpoints');await fs.mkdir(reportRoot,{recursive:true})
await fs.writeFile(path.join(reportRoot,`${breed??'all'}.json`),JSON.stringify(report,null,2)+'\n')
if(rows.length){
 const cols=4,cell=216,cardH=250,margin=16,w=cols*cell+margin*2,h=Math.ceil(rows.length/cols)*cardH+margin*2,layers=[]
 for(const [i,row]of rows.entries()){
   const x=margin+(i%cols)*cell,y=margin+Math.floor(i/cols)*cardH
   layers.push({input:await sharp(await read(row.path)).resize(192,192,{kernel:row.style==='pixel'?'nearest':'lanczos3'}).png().toBuffer(),left:x+12,top:y+8})
   const label=`${row.style} ${row.body}`;const sub=`${row.eyes} / ${row.expression}`
   layers.push({input:Buffer.from(`<svg width="216" height="42"><text x="8" y="15" font-family="sans-serif" font-size="12" fill="#26332d">${label}</text><text x="8" y="32" font-family="sans-serif" font-size="11" fill="#506058">${sub}</text></svg>`),left:x,top:y+204})
 }
 const out=path.join(reportRoot,`${breed??'all'}-contact.png`)
 await sharp({create:{width:w,height:h,channels:4,background:'#f1ede2'}}).composite(layers).png().toFile(out)
}
console.log(JSON.stringify({status:report.status,scope:report.scope,bodyCounts:report.bodyCounts,remainingBodies:report.remainingBodies,partsStatus:report.partsStatus,goalComplete:false}))
