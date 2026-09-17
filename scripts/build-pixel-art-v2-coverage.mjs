import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const packagePath = 'packages/asset-catalog/pixel/v2/coverage-standard-small-fangs-round'
const distPath = 'dist/pixel-art/v2-coverage-standard-small-fangs-round'
const basePath = 'packages/asset-catalog/pixel/v2/catalog.approved.json'
const baseProvenancePath = 'packages/asset-catalog/pixel/v2/provenance.approved.json'
const baselinePath = 'docs/qa/pixel-standard-small-fangs-coverage/baseline.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const json = async file => JSON.parse(await read(file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-coverage')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV2, canonicalJson, resolvePixelArtV2, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)

const baseBytes = await read(basePath)
assert.equal(sha(baseBytes), 'cf9c14c464b2bcf31802f8927c2453926200971b821c4be666362669c6090732', 'Base approved bytes changed')
const base = requirePixelArtCatalogV2(JSON.parse(baseBytes))
assert.equal(base.artVersion, '1.2.0')
assert.equal(base.revision, '5b3a92c67957fda3bfe12f6f598e631e1942cc3303d07775fee4bc33aea3bd36')
assert.equal(base.coverage.length, 21)
assert.equal(base.generatable.length, 21)
const baseProvenance = await json(baseProvenancePath)
assert.equal(sha(await read(baseProvenancePath)), '69c9a2bbea4d6f71c62ab0b471f47161e9ade55eadf5ffb7ae7124cc3dfd961b')
const baseline = await json(baselinePath)
const files = {}
async function pin(file, expected) {
  const hash = sha(await read(file))
  if (expected) assert.equal(hash, expected, `Pinned evidence changed: ${file}`)
  files[file] = hash
  return hash
}
// Pin prior releases and transitive source evidence before producing any output.
for (const [file, hash] of Object.entries(baseline.files)) await pin(file, hash)
for (const [file, hash] of Object.entries({ ...baseProvenance.files, ...base.evidence })) await pin(file, hash)
for (const file of [baselinePath, basePath, baseProvenancePath,
  'packages/renderer-canvas/src/pixel-art-render.ts', 'packages/asset-catalog/src/pixel-art-catalog.ts',
  'packages/asset-catalog/src/pixel-art-catalog-v2.ts', 'packages/generator-core/src/feline-phenotype-v2.ts',
  'packages/generator-core/src/feline-phenotype.ts', 'packages/generator-core/src/canonical-json.ts']) await pin(file)
const layers = {}
for (const [id, resource] of Object.entries(base.resources)) {
  const file = `packages/asset-catalog/pixel/v2/${resource.path}`
  await pin(file, resource.sha256)
  layers[id] = new Uint8ClampedArray(await sharp(await read(file)).ensureAlpha().raw().toBuffer())
}
const template = base.coverage.find(row => row.id === 'standard-base')
assert.equal(template.profileId, 'standard-small-fangs-round')
const parts = { horns: ['crown', 'dragon-horns', '龙角'], ears: ['ears', 'fin-ears', '鳍耳'], mane: ['neck', 'small-lion-mane', '鬃毛'], flame: ['tailTip', 'flame-tail', '焰尾'] }
const combinations = ['horns', 'flame', 'horns-flame', 'horns-ears', 'horns-mane', 'ears-flame', 'mane-flame', 'horns-ears-mane', 'horns-ears-flame', 'horns-mane-flame', 'ears-mane-flame']
const added = combinations.map(combination => {
  const selected = combination.split('-'), phenotype = { ...template.phenotype }
  for (const part of selected) phenotype[parts[part][0]] = parts[part][1]
  return { id: `standard-${combination}`, label: `标准体型 · 圆眼小尖牙 · ${selected.map(p => parts[p][2]).join('＋')}`,
    phenotype, profileId: template.profileId, review: 'pending', rgbaSha256: '0'.repeat(64) }
})
const { revision: baseRevision, ...baseContent } = base
const content = { ...baseContent, artVersion: '1.2.1-candidate.1', coverage: [...base.coverage, ...added], evidence: { ...base.evidence, ...files } }
for (const row of added) row.rgbaSha256 = sha(composePixelArt(resolvePixelArtV2(row.phenotype, { ...content, revision: '0'.repeat(64) }), layers))
const catalog = requirePixelArtCatalogV2({ ...content, revision: sha(canonicalJson(content)) })
assert.equal(catalog.coverage.length, 32)
assert.equal(catalog.coverage.filter(row => row.review === 'pending').length, 11)
assert.deepEqual(catalog.generatable, base.generatable)
assert.equal(Object.keys(catalog.resources).length, 15)
for (const row of catalog.coverage) assert.equal(sha(composePixelArt(resolvePixelArtV2(row.phenotype, catalog), layers)), row.rgbaSha256, row.id)
const provenance = { schemaVersion: 'pixel-art-coverage-provenance-v1', status: 'candidate-review-pending', runtimeEnabled: false,
  base: { path: basePath, artVersion: base.artVersion, revision: baseRevision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: files[baseProvenancePath] },
  candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(serialized(catalog)) },
  profileId: template.profileId, addedIds: added.map(row => row.id), files }
// Preflight every retained destination before writing any missing artifact.
const outputs = new Map()
for (const directory of [packagePath, distPath]) {
  outputs.set(`${directory}/${directory === packagePath ? 'catalog.candidate.json' : 'catalog.json'}`, Buffer.from(serialized(catalog)))
  outputs.set(`${directory}/provenance.json`, Buffer.from(serialized(provenance)))
  for (const resource of Object.values(catalog.resources)) outputs.set(`${directory}/${resource.path}`, await read(`packages/asset-catalog/pixel/v2/${resource.path}`))
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
// New example identity keeps the historical dist/index.html byte-for-byte.
await fs.copyFile(path.join(root, 'docs/integration/examples/pixel-art-coverage.html'), path.join(root, 'dist/pixel-art/coverage.html'))
console.log(`Coverage candidate ${catalog.artVersion}: 32 coverage / 21 approved and generatable / 11 pending / 15 resources / ${catalog.revision}`)
