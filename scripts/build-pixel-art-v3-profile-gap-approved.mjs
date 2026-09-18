import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { profileGapApprovalPath, validateProfileGapApproval } from './pixel-art-v3-profile-gap-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'packages/asset-catalog/pixel/v3/profile-gap-1.3.1'
const release = 'packages/asset-catalog/pixel/v3/approved-1.3.1'
const dist = 'dist/pixel-art/v3-approved-1.3.1'
const reportPath = 'docs/qa/pixel-profile-gap/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const candidateBytes = await read(`${source}/catalog.candidate.json`)
const provenanceBytes = await read(`${source}/provenance.json`)
const candidate = JSON.parse(candidateBytes)
const report = JSON.parse(await read(reportPath))
const validated = await validateProfileGapApproval(await read(profileGapApprovalPath), { candidate, candidateBytes, provenanceBytes, report, read })
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-profile-gap-approved')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalogV3, resolvePixelArtV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(candidate)
const { revision: candidateRevision, ...candidateContent } = candidate
const approvedContent = {
  ...candidateContent,
  artVersion: validated.approval.approvedArtVersion,
  coverage: candidate.coverage.map(row => ({ ...row, review: 'approved' })),
  generatable: candidate.coverage.map(row => row.id),
  evidence: { ...candidate.evidence, [profileGapApprovalPath]: validated.sha256 },
}
const approved = requirePixelArtCatalogV3({ ...approvedContent, revision: sha(canonicalJson(approvedContent)) })
assert.equal(approved.profiles.length, 8)
assert.equal(approved.coverage.length, 2304)
assert.equal(approved.generatable.length, 2304)
assert.equal(approved.coverage.filter(row => row.review === 'pending').length, 0)
assert.equal(Object.keys(approved.resources).length, 23)
const layers = {}
for (const [id, resource] of Object.entries(approved.resources)) {
  const bytes = await read(`${source}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
for (const row of approved.coverage) assert.equal(sha(composePixelArt(resolvePixelArtV3(row.phenotype, approved), layers)), row.rgbaSha256, row.id)
const approvedBytes = Buffer.from(serialized(approved))
const provenance = {
  schemaVersion: 'pixel-art-profile-gap-approved-provenance-v1', status: 'approved', runtimeEnabled: false,
  candidate: validated.approval.candidate,
  approval: { path: profileGapApprovalPath, sha256: validated.sha256, statement: validated.approval.userStatement },
  approved: { artVersion: approved.artVersion, revision: approved.revision, sha256: sha(approvedBytes) },
  promotedCoverage: 288,
  files: { ...JSON.parse(provenanceBytes).files, ...validated.approval.evidence, [profileGapApprovalPath]: validated.sha256 },
}
const outputs = new Map()
for (const directory of [release, dist]) {
  outputs.set(`${directory}/${directory === release ? 'catalog.approved.json' : 'catalog.json'}`, approvedBytes)
  outputs.set(`${directory}/provenance.json`, Buffer.from(serialized(provenance)))
  for (const resource of Object.values(approved.resources)) outputs.set(`${directory}/${resource.path}`, await read(`${source}/${resource.path}`))
}
for (const [file, bytes] of outputs) {
  try { assert.ok((await read(file)).equals(bytes), `Immutable artifact changed: ${file}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
for (const [file, bytes] of outputs) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
  try { await fs.writeFile(path.join(root, file), bytes, { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
console.log(`Approved ${approved.artVersion}: 8 profiles / 2304 coverage / 2304 generatable / 0 pending / 23 resources / ${approved.revision}`)
