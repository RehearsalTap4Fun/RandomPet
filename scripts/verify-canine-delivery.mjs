import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {resolveCanine,composeCanine,canonicalJson} from '../packages/asset-catalog/canine/v1/runtime.mjs'
const pack='dist/canine/approved-1.0.0',sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const manifest=JSON.parse(await fs.readFile(`${pack}/delivery.json`)),fixtures=JSON.parse(await fs.readFile(`${pack}/fixtures.json`))
assert.equal(new Set(manifest.files.map(f=>f.path)).size,manifest.files.length)
for(const f of manifest.files)assert.equal(sha(await fs.readFile(`${pack}/${f.path}`)),f.sha256)
assert.equal(sha(await fs.readFile(`${pack}/runtime.mjs`)),fixtures.runtimeSha256)
const report={schemaVersion:'canine-delivery-replay-v1',decision:'pass',files:manifest.files.length,deliverySha256:sha(await fs.readFile(`${pack}/delivery.json`)),styles:{}}
for(const style of ['pixel','plush']){
 const c=JSON.parse(await fs.readFile(`${pack}/${style}/catalog.approved.json`)),{revision,...rest}=c
 assert.equal(c.status,'approved');assert.equal(sha(canonicalJson(rest)),revision)
 assert.equal(c.runtimeSha256,fixtures.runtimeSha256);assert.equal(c.releaseGateSha256,manifest.gateSha256)
 const layers={};for(const[id,r]of Object.entries(c.resources)){const data=await sharp(`${pack}/${r.path}`).ensureAlpha().raw().toBuffer();assert.equal(sha(data),r.rgbaSha256);layers[id]=data}
 const rows=fixtures.rows.filter(r=>r.style===style)
 for(const r of rows)assert.equal(sha(composeCanine(resolveCanine(c,r.selection),layers)),r.rgbaSha256,r.id)
 report.styles[style]={revision,fixturesPassed:rows.length,resources:Object.keys(c.resources).length}
 console.log(`${style}: ${rows.length} released-package fixtures passed`)
}
await fs.writeFile('docs/qa/canine-v1/delivery-verification.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
