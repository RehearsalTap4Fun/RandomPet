import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { evolutionChainsCompleteApprovalPath, validateEvolutionChainsCompleteApproval } from './pixel-art-v3-evolution-chains-complete-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.1'
const release = 'packages/asset-catalog/pixel/v3/approved-1.6.1'
const dist = 'dist/pixel-art/v3-approved-1.6.1'
const reportPath = 'docs/qa/pixel-evolution-chain-complete/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const candidateBytes = await read(`${source}/catalog.candidate.json`)
const provenanceBytes = await read(`${source}/provenance.json`)
const approvalBytes = await read(evolutionChainsCompleteApprovalPath)
const candidate = JSON.parse(candidateBytes)
const candidateProvenance = JSON.parse(provenanceBytes)
const report = JSON.parse(await read(reportPath))
const validated = await validateEvolutionChainsCompleteApproval(approvalBytes, { candidate, candidateBytes, provenanceBytes, report, read })
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-chains-complete-approved')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalogV3 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(candidate)
const { revision: candidateRevision, ...candidateContent } = candidate
const approvedContent = {
  ...candidateContent,
  artVersion: validated.approval.approvedArtVersion,
  coverage: candidate.coverage.map(row => ({ ...row, review: 'approved' })),
  generatable: candidate.coverage.map(row => row.id),
  evidence: { ...candidate.evidence, [evolutionChainsCompleteApprovalPath]: validated.sha256 },
}
const approved = requirePixelArtCatalogV3({ ...approvedContent, revision: sha(canonicalJson(approvedContent)) })
assert.equal(approved.profiles.length, 28)
assert.equal(approved.coverage.length, 35840)
assert.equal(approved.generatable.length, 35840)
assert.equal(approved.coverage.filter(row => row.review === 'pending').length, 0)
assert.equal(Object.keys(approved.resources).length, 63)
const approvedBytes = Buffer.from(serialized(approved))
const provenance = {
  schemaVersion: 'pixel-art-evolution-chains-complete-approved-provenance-v1', status: 'approved', runtimeEnabled: false,
  candidate: validated.approval.candidate,
  approval: { path: evolutionChainsCompleteApprovalPath, sha256: validated.sha256, statement: validated.approval.userStatement },
  compactRuntimeContract: validated.approval.compactRuntimeContract,
  approved: { artVersion: approved.artVersion, revision: approved.revision, sha256: sha(approvedBytes) },
  promotedCoverage: 27763,
  validationMode: 'mechanical-full-grid-with-representative-art-qa',
  registration: { profiles: 28, coverage: 35840, approved: 35840, pending: 0, generatable: 35840, resources: 63 },
  files: { ...candidateProvenance.files, ...validated.approval.evidence, [evolutionChainsCompleteApprovalPath]: validated.sha256 },
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
console.log(`Approved ${approved.artVersion}: 28 × 1280 = 35840 approved+generatable / 27763 promoted / 63 resources / ${approved.revision}`)
