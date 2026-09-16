// Only normalize chroma background; all foreground drawing comes from built-in imagegen.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const root = path.resolve(import.meta.dirname, '../../../..')
const dir = import.meta.dirname
const file = path.join(dir, 'generation.json')
const generation = JSON.parse(await fs.readFile(file, 'utf8'))
await fs.mkdir(path.join(dir, 'solid'), {recursive:true})
await fs.mkdir(path.join(dir, 'attempts'), {recursive:true})
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
for (const item of generation.items) {
  const rawPath = path.join(dir, 'attempts', item.id + '-raw.png')
  try { await fs.access(rawPath) } catch { await fs.copyFile(item.generatedPath, rawPath) }
  const {data, info} = await sharp(rawPath).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  if(info.width !== 1254 || info.height !== 1254) throw Error('Unexpected dimensions: '+item.id)
  const original = Buffer.from(data)
  let changed = 0
  for(let i=0;i<data.length;i+=4) if(Math.hypot(data[i]-255,data[i+1],data[i+2]-255)<90) {
    if(data[i]!==255||data[i+1]!==0||data[i+2]!==255||data[i+3]!==255) changed++
    data[i]=255; data[i+1]=0; data[i+2]=255; data[i+3]=255
  }
  item.path = path.relative(root,path.join(dir,'solid',item.id+'.png')).replaceAll('\\','/')
  await sharp(data,{raw:{width:1254,height:1254,channels:4}}).png().toFile(path.join(root,item.path))
  item.sha256 = sha(await fs.readFile(path.join(root,item.path)))
  item.rawAttempt = path.relative(root,rawPath).replaceAll('\\','/')
  item.rawSha256 = sha(await fs.readFile(rawPath))
  item.processing = {operation:'chroma-background-normalization',rule:'Euclidean RGB distance from #FF00FF < 90 becomes exact #FF00FF; all other RGBA bytes unchanged',changedPixels:changed,foregroundPreserved:true,resize:false}
  for(let i=0;i<data.length;i+=4) if(Math.hypot(original[i]-255,original[i+1],original[i+2]-255)>=90 && !original.subarray(i,i+4).equals(data.subarray(i,i+4))) throw Error('Foreground modified')
}
generation.revisions = 'docs/art/flat-source-trial/stage3/revisions.json'
generation.notes = ['Four distinct built-in calls; no generation retry. Raw attempts retain original output metadata. Only authorized deterministic background normalization was applied.','source-candidates-review-pending: final approval belongs to later full pixel/combination review.']
await fs.writeFile(file,JSON.stringify(generation,null,2)+'\n')
console.log('Prepared four 1254px sources; preserved non-background pixels byte-for-byte.')
