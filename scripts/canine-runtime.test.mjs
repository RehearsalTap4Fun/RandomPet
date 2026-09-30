import test from 'node:test'
import assert from 'node:assert/strict'
import { composeCanine, resolveCanine } from '../packages/asset-catalog/canine/v1/runtime.mjs'
const at=(x,y)=>(y*64+x)*4
const layer=(values)=>{const p=new Uint8ClampedArray(64*64*4);for(const [x,y,r,g,b,a]of values)p.set([r,g,b,a],at(x,y));return p}
test('ear replacement clears only the original body, preserving the new ear behind it',()=>{
 const resources={body:layer([[5,5,255,0,0,255],[6,5,255,0,0,255]]),ears:layer([[5,5,0,255,0,255],[6,5,0,255,0,255]]),mask:layer([[5,5,0,0,0,255]])}
 const out=composeCanine({size:64,body:'body',clearMasks:['mask'],behind:['ears'],front:[]},resources)
 assert.deepEqual([...out.slice(at(5,5),at(5,5)+4)],[0,255,0,255])
 assert.deepEqual([...out.slice(at(6,5),at(6,5)+4)],[255,0,0,255])
 assert.deepEqual([...resources.body.slice(at(5,5),at(5,5)+4)],[255,0,0,255],'source is immutable')
})
test('RGBA over preserves partial alpha and zeroes RGB for empty pixels',()=>{
 const resources={body:layer([[5,5,0,0,255,255],[0,0,255,0,0,0]]),front:layer([[5,5,255,0,0,128],[6,5,255,0,0,128]])}
 const out=composeCanine({size:64,body:'body',clearMasks:[],behind:[],front:['front']},resources)
 assert.deepEqual([...out.slice(at(5,5),at(5,5)+4)],[128,0,127,255])
 assert.deepEqual([...out.slice(at(6,5),at(6,5)+4)],[255,0,0,128])
 assert.deepEqual([...out.slice(0,4)],[0,0,0,0])
})
test('neck is behind the actual head pixels while remaining visible outside the head silhouette',()=>{
 const resources={body:layer([[5,5,255,0,0,128]]),neck:layer([[5,5,0,255,0,255],[6,5,0,255,0,255]]),head:layer([[5,5,0,0,0,255],[6,5,0,0,0,255]])}
 const out=composeCanine({size:64,body:'body',clearMasks:[],behind:[],front:['neck'],neck:'neck',headMask:'head'},resources)
 assert.deepEqual([...out.slice(at(5,5),at(5,5)+4)],[128,127,0,255])
 assert.deepEqual([...out.slice(at(6,5),at(6,5)+4)],[0,255,0,255])
})
test('unapproved catalogs, unknown selections and missing decoded resources fail closed',()=>{
 const catalog={schemaVersion:'canine-layer-catalog-v1',status:'candidate',size:64,bodies:{dog:{resource:'body',profile:'dog'}},profiles:{dog:{slots:{crown:{halo:'halo'},ears:{},neck:{},back:{},tailTip:{}},clearMasks:{}}}}
 assert.throws(()=>resolveCanine(catalog,{bodyId:'dog'}),/approved/)
 assert.throws(()=>resolveCanine(catalog,{bodyId:'dog',crown:'unknown'},{allowCandidate:true}),/Unsupported/)
 for(const crown of ['toString','constructor','__proto__'])assert.throws(()=>resolveCanine(catalog,{bodyId:'dog',crown},{allowCandidate:true}),/Unsupported/)
 assert.throws(()=>resolveCanine(catalog,{bodyId:'dog',surprise:'halo'},{allowCandidate:true}),/Unknown selection/)
 const plan=resolveCanine(catalog,{bodyId:'dog',crown:'halo'},{allowCandidate:true})
 assert.deepEqual(plan.front,['halo'])
 assert.throws(()=>composeCanine(plan,{body:layer([])}),/Missing decoded resource/)
})
