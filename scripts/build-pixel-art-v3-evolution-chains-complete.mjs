import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const baseRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.0'
const basePath = `${baseRoot}/catalog.approved.json`
const baseProvenancePath = `${baseRoot}/provenance.json`
const candidateRoot = 'packages/asset-catalog/pixel/v3/evolution-chains-1.6.1'
const distRoot = 'dist/pixel-art/v3-evolution-chains-complete-candidate'
const reportPath = 'docs/qa/pixel-evolution-chain-complete/report.json'
const sampleReportPath = 'docs/qa/pixel-evolution-chain-registration/report.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const baseBytes = await read(basePath)
const baseProvenanceBytes = await read(baseProvenancePath)
const sampleReportBytes = await read(sampleReportPath)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-evolution-chains-complete')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalogV3, composePixelArt, phenotypeKeyV2 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const base = requirePixelArtCatalogV3(JSON.parse(baseBytes))
assert.equal(base.artVersion, '1.6.0')
assert.equal(base.coverage.length, 8077)
assert.equal(Object.keys(base.resources).length, 63)

const layers = {}
for (const [id, resource] of Object.entries(base.resources)) {
  const bytes = await read(`${baseRoot}/${resource.path}`)
  assert.equal(sha(bytes), resource.sha256, id)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const planFor = (profile, phenotype, key) => {
  const operations = []; const resources = {}
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]
    assert.ok(resourceId, `${profile.id}/${step.slot}/${selected}`)
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = base.resources[resourceId]
  }
  return { size: 64, operations, resources, key, review: 'pending' }
}

const coverage = structuredClone(base.coverage)
const existingKeys = new Set(coverage.map(row => phenotypeKeyV2(row.phenotype)))
const coverageIds = new Set(coverage.map(row => row.id))
let generated = 0
for (const profile of base.profiles) {
  const options = slot => ['none', ...Object.keys(profile.steps.find(step => step.slot === slot).resources)]
  for (const crown of options('crown')) for (const ears of options('ears')) for (const neck of options('neck')) {
    for (const back of options('back')) for (const tailTip of options('tailTip')) {
      const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
        expression: profile.expression, crown, ears, neck, back, tailTip }
      const key = phenotypeKeyV2(phenotype)
      if (existingKeys.has(key)) continue
      const id = `evolution-chains-${sha(Buffer.from(key)).slice(0, 20)}`
      assert.ok(!coverageIds.has(id), `Coverage ID collision: ${id}`)
      const rgbaSha256 = sha(composePixelArt(planFor(profile, phenotype, id), layers))
      coverage.push({ id, label: `完整覆盖 ${profile.id} ${generated + 1}`, phenotype, profileId: profile.id, review: 'pending', rgbaSha256 })
      existingKeys.add(key); coverageIds.add(id); generated++
      if (generated % 2000 === 0) console.log(`Computed ${generated}/27763 missing coverage digests...`)
    }
  }
}
assert.equal(generated, 27763)
assert.equal(coverage.length, 35840)
assert.equal(existingKeys.size, 35840)

const evidence = { ...base.evidence, [basePath]: sha(baseBytes), [baseProvenancePath]: sha(baseProvenanceBytes), [sampleReportPath]: sha(sampleReportBytes) }
const content = { schemaVersion: base.schemaVersion, styleId: base.styleId, artVersion: '1.6.1-candidate.1', rendererVersion: base.rendererVersion,
  size: base.size, resources: base.resources, profiles: base.profiles, coverage, generatable: base.generatable, evidence }
const catalog = requirePixelArtCatalogV3({ ...content, revision: sha(canonicalJson(content)) })
const catalogBytes = Buffer.from(serialized(catalog))
const report = {
  schemaVersion: 'pixel-evolution-chain-complete-report-v1',
  status: 'mechanical-coverage-complete',
  compactRuntimeContract: { sourceExchangeCommit: '8d357b08af26e23254997609892cced0a780e45c', profileProduct: 1280, profiles: 28 },
  candidate: { path: `${candidateRoot}/catalog.candidate.json`, artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  explicitCoverage: 35840, derivedCoverage: 35840, reusedCoverage: 8077, generatedDigests: 27763,
  resources: 63, renderedPngs: 0, reviewSamples: 13, reviewSampleReport: { path: sampleReportPath, sha256: sha(sampleReportBytes) },
  profileCounts: Object.fromEntries(catalog.profiles.map(profile => [profile.id, catalog.coverage.filter(row => row.profileId === profile.id).length])),
}
assert.ok(Object.values(report.profileCounts).every(count => count === 1280))
const provenance = {
  schemaVersion: 'pixel-art-evolution-chains-complete-candidate-provenance-v1', status: 'candidate-technical-validation', runtimeEnabled: false,
  source: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: sha(baseProvenanceBytes) },
  contract: report.compactRuntimeContract,
  candidate: report.candidate,
  validationMode: 'mechanical-full-grid-with-representative-art-qa',
  registration: { profiles: 28, reusedCoverage: 8077, sampledArtCoverage: 13, generatedDigests: 27763, coverage: 35840, generatable: 8077, resources: 63, renderedPngs: 0 },
  files: evidence,
}
const outputs = new Map([
  [`${candidateRoot}/catalog.candidate.json`, catalogBytes],
  [`${candidateRoot}/provenance.json`, Buffer.from(serialized(provenance))],
  [`${distRoot}/catalog.json`, catalogBytes],
  [`${distRoot}/provenance.json`, Buffer.from(serialized(provenance))],
  [reportPath, Buffer.from(serialized(report))],
])
for (const [directory, sourceDirectory] of [[candidateRoot, baseRoot], [distRoot, baseRoot]]) {
  for (const resource of Object.values(catalog.resources)) outputs.set(`${directory}/${resource.path}`, await read(`${sourceDirectory}/${resource.path}`))
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
console.log(`Complete-grid candidate ${catalog.artVersion}: 28 × 1280 = 35840 coverage / 27763 new digests / 0 new PNGs / ${catalog.revision}`)
