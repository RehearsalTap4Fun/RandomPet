import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const basePath = 'packages/asset-catalog/pixel/v2/approved-1.2.1/catalog.approved.json'
const baseProvenancePath = 'packages/asset-catalog/pixel/v2/approved-1.2.1/provenance.json'
const approvalPath = 'docs/qa/pixel-parts-batch/approval.json'
const packagePath = 'packages/asset-catalog/pixel/v3/parts-coverage-1.3.0'
const distPath = 'dist/pixel-art/v3-parts-coverage-candidate'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const baseBytes = await read(basePath)
assert.equal(sha(baseBytes), 'ae367420c1cf4d5443faa8cbe69e5e58be4ddf3f4e8a121f2ae33144a332a7cb')
assert.equal(sha(await read(baseProvenancePath)), 'a69398ebf9a69135b7fcfa61993759e09abdc258d307cb9fa4b67aaef66e822a')
const approvalBytes = await read(approvalPath)
assert.equal(sha(approvalBytes), 'fefb863ef0678b0eca17fe7ca614ae3987673fcdca9959914bdfde430eedf6e3')
const approval = JSON.parse(approvalBytes)
assert.equal(approval.state, 'art-approved-registration-pending')
assert.equal(approval.scope.length, 7)

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-parts-coverage')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV2, requirePixelArtCatalogV3, canonicalJson, resolvePixelArtV3, composePixelArt, phenotypeKeyV2 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
const base = requirePixelArtCatalogV2(JSON.parse(baseBytes))
assert.equal(base.artVersion, '1.2.1')
assert.equal(base.profiles.length, 7)
assert.equal(base.coverage.length, 32)

const evidence = { ...base.evidence, [basePath]: sha(baseBytes), [baseProvenancePath]: sha(await read(baseProvenancePath)), [approvalPath]: sha(approvalBytes) }
for (const file of ['packages/asset-catalog/src/pixel-art-catalog-v3.ts', 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts',
  'packages/asset-catalog/src/pixel-art-catalog-v2.ts', 'packages/asset-catalog/src/pixel-art-catalog.ts',
  'packages/renderer-canvas/src/pixel-art-render.ts', 'packages/generator-core/src/feline-phenotype-v2.ts']) {
  evidence[file] = sha(await read(file))
}
const resources = { ...base.resources }
const resourceBytes = new Map()
for (const [id, resource] of Object.entries(base.resources)) resourceBytes.set(id, await read(`packages/asset-catalog/pixel/v2/approved-1.2.1/${resource.path}`))
const opaqueLeftEdge = async bytes => {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]) left = Math.min(left, x)
  assert.notEqual(left, info.width, 'Tail layer is empty.')
  return left
}
const flameTailResources = new Set(base.profiles.map(profile => profile.steps.find(step => step.slot === 'tailTip')?.resources['flame-tail']).filter(Boolean))
assert.ok(flameTailResources.size > 0, 'Missing published flame-tail anchor resource.')
const tailLeftAnchor = 40
const flameTailAnchors = await Promise.all([...flameTailResources].map(async resourceId => ({ resourceId, left: await opaqueLeftEdge(resourceBytes.get(resourceId)) })))
const alignedFlameTailResources = flameTailAnchors.filter(item => item.left === tailLeftAnchor)
assert.equal(alignedFlameTailResources.length, 1, `Expected one published flame-tail resource at x=${tailLeftAnchor}.`)
const alignedFlameTailResource = alignedFlameTailResources[0].resourceId
const traitResources = {}
for (const item of approval.scope) {
  const bytes = await read(item.pixelLayer)
  assert.equal(sha(bytes), item.pixelSha256, `Approved pixel changed: ${item.id}`)
  assert.equal(sha(await read(item.source)), item.sourceSha256, `Approved source changed: ${item.id}`)
  evidence[item.pixelLayer] = item.pixelSha256
  evidence[item.source] = item.sourceSha256
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.width, 64); assert.equal(metadata.height, 64); assert.equal(metadata.hasAlpha, true)
  if (item.slot === 'tailTip') assert.equal(await opaqueLeftEdge(bytes), tailLeftAnchor, `${item.id} must use tail left anchor x=${tailLeftAnchor}`)
  const resourceId = `layer-${item.pixelSha256.slice(0, 16)}`
  assert.ok(!Object.hasOwn(resources, resourceId), `Resource collision: ${resourceId}`)
  resources[resourceId] = { path: `assets/${resourceId}.png`, sha256: item.pixelSha256, width: 64, height: 64 }
  resourceBytes.set(resourceId, bytes)
  traitResources[item.id === 'orange-white-forked-tail-tip' ? 'forked-tail-tip' : item.id] = resourceId
}
const findProfile = (body, eyes, expression) => base.profiles.find(profile => profile.body === body && profile.eyes === eyes && profile.expression === expression)
const profiles = base.profiles.map(profile => {
  const fallback = findProfile(profile.body, profile.eyes, 'small-fangs') ?? findProfile(profile.body, 'round', 'small-fangs')
  assert.ok(fallback, `No compatible mutation profile: ${profile.id}`)
  const steps = profile.steps.map(step => {
    const next = structuredClone(step)
    if (step.slot === 'back') Object.assign(next.resources, {
      'small-wings': traitResources['small-wings'], 'feathered-wings': traitResources['feathered-wings'], 'dragon-wings': traitResources['dragon-wings'],
    })
    if (step.slot === 'crown') Object.assign(next.resources, { antlers: traitResources.antlers, halo: traitResources.halo })
    if (step.slot === 'ears' && !next.resources['fin-ears']) next.resources['fin-ears'] = fallback.steps.find(item => item.slot === 'ears').resources['fin-ears']
    if (step.slot === 'neck') {
      if (!next.resources['small-lion-mane']) next.resources['small-lion-mane'] = fallback.steps.find(item => item.slot === 'neck').resources['small-lion-mane']
      next.resources['frill-neck'] = traitResources['frill-neck']
      next.variants = { ...(next.variants ?? {}), 'frill-neck': { target: 'frame', clear: [], occlusion: [] } }
    }
    if (step.slot === 'tailTip') {
      next.resources['flame-tail'] = alignedFlameTailResource
      next.resources['forked-tail-tip'] = traitResources['forked-tail-tip']
    }
    return next
  })
  return { ...profile, steps }
})

const values = {
  crown: ['none', 'dragon-horns', 'antlers', 'halo'], ears: ['none', 'fin-ears'],
  neck: ['none', 'small-lion-mane', 'frill-neck'], back: ['none', 'small-wings', 'feathered-wings', 'dragon-wings'],
  tailTip: ['none', 'flame-tail', 'forked-tail-tip'],
}
const names = { none: '无', 'dragon-horns': '龙角', antlers: '鹿角', halo: '光环', 'fin-ears': '鳍耳',
  'small-lion-mane': '小狮鬃', 'frill-neck': '颈膜', 'small-wings': '小翅膀', 'feathered-wings': '羽翼',
  'dragon-wings': '龙翼', 'flame-tail': '焰尾', 'forked-tail-tip': '分叉尾尖' }
const baseByPhenotype = new Map(base.coverage.map(row => [phenotypeKeyV2(row.phenotype), row]))
const layers = {}
for (const [id, bytes] of resourceBytes) {
  assert.equal(sha(bytes), resources[id].sha256)
  layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
}
const coverage = []
for (const [profileIndex, profile] of profiles.entries()) {
  let stateIndex = 0
  for (const crown of values.crown) for (const ears of values.ears) for (const neck of values.neck) for (const back of values.back) for (const tailTip of values.tailTip) {
    const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
      expression: profile.expression, crown, ears, neck, back, tailTip }
    const retained = baseByPhenotype.get(phenotypeKeyV2(phenotype))
    const shiftedPublishedTail = retained && tailTip === 'flame-tail' && profile.body !== 'slender-tall'
    coverage.push(shiftedPublishedTail ? { ...retained, review: 'pending', rgbaSha256: '0'.repeat(64) } : retained ?? { id: `parts-p${profileIndex + 1}-s${String(stateIndex + 1).padStart(3, '0')}`,
      label: `${profile.body} · ${profile.eyes} · ${profile.expression} · ${[crown, ears, neck, back, tailTip].map(value => names[value]).join('＋')}`,
      phenotype, profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64) })
    stateIndex++
  }
  assert.equal(stateIndex, 288)
}
assert.equal(coverage.length, 2016)
const approvedCount = coverage.filter(row => row.review === 'approved').length
assert.equal(approvedCount, 20)
const coverageById = new Map(coverage.map(row => [row.id, row]))
const generatable = base.generatable.filter(id => coverageById.get(id)?.review === 'approved')
assert.equal(generatable.length, approvedCount)
const content = { schemaVersion: 'pixel-art-catalog-v3', styleId: base.styleId, artVersion: '1.3.0-candidate.1', rendererVersion: base.rendererVersion,
  size: base.size, resources, profiles, coverage, generatable, evidence }
const temporaryCatalog = requirePixelArtCatalogV3({ ...content, revision: '0'.repeat(64) })
for (const row of coverage) {
  const pixels = composePixelArt(resolvePixelArtV3(row.phenotype, temporaryCatalog), layers)
  const digest = sha(pixels)
  if (row.review === 'approved') assert.equal(digest, row.rgbaSha256, `Approved pixels changed: ${row.id}`)
  else row.rgbaSha256 = digest
}
const catalog = requirePixelArtCatalogV3({ ...content, revision: sha(canonicalJson(content)) })
const catalogBytes = Buffer.from(serialized(catalog))
const provenance = { schemaVersion: 'pixel-art-parts-coverage-provenance-v1', status: 'candidate-review-pending', runtimeEnabled: false,
  base: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: evidence[baseProvenancePath] },
  artApproval: { path: approvalPath, sha256: evidence[approvalPath] }, candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  registration: { profiles: profiles.length, statesPerProfile: 288, coverage: coverage.length, approved: approvedCount, pending: coverage.length - approvedCount, resources: Object.keys(resources).length }, files: evidence }
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
console.log(`Parts candidate ${catalog.artVersion}: ${profiles.length} profiles × 288 = ${coverage.length} coverage / ${approvedCount} approved / ${coverage.length - approvedCount} pending / ${Object.keys(resources).length} resources / ${catalog.revision}`)
