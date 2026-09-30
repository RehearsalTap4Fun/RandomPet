import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import crypto from 'node:crypto'
const root=path.resolve(import.meta.dirname,'..'),art=path.join(root,'packages/asset-catalog/canine/v1'),qa=path.join(root,'docs/qa/canine-v1/registration')
const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/manifest.json'),'utf8'))
const parts=JSON.parse(await fs.readFile(path.join(root,'docs/art/canine-v1/parts-manifest.json'),'utf8'))
const regPath=path.join(root,'docs/art/canine-v1/ear-registration.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
let registration
try{registration=JSON.parse(await fs.readFile(regPath,'utf8'))}catch(e){
 if(e.code!=='ENOENT')throw e
 registration={schemaVersion:'canine-ear-registration-study-v1',review:'pending',profiles:{}}
 const shapes={
  shiba:{clear:[[[0,0],[25,0],[25,9],[21,10],[18,12],[13,17],[0,17]],[[33,0],[55,0],[55,25],[44,25],[41,19],[38,14],[33,10]]],nodes:[{left:10,top:2,width:15,height:19},{left:35,top:3,width:15,height:19}]},
  corgi:{clear:[[[0,0],[26,0],[26,10],[21,13],[18,17],[0,17]],[[34,0],[56,0],[56,26],[43,26],[41,19],[37,14],[34,12]]],nodes:[{left:10,top:2,width:16,height:20},{left:35,top:3,width:16,height:20}]},
  husky:{clear:[[[0,0],[26,0],[26,12],[21,15],[16,21],[0,21]],[[33,0],[55,0],[55,25],[43,25],[40,19],[35,14],[33,12]]],nodes:[{left:10,top:4,width:16,height:20},{left:35,top:4,width:16,height:20}]},
  'golden-retriever':{clear:[[[0,0],[21,0],[21,12],[18,18],[17,24],[18,30],[20,34],[0,36]],[[40,0],[54,0],[54,29],[50,35],[42,36],[40,30],[41,22],[40,16]]],nodes:[{left:5,top:9,width:16,height:24},{left:40,top:10,width:16,height:24}]},
  dalmatian:{clear:[[[0,0],[21,0],[21,12],[18,18],[17,26],[19,33],[0,34]],[[40,0],[54,0],[54,30],[48,35],[41,35],[40,29],[41,21],[40,15]]],nodes:[{left:5,top:8,width:16,height:23},{left:40,top:9,width:16,height:23}]},
  poodle:{clear:[[[0,0],[19,0],[19,13],[17,20],[17,29],[19,36],[0,39]],[[41,0],[54,0],[54,33],[49,39],[41,39],[41,31],[42,24],[41,17]]],nodes:[{left:3,top:10,width:17,height:25},{left:40,top:10,width:17,height:25}]}
 }
 for(const breed of manifest.breeds)for(const body of ['standard','shortleg-round','slender-tall'])registration.profiles[`${breed}-${body}`]=structuredClone(shapes[breed])
 registration.profiles['golden-retriever-slender-tall']={clear:[[[0,0],[24,0],[24,8],[21,13],[19,20],[21,27],[0,29]],[[38,0],[53,0],[53,29],[41,29],[39,24],[41,17],[39,11]]],nodes:[{left:9,top:3,width:15,height:22},{left:38,top:4,width:15,height:22}]}
 await fs.writeFile(regPath,JSON.stringify(registration,null,2)+'\n')
}
const inside=(x,y,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const[a,b]=p[i],[c,d]=p[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes}return yes}
await fs.mkdir(qa,{recursive:true})
const bodyType=process.argv[2]||'standard',background=process.argv[3]==='dark'?'#17212c':'#f2eee3',traits=['fin-ears','feathered-ears','celestial-ears'],cells=[],records=[]
for(const[column,breed]of manifest.breeds.entries())for(const[row,trait]of traits.entries()){
 const part=parts.jobs.find(j=>j.style==='pixel'&&j.trait===trait)
 if(part?.status!=='ai-reviewed')throw new Error(`Unreviewed part ${trait}`)
 const body=manifest.jobs.find(j=>j.style==='pixel'&&j.breed===breed&&j.body===bodyType&&j.eyes==='round'&&j.expression==='parted-mouth')
 const geometry=registration.profiles[`${breed}-${bodyType}`]
 const original=await fs.readFile(path.join(art,'pixel/assets',`${body.id}.png`)),partPng=await fs.readFile(path.join(art,'pixel/assets',`${part.id}.png`))
 if(sha(original)!==body.sha256||sha(partPng)!==part.sha256)throw new Error('Source changed')
 const pixels=await sharp(original).ensureAlpha().raw().toBuffer()
 for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(geometry.clear.some(p=>inside(x+.5,y+.5,p)))pixels.fill(0,(y*64+x)*4,(y*64+x)*4+4)
 const overlays=[]
 for(let half=0;half<2;half++){
  const halfPng=await sharp(partPng).extract({left:half*32,top:0,width:32,height:64}).png().toBuffer()
  const crop=await sharp(halfPng).trim().png().toBuffer()
  const n=geometry.nodes[half],input=await sharp(crop).resize(n.width,n.height,{fit:'fill',kernel:'nearest'}).png().toBuffer()
  overlays.push({input,left:n.left,top:n.top})
 }
 const ears=await sharp({create:{width:64,height:64,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(overlays).png().toBuffer()
 const clearedBody=await sharp(pixels,{raw:{width:64,height:64,channels:4}}).png().toBuffer()
 const output=await sharp(ears).composite([{input:clearedBody}]).png().toBuffer()
 const filename=`pixel-${breed}-${bodyType}-${trait}.png`
 await fs.writeFile(path.join(qa,filename),output)
 const input=await sharp(output).resize(192,192,{kernel:'nearest'}).flatten({background}).png().toBuffer()
 const label=Buffer.from(`<svg width="208" height="40"><text x="4" y="15" fill="${background==='#17212c'?'white':'black'}" font-size="11">${breed}</text><text x="4" y="31" fill="${background==='#17212c'?'white':'black'}" font-size="11">${trait}</text></svg>`)
 cells.push({input,left:column*208+8,top:row*240+8},{input:label,left:column*208,top:row*240+200})
 records.push({body:body.id,trait,geometry,bodySha256:body.sha256,partSha256:part.sha256,compositeSha256:sha(output),path:`docs/qa/canine-v1/registration/${filename}`})
}
const filename=`pixel-ears-${bodyType}-${process.argv[3]==='dark'?'dark':'light'}.png`
await sharp({create:{width:1248,height:720,channels:4,background}}).composite(cells).png().toFile(path.join(qa,filename))
await fs.writeFile(path.join(qa,`pixel-ears-${bodyType}.json`),JSON.stringify({status:'pending-visual-review',records},null,2)+'\n')
console.log(path.join(qa,filename))
