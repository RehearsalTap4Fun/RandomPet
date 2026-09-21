import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { evolutionChainsPromotionApprovalPath, validateEvolutionChainsPromotionApproval } from './pixel-art-v3-evolution-chains-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0'
const release = 'packages/asset-catalog/pixel/v3/approved-1.6.0'
const dist = 'dist/pixel-art/v3-approved-1.6.0'
const reportPath = 'docs/qa/pixel-evolution-chain-registration/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const candidateBytes = await read(`${source}/catalog.candidate.json`)
const provenanceBytes = await read(`${source}/provenance.json`)
const approvalBytes = await read(evolutionChainsPromotionApprovalPath)
const candidate = JSON.parse(candidateBytes)
const candidateProvenance = JSON.parse(provenanceBytes)
const report = JSON.parse(await read(reportPath))
const validated = await validateEvolutionChainsPromotionApproval(approvalBytes, {
  candidate, candidateBytes, provenanceBytes, report, read,
})

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-chains-approved')
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
  evidence: { ...candidate.evidence, [evolutionChainsPromotionApprovalPath]: validated.sha256 },
}
const approved = requirePixelArtCatalogV3({ ...approvedContent, revision: sha(canonicalJson(approvedContent)) })
assert.equal(approved.profiles.length, 28)
assert.equal(approved.coverage.length, 8077)
assert.equal(approved.generatable.length, 8077)
assert.equal(approved.coverage.filter(row => row.review === 'pending').length, 0)
assert.equal(Object.keys(approved.resources).length, 63)

const layers = {}
for (const [id, resource] of Object.entries(approved.resources)) {
  const bytes = await read(`${source}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const profileById = new Map(approved.profiles.map(profile => [profile.id, profile]))
const planFor = row => {
  const operations = []; const resources = {}; const profile = profileById.get(row.profileId)
  assert.ok(profile, row.id)
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? row.phenotype.expression : row.phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `${row.id}/${step.slot}/${selected}`)
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = approved.resources[resourceId]
  }
  return { size: 64, operations, resources, key: row.id, review: 'approved' }
}
for (const row of candidate.coverage.filter(row => row.review === 'pending')) {
  assert.equal(sha(composePixelArt(planFor(row), layers)), row.rgbaSha256, row.id)
}

const approvedBytes = Buffer.from(serialized(approved))
const provenance = {
  schemaVersion: 'pixel-art-evolution-chains-approved-provenance-v1',
  status: 'approved',
  runtimeEnabled: false,
  candidate: validated.approval.candidate,
  approval: { path: evolutionChainsPromotionApprovalPath, sha256: validated.sha256, statement: validated.approval.userStatement },
  consumerReplay: validated.approval.consumerReplay,
  approved: { artVersion: approved.artVersion, revision: approved.revision, sha256: sha(approvedBytes) },
  promotedCoverage: 13,
  theoreticalCoverage: 35840,
  validationMode: 'representative-samples-plus-consumer-replay',
  registration: { profiles: 28, coverage: 8077, approved: 8077, pending: 0, generatable: 8077, resources: 63 },
  files: { ...candidateProvenance.files, ...validated.approval.evidence, [evolutionChainsPromotionApprovalPath]: validated.sha256 },
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
console.log(`Approved ${approved.artVersion}: 28 profiles / 8077 approved+generatable / 13 promoted / 63 resources / ${approved.revision}`)
