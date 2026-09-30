import fs from 'node:fs/promises'
import sharp from 'sharp'
const breeds=['shiba','corgi','golden-retriever','husky','dalmatian','poodle'],labels=['柴犬','柯基','金毛','哈士奇','斑点狗','贵宾'],layers=[],w=208
for(let row=0;row<4;row++)for(let col=0;col<6;col++){
 const style=row<2?'pixel':'plush',id=style==='pixel'?`${breeds[col]}-standard-round-parted-mouth`:`${breeds[col]}-parted-mouth`
 const report=JSON.parse(await fs.readFile(`docs/qa/canine-v1/composition/${style}/${id}.json`))
 const i=report.cases.findIndex(c=>c.id===(row%2?'combined-2':'none')),cols=style==='pixel'?5:4
 const input=await sharp(report.contactPath).extract({left:(i%cols)*208,top:Math.floor(i/cols)*240,width:208,height:200}).png().toBuffer()
 layers.push({input,left:col*w,top:row*226+26})
 layers.push({input:Buffer.from(`<svg width="208" height="26"><text x="8" y="19" font-family="sans-serif" font-size="13">${labels[col]} · ${style} ${row%2?'成长':'主体'}</text></svg>`),left:col*w,top:row*226})
}
await sharp({create:{width:6*w,height:4*226,channels:4,background:'#e2e2d8'}}).composite(layers).png().toFile('docs/qa/canine-v1/overview.png')
