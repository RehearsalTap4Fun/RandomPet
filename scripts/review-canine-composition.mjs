import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {resolveCanine,composeCanine,slots} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const root=path.resolve(import.meta.dirname,'..'),pack=path.join(root,'packages/asset-catalog/canine/v1'),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const [style,breed,bodyType='standard',eyes='round',expression='parted-mouth']=process.argv.slice(2)
const catalog=JSON.parse(await fs.readFile(path.join(pack,style,'catalog.candidate.json'),'utf8'))
const bodyId=style==='pixel'?`${breed}-${bodyType}-${eyes}-${expression}`:`${breed}-${expression}`
let prior,priorBytes
try{priorBytes=await fs.readFile(path.join(root,`docs/qa/canine-v1/composition/${style}/${bodyId}.json`));prior=JSON.parse(priorBytes)}catch(e){if(e.code!=='ENOENT')throw e}
const body=catalog.bodies[bodyId];assert.ok(body,bodyId)
const profile=catalog.profiles[body.profile],cases=[{id:'none',selection:{bodyId}}]
for(const slot of slots)for(const trait of Object.keys(profile.slots[slot]))cases.push({id:trait,selection:{bodyId,[slot]:trait}})
for(let i=0;i<4;i++){
 const selection={bodyId}
 for(const slot of slots){const traits=Object.keys(profile.slots[slot]);selection[slot]=traits[i%traits.length]}
 cases.push({id:`combined-${i+1}`,selection})
}
const layers={},needed=new Set(cases.flatMap(c=>{const p=resolveCanine(catalog,c.selection,{allowCandidate:true});return[p.body,...p.clearMasks,...p.behind,...p.front,...(p.headMask?[p.headMask]:[])]}))
for(const id of needed){const resource=catalog.resources[id],png=await fs.readFile(path.join(pack,resource.path));assert.equal(sha(png),resource.sha256);layers[id]=await sharp(png).ensureAlpha().raw().toBuffer();assert.equal(sha(layers[id]),resource.rgbaSha256)}
const outputDir=path.join(root,'docs/qa/canine-v1/composition',style);await fs.mkdir(outputDir,{recursive:true})
const cols=style==='pixel'?5:4,cell=208,height=240,contactLayers=[]
for(const [i,c]of cases.entries()){
 const plan=resolveCanine(catalog,c.selection,{allowCandidate:true}),rgba=composeCanine(plan,layers)
 c.rgbaSha256=sha(rgba)
 let visible=0,edge=0
 for(let y=0;y<catalog.size;y++)for(let x=0;x<catalog.size;x++){const a=rgba[(y*catalog.size+x)*4+3];if(a>127){visible++;if(x===0||y===0||x===catalog.size-1||y===catalog.size-1)edge++}}
 c.checks={nonEmpty:visible>0,noEdgeClipping:edge===0};c.edgePixels=edge
 const png=await sharp(rgba,{raw:{width:catalog.size,height:catalog.size,channels:4}}).png().toBuffer()
 c.pngSha256=sha(png)
 if(c.id.startsWith('combined-')||style==='pixel'){
  const relative=`docs/qa/canine-v1/composition/${style}/${bodyId}--${c.id}.png`;await fs.writeFile(path.join(root,relative),png);c.path=relative
 }
 const bg=i%2?'#17212c':'#f2eee3',input=await sharp(png).resize(192,192,{kernel:style==='pixel'?'nearest':'lanczos3'}).flatten({background:bg}).png().toBuffer()
 const x=(i%cols)*cell,y=Math.floor(i/cols)*height
 contactLayers.push({input,left:x+8,top:y+8})
 contactLayers.push({input:Buffer.from(`<svg width="208" height="38"><text x="6" y="15" font-family="sans-serif" font-size="11" fill="#26332d">${c.id}</text><text x="6" y="31" font-family="sans-serif" font-size="10" fill="#506058">${c.checks.noEdgeClipping?'bounds OK':'CLIPPED'}</text></svg>`),left:x,top:y+200})
}
const contact=await sharp({create:{width:cols*cell,height:Math.ceil(cases.length/cols)*height,channels:4,background:'#e2e2d8'}}).composite(contactLayers).png().toBuffer()
const contactPath=`docs/qa/canine-v1/composition/${style}/${bodyId}-contact.png`;await fs.writeFile(path.join(root,contactPath),contact)
const report={schemaVersion:'canine-composition-review-v1',catalogRevision:catalog.revision,runtimeSha256:catalog.runtimeSha256,bodyId,profile:body.profile,style,decision:'pending',reviewer:'Codex AI',userArtApproval:false,contactPath,contactSha256:sha(contact),cases}
// Reuse only an actual prior visual decision when every rendered byte and contact sheet agrees.
if(prior?.decision==='pass'&&prior.contactSha256===report.contactSha256&&prior.cases.length===cases.length&&cases.every((c,i)=>c.id===prior.cases[i].id&&c.rgbaSha256===prior.cases[i].rgbaSha256&&c.pngSha256===prior.cases[i].pngSha256)){
 const priorPath=`docs/qa/canine-v1/history/composition/${style}/${bodyId}-${sha(priorBytes)}.json`
 await fs.mkdir(path.dirname(path.join(root,priorPath)),{recursive:true});await fs.writeFile(path.join(root,priorPath),priorBytes)
 Object.assign(report,{decision:'pass',reviewNotes:prior.reviewNotes,reviewedAt:prior.reviewedAt,visuallyInspectedCases:prior.visuallyInspectedCases,revalidatedFrom:{path:priorPath,sha256:sha(priorBytes),reason:'Every case PNG/RGBA and contact-sheet hash unchanged after resolver-only validation fix'}})
}
await fs.writeFile(path.join(outputDir,`${bodyId}.json`),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({bodyId,cases:cases.length,clipped:cases.filter(c=>!c.checks.noEdgeClipping).map(c=>c.id),contactPath}))
