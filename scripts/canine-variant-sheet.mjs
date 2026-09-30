import fs from 'node:fs/promises'
import sharp from 'sharp'
import crypto from 'node:crypto'
const[style,breed,body='standard']=process.argv.slice(2)
const cat=JSON.parse(await fs.readFile(`packages/asset-catalog/canine/v1/${style}/catalog.candidate.json`))
const ids=Object.entries(cat.bodies).filter(([id,b])=>b.breed===breed&&(style==='plush'||b.body===body)).map(([id])=>id)
const overlays=[],reports=[]
for(let row=0;row<ids.length;row++){
 const r=JSON.parse(await fs.readFile(`docs/qa/canine-v1/composition/${style}/${ids[row]}.json`))
 if(r.catalogRevision!==cat.revision)throw new Error('Stale report '+ids[row])
 reports.push({id:ids[row],contactSha256:r.contactSha256,cases:['none','combined-1','combined-2','combined-3','combined-4']})
 for(let col=0;col<5;col++){
  const index=r.cases.findIndex(c=>c.id===reports[row].cases[col]),cols=style==='pixel'?5:4
  const input=await sharp(r.contactPath).extract({left:(index%cols)*208,top:Math.floor(index/cols)*240,width:208,height:200}).png().toBuffer()
  overlays.push({input,left:col*208,top:row*236+28})
 }
 overlays.push({input:Buffer.from(`<svg width="1040" height="28"><text x="8" y="20" font-size="16">${ids[row]}</text></svg>`),left:0,top:row*236})
}
const p=`docs/qa/canine-v1/composition/${style}/${breed}-${body}-variants.png`
const png=await sharp({create:{width:1040,height:ids.length*236,channels:4,background:'#e2e2d8'}}).composite(overlays).png().toBuffer()
await fs.writeFile(p,png)
await fs.writeFile(p.replace('.png','.json'),JSON.stringify({catalogRevision:cat.revision,sha256:crypto.createHash('sha256').update(png).digest('hex'),reports},null,2)+'\n')
console.log(p)
