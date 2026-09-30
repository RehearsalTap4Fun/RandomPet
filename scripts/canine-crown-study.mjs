import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import crypto from 'node:crypto'
const root=path.resolve(import.meta.dirname,'..')
const art=path.join(root,'packages/asset-catalog/canine/v1')
const qa=path.join(root,'docs/qa/canine-v1/registration')
const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/manifest.json'),'utf8'))
const parts=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/parts-manifest.json'),'utf8'))
const regPath=path.join(root,'docs/art/canine-v1/crown-registration.json')
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
let registration
try{registration=JSON.parse(await fs.readFile(regPath,'utf8'))}catch(e){
 if(e.code!=='ENOENT')throw e
 registration={schemaVersion:'canine-crown-registration-study-v1',review:'pending',profiles:{}}
 for(const breed of manifest.breeds)for(const body of ['standard','shortleg-round','slender-tall'])registration.profiles[`${breed}-${body}`]={
  'dragon-horns':{left:19,top:2,width:22,height:12},
  antlers:{left:17,top:1,width:26,height:14},
  halo:{left:21,top:1,width:18,height:4},
  'crystal-horns':{left:19,top:2,width:22,height:12}
 }
 await fs.writeFile(regPath,JSON.stringify(registration,null,2)+'\n')
}
await fs.mkdir(qa,{recursive:true})
const bodyType=process.argv[2]||'standard'
const background=process.argv[3]==='dark'?'#17212c':'#f2eee3'
const traits=['dragon-horns','antlers','halo','crystal-horns']
const cells=[]
const records=[]
for(const [column,breed]of manifest.breeds.entries())for(const [row,trait]of traits.entries()){
 const part=parts.jobs.find(j=>j.style==='pixel'&&j.trait===trait)
 if(part?.status!=='ai-reviewed')throw new Error(`Part not reviewed: ${trait}`)
 const body=manifest.jobs.find(j=>j.style==='pixel'&&j.breed===breed&&j.body===bodyType&&j.eyes==='round'&&j.expression==='parted-mouth')
 const partPng=await fs.readFile(path.join(art,'pixel/assets',`${part.id}.png`))
 if(sha(partPng)!==part.sha256)throw new Error('Part hash changed')
 const t=JSON.parse(await fs.readFile(path.join(root,`docs/qa/canine-v1/technical/pixel/${part.id}.json`),'utf8'))
 const b=t.bounds,geometry=registration.profiles[`${breed}-${bodyType}`][trait]
 const cropped=await sharp(partPng).extract({left:b.left,top:b.top,width:b.right-b.left+1,height:b.bottom-b.top+1}).png().toBuffer()
 const resized=await sharp(cropped).resize(geometry.width,geometry.height,{fit:'fill',kernel:'nearest'}).png().toBuffer()
 const overlay=await sharp({create:{width:64,height:64,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:resized,left:geometry.left,top:geometry.top}]).png().toBuffer()
 const out=await sharp(path.join(art,'pixel/assets',`${body.id}.png`)).composite([{input:overlay}]).png().toBuffer()
 const filename=`pixel-${breed}-${bodyType}-${trait}.png`
 await fs.writeFile(path.join(qa,filename),out)
 const input=await sharp(out).resize(192,192,{kernel:'nearest'}).flatten({background}).png().toBuffer()
 const label=Buffer.from(`<svg width="208" height="40"><text x="4" y="15" fill="${background==='#17212c'?'white':'black'}" font-size="11">${breed}</text><text x="4" y="31" fill="${background==='#17212c'?'white':'black'}" font-size="11">${trait}</text></svg>`)
 cells.push({input,left:column*208+8,top:row*240+8},{input:label,left:column*208,top:row*240+200})
 records.push({body:body.id,trait,geometry,partSha256:part.sha256,bodySha256:body.sha256,compositeSha256:sha(out),path:`docs/qa/canine-v1/registration/${filename}`})
}
const filename=`pixel-crown-${bodyType}-${process.argv[3]==='dark'?'dark':'light'}.png`
await sharp({create:{width:1248,height:960,channels:4,background}}).composite(cells).png().toFile(path.join(qa,filename))
await fs.writeFile(path.join(qa,`pixel-crown-${bodyType}.json`),JSON.stringify({status:'pending-visual-review',records},null,2)+'\n')
console.log(path.join(qa,filename))
