import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const [style,ids,note,scope='full']=process.argv.slice(2),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
assert.ok(['full','variants'].includes(scope))
assert.ok(note?.length>15,'Specific observed visual notes required')
const catalog=JSON.parse(await fs.readFile(`packages/asset-catalog/canine/v1/${style}/catalog.candidate.json`))
for(const id of ids.split(',')){
 const f=`docs/qa/canine-v1/composition/${style}/${id}.json`,r=JSON.parse(await fs.readFile(f))
 assert.equal(r.catalogRevision,catalog.revision);assert.equal(r.runtimeSha256,catalog.runtimeSha256)
 assert.equal(sha(await fs.readFile(r.contactPath)),r.contactSha256)
 assert.ok(r.cases.every(c=>c.checks.nonEmpty&&c.checks.noEdgeClipping))
 r.decision='pass';r.reviewNotes=note;r.reviewedAt=new Date().toISOString()
 r.visuallyInspectedCases=scope==='full'?r.cases.map(c=>c.id):['none','combined-1','combined-2','combined-3','combined-4']
 await fs.writeFile(f,JSON.stringify(r,null,2)+'\n')
 console.log(id+' pass')
}
