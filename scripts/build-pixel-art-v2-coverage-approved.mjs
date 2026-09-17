import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { coverageApprovalPath, validateCoverageApproval } from './pixel-art-v2-coverage-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round'
const packagePath = 'packages/asset-catalog/pixel/v2/approved-1.2.1'
const distPath = 'dist/pixel-art/v2-approved-1.2.1'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const candidateBytes = await read(`${source}/catalog.candidate.json`), provenanceBytes = await read(`${source}/provenance.json`)
const candidate = JSON.parse(candidateBytes)
const validated = await validateCoverageApproval(await read(coverageApprovalPath), { candidate, candidateBytes, provenanceBytes, read })
const baseline = JSON.parse(await read('docs/qa/pixel-standard-small-fangs-approved/baseline.json'))
for (const [file, hash] of Object.entries(baseline.files)) assert.equal(sha(await read(file)), hash, `Historical artifact changed: ${file}`)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-coverage-approved')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalogV2, resolvePixelArtV2, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV2(candidate)
const { revision: candidateRevision, ...content } = candidate
const approvedContent = { ...content, artVersion: '1.2.1', coverage: candidate.coverage.map(row => ({ ...row, review: 'approved' })),
  generatable: candidate.coverage.map(row => row.id), evidence: { ...candidate.evidence, [coverageApprovalPath]: validated.sha256 } }
const approved = requirePixelArtCatalogV2({ ...approvedContent, revision: sha(canonicalJson(approvedContent)) })
assert.equal(approved.coverage.length, 32)
assert.equal(approved.generatable.length, 32)
assert.equal(Object.keys(approved.resources).length, 15)
const layers = {}
for (const [id, resource] of Object.entries(approved.resources)) {
  const bytes = await read(`${source}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
for (const row of approved.coverage) assert.equal(sha(composePixelArt(resolvePixelArtV2(row.phenotype, approved), layers)), row.rgbaSha256, row.id)
const provenance = { schemaVersion: 'pixel-art-coverage-approved-provenance-v1', status: 'approved', runtimeEnabled: false,
  candidate: validated.approval.candidate, approval: { path: coverageApprovalPath, sha256: validated.sha256 },
  approved: { artVersion: approved.artVersion, revision: approved.revision, sha256: sha(serialized(approved)) },
  promotedIds: validated.approval.samples.map(row => row.id), files: { ...JSON.parse(provenanceBytes).files, ...validated.approval.evidence, [coverageApprovalPath]: validated.sha256 } }
const outputs = new Map()
for (const directory of [packagePath, distPath]) {
  outputs.set(`${directory}/${directory === packagePath ? 'catalog.approved.json' : 'catalog.json'}`, Buffer.from(serialized(approved)))
  outputs.set(`${directory}/provenance.json`, Buffer.from(serialized(provenance)))
  for (const resource of Object.values(approved.resources)) outputs.set(`${directory}/${resource.path}`, await read(`${source}/${resource.path}`))
}
// Check all destinations before writing any file; retained identities are immutable.
for (const [file, bytes] of outputs) {
  try { assert.ok((await read(file)).equals(bytes), `Immutable artifact changed: ${file}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
for (const [file, bytes] of outputs) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
  try { await fs.writeFile(path.join(root, file), bytes, { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
console.log(`Approved ${approved.artVersion}: 32 coverage / 32 generatable / 0 pending / 15 resources / ${approved.revision}`)

await fs.copyFile(path.join(root, 'docs/integration/examples/pixel-art-approved-1.2.1.html'), path.join(root, 'dist/pixel-art/approved-1.2.1.html'))
