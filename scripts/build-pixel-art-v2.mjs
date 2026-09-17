import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import { approvalPath, validateApproval } from './pixel-art-v2-approval.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'packages/asset-catalog/pixel/v2')
const dist = path.join(root, 'dist/pixel-art/v2-candidate')
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-v2')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const expectedV1Revision = '5d2b92c990ef571d71ee5820e76eb99880988bc57e70d581542e7fd593bceff4'
const expectedV1Sha256 = '694b9c7ce955c17b5ca48bd4ca4db0f6c555e1b31b01e80fab9e0bfa47588515'
const expectedStage3ReportSha256 = 'fe56022836fd0c3243cbdd0d0b7ffebcf8648f0c06941c727342c6cb9b4aaad8'

await fs.mkdir(temp, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: {
    catalog: 'packages/asset-catalog/src/pixel-art-catalog-v2.ts',
    canonical: 'packages/generator-core/src/canonical-json.ts',
    phenotype: 'packages/generator-core/src/feline-phenotype-v2.ts',
  },
  outdir: temp,
  bundle: true,
  format: 'esm',
  platform: 'node',
})
const { requirePixelArtCatalogV2 } = await import(pathToFileURL(path.join(temp, 'catalog.js')).href)
const { canonicalJson } = await import(pathToFileURL(path.join(temp, 'canonical.js')).href)
const { phenotypeV2FromV1 } = await import(pathToFileURL(path.join(temp, 'phenotype.js')).href)

const v1Path = 'packages/asset-catalog/pixel/v1/catalog.approved.json'
const stage3Path = 'docs/qa/flat-source-trial/stage3/report.json'
const stage3ScriptPath = 'scripts/review-pixel-stage3.mjs'
const v1 = await readJson(v1Path)
const stage3 = await readJson(stage3Path)
assert.equal(v1.schemaVersion, 'pixel-art-catalog-v1')
assert.equal(v1.artVersion, '1.1.0')
assert.equal(v1.revision, expectedV1Revision, 'Approved v1 catalog revision changed')
assert.equal(v1.coverage.length, 14)
assert.equal(v1.generatable.length, 14)
assert.equal(stage3.schemaVersion, 'pixel-stage3-qa-v1')
assert.equal(stage3.status, 'candidate-review-pending')
assert.equal(stage3.rendererVersion, 'pixel-rgba-v1')
assert.equal(stage3.samples.length, 7)

const provenance = {
  schemaVersion: 'pixel-art-provenance-v2',
  upstream: {
    v1: { path: v1Path, artVersion: v1.artVersion, revision: expectedV1Revision, sha256: expectedV1Sha256 },
    stage3: {
      reportPath: stage3Path,
      reportSha256: expectedStage3ReportSha256,
      nutriCommit: stage3.nutriCommit,
      nutriSourceHashes: stage3.nutriSourceHashes,
      profilePath: stage3.profileFile,
      profileSha256: stage3.profileSha256,
      reviewScriptPath: stage3ScriptPath,
      reviewScriptSha256: stage3.reviewScriptSha256,
    },
  },
  files: {},
}

async function pin(file, expected) {
  const bytes = await fs.readFile(path.join(root, file))
  const actual = sha(bytes)
  if (expected && actual !== expected) throw new Error(`Evidence hash changed: ${file}`)
  provenance.files[file] = actual
  return actual
}

await pin(v1Path, provenance.upstream.v1.sha256)
await pin(stage3Path, provenance.upstream.stage3.reportSha256)
await pin(stage3.profileFile, stage3.profileSha256)
await pin(stage3ScriptPath, stage3.reviewScriptSha256)
for (const [file, expected] of Object.entries(stage3.sourceAssets)) await pin(file, expected)
for (const [file, expected] of Object.entries(stage3.inputHashes)) await pin(file, expected)

// Retained candidate artifacts must never be replaced with different bytes.
async function retain(file, bytes) {
  try { assert.ok((await fs.readFile(file)).equals(Buffer.from(bytes)), `Retained artifact changed: ${file}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.writeFile(file, bytes) }
}
await fs.mkdir(path.join(out, 'assets'), { recursive: true })
const resources = {}
const copiedByHash = new Map()

async function resource(file, expected) {
  const bytes = await fs.readFile(path.join(root, file))
  const actual = sha(bytes)
  if (actual !== expected) throw new Error(`Layer changed: ${file}`)
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 64 || info.height !== 64) throw new Error(`Invalid dimensions: ${file}`)
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0 && data[i] !== 255) throw new Error(`Invalid alpha: ${file}`)
  provenance.files[file] = actual
  if (copiedByHash.has(actual)) return copiedByHash.get(actual)
  const id = `layer-${actual.slice(0, 16)}`
  const relative = `assets/${id}.png`
  await retain(path.join(out, relative), bytes)
  resources[id] = { path: relative, sha256: actual, width: 64, height: 64 }
  copiedByHash.set(actual, id)
  return id
}

for (const entry of Object.values(v1.resources)) {
  await resource(`packages/asset-catalog/pixel/v1/${entry.path}`, entry.sha256)
}

const stage3Resources = {}
for (const [body, profile] of Object.entries(stage3.profiles)) {
  stage3Resources[body] = {}
  for (const [name, layer] of Object.entries(profile.layers)) {
    stage3Resources[body][name] = await resource(layer.path, layer.pngSha256)
  }
}

const migratedProfiles = v1.profiles.map(profile => ({
  ...profile,
  id: `${profile.id}-round`,
  eyes: 'round',
}))
const step = (slot, target, resources = {}, clear = [], occlusion = []) => ({ slot, target, resources, clear, occlusion })
function stage3Profile(body, eyes) {
  const source = stage3.profiles[body]
  const ids = stage3Resources[body]
  const bodyName = eyes === 'round' ? `orange-white-round-small-fangs-${body}` : source.bodyId
  return {
    id: `${body}-${eyes}-small-fangs`,
    body,
    coat: 'orange-white',
    eyes,
    expression: 'small-fangs',
    steps: [
      step('back', 'frame'),
      step('crown', 'frame', { 'dragon-horns': ids['dragon-horns'] }),
      step('body', 'subject', { 'small-fangs': ids[bodyName] }),
      step('ears', 'subject', { 'fin-ears': ids['orange-white-fin-ears'] }, source.clear.ears),
      step('tailTip', 'frame', { 'flame-tail': ids['flame-tail'] }, [source.clear.tailTip]),
      step('neck', 'subject', { 'small-lion-mane': ids['orange-white-small-lion-mane'] }, [], [source.faceOcclusion]),
    ],
  }
}
const addedProfiles = [
  stage3Profile('standard', 'sleepy-almond'),
  stage3Profile('shortleg-round', 'sleepy-almond'),
  stage3Profile('slender-tall', 'round'),
  stage3Profile('slender-tall', 'sleepy-almond'),
]

const migrated = v1.coverage.map(entry => ({
  ...entry,
  phenotype: phenotypeV2FromV1(entry.phenotype),
  profileId: `${entry.profileId}-round`,
}))
const labels = {
  'standard-sleepy-base': '标准体型 · 半眯眼基础',
  'shortleg-sleepy-base': '短腿圆身体型 · 半眯眼基础',
  'slender-round-base': '修长高挑体型 · 圆眼基础',
  'slender-sleepy-base': '修长高挑体型 · 半眯眼基础',
  'standard-sleepy-ears-mane': '标准体型 · 半眯眼鳍耳鬃毛',
  'shortleg-sleepy-horns-flame': '短腿圆身体型 · 半眯眼龙角焰尾',
  'slender-sleepy-stack': '修长高挑体型 · 半眯眼完整异化',
}
const pending = stage3.samples.map(sample => ({
  id: sample.id,
  label: labels[sample.id],
  phenotype: sample.phenotype,
  profileId: sample.profileId,
  review: sample.review,
  rgbaSha256: sample.rgbaSha256,
}))
assert.ok(pending.every(entry => entry.review === 'pending'))
const coverage = [...migrated, ...pending]
const used = new Set([...migratedProfiles, ...addedProfiles].flatMap(profile => profile.steps.flatMap(operation => Object.values(operation.resources))))
const data = {
  schemaVersion: 'pixel-art-catalog-v2',
  styleId: 'pixel-flat',
  artVersion: '1.2.0-candidate.1',
  rendererVersion: 'pixel-rgba-v1',
  size: 64,
  resources: Object.fromEntries(Object.entries(resources).filter(([id]) => used.has(id))),
  profiles: [...migratedProfiles, ...addedProfiles],
  coverage,
  generatable: migrated.map(entry => entry.id),
  evidence: {
    [v1Path]: provenance.upstream.v1.sha256,
    [stage3Path]: provenance.upstream.stage3.reportSha256,
    [stage3.profileFile]: stage3.profileSha256,
    [stage3ScriptPath]: stage3.reviewScriptSha256,
    ...stage3.sourceAssets,
  },
}
const catalog = { ...data, revision: sha(canonicalJson(data)) }
requirePixelArtCatalogV2(catalog)

const approvalBytes = await fs.readFile(path.join(root, approvalPath))
const validated = await validateApproval(approvalBytes, { candidate: catalog, candidateBytes: Buffer.from(serialized(catalog)), provenanceBytes: Buffer.from(serialized(provenance)), stage3, read: file => fs.readFile(path.join(root, file)) })
await retain(path.join(out, 'catalog.candidate.json'), serialized(catalog))
await retain(path.join(out, 'provenance.json'), serialized(provenance))
// Preserve the historical portable candidate byte-for-byte as well.
await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
await retain(path.join(dist, 'catalog.json'), serialized(catalog))
await retain(path.join(dist, 'provenance.json'), serialized(provenance))
for (const entry of Object.values(catalog.resources)) await retain(path.join(dist, entry.path), await fs.readFile(path.join(out, entry.path)))

console.log(`Pixel art v2: candidate ${catalog.coverage.length} combinations / ${catalog.generatable.length} generatable / ${Object.keys(catalog.resources).length} layers.`)

const approvedData = { ...data, artVersion: '1.2.0',
  coverage: coverage.map(entry => ({ ...entry, review: 'approved' })),
  generatable: coverage.map(entry => entry.id),
  evidence: { ...data.evidence, [approvalPath]: validated.sha256 },
}
const approved = { ...approvedData, revision: sha(canonicalJson(approvedData)) }
requirePixelArtCatalogV2(approved)
const approvedProvenance = { ...provenance,
  approval: { path: approvalPath, sha256: validated.sha256, candidate: validated.approval.candidate },
  files: { ...provenance.files, [approvalPath]: validated.sha256 },
}
await fs.writeFile(path.join(out, 'catalog.approved.json'), serialized(approved))
await fs.writeFile(path.join(out, 'provenance.approved.json'), serialized(approvedProvenance))
const approvedDist = path.join(root, 'dist/pixel-art/v2-approved')
await fs.mkdir(path.join(approvedDist, 'assets'), { recursive: true })
await fs.writeFile(path.join(approvedDist, 'catalog.json'), serialized(approved))
await fs.writeFile(path.join(approvedDist, 'provenance.json'), serialized(approvedProvenance))
for (const entry of Object.values(approved.resources)) await fs.copyFile(path.join(out, entry.path), path.join(approvedDist, entry.path))
console.log(`Pixel art v2: approved ${approved.coverage.length} combinations / ${approved.generatable.length} generatable / revision ${approved.revision}.`)
