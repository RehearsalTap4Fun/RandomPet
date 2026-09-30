import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'docs/art/canine-v1')
const outputRoot = path.join(root, 'packages/asset-catalog/canine/v1')
const qaRoot = path.join(root, 'docs/qa/canine-v1')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const writeJson = async (p,v) => { await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p,JSON.stringify(v,null,2)+'\n') }
export const breeds = ['shiba','corgi','golden-retriever','husky','dalmatian','poodle']
const bodies = ['standard','shortleg-round','slender-tall']
const eyes = ['round','sleepy-almond']
const expressions = ['parted-mouth','small-fangs']
const partSlots = { crown:['dragon-horns','antlers','halo','crystal-horns'],ears:['fin-ears','feathered-ears','celestial-ears'],neck:['small-lion-mane','frill-neck','sunburst-ruff'],back:['small-wings','feathered-wings','dragon-wings'],tailTip:['forked-tail-tip','flame-tail','phoenix-tail'] }
const plushExcluded = new Set(['crystal-horns','feathered-ears','celestial-ears','sunburst-ruff','phoenix-tail'])
const [command,...args] = process.argv.slice(2)

async function exportPixel128(png,id) {
  const input=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  if(input.info.width!==64||input.info.height!==64)throw new Error('Expected 64px source')
  const output=Buffer.alloc(128*128*4)
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const source=(Math.floor(y/2)*64+Math.floor(x/2))*4
    input.data.copy(output,(y*128+x)*4,source,source+4)
  }
  const dir=path.join(outputRoot,'pixel','exports-128');await fs.mkdir(dir,{recursive:true})
  await sharp(output,{raw:{width:128,height:128,channels:4}}).png().toFile(path.join(dir,`${id}.png`))
}

function boxOf(data,w,h) {
  let left=w,top=h,right=-1,bottom=-1,opaque=0,transparent=0,fractional=0,visible=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const a=data[(y*w+x)*4+3]
    if(a===0)transparent++;else if(a===255)opaque++;else fractional++
    if(a>127){visible++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
  }
  return {left,top,right,bottom,opaque,transparent,fractional,visible}
}

if(command==='init') {
  const jobs=[]
  for(const breed of breeds) {
    for(const body of bodies)for(const eye of eyes)for(const expression of expressions) jobs.push({id:`${breed}-${body}-${eye}-${expression}`,kind:'body',style:'pixel',breed,body,eyes:eye,expression,status:'pending'})
    for(const expression of [...expressions,'tongue-tip'])jobs.push({id:`${breed}-${expression}`,kind:'body',style:'plush',breed,body:'standard',eyes:'round',expression,status:'pending'})
  }
  const manifestPath=path.join(sourceRoot,'manifest.json')
  try { await fs.access(manifestPath); throw new Error('Manifest exists; refusing to reset production state') } catch(e) { if(e.code!=='ENOENT')throw e }
  await writeJson(manifestPath,{schemaVersion:'canine-production-v1',authorization:{date:'2026-09-30',userConfirmation:'ok; 确认，按此范围开始（推荐）',maxReworks:3,reviewer:'AI visual review plus automated technical checks'},breeds,expectedBodies:{pixel:72,plush:18},partSlots,plushExcluded:[...plushExcluded],jobs})
  console.log('Initialized 90 body jobs; parts require individually registered variants.')
} else if(command==='import') {
  const [style,id,generatedPath,promptPath]=args
  if(!['pixel','plush'].includes(style)||!/^[a-z0-9-]+$/.test(id))throw new Error('Invalid style/id')
  const target=path.join(sourceRoot,'raw',style,`${id}.png`)
  await fs.mkdir(path.dirname(target),{recursive:true})
  try{await fs.access(target);throw new Error('Use a distinct attempt id; refusing overwrite')}catch(e){if(e.code!=='ENOENT')throw e}
  await fs.copyFile(generatedPath,target)
  const bytes=await fs.readFile(target), meta=await sharp(bytes).metadata()
  if(!meta.hasAlpha)throw new Error('Generator output has no alpha')
  const record={id,style,tool:'built-in image_gen',generatedPath,rawPath:path.relative(root,target).replaceAll('\\','/'),rawSha256:sha(bytes),width:meta.width,height:meta.height,prompt:await fs.readFile(promptPath,'utf8'),visualReview:'pending'}
  await writeJson(path.join(sourceRoot,'attempts',style,`${id}.json`),record)
  console.log(JSON.stringify({id,...meta,size:bytes.length}))
} else if(command==='normalize') {
  const [style,id]=args
  if(!['pixel','plush'].includes(style)||!/^[a-z0-9-]+$/.test(id))throw new Error('Invalid style/id')
  const rawPath=path.join(sourceRoot,'raw',style,`${id}.png`), raw=await fs.readFile(rawPath)
  const size=style==='pixel'?64:1254
  let img=sharp(raw).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0},kernel:style==='pixel'?'nearest':'lanczos3'}).ensureAlpha()
  let data=await img.raw().toBuffer()
  if(style==='pixel')for(let i=0;i<data.length;i+=4){data[i+3]=data[i+3]>=128?255:0;if(!data[i+3])data.fill(0,i,i+3)}
  const png=await sharp(data,{raw:{width:size,height:size,channels:4}}).png(style==='pixel'?{palette:true,colours:32,dither:0}:{}).toBuffer()
  const target=path.join(outputRoot,style,'assets',`${id}.png`)
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,png)
  if(style==='pixel') await exportPixel128(png,id)
  const decoded=await sharp(png).ensureAlpha().raw().toBuffer()
  const box=boxOf(decoded,size,size)
  const checks={hasTransparentBackground:box.transparent>size*size*0.1,nonEmpty:box.visible>size*size*0.02,noClipping:box.left>0&&box.top>0&&box.right<size-1&&box.bottom<size-1,binaryAlpha:style!=='pixel'||box.fractional===0}
  const record={id,style,path:path.relative(root,target).replaceAll('\\','/'),width:size,height:size,sha256:sha(png),rgbaSha256:sha(decoded),bounds:box,checks,technicalPass:Object.values(checks).every(Boolean),visualReview:'pending'}
  await writeJson(path.join(qaRoot,'technical',style,`${id}.json`),record)
  console.log(JSON.stringify(record))
} else if(command==='exports') {
  const manifest=JSON.parse(await fs.readFile(path.join(sourceRoot,'manifest.json'),'utf8'))
  for(const job of manifest.jobs.filter(j=>j.style==='pixel'&&j.status==='ai-reviewed')){
    const bytes=await fs.readFile(path.join(outputRoot,'pixel','assets',`${job.id}.png`))
    if(sha(bytes)!==job.sha256)throw new Error(`Reviewed image changed: ${job.id}`)
    await exportPixel128(bytes,job.id)
  }
  console.log('Rebuilt reviewed pixel exports with exact RGBA replication; native assets unchanged.')
} else if(command==='promote') {
  const [style,attemptId,id]=args
  const review=JSON.parse(await fs.readFile(path.join(qaRoot,'visual',style,`${attemptId}.json`),'utf8'))
  const technical=JSON.parse(await fs.readFile(path.join(qaRoot,'technical',style,`${attemptId}.json`),'utf8'))
  if(review.decision!=='pass'||review.resourceSha256!==technical.sha256)throw new Error('Attempt not approved')
  const source=path.join(outputRoot,style,'assets',`${attemptId}.png`),target=path.join(outputRoot,style,'assets',`${id}.png`)
  if(sha(await fs.readFile(source))!==technical.sha256)throw new Error('Attempt changed')
  // Preserve the displaced canonical review and asset before accepting a rework.
  const previousBytes=await fs.readFile(target)
  const historyPath=path.join(qaRoot,'history',style,id,sha(previousBytes))
  await fs.mkdir(historyPath,{recursive:true})
  for(const [from,name] of [[target,'asset.png'],[path.join(qaRoot,'technical',style,`${id}.json`),'technical.json'],[path.join(qaRoot,'visual',style,`${id}.json`),'visual.json']]) {
    await fs.copyFile(from,path.join(historyPath,name))
  }
  const oldReview=JSON.parse(await fs.readFile(path.join(historyPath,'visual.json'),'utf8'))
  await fs.copyFile(path.join(root,oldReview.evidence),path.join(historyPath,'review.png'))
  await fs.copyFile(source,target)
  if(style==='pixel')await fs.copyFile(path.join(outputRoot,style,'exports-128',`${attemptId}.png`),path.join(outputRoot,style,'exports-128',`${id}.png`))
  await writeJson(path.join(qaRoot,'technical',style,`${id}.json`),{...technical,id,acceptedAttempt:attemptId,path:path.relative(root,target).replaceAll('\\','/')})
  await writeJson(path.join(qaRoot,'visual',style,`${id}.json`),{...review,id,acceptedAttempt:attemptId})
  const manifestPath=path.join(sourceRoot,id.startsWith('growth-')?'parts-manifest.json':'manifest.json'),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'))
  const job=manifest.jobs.find(j=>j.id===id&&j.style===style)
  if(!job)throw new Error('Unknown canonical job')
  Object.assign(job,{status:'ai-reviewed',acceptedAttempt:attemptId,sha256:technical.sha256})
  await writeJson(manifestPath,manifest)
  console.log(`${style}/${id}: adopted ${attemptId}; raw attempts preserved`)
} else if(command==='review') {
  const [style,id,decision,...noteParts]=args
  if(!['pass','fail'].includes(decision))throw new Error('Review decision required')
  const technicalPath=path.join(qaRoot,'technical',style,`${id}.json`)
  const technical=JSON.parse(await fs.readFile(technicalPath,'utf8'))
  if(decision==='pass'&&!technical.technicalPass)throw new Error('Cannot approve a technical failure')
  const current=await fs.readFile(path.join(root,technical.path))
  if(sha(current)!==technical.sha256)throw new Error('Resource changed after technical checks')
  const snapshotPath=path.join(qaRoot,'visual',style,`${id}-review.png`)
  await fs.mkdir(path.dirname(snapshotPath),{recursive:true})
  await fs.copyFile(path.join(qaRoot,'latest-review.png'),snapshotPath)
  await writeJson(path.join(qaRoot,'visual',style,`${id}.json`),{id,style,reviewer:'Codex AI visual inspection',decision,notes:noteParts.join(' '),resourceSha256:technical.sha256,evidence:path.relative(root,snapshotPath).replaceAll('\\','/'),evidenceSha256:sha(await fs.readFile(snapshotPath)),userArtApproval:false})
  const manifestPath=path.join(sourceRoot,id.startsWith('growth-')?'parts-manifest.json':'manifest.json'),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'))
  const job=manifest.jobs.find(j=>j.id===id&&j.style===style)
  if(job){job.status=decision==='pass'?'ai-reviewed':'rework-required';job.sha256=technical.sha256;await writeJson(manifestPath,manifest)}
  console.log(`${style}/${id}: visual ${decision}`)
} else if(command==='preview') {
  const entries=args.map(a=>{const [style,id]=a.split('/');return{style,id}})
  const cell=384,pad=24,header=36,canvasWidth=(cell+pad)*entries.length+pad,canvasHeight=cell*2+header+pad*3
  const layers=[]
  for(const [i,{style,id}]of entries.entries()) {
    const p=path.join(outputRoot,style,'assets',`${id}.png`)
    for(let row=0;row<2;row++){
      const input=await sharp(p).resize(cell,cell,{kernel:style==='pixel'?'nearest':'lanczos3'}).flatten({background:row?'#17212c':'#f2eee3'}).png().toBuffer()
      layers.push({input,left:pad+i*(cell+pad),top:header+pad+row*(cell+pad)})
    }
  }
  await fs.mkdir(qaRoot,{recursive:true})
  const output=path.join(qaRoot,'latest-review.png')
  await sharp({create:{width:canvasWidth,height:canvasHeight,channels:4,background:'#ccd2d2'}}).composite(layers).png().toFile(output)
  console.log(output)
} else {throw new Error('Expected init, import, normalize, preview')}
