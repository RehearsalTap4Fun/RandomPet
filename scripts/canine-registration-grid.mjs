import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
const root=path.resolve(import.meta.dirname,'..'),pack=path.join(root,'packages/asset-catalog/canine/v1')
const [style='pixel',breed='shiba']=process.argv.slice(2)
const cat=JSON.parse(await fs.readFile(path.join(pack,style,'catalog.candidate.json'),'utf8'))
const bodies=Object.entries(cat.bodies).filter(([id,b])=>b.breed===breed&&(style==='plush'||b.eyes==='round'&&b.expression==='parted-mouth'))
const layers=[]
for(let i=0;i<bodies.length;i++){
 const[id,b]=bodies[i],png=await fs.readFile(path.join(pack,cat.resources[b.resource].path))
 const input=await sharp(png).resize(640,640,{kernel:style==='pixel'?'nearest':'lanczos3'}).flatten({background:'#abb8bc'}).png().toBuffer()
 const lines=Array.from({length:17},(_,k)=>{const p=k*40;return `<path d="M ${p} 0 V 640 M 0 ${p} H 640" stroke="#477f99" stroke-opacity=".4"/><text x="${p+2}" y="12" fill="red" font-size="12">${k*4}</text><text x="1" y="${p+12}" fill="red" font-size="12">${k*4}</text>`}).join('')
 layers.push({input,left:i*640,top:24},{input:Buffer.from(`<svg width="640" height="664"><text x="10" y="20">${id}</text><g transform="translate(0,24)">${lines}</g></svg>`),left:i*640,top:0})
}
const out=path.join(root,`docs/qa/canine-v1/registration/grid-${style}-${breed}.png`)
await sharp({create:{width:640*bodies.length,height:664,channels:4,background:'white'}}).composite(layers).png().toFile(out)
console.log(out)
