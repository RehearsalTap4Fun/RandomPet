import fs from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'docs/art/canine-v1')
const out=path.join(dir,'registration.json')
try{await fs.access(out);throw new Error('Registration already exists; edit it rather than reset')}catch(e){if(e.code!=='ENOENT')throw e}
const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'))
const crowns=JSON.parse(await fs.readFile(path.join(dir,'crown-registration.json'),'utf8'))
const ears=JSON.parse(await fs.readFile(path.join(dir,'ear-registration.json'),'utf8'))
const registration={schemaVersion:'canine-registration-v1',coordinates:'logical 64x64, scaled to style canvas when compiled',review:'pending',profiles:{pixel:{},plush:{}}}
for(const breed of manifest.breeds)for(const body of ['standard','shortleg-round','slender-tall']){
 const id=`${breed}-${body}`,slender=body==='slender-tall',short=body==='shortleg-round',smallHead=breed==='golden-retriever'&&slender
 const headBottom=smallHead?32:breed==='husky'?34:36
 const headMask=[[0,0],[64,0],[64,headBottom-8],[46,headBottom-8],[42,headBottom-3],[35,headBottom],[24,headBottom],[16,headBottom-3],[9,headBottom-8],[0,headBottom-8]]
 const tailBoundary=(slender?44:short?52:50)
 const tailMask=[[51,29],[64,29],[64,61],[tailBoundary-1,61],[tailBoundary,57],[tailBoundary+1,52],[tailBoundary+1,47],[tailBoundary-1,42],[tailBoundary-4,38],[47,34],[51,34]]
 if(breed==='poodle'){tailMask[0]=[54,32];tailMask[10]=[51,37];tailMask[11]=[54,35]}
 const w=slender?30:short?38:36
 const neck={left:Math.round(29-w/2),top:headBottom-9,width:w,height:20,occlusion:[headMask]}
 registration.profiles.pixel[id]={body:{left:0,top:0,width:64,height:64},headBottom,
  clear:{ears:ears.profiles[id].clear,tailTip:[tailMask]},
  parts:{...Object.fromEntries(Object.entries(crowns.profiles[id]).map(([k,v])=>[k,{nodes:[v]}])),
   ...Object.fromEntries(['fin-ears','feathered-ears','celestial-ears'].map(k=>[k,{nodes:ears.profiles[id].nodes.map((n,i)=>({...n,half:i}))}])),
   ...Object.fromEntries(['small-lion-mane','frill-neck','sunburst-ruff'].map(k=>[k,{nodes:[neck]}])),
   'small-wings':{nodes:[{left:3,top:28,width:57,height:25}]},
   'feathered-wings':{nodes:[{left:1,top:20,width:62,height:32}]},
   'dragon-wings':{nodes:[{left:1,top:22,width:62,height:31}]},
   ...Object.fromEntries(['forked-tail-tip','flame-tail','phoenix-tail'].map(k=>[k,{nodes:[{left:slender?38:41,top:31,width:slender?24:21,height:28}]}]))
  }
 }
}
// Plush layouts reserve a uniform border for growth. Geometry is independent of pixel positions.
for(const breed of manifest.breeds){
 const id=`${breed}-standard`,pixel=registration.profiles.pixel[id]
 const tx=x=>4+x*.875,ty=y=>7+y*.875
 const convert=p=>p.map(([x,y])=>[tx(x),ty(y)])
 const low=breed==='husky'?37:39
 const headMask=[[0,0],[64,0],[64,low-7],[46,low-7],[42,low-3],[35,low],[25,low],[17,low-3],[8,low-7],[0,low-7]]
 registration.profiles.plush[id]={body:{left:4,top:7,width:56,height:56},headBottom:low,
  clear:{ears:pixel.clear.ears.map(convert),tailTip:pixel.clear.tailTip.map(convert)},
  parts:{
   'dragon-horns':{nodes:[{left:19,top:3,width:24,height:16}]},antlers:{nodes:[{left:18,top:2,width:26,height:18}]},halo:{nodes:[{left:22,top:2,width:18,height:5}]},
   'fin-ears':{nodes:pixel.parts['fin-ears'].nodes.map(n=>({...n,left:tx(n.left),top:ty(n.top),width:n.width*.875,height:n.height*.875}))},
   ...Object.fromEntries(['small-lion-mane','frill-neck'].map(k=>[k,{nodes:[{left:13,top:low-10,width:36,height:20,occlusion:[headMask]}]}])),
   'small-wings':{nodes:[{left:2,top:29,width:60,height:26}]},
   'feathered-wings':{nodes:[{left:1,top:23,width:62,height:32}]},
   'dragon-wings':{nodes:[{left:1,top:24,width:62,height:31}]},
   ...Object.fromEntries(['forked-tail-tip','flame-tail'].map(k=>[k,{nodes:[{left:41,top:32,width:21,height:27}]}]))
  }
 }
}
await fs.writeFile(out,JSON.stringify(registration,null,2)+'\n')
console.log(out)
