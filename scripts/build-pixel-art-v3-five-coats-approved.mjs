import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { fiveCoatsApprovalPath, validateFiveCoatsApproval } from './pixel-art-v3-five-coats-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'packages/asset-catalog/pixel/v3/five-coats-1.4.0'
const release = 'packages/asset-catalog/pixel/v3/approved-1.4.0'
const dist = 'dist/pixel-art/v3-approved-1.4.0'
const reportPath = 'docs/qa/pixel-five-coats/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const candidateBytes = await read(`${source}/catalog.candidate.json`)
const provenanceBytes = await read(`${source}/provenance.json`)
const candidate = JSON.parse(candidateBytes)
const report = JSON.parse(await read(reportPath))
const validated = await validateFiveCoatsApproval(await read(fiveCoatsApprovalPath), { candidate, candidateBytes, provenanceBytes, report, read })
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-five-coats-approved')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalogV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(candidate)
const { revision: candidateRevision, ...candidateContent } = candidate
const approvedContent = {
  ...candidateContent,
  artVersion: validated.approval.approvedArtVersion,
  coverage: candidate.coverage.map(row => ({ ...row, review: 'approved' })),
  generatable: candidate.coverage.map(row => row.id),
  evidence: { ...candidate.evidence, [fiveCoatsApprovalPath]: validated.sha256 },
}
const approved = requirePixelArtCatalogV3({ ...approvedContent, revision: sha(canonicalJson(approvedContent)) })
assert.equal(approved.profiles.length, 18)
assert.equal(approved.coverage.length, 5184)
assert.equal(approved.generatable.length, 5184)
assert.equal(approved.coverage.filter(row => row.review === 'pending').length, 0)
assert.equal(Object.keys(approved.resources).length, 48)
const layers = {}
for (const [id, resource] of Object.entries(approved.resources)) {
  const bytes = await read(`${source}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const profileById = new Map(approved.profiles.map(profile => [profile.id, profile]))
const planFor = row => {
  const operations = []; const planResources = {}; const profile = profileById.get(row.profileId)
  assert.ok(profile)
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? row.phenotype.expression : row.phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    planResources[resourceId] = approved.resources[resourceId]
  }
  return { size: 64, operations, resources: planResources, key: row.id, review: row.review }
}
for (const row of approved.coverage) assert.equal(sha(composePixelArt(planFor(row), layers)), row.rgbaSha256, row.id)
const approvedBytes = Buffer.from(serialized(approved))
const provenance = {
  schemaVersion: 'pixel-art-five-coats-approved-provenance-v1', status: 'approved', runtimeEnabled: false,
  candidate: validated.approval.candidate,
  approval: { path: fiveCoatsApprovalPath, sha256: validated.sha256, statement: validated.approval.userStatement },
  approved: { artVersion: approved.artVersion, revision: approved.revision, sha256: sha(approvedBytes) },
  promotedCoverage: 2880,
  registration: { profiles: 18, coverage: 5184, approved: 5184, pending: 0, resources: 48 },
  files: { ...JSON.parse(provenanceBytes).files, ...validated.approval.evidence, [fiveCoatsApprovalPath]: validated.sha256 },
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
console.log(`Approved ${approved.artVersion}: ${approved.profiles.length} profiles / ${approved.coverage.length} coverage / ${approved.generatable.length} generatable / 0 pending / ${Object.keys(approved.resources).length} resources / ${approved.revision}`)
