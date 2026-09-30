// Applied geometry corrections from the 64-unit diagnostic grids. Sources are untouched.
import fs from 'node:fs/promises'
const file='docs/art/canine-v1/registration.json',r=JSON.parse(await fs.readFile(file,'utf8'))
throw new Error('Historical first-pass repair only. Final reviewed geometry is registration.json; this script must not overwrite it.')
const head=low=>[[0,0],[64,0],[64,low-7],[46,low-7],[42,low-3],[35,low],[24,low],[17,low-3],[9,low-7],[0,low-7]]
for(const[id,g]of Object.entries(r.profiles.pixel)){
 const slender=id.endsWith('slender-tall'),short=id.endsWith('shortleg-round')
 const low=id.startsWith('husky')||id.startsWith('corgi')?40:id==='golden-retriever-slender-tall'?33:36
 const w=id==='golden-retriever-slender-tall'?34:slender?38:short?42:40
 g.headBottom=low
 for(const k of ['small-lion-mane','frill-neck','sunburst-ruff'])g.parts[k].nodes=[{left:29-w/2,top:low-10,width:w,height:22,occlusion:[head(low)]}]
 if(id.startsWith('shiba'))g.clear.tailTip=[[[46,24],[64,24],[64,64],[51,64],[51,54],[51,48],[48,43],[44,39],[44,34],[46,30]]]
 if(id.startsWith('husky'))g.clear.tailTip=[[[45,30],[64,30],[64,64],[slender?47:short?51:49,64],[slender?47:short?51:49,54],[slender?47:short?51:49,49],[46,44],[42,40],[45,37]]]
 if(id.startsWith('poodle')){
  g.clear.ears[1]=[[41,0],[64,0],[64,40],[38,40],[38,35],[39,30],[40,25],[40,20],[39,17],[41,13]]
  g.clear.tailTip=[[[49,32],[64,32],[64,64],[53,64],[53,52],[52,48],[49,44],[46,41],[48,37]]]
 }
 if(id.startsWith('corgi'))g.clear.ears=[[[0,0],[26,0],[26,11],[21,14],[18,18],[15,24],[12,27],[0,27]],[[34,0],[56,0],[56,31],[44,31],[42,26],[40,21],[37,17],[34,14]]]
 if(id.startsWith('golden-retriever')&&!slender)g.clear.ears[0]=[[0,0],[21,0],[21,10],[18,14],[17,19],[15,23],[14,27],[15,31],[17,34],[17,36],[0,36]]
}
for(const[id,g]of Object.entries(r.profiles.plush)){
 const low=id.startsWith('corgi')?40:id.startsWith('husky')?39:36
 g.headBottom=low
 for(const k of ['small-lion-mane','frill-neck'])g.parts[k].nodes=[{left:12,top:low-9,width:37,height:20,occlusion:[head(low)]}]
 if(id==='shiba-standard')g.clear.tailTip=[[[46,30],[64,30],[64,62],[49,62],[48,53],[48,48],[46,44],[43,41],[43,36]]]
 if(id==='corgi-standard'){
  g.clear.ears=[[[0,0],[27,0],[27,16],[22,18],[18,23],[16,28],[0,28]],[[34,0],[64,0],[64,33],[44,33],[42,29],[39,22],[36,19],[34,17]]]
  g.clear.tailTip=[[[48,40],[64,40],[64,62],[49,62],[48,55],[48,49],[46,45]]]
 }
 if(id==='golden-retriever-standard'){
  g.clear.ears=[[[0,0],[22,0],[22,13],[19,16],[18,20],[17,25],[16,30],[16,34],[0,36]],[[39,0],[64,0],[64,36],[39,36],[38.5,32],[39,26],[38,20],[37.5,16],[39,12]]]
  g.clear.tailTip=[[[48,29],[64,29],[64,62],[48,62],[47,54],[47,49],[45,45],[47,40]]]
 }
 if(id==='husky-standard')g.clear.tailTip=[[[44,31],[64,31],[64,60],[44,60],[44,49],[43,45],[41,42],[41,36]]]
 if(id==='dalmatian-standard'){
  g.clear.ears=[[[0,0],[24,0],[24,12],[20,15],[18,21],[16,25],[15,29],[0,30]],[[38,0],[64,0],[64,36],[40,36],[39,30],[39,24],[38,18],[37,15]]]
  g.clear.tailTip=[[[49,29],[64,29],[64,62],[48,62],[48,50],[46,46],[49,40]]]
 }
 if(id==='poodle-standard'){
  g.clear.ears=[[[0,0],[21,0],[21,17],[20,23],[19,28],[19,32],[21,36],[0,38]],[[42,0],[64,0],[64,40],[38,40],[38,36],[39.5,32],[40,26],[40,22],[40,18],[42,15]]]
  g.clear.tailTip=[[[46,37],[64,37],[64,62],[49,62],[49,51],[48,47],[44,43],[44,39]]]
 }
}
await fs.writeFile(file,JSON.stringify(r,null,2)+'\n')
