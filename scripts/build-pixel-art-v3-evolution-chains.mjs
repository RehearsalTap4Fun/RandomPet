import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.5.0'
const basePath = `${baseRoot}/catalog.approved.json`
const baseProvenancePath = `${baseRoot}/provenance.json`
const packagePath = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.0'
const distPath = 'dist/pixel-art/v3-evolution-chains-candidate'
const approvalPath = 'docs/qa/pixel-evolution-chains/approval.json'
const reportPath = 'docs/qa/pixel-evolution-chains/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const baseBytes = await read(basePath)
const baseProvenanceBytes = await read(baseProvenancePath)
const approvalBytes = await read(approvalPath)
const reportBytes = await read(reportPath)
const base = JSON.parse(baseBytes)
const approval = JSON.parse(approvalBytes)
assert.equal(base.artVersion, '1.5.0')
assert.equal(base.profiles.length, 28)
assert.equal(base.coverage.length, 8_064)
assert.equal(base.generatable.length, 8_064)
assert.equal(Object.keys(base.resources).length, 58)
assert.equal(approval.schemaVersion, 'pixel-evolution-chain-approval-v2')
assert.equal(approval.state, 'art-approved-registration-pending')
assert.equal(approval.baseCatalog, basePath)
assert.equal(approval.scope.length, 5)

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-chains-candidate')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, canonicalJson, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(base)

const resources = structuredClone(base.resources)
const resourceBytes = new Map()
for (const [id, resource] of Object.entries(base.resources)) {
  const bytes = await read(`${baseRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  resourceBytes.set(id, bytes)
}

const approvedById = new Map()
const newResourceIds = {}
for (const item of approval.scope) {
  const bytes = await read(item.pixelLayer)
  assert.equal(sha(bytes), item.pixelSha256, item.id)
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 64, item.id)
  assert.equal(metadata.height, 64, item.id)
  assert.equal(metadata.hasAlpha, true, item.id)
  const resourceId = `layer-${item.pixelSha256.slice(0, 16)}`
  assert.ok(!Object.hasOwn(resources, resourceId), `Resource collision: ${resourceId}`)
  resources[resourceId] = { path: `assets/${resourceId}.png`, sha256: item.pixelSha256, width: 64, height: 64 }
  resourceBytes.set(resourceId, bytes)
  approvedById.set(item.id, item)
  newResourceIds[item.id] = resourceId
}
assert.equal(Object.keys(resources).length, 63)

const traitsBySlot = {
  crown: ['crystal-horns'],
  ears: ['feathered-ears', 'celestial-ears'],
  neck: ['sunburst-ruff'],
  tailTip: ['phoenix-tail'],
}
const profiles = base.profiles.map(profile => {
  const next = structuredClone(profile)
  for (const [slot, ids] of Object.entries(traitsBySlot)) {
    const step = next.steps.find(item => item.slot === slot)
    assert.ok(step, `${profile.id}/${slot}`)
    for (const id of ids) step.resources[id] = newResourceIds[id]
  }
  const neck = next.steps.find(item => item.slot === 'neck')
  neck.variants ??= {}
  neck.variants['sunburst-ruff'] = {
    target: 'subject', clear: [],
    occlusion: structuredClone(approvedById.get('sunburst-ruff').occlusionByBody[profile.body]),
  }
  return next
})

const basePhenotype = {
  schemaVersion: 'feline-phenotype-v2', body: 'standard', coat: 'orange-white', eyes: 'round', expression: 'parted-mouth',
  crown: 'none', ears: 'none', neck: 'none', back: 'none', tailTip: 'none',
}
const fullStack = { crown: 'crystal-horns', ears: 'celestial-ears', neck: 'sunburst-ruff', back: 'feathered-wings', tailTip: 'phoenix-tail' }
const sampleDefinitions = [
  ['晶角单件', { crown: 'crystal-horns' }],
  ['羽翅耳单件', { ears: 'feathered-ears' }],
  ['星辉翼耳单件', { ears: 'celestial-ears' }],
  ['日冕颈饰单件', { neck: 'sunburst-ruff' }],
  ['凤凰尾单件', { tailTip: 'phoenix-tail' }],
  ['橘白标准满配', fullStack],
  ['橘白短腿满配', { ...fullStack, body: 'shortleg-round', expression: 'small-fangs' }],
  ['橘白细长满配', { ...fullStack, body: 'slender-tall', expression: 'small-fangs' }],
  ['棕虎斑满配', { ...fullStack, coat: 'brown-tabby', eyes: 'sleepy-almond' }],
  ['燕尾服满配', { ...fullStack, coat: 'tuxedo', expression: 'small-fangs' }],
  ['三花满配', { ...fullStack, coat: 'calico', eyes: 'sleepy-almond', expression: 'small-fangs' }],
  ['重点色满配', { ...fullStack, coat: 'colorpoint' }],
  ['金豹点满配', { ...fullStack, coat: 'rosetted', eyes: 'sleepy-almond' }],
]
assert.equal(sampleDefinitions.length, 13)
const profileFor = phenotype => profiles.find(profile => profile.body === phenotype.body && profile.coat === phenotype.coat
  && profile.eyes === phenotype.eyes && profile.expression === phenotype.expression)
const added = sampleDefinitions.map(([label, patch], index) => {
  const phenotype = { ...basePhenotype, ...patch }
  const profile = profileFor(phenotype)
  assert.ok(profile, `Missing profile for ${label}`)
  return { id: `evolution-chains-s${String(index + 1).padStart(2, '0')}`, label, phenotype,
    profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64) }
})

const evidence = {
  ...base.evidence,
  [basePath]: sha(baseBytes),
  [baseProvenancePath]: sha(baseProvenanceBytes),
  [approvalPath]: sha(approvalBytes),
  [reportPath]: sha(reportBytes),
  'scripts/build-pixel-art-v3-evolution-chains.mjs': sha(await read('scripts/build-pixel-art-v3-evolution-chains.mjs')),
}
const content = {
  schemaVersion: 'pixel-art-catalog-v3', styleId: base.styleId, artVersion: '1.6.0-candidate.1',
  rendererVersion: base.rendererVersion, size: base.size, resources, profiles,
  coverage: [...base.coverage, ...added], generatable: base.generatable, evidence,
}
const temporary = requirePixelArtCatalogV3({ ...content, revision: '0'.repeat(64) })
const layers = {}
for (const [id, bytes] of resourceBytes) layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
const profileById = new Map(temporary.profiles.map(profile => [profile.id, profile]))
const planFor = row => {
  const operations = []; const planResources = {}; const profile = profileById.get(row.profileId)
  assert.ok(profile, row.id)
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? row.phenotype.expression : row.phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `${row.id}/${step.slot}/${selected}`)
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    planResources[resourceId] = temporary.resources[resourceId]
  }
  return { size: 64, operations, resources: planResources, key: row.id, review: row.review }
}
for (const row of added) row.rgbaSha256 = sha(composePixelArt(planFor(row), layers))

const catalog = requirePixelArtCatalogV3({ ...content, coverage: [...base.coverage, ...added], revision: sha(canonicalJson({ ...content, coverage: [...base.coverage, ...added] })) })
const catalogBytes = Buffer.from(serialized(catalog))
const provenance = {
  schemaVersion: 'pixel-art-evolution-chains-candidate-provenance-v1', status: 'candidate-technical-validation', runtimeEnabled: false,
  validationMode: 'representative-samples',
  base: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes),
    provenancePath: baseProvenancePath, provenanceSha256: sha(baseProvenanceBytes) },
  approval: { path: approvalPath, sha256: sha(approvalBytes), decision: approval.decision },
  candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  registration: { profiles: 28, baseCoverage: 8_064, sampledPending: 13, catalogCoverage: 8_077,
    theoreticalCoverage: 35_840, generatedForValidation: 13, resources: 63 },
  files: evidence,
}
const outputs = new Map()
for (const directory of [packagePath, distPath]) {
  outputs.set(`${directory}/${directory === packagePath ? 'catalog.candidate.json' : 'catalog.json'}`, catalogBytes)
  outputs.set(`${directory}/provenance.json`, Buffer.from(serialized(provenance)))
  for (const [id, bytes] of resourceBytes) outputs.set(`${directory}/${resources[id].path}`, bytes)
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
console.log(`Evolution-chain candidate ${catalog.artVersion}: 28 profiles / 8077 coverage metadata / 13 generated samples / 63 resources / ${catalog.revision}`)
