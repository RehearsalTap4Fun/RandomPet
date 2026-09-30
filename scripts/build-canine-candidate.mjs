import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {canonicalJson,rendererVersion} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const root=path.resolve(import.meta.dirname,'..'),pack=path.join(root,'packages/asset-catalog/canine/v1')
const read=p=>fs.readFile(path.join(root,p)),json=async p=>JSON.parse(await read(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const bodies=await json('docs/art/canine-v1/manifest.json'),parts=await json('docs/art/canine-v1/parts-manifest.json'),registration=await json('docs/art/canine-v1/registration.json')
assert.equal(bodies.jobs.filter(j=>j.status==='ai-reviewed').length,90)
assert.equal(parts.jobs.filter(j=>j.status==='ai-reviewed').length,27)
const inside=(x,y,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const[a,b]=p[i],[c,d]=p[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes}return yes}
async function cropAlpha(png,half,style){
 let {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 let l=info.width,t=info.height,r=-1,b=-1
 const x0=half===undefined?0:Math.floor(info.width/2)*half,x1=half===undefined?info.width:Math.floor(info.width/2)*(half+1)
 for(let y=0;y<info.height;y++)for(let x=x0;x<x1;x++)if(data[(y*info.width+x)*4+3]>(style==='pixel'?0:16)){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
 assert.ok(r>=l&&b>=t,'Non-empty crop')
 const margin=style==='pixel'?0:8;l=Math.max(x0,l-margin);r=Math.min(x1-1,r+margin);t=Math.max(0,t-margin);b=Math.min(info.height-1,b+margin)
 return sharp(png).extract({left:l,top:t,width:r-l+1,height:b-t+1}).png().toBuffer()
}
async function erase(png,polygons,size){
 if(!polygons?.length)return png
 const p=await sharp(png).ensureAlpha().raw().toBuffer(),scale=size/64
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(polygons.some(poly=>inside((x+.5)/scale,(y+.5)/scale,poly)))p.fill(0,(y*size+x)*4,(y*size+x)*4+4)
 return sharp(p,{raw:{width:size,height:size,channels:4}}).png().toBuffer()
}
for(const style of(process.argv[2]?[process.argv[2]]:['pixel','plush'])){
 assert.ok(['pixel','plush'].includes(style))
 const size=style==='pixel'?64:1254,scale=size/64,resources={},profiles={},bodyMap={}
 const output=path.join(pack,style,'registered');await fs.mkdir(output,{recursive:true})
 async function save(id,png,provenance){
  const decoded=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(decoded.info.width,size);assert.equal(decoded.info.height,size)
  if(style==='pixel')for(let i=3;i<decoded.data.length;i+=4)assert.ok(decoded.data[i]===0||decoded.data[i]===255)
  const p=`${style}/registered/${id}.png`;await fs.writeFile(path.join(pack,p),png)
  resources[id]={path:p,sha256:sha(png),rgbaSha256:sha(decoded.data),width:size,height:size,...provenance}
 }
 const cache=new Map()
 async function checkedSource(job){
  const key=`${style}/${job.id}`;if(cache.has(key))return cache.get(key)
  const png=await fs.readFile(path.join(pack,style,'assets',`${job.id}.png`)),review=await json(`docs/qa/canine-v1/visual/${key}.json`)
  assert.equal(sha(png),job.sha256);assert.equal(review.resourceSha256,job.sha256);assert.equal(review.decision,'pass')
  cache.set(key,png);return png
 }
 for(const [id,geometry]of Object.entries(registration.profiles[style])){
  const profile={slots:{back:{},tailTip:{},ears:{},neck:{},crown:{}},clearMasks:{},geometry}
  for(const [slot,polygons]of Object.entries({...geometry.clear,head:geometry.parts['small-lion-mane'].nodes[0].occlusion})){
   const pixels=Buffer.alloc(size*size*4)
   for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(polygons.some(p=>inside((x+.5)/scale,(y+.5)/scale,p)))pixels[(y*size+x)*4+3]=255
   const rid=`mask-${id}-${slot}`,png=await sharp(pixels,{raw:{width:size,height:size,channels:4}}).png().toBuffer()
   await save(rid,png,{kind:'mask',profile:id,slot});if(slot==='head')profile.headMask=rid;else profile.clearMasks[slot]=rid
  }
  for(const part of parts.jobs.filter(j=>j.style===style)){
   const geometryPart=geometry.parts[part.trait];assert.ok(geometryPart,`Missing ${id}/${part.trait}`)
   const source=await checkedSource(part),overlays=[]
   for(const node of geometryPart.nodes){
    const crop=await cropAlpha(source,node.half,style),width=Math.round(node.width*scale),height=Math.round(node.height*scale),left=Math.round(node.left*scale),top=Math.round(node.top*scale)
    assert.ok(left>=0&&top>=0&&left+width<=size&&top+height<=size,`Node outside canvas: ${id}/${part.trait}`)
    const resized=await sharp(crop).resize(width,height,{fit:'fill',kernel:style==='pixel'?'nearest':'lanczos3'}).png().toBuffer()
    let input=await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:resized,left,top}]).png().toBuffer()
    // Neck occlusion is a body partition in the common renderer, preserving actual fur alpha.
    input=await erase(input,part.slot==='neck'?[]:node.occlusion,size);overlays.push({input})
   }
   const png=await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(overlays).png().toBuffer(),rid=`part-${id}-${part.trait}`
   await save(rid,png,{kind:'part',sourceId:part.id,sourceSha256:part.sha256,profile:id,slot:part.slot,trait:part.trait})
   profile.slots[part.slot][part.trait]=rid
  }
  profiles[id]=profile
 }
 for(const body of bodies.jobs.filter(j=>j.style===style)){
  const profile=`${body.breed}-${body.body}`,g=registration.profiles[style][profile].body,source=await checkedSource(body)
  let png=source
  if(g.left||g.top||g.width!==64||g.height!==64){
   const input=await sharp(source).resize(Math.round(g.width*scale),Math.round(g.height*scale),{fit:'fill',kernel:style==='pixel'?'nearest':'lanczos3'}).png().toBuffer()
   png=await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input,left:Math.round(g.left*scale),top:Math.round(g.top*scale)}]).png().toBuffer()
  }
  const rid=`body-${body.id}`;await save(rid,png,{kind:'body',sourceId:body.id,sourceSha256:body.sha256})
  bodyMap[body.id]={resource:rid,profile,breed:body.breed,body:body.body,eyes:body.eyes,expression:body.expression}
 }
 const content={schemaVersion:'canine-layer-catalog-v1',artVersion:'canine-1.0.0',style,status:'candidate',reviewer:'AI',userArtApproval:false,rendererVersion,size,registrationSha256:sha(await read('docs/art/canine-v1/registration.json')),runtimeSha256:sha(await fs.readFile(path.join(pack,'runtime.mjs'))),resources,profiles,bodies:bodyMap}
 const catalog={...content,revision:sha(canonicalJson(content))}
 await fs.writeFile(path.join(pack,style,'catalog.candidate.json'),JSON.stringify(catalog,null,2)+'\n')
 console.log(JSON.stringify({style,status:'candidate',resources:Object.keys(resources).length,profiles:Object.keys(profiles).length,bodies:Object.keys(bodyMap).length,revision:catalog.revision}))
}
