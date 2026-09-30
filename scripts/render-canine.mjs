import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {resolveCanine,composeCanine,canonicalJson} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const[style,selectionFile,output]=process.argv.slice(2),pack='packages/asset-catalog/canine/v1'
assert.ok(['pixel','plush'].includes(style)&&selectionFile&&output,'Usage: node scripts/render-canine.mjs pixel|plush selection.json output.png')
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),catalog=JSON.parse(await fs.readFile(`${pack}/${style}/catalog.approved.json`))
const{revision,...content}=catalog;assert.equal(sha(canonicalJson(content)),revision)
assert.equal(sha(await fs.readFile(`${pack}/runtime.mjs`)),catalog.runtimeSha256)
const selection=JSON.parse(await fs.readFile(selectionFile)),plan=resolveCanine(catalog,selection),layers={}
for(const id of new Set([plan.body,...plan.clearMasks,...plan.behind,...plan.front,...(plan.headMask?[plan.headMask]:[])])){
 const r=catalog.resources[id],png=await fs.readFile(`${pack}/${r.path}`);assert.equal(sha(png),r.sha256)
 const d=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(d.info.width,catalog.size);assert.equal(d.info.height,catalog.size);assert.equal(sha(d.data),r.rgbaSha256);layers[id]=d.data
}
const rgba=composeCanine(plan,layers);await fs.mkdir(path.dirname(output),{recursive:true});await sharp(rgba,{raw:{width:catalog.size,height:catalog.size,channels:4}}).png().toFile(output)
if(style==='pixel'){
 const big=Buffer.alloc(128*128*4)
 for(let y=0;y<128;y++)for(let x=0;x<128;x++)for(let c=0;c<4;c++)big[(y*128+x)*4+c]=rgba[(Math.floor(y/2)*64+Math.floor(x/2))*4+c]
 await sharp(big,{raw:{width:128,height:128,channels:4}}).png().toFile(output.replace(/\.png$/i,'')+'-128.png')
}
console.log(JSON.stringify({style,revision,output,rgbaSha256:sha(rgba)}))
