// One renderer for production previews, batch verification and consumer integration.
// Inputs are straight RGBA bytes. PNG decoding and hash verification belong to the loader.
export const rendererVersion='canine-rgba-v1'
export const slots=['back','tailTip','ears','neck','crown']
export function resolveCanine(catalog,selection,{allowCandidate=false}={}){
 if(catalog.schemaVersion!=='canine-layer-catalog-v1')throw new Error('Unsupported canine catalog')
 if(catalog.status!=='approved'&&!allowCandidate)throw new Error('Catalog must be approved')
 if(![64,1254].includes(catalog.size))throw new Error('Unsupported canvas size')
 for(const key of Object.keys(selection))if(key!=='bodyId'&&!slots.includes(key))throw new Error(`Unknown selection field: ${key}`)
 if(typeof selection.bodyId!=='string'||!Object.hasOwn(catalog.bodies,selection.bodyId))throw new Error(`Unsupported body: ${selection.bodyId}`)
 const body=catalog.bodies[selection.bodyId]
 const profile=catalog.profiles[body.profile]
 if(!profile)throw new Error('Missing body profile')
 const behind=[],front=[],clearMasks=[]
 for(const slot of slots){
  const trait=selection[slot]??'none'
  if(trait==='none')continue
  if(typeof trait!=='string'||!Object.hasOwn(profile.slots[slot]??{},trait))throw new Error(`Unsupported ${slot}: ${trait}`)
  const resource=profile.slots[slot][trait]
  ;(slot==='neck'||slot==='crown'?front:behind).push(resource)
  if(profile.clearMasks[slot])clearMasks.push(profile.clearMasks[slot])
 }
 const neck=selection.neck&&selection.neck!=='none'?profile.slots.neck[selection.neck]:undefined
 return{size:catalog.size,body:body.resource,clearMasks,behind,front,...(neck?{neck,headMask:profile.headMask}:{})}
}
export function composeCanine(plan,resources){
 const n=plan.size*plan.size*4
 if(![64,1254].includes(plan.size))throw new Error('Unsupported canvas size')
 const get=id=>{const p=resources[id];if(!p)throw new Error(`Missing decoded resource: ${id}`);if(p.length!==n)throw new Error(`Wrong dimensions: ${id}`);return p}
 const body=new Uint8ClampedArray(get(plan.body)),out=new Uint8ClampedArray(n)
 for(const id of plan.clearMasks){const mask=get(id);for(let i=3;i<n;i+=4)if(mask[i]){body[i]=Math.round(body[i]*(255-mask[i])/255);if(!body[i])body.fill(0,i-3,i)}}
 let head
 if(plan.headMask){
  const mask=get(plan.headMask);head=new Uint8ClampedArray(n)
  for(let i=0;i<n;i+=4){
   if(mask[i+3]!==0&&mask[i+3]!==255)throw new Error('Head partition mask must be binary')
   if(mask[i+3]){head.set(body.subarray(i,i+4),i);body.fill(0,i,i+4)}
  }
 }
 const over=src=>{
  for(let i=0;i<n;i+=4){
   const sa=src[i+3];if(!sa)continue
   if(sa===255){out.set(src.subarray(i,i+4),i);continue}
   const da=out[i+3],a=sa+da*(255-sa)/255
   for(let c=0;c<3;c++)out[i+c]=Math.round((src[i+c]*sa+out[i+c]*da*(255-sa)/255)/a)
   out[i+3]=Math.round(a)
  }
 }
 for(const id of plan.behind)over(get(id))
 over(body)
 for(const id of plan.front){over(get(id));if(id===plan.neck&&head)over(head)}
 return out
}
export function canonicalJson(value){
 if(Array.isArray(value))return`[${value.map(canonicalJson).join(',')}]`
 if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')}}`
 return JSON.stringify(value)
}
