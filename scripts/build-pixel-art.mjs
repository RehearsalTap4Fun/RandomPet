import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'packages/asset-catalog/pixel/v1')
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel')
await fs.mkdir(temp, { recursive: true }); await fs.mkdir(path.join(out, 'assets'), { recursive: true })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
await build({ absWorkingDir: root, entryPoints: ['packages/asset-catalog/src/pixel-art-catalog.ts'], outfile: path.join(temp, 'catalog.mjs'), bundle: true, format: 'esm', platform: 'node' })
const { canonicalJson, requirePixelArtCatalog } = await import(pathToFileURL(path.join(temp, 'catalog.mjs')).href)
const firstPath = 'docs/qa/flat-source-trial/consumer/approval.json', secondPath = 'docs/qa/flat-source-trial/stage2/report.json'
const first = await read(firstPath), second = await read(secondPath), firstReport = await read('docs/qa/flat-source-trial/consumer/report.json')
const authored = await read(second.profileFile)
const provenance = { schemaVersion: 'pixel-art-provenance-v1', nutriCommit: first.nutriCommit, upstreamCode: second.nutriSourceHashes, files: {} }
async function pin(file, expected) {
  const actual = sha(await fs.readFile(path.join(root, file)))
  if (expected && actual !== expected) throw new Error(`Evidence hash changed: ${file}`)
  provenance.files[file] = actual
  return actual
}
await pin('docs/qa/flat-source-trial/consumer/report.json', first.reportSha256)
await pin(second.profileFile, second.profileSha256)
for (const [id, hash] of Object.entries(first.sourceAssets)) await pin(`docs/art/flat-source-trial/solid/${id}.png`, hash)
for (const [id, hash] of Object.entries(second.sourceAssets)) await pin(`docs/art/flat-source-trial/stage2/solid/${id}`, hash)
await pin('scripts/review-pixel-stage2.mjs', second.reviewScriptSha256)
const allResources = {}, copiedByHash = new Map()
async function layer(folder, name, hash) {
  const file = `${folder}/${name}.png`, bytes = await fs.readFile(path.join(root, file))
  if (sha(bytes) !== hash) throw new Error(`Layer changed: ${file}`)
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 64 || info.height !== 64) throw new Error(`Invalid dimensions: ${file}`)
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0 && data[i] !== 255) throw new Error(`Invalid alpha: ${file}`)
  provenance.files[file] = hash
  if (copiedByHash.has(hash)) return copiedByHash.get(hash)
  const id = `layer-${hash.slice(0, 16)}`
  const relative = `assets/${id}.png`
  await fs.writeFile(path.join(out, relative), bytes)
  allResources[id] = { path: relative, sha256: hash, width: 64, height: 64 }
  copiedByHash.set(hash, id)
  return id
}
function profile(id, body, expression, ids, clear, face = []) {
  const step = (slot, target, resources = {}, polygons = [], occlusion = []) => ({ slot, target, resources, clear: polygons, occlusion })
  return { id, body, coat: 'orange-white', expression, steps: [
    step('back', 'frame'), step('crown', 'frame', { 'dragon-horns': ids.horns }),
    step('body', 'subject', { [expression]: ids.body }),
    step('ears', 'subject', ids.ears ? { 'fin-ears': ids.ears } : {}, clear.ears),
    step('tailTip', 'frame', { 'flame-tail': ids.tail }, [clear.tailTip]),
    step('neck', 'subject', ids.mane ? { 'small-lion-mane': ids.mane } : {}, [], face.length ? [face] : []),
  ] }
}
const firstManifest = await read('docs/qa/flat-source-trial/consumer/flat/manifest.json')
const firstFolder = 'docs/qa/flat-source-trial/consumer/flat'
const ids = {}
for (const [key, name] of Object.entries({ body: 'orange-white-parted-mouth', horns: 'dragon-horns', tail: 'flame-tail' })) ids[key] = await layer(firstFolder, name, firstReport.layerHashes.flat[name])
const profiles = [profile('standard-parted-mouth', 'standard', 'parted-mouth', ids, firstManifest.clear)]
const toPhenotype = (spec, body) => ({ schemaVersion: 'feline-phenotype-v1', body, ...spec })
const coverage = first.samples.map(s => ({ id: `approved-${s.id}`, label: `标准体型 · ${({ base: '微张嘴', horns: '小龙角', flame: '焰尾', both: '龙角＋焰尾' })[s.id]}`, phenotype: toPhenotype(s.spec, 'standard'), profileId: 'standard-parted-mouth', review: 'approved', rgbaSha256: s.rgbaSha256 }))
const evidence = { [firstPath]: await pin(firstPath) }
const makeCatalog = (version, usedProfiles, usedCoverage, evidence) => {
  const used = new Set(usedProfiles.flatMap(p => p.steps.flatMap(s => Object.values(s.resources))))
  const data = { schemaVersion: 'pixel-art-catalog-v1', styleId: 'pixel-flat', artVersion: version, rendererVersion: 'pixel-rgba-v1', size: 64,
    resources: Object.fromEntries(Object.entries(allResources).filter(([id]) => used.has(id))), profiles: usedProfiles, coverage: usedCoverage,
    generatable: usedCoverage.filter(c => c.review === 'approved').map(c => c.id), evidence }
  const catalog = { ...data, revision: sha(canonicalJson(data)) }
  requirePixelArtCatalog(catalog)
  return catalog
}
const legacyApproved = makeCatalog('1.0.0', [...profiles], [...coverage], evidence)
for (const body of ['standard', 'shortleg-round']) {
  const p = second.profiles[body], map = {}, folder = `docs/qa/flat-source-trial/stage2/layers/${body}`
  for (const [key, name] of Object.entries({ body: 'orange-white-small-fangs', horns: 'dragon-horns', tail: 'flame-tail', ears: 'orange-white-fin-ears', mane: 'orange-white-small-lion-mane' })) map[key] = await layer(folder, name, p.layerHashes[name])
  const sourceProfile = authored.profiles.find(p => p.id === body)
  const face = sourceProfile.faceOcclusion.map(point => point.map(n => n * 62 / 1254 + 1))
  profiles.push(profile(`${body}-small-fangs`, body, 'small-fangs', map, p.clear, face))
  for (const s of second.samples.filter(s => s.body === body && s.experimentalGeometry && s.spec.expression === 'small-fangs')) {
    coverage.push({ id: `${body}-${s.id}`, label: `${body === 'standard' ? '标准' : '短腿'}体型 · ${s.title}`, phenotype: toPhenotype(s.spec, body), profileId: `${body}-small-fangs`, review: 'pending', rgbaSha256: s.rgbaSha256 })
  }
}
const candidate = makeCatalog('1.1.0-candidate.1', profiles, coverage, { ...evidence, [secondPath]: await pin(secondPath), [second.profileFile]: second.profileSha256 })
const approvalPath = 'docs/qa/flat-source-trial/stage2/approval.json'
const approval = await read(approvalPath)
assert.equal(approval.schemaVersion, 'pixel-stage2-approval-v1')
assert.equal(approval.status, 'approved')
assert.equal(approval.reportPath, secondPath)
assert.equal(approval.profilePath, second.profileFile)
await pin(secondPath, approval.reportSha256)
await pin(second.profileFile, approval.profileSha256)
assert.deepEqual(approval.sourceAssets, second.sourceAssets)
const serialized = catalog => JSON.stringify(catalog, null, 2) + '\n'
assert.equal(sha(serialized(legacyApproved)), approval.previousCatalogSha256['catalog.legacy-approved.json'], 'Legacy approved catalog drifted')
assert.equal(sha(serialized(candidate)), approval.previousCatalogSha256['catalog.candidate.json'], 'Reviewed candidate catalog drifted')
assert.deepEqual(approval.samples, candidate.coverage.filter(c => c.review === 'pending').map(({ id, phenotype, profileId, rgbaSha256 }) => ({ id, phenotype, profileId, rgbaSha256 })), 'Approval must match the exact reviewed combinations')
const approved = makeCatalog('1.1.0', profiles, coverage.map(c => ({ ...c, review: 'approved' })), { ...candidate.evidence, [approvalPath]: await pin(approvalPath) })
const catalogs = { approved, candidate, 'legacy-approved': legacyApproved }
for (const [name, catalog] of Object.entries(catalogs)) await fs.writeFile(path.join(out, `catalog.${name}.json`), serialized(catalog))
await fs.writeFile(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
if (!process.argv.includes('--inventory-only')) {
  const sdk = path.join(root, 'dist/pixel-art/qmonster-pixel.js')
  await build({ absWorkingDir: root, entryPoints: ['packages/incubator-adapter/src/pixel-art-sdk.ts'], outfile: sdk, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
  for (const [name, catalog] of Object.entries(catalogs)) {
    const dest = path.join(root, 'dist/pixel-art', name)
    await fs.mkdir(path.join(dest, 'assets'), { recursive: true })
    await fs.writeFile(path.join(dest, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
    for (const resource of Object.values(catalog.resources)) await fs.copyFile(path.join(out, resource.path), path.join(dest, resource.path))
  }
  await fs.copyFile(path.join(out, 'provenance.json'), path.join(root, 'dist/pixel-art/provenance.json'))
  await fs.copyFile(path.join(root, 'docs/integration/examples/pixel-art.html'), path.join(root, 'dist/pixel-art/index.html'))
}
console.log(`Pixel art: approved ${approved.coverage.length} combinations / ${Object.keys(approved.resources).length} layers; candidate ${candidate.coverage.length} combinations / ${Object.keys(candidate.resources).length} layers.`)
