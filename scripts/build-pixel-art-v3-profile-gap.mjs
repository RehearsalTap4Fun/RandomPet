import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const basePath = 'packages/asset-catalog/pixel/v3/approved-1.3.0/catalog.approved.json'
const baseProvenancePath = 'packages/asset-catalog/pixel/v3/approved-1.3.0/provenance.json'
const packagePath = 'packages/asset-catalog/pixel/v3/profile-gap-1.3.1'
const distPath = 'dist/pixel-art/v3-profile-gap-candidate'
const layerPath = 'docs/qa/pixel-profile-gap/orange-white-standard-sleepy-almond-parted-mouth-64.png'
const sourcePath = 'docs/art/pixel-profile-gap/solid/orange-white-standard-sleepy-almond-parted-mouth.png'
const reportPath = 'docs/qa/pixel-profile-gap/report.json'
const generationPath = 'docs/art/pixel-profile-gap/generation.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

const baseBytes = await read(basePath)
const base = JSON.parse(baseBytes)
assert.equal(base.artVersion, '1.3.0')
assert.equal(base.coverage.length, 2016)
assert.equal(base.generatable.length, 2016)
const report = JSON.parse(await read(reportPath))
assert.equal(report.status, 'engineering-passed-art-review-pending')
assert.equal(report.samples.length, 6)
const layerBytes = await read(layerPath)
assert.equal(sha(layerBytes), '10d12c620bc4520ffeb331edd6adef8079d08b829f7ab8ed2bbda431004478c2')
const sourceBytes = await read(sourcePath)
assert.equal(sha(sourceBytes), report.source.selectedSource.sha256)

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-profile-gap')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, canonicalJson, resolvePixelArtV3, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(base)

const resources = structuredClone(base.resources)
const resourceBytes = new Map()
for (const [id, resource] of Object.entries(base.resources)) resourceBytes.set(id, await read(`packages/asset-catalog/pixel/v3/approved-1.3.0/${resource.path}`))
const resourceId = `layer-${sha(layerBytes).slice(0, 16)}`
assert.ok(!Object.hasOwn(resources, resourceId))
resources[resourceId] = { path: `assets/${resourceId}.png`, sha256: sha(layerBytes), width: 64, height: 64 }
resourceBytes.set(resourceId, layerBytes)

const sourceProfile = base.profiles.find(profile => profile.id === 'standard-sleepy-almond-small-fangs')
assert.ok(sourceProfile)
const profile = structuredClone(sourceProfile)
profile.id = 'standard-sleepy-almond-parted-mouth'
profile.expression = 'parted-mouth'
profile.steps.find(step => step.slot === 'body').resources['parted-mouth'] = resourceId
const profiles = [...base.profiles, profile]

const values = {
  crown: ['none', 'dragon-horns', 'antlers', 'halo'], ears: ['none', 'fin-ears'],
  neck: ['none', 'small-lion-mane', 'frill-neck'], back: ['none', 'small-wings', 'feathered-wings', 'dragon-wings'],
  tailTip: ['none', 'flame-tail', 'forked-tail-tip'],
}
const names = { none: '无', 'dragon-horns': '龙角', antlers: '鹿角', halo: '光环', 'fin-ears': '鳍耳',
  'small-lion-mane': '小狮鬃', 'frill-neck': '颈膜', 'small-wings': '小翅膀', 'feathered-wings': '羽翼',
  'dragon-wings': '龙翼', 'flame-tail': '焰尾', 'forked-tail-tip': '分叉尾尖' }
const added = []
let stateIndex = 0
for (const crown of values.crown) for (const ears of values.ears) for (const neck of values.neck) for (const back of values.back) for (const tailTip of values.tailTip) {
  const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
    expression: profile.expression, crown, ears, neck, back, tailTip }
  added.push({ id: `profile-gap-s${String(stateIndex + 1).padStart(3, '0')}`,
    label: `${profile.body} · ${profile.eyes} · ${profile.expression} · ${[crown, ears, neck, back, tailTip].map(value => names[value]).join('＋')}`,
    phenotype, profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64) })
  stateIndex++
}
assert.equal(added.length, 288)
const coverage = [...base.coverage, ...added]
const evidence = { ...base.evidence }
for (const file of [basePath, baseProvenancePath, layerPath, sourcePath, reportPath, generationPath,
  'docs/art/pixel-profile-gap/build-review.mjs', 'docs/qa/pixel-profile-gap/nutri-manifest.json']) evidence[file] = sha(await read(file))
const content = { schemaVersion: 'pixel-art-catalog-v3', styleId: base.styleId, artVersion: '1.3.1-candidate.1', rendererVersion: base.rendererVersion,
  size: base.size, resources, profiles, coverage, generatable: base.generatable, evidence }
const temporary = requirePixelArtCatalogV3({ ...content, revision: '0'.repeat(64) })
const layers = {}
for (const [id, bytes] of resourceBytes) layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
for (const row of added) row.rgbaSha256 = sha(composePixelArt(resolvePixelArtV3(row.phenotype, temporary), layers))
const catalog = requirePixelArtCatalogV3({ ...content, revision: sha(canonicalJson(content)) })
const catalogBytes = Buffer.from(serialized(catalog))
const provenance = { schemaVersion: 'pixel-art-profile-gap-provenance-v1', status: 'candidate-art-approved-promotion-pending', runtimeEnabled: false,
  base: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: evidence[baseProvenancePath] },
  candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  registration: { profiles: profiles.length, addedProfiles: 1, statesPerAddedProfile: 288, coverage: coverage.length, approved: base.coverage.length, pending: added.length, resources: Object.keys(resources).length },
  files: evidence }
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
console.log(`Profile-gap candidate ${catalog.artVersion}: 8 profiles / 2304 coverage / 2016 approved / 288 pending / 23 resources / ${catalog.revision}`)
