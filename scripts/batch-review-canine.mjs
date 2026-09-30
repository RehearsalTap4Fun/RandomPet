import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
const styles=process.argv[2]?[process.argv[2]]:['pixel','plush']
for(const style of styles){
 const cat=JSON.parse(await fs.readFile(`packages/asset-catalog/canine/v1/${style}/catalog.candidate.json`))
 for(const[id,b]of Object.entries(cat.bodies)){
  const p=`docs/qa/canine-v1/composition/${style}/${id}.json`
  let old;try{old=JSON.parse(await fs.readFile(p))}catch{}
  if(old?.catalogRevision===cat.revision)continue
  const result=spawnSync(process.execPath,['scripts/review-canine-composition.mjs',style,b.breed,b.body,b.eyes,b.expression],{stdio:'inherit'})
  if(result.status!==0)process.exit(result.status||1)
 }
 const profiles=new Set(Object.values(cat.bodies).map(b=>`${b.breed}|${b.body}`))
 for(const key of profiles){const[breed,body]=key.split('|');const r=spawnSync(process.execPath,['scripts/canine-variant-sheet.mjs',style,breed,body],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
}
