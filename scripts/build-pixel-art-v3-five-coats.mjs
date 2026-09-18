import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const basePath = 'packages/asset-catalog/pixel/v3/approved-1.3.1/catalog.approved.json'
const baseProvenancePath = 'packages/asset-catalog/pixel/v3/approved-1.3.1/provenance.json'
const packagePath = 'packages/asset-catalog/pixel/v3/five-coats-1.4.0'
const distPath = 'dist/pixel-art/v3-five-coats-candidate'
const qaPath = 'docs/qa/pixel-five-coats'
const sourceRoot = 'docs/qa/flat-source-trial/consumer/flat'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const kinds = ['parted-mouth', 'small-fangs', 'fin-ears', 'small-lion-mane', 'forked-tail-tip']
const templateIds = {
  'parted-mouth': 'layer-c68b7f3b61d5650f',
  'small-fangs': 'layer-fec0335aee4cb501',
  'fin-ears': 'layer-6d8134b5c93d11f7',
  'small-lion-mane': 'layer-0dc4c49bf437b30a',
  'forked-tail-tip': 'layer-28f0a9fba22b4bae',
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

function alphaBytes(rgba) {
  const result = Buffer.alloc(rgba.length / 4)
  for (let source = 3, target = 0; source < rgba.length; source += 4, target++) result[target] = rgba[source]
  return result
}

function opaqueBox(rgba, width, height) {
  let left = width; let top = height; let right = -1; let bottom = -1; let pixels = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] === 0) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); pixels++
  }
  assert.ok(pixels > 0, 'Image has no opaque pixels.')
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, pixels }
}

async function projectColours(sourceBytes, templateBytes) {
  const source = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const template = await sharp(templateBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([source.info.width, source.info.height, source.info.channels], [64, 64, 4])
  assert.deepEqual([template.info.width, template.info.height, template.info.channels], [64, 64, 4])
  const sourceBox = opaqueBox(source.data, 64, 64)
  const templateBox = opaqueBox(template.data, 64, 64)
  const opaqueSource = []
  for (let y = sourceBox.top; y <= sourceBox.bottom; y++) for (let x = sourceBox.left; x <= sourceBox.right; x++) {
    if (source.data[(y * 64 + x) * 4 + 3]) opaqueSource.push([x, y])
  }
  const output = Buffer.alloc(64 * 64 * 4)
  for (let y = templateBox.top; y <= templateBox.bottom; y++) for (let x = templateBox.left; x <= templateBox.right; x++) {
    const targetOffset = (y * 64 + x) * 4
    const targetAlpha = template.data[targetOffset + 3]
    if (!targetAlpha) continue
    const mappedX = sourceBox.left + (x - templateBox.left) * (sourceBox.width - 1) / Math.max(1, templateBox.width - 1)
    const mappedY = sourceBox.top + (y - templateBox.top) * (sourceBox.height - 1) / Math.max(1, templateBox.height - 1)
    let bestX = sourceBox.left; let bestY = sourceBox.top; let bestDistance = Infinity
    for (const [sourceX, sourceY] of opaqueSource) {
      const distance = (sourceX - mappedX) ** 2 + (sourceY - mappedY) ** 2
      if (distance < bestDistance) { bestDistance = distance; bestX = sourceX; bestY = sourceY }
    }
    const sourceOffset = (bestY * 64 + bestX) * 4
    output[targetOffset] = source.data[sourceOffset]
    output[targetOffset + 1] = source.data[sourceOffset + 1]
    output[targetOffset + 2] = source.data[sourceOffset + 2]
    output[targetOffset + 3] = targetAlpha
  }
  assert.ok(alphaBytes(output).equals(alphaBytes(template.data)), 'Projected alpha must equal the approved template.')
  const png = await sharp(output, { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  return { png, sourceBox, templateBox, alphaSha256: sha(alphaBytes(output)) }
}

const baseBytes = await read(basePath)
const baseProvenanceBytes = await read(baseProvenancePath)
const base = JSON.parse(baseBytes)
assert.equal(base.artVersion, '1.3.1')
assert.equal(base.profiles.length, 8)
assert.equal(base.coverage.length, 2304)
assert.equal(Object.keys(base.resources).length, 23)

const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-five-coats')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, canonicalJson, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(base)

const resources = structuredClone(base.resources)
const resourceBytes = new Map()
for (const [id, resource] of Object.entries(base.resources)) resourceBytes.set(id, await read(`packages/asset-catalog/pixel/v3/approved-1.3.1/${resource.path}`))
const generated = {}
const normalization = []
await fs.mkdir(path.join(root, qaPath, 'layers'), { recursive: true })
for (const coat of coats) {
  generated[coat] = {}
  for (const kind of kinds) {
    const sourcePath = `${sourceRoot}/${coat}-${kind}.png`
    const templateId = templateIds[kind]
    const sourceBytes = await read(sourcePath)
    const templateBytes = resourceBytes.get(templateId)
    assert.ok(templateBytes, `Missing approved template ${templateId}.`)
    const result = await projectColours(sourceBytes, templateBytes)
    const pixelSha256 = sha(result.png)
    const resourceId = `layer-${pixelSha256.slice(0, 16)}`
    assert.ok(!Object.hasOwn(resources, resourceId), `Resource collision: ${resourceId}`)
    resources[resourceId] = { path: `assets/${resourceId}.png`, sha256: pixelSha256, width: 64, height: 64 }
    resourceBytes.set(resourceId, result.png)
    generated[coat][kind] = resourceId
    const outputPath = `${qaPath}/layers/${coat}-${kind}.png`
    await fs.writeFile(path.join(root, outputPath), result.png)
    normalization.push({ coat, kind, sourcePath, sourceSha256: sha(sourceBytes), templateId,
      templateSha256: base.resources[templateId].sha256, outputPath, outputSha256: pixelSha256,
      sourceBox: result.sourceBox, templateBox: result.templateBox, alphaSha256: result.alphaSha256 })
  }
}
assert.equal(new Set(normalization.map(row => row.outputSha256)).size, 25)
for (const row of normalization.filter(row => row.kind === 'forked-tail-tip')) assert.equal(row.templateBox.left, 40)
const normalizationPath = `${qaPath}/normalization-report.json`
const normalizationReport = { schemaVersion: 'pixel-five-coats-normalization-v1', method: 'historical Nutri RGB projected onto approved 1.3.1 alpha masks',
  invariant: 'RGB and coat pattern may change; alpha, canvas, anchor, clear, occlusion and layer order remain unchanged', entries: normalization }
await fs.writeFile(path.join(root, normalizationPath), serialized(normalizationReport))

const baseParted = base.profiles.find(profile => profile.id === 'standard-parted-mouth-round')
const baseFangs = base.profiles.find(profile => profile.id === 'standard-small-fangs-round')
assert.ok(baseParted && baseFangs)
const addedProfiles = []
for (const coat of coats) for (const expression of ['parted-mouth', 'small-fangs']) {
  const profile = structuredClone(expression === 'parted-mouth' ? baseParted : baseFangs)
  profile.id = `standard-${coat}-${expression}-round`
  profile.coat = coat
  for (const step of profile.steps) {
    if (step.slot === 'body') step.resources[expression] = generated[coat][expression]
    if (step.slot === 'ears') step.resources['fin-ears'] = generated[coat]['fin-ears']
    if (step.slot === 'neck') step.resources['small-lion-mane'] = generated[coat]['small-lion-mane']
    if (step.slot === 'tailTip') step.resources['forked-tail-tip'] = generated[coat]['forked-tail-tip']
  }
  addedProfiles.push(profile)
}
const profiles = [...base.profiles, ...addedProfiles]
const values = {
  crown: ['none', 'dragon-horns', 'antlers', 'halo'], ears: ['none', 'fin-ears'],
  neck: ['none', 'small-lion-mane', 'frill-neck'], back: ['none', 'small-wings', 'feathered-wings', 'dragon-wings'],
  tailTip: ['none', 'flame-tail', 'forked-tail-tip'],
}
const names = { none: '无', 'dragon-horns': '龙角', antlers: '鹿角', halo: '光环', 'fin-ears': '鳍耳',
  'small-lion-mane': '小狮鬃', 'frill-neck': '颈膜', 'small-wings': '小翅膀', 'feathered-wings': '羽翼',
  'dragon-wings': '龙翼', 'flame-tail': '焰尾', 'forked-tail-tip': '分叉尾尖' }
const added = []
for (const [profileIndex, profile] of addedProfiles.entries()) {
  let stateIndex = 0
  for (const crown of values.crown) for (const ears of values.ears) for (const neck of values.neck) for (const back of values.back) for (const tailTip of values.tailTip) {
    const phenotype = { schemaVersion: 'feline-phenotype-v2', body: profile.body, coat: profile.coat, eyes: profile.eyes,
      expression: profile.expression, crown, ears, neck, back, tailTip }
    added.push({ id: `five-coats-p${profileIndex + 1}-s${String(stateIndex + 1).padStart(3, '0')}`,
      label: `${profile.body} · ${profile.coat} · ${profile.expression} · ${[crown, ears, neck, back, tailTip].map(value => names[value]).join('＋')}`,
      phenotype, profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64) })
    stateIndex++
  }
  assert.equal(stateIndex, 288)
}
assert.equal(added.length, 2880)
const coverage = [...base.coverage, ...added]
const evidence = { ...base.evidence, [basePath]: sha(baseBytes), [baseProvenancePath]: sha(baseProvenanceBytes), [normalizationPath]: sha(await read(normalizationPath)) }
for (const row of normalization) evidence[row.sourcePath] = row.sourceSha256
evidence['scripts/build-pixel-art-v3-five-coats.mjs'] = sha(await read('scripts/build-pixel-art-v3-five-coats.mjs'))
const content = { schemaVersion: 'pixel-art-catalog-v3', styleId: base.styleId, artVersion: '1.4.0-candidate.1', rendererVersion: base.rendererVersion,
  size: base.size, resources, profiles, coverage, generatable: base.generatable, evidence }
const temporary = requirePixelArtCatalogV3({ ...content, revision: '0'.repeat(64) })
const layers = {}
for (const [id, bytes] of resourceBytes) layers[id] = new Uint8ClampedArray(await sharp(bytes).ensureAlpha().raw().toBuffer())
const profileById = new Map(temporary.profiles.map(profile => [profile.id, profile]))
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
    planResources[resourceId] = temporary.resources[resourceId]
  }
  return { size: 64, operations, resources: planResources, key: row.id, review: row.review }
}
for (const row of added) row.rgbaSha256 = sha(composePixelArt(planFor(row), layers))
const catalog = requirePixelArtCatalogV3({ ...content, revision: sha(canonicalJson(content)) })
const catalogBytes = Buffer.from(serialized(catalog))
const provenance = { schemaVersion: 'pixel-art-five-coats-provenance-v1', status: 'candidate-art-review-pending', runtimeEnabled: false,
  base: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: sha(baseProvenanceBytes) },
  candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  normalization: { reportPath: normalizationPath, reportSha256: evidence[normalizationPath], resources: 25, alphaTemplates: 5, tailLeftAnchor: 40 },
  registration: { profiles: profiles.length, addedProfiles: 10, statesPerAddedProfile: 288, coverage: coverage.length,
    approved: base.coverage.length, pending: added.length, resources: Object.keys(resources).length }, files: evidence }
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
console.log(`Five-coat candidate ${catalog.artVersion}: ${profiles.length} profiles / ${coverage.length} coverage / ${base.coverage.length} approved / ${added.length} pending / ${Object.keys(resources).length} resources / ${catalog.revision}`)
