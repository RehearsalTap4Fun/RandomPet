import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const basePath = 'packages/asset-catalog/pixel/v3/approved-1.4.0/catalog.approved.json'
const baseProvenancePath = 'packages/asset-catalog/pixel/v3/approved-1.4.0/provenance.json'
const packagePath = 'packages/asset-catalog/pixel/v3/sleepy-coats-1.5.0'
const distPath = 'dist/pixel-art/v3-sleepy-coats-candidate'
const qaPath = 'docs/qa/pixel-sleepy-coats'
const coats = ['brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']
const expressions = ['parted-mouth', 'small-fangs']
const eyePatch = { left: 14, top: 17, right: 42, bottom: 26 }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => fs.readFile(path.join(root, file))
const serialized = value => JSON.stringify(value, null, 2) + '\n'

function alphaBytes(rgba) {
  const result = Buffer.alloc(rgba.length / 4)
  for (let source = 3, target = 0; source < rgba.length; source += 4, target++) result[target] = rgba[source]
  return result
}

function nearestOpaque(data, x, y) {
  let bestX = x; let bestY = y; let bestDistance = Infinity
  for (let sourceY = 0; sourceY < 64; sourceY++) for (let sourceX = 0; sourceX < 64; sourceX++) {
    if (!data[(sourceY * 64 + sourceX) * 4 + 3]) continue
    const distance = (sourceX - x) ** 2 + (sourceY - y) ** 2
    if (distance < bestDistance) { bestDistance = distance; bestX = sourceX; bestY = sourceY }
  }
  return [bestX, bestY]
}

async function transferSleepyEyes(roundOrangeBytes, sleepyOrangeBytes, coatRoundBytes) {
  const roundOrange = await sharp(roundOrangeBytes).ensureAlpha().raw().toBuffer()
  const sleepyOrange = await sharp(sleepyOrangeBytes).ensureAlpha().raw().toBuffer()
  const coatRound = await sharp(coatRoundBytes).ensureAlpha().raw().toBuffer()
  assert.equal(roundOrange.length, 64 * 64 * 4)
  assert.equal(sleepyOrange.length, roundOrange.length)
  assert.equal(coatRound.length, roundOrange.length)
  const output = Buffer.alloc(roundOrange.length)
  const candidates = []
  for (let y = 9; y <= 35; y++) for (let x = 7; x <= 49; x++) {
    const offset = (y * 64 + x) * 4
    if (roundOrange[offset + 3] && coatRound[offset + 3]) candidates.push([x, y])
  }
  let patchPixels = 0; let outsideRgbChanges = 0
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4
    const targetAlpha = sleepyOrange[offset + 3]
    if (!targetAlpha) continue
    const inPatch = x >= eyePatch.left && x <= eyePatch.right && y >= eyePatch.top && y <= eyePatch.bottom
    let sourceX = x; let sourceY = y
    if (inPatch) {
      patchPixels++
      let bestScore = Infinity
      for (const [candidateX, candidateY] of candidates) {
        const candidateOffset = (candidateY * 64 + candidateX) * 4
        const dr = sleepyOrange[offset] - roundOrange[candidateOffset]
        const dg = sleepyOrange[offset + 1] - roundOrange[candidateOffset + 1]
        const db = sleepyOrange[offset + 2] - roundOrange[candidateOffset + 2]
        const spatial = (candidateX - x) ** 2 + (candidateY - y) ** 2
        const score = dr ** 2 + dg ** 2 + db ** 2 + spatial * 18
        if (score < bestScore) { bestScore = score; sourceX = candidateX; sourceY = candidateY }
      }
    } else if (!coatRound[offset + 3]) {
      ;[sourceX, sourceY] = nearestOpaque(coatRound, x, y)
    }
    const sourceOffset = (sourceY * 64 + sourceX) * 4
    output[offset] = coatRound[sourceOffset]
    output[offset + 1] = coatRound[sourceOffset + 1]
    output[offset + 2] = coatRound[sourceOffset + 2]
    output[offset + 3] = targetAlpha
    if (!inPatch && coatRound[offset + 3] === targetAlpha &&
      (output[offset] !== coatRound[offset] || output[offset + 1] !== coatRound[offset + 1] || output[offset + 2] !== coatRound[offset + 2])) outsideRgbChanges++
  }
  assert.equal(outsideRgbChanges, 0, 'Sleepy transfer changed RGB outside the eye patch.')
  assert.ok(alphaBytes(output).equals(alphaBytes(sleepyOrange)), 'Sleepy transfer must preserve the approved sleepy alpha.')
  const png = await sharp(output, { raw: { width: 64, height: 64, channels: 4 } }).png({ palette: true, colours: 256, dither: 0 }).toBuffer()
  return { png, patchPixels, outsideRgbChanges, alphaSha256: sha(alphaBytes(output)) }
}

const baseBytes = await read(basePath)
const baseProvenanceBytes = await read(baseProvenancePath)
const base = JSON.parse(baseBytes)
assert.equal(base.artVersion, '1.4.0')
assert.equal(base.profiles.length, 18)
assert.equal(base.coverage.length, 5184)
assert.equal(Object.keys(base.resources).length, 48)
const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-sleepy-coats')
await fs.mkdir(temp, { recursive: true })
await build({ absWorkingDir: root, entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-art-sdk-v3.ts' }, outdir: temp, bundle: true, format: 'esm', platform: 'node' })
const { requirePixelArtCatalogV3, canonicalJson, composePixelArt } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
requirePixelArtCatalogV3(base)
const resources = structuredClone(base.resources)
const resourceBytes = new Map()
for (const [id, resource] of Object.entries(base.resources)) resourceBytes.set(id, await read(`packages/asset-catalog/pixel/v3/approved-1.4.0/${resource.path}`))
const bodyResource = profile => profile.steps.find(step => step.slot === 'body').resources[profile.expression]
const profileFor = (coat, eyes, expression) => base.profiles.find(profile => profile.body === 'standard' && profile.coat === coat && profile.eyes === eyes && profile.expression === expression)
const generated = {}; const transferEntries = []
await fs.mkdir(path.join(root, qaPath, 'layers'), { recursive: true })
for (const coat of coats) {
  generated[coat] = {}
  for (const expression of expressions) {
    const roundOrangeProfile = profileFor('orange-white', 'round', expression)
    const sleepyOrangeProfile = profileFor('orange-white', 'sleepy-almond', expression)
    const coatRoundProfile = profileFor(coat, 'round', expression)
    assert.ok(roundOrangeProfile && sleepyOrangeProfile && coatRoundProfile)
    const roundOrangeId = bodyResource(roundOrangeProfile)
    const sleepyOrangeId = bodyResource(sleepyOrangeProfile)
    const coatRoundId = bodyResource(coatRoundProfile)
    const result = await transferSleepyEyes(resourceBytes.get(roundOrangeId), resourceBytes.get(sleepyOrangeId), resourceBytes.get(coatRoundId))
    const outputSha256 = sha(result.png)
    const resourceId = `layer-${outputSha256.slice(0, 16)}`
    assert.ok(!Object.hasOwn(resources, resourceId), `Resource collision: ${resourceId}`)
    resources[resourceId] = { path: `assets/${resourceId}.png`, sha256: outputSha256, width: 64, height: 64 }
    resourceBytes.set(resourceId, result.png)
    generated[coat][expression] = resourceId
    const outputPath = `${qaPath}/layers/${coat}-sleepy-almond-${expression}.png`
    await fs.writeFile(path.join(root, outputPath), result.png)
    transferEntries.push({ coat, expression, roundOrangeId, sleepyOrangeId, coatRoundId, outputPath, outputSha256,
      eyePatch, patchPixels: result.patchPixels, outsideRgbChanges: result.outsideRgbChanges, alphaSha256: result.alphaSha256 })
  }
}
assert.equal(new Set(transferEntries.map(row => row.outputSha256)).size, 10)
const transferPath = `${qaPath}/transfer-report.json`
const transferReport = { schemaVersion: 'pixel-sleepy-coats-transfer-v1',
  method: 'approved sleepy-almond eye shape mapped through each approved round-eye coat palette inside a bounded eye patch',
  invariant: 'RGB outside the eye patch is unchanged; alpha exactly matches the approved orange-white sleepy-almond expression template',
  eyePatch, entries: transferEntries }
await fs.writeFile(path.join(root, transferPath), serialized(transferReport))

const addedProfiles = []
for (const coat of coats) for (const expression of expressions) {
  const template = structuredClone(profileFor('orange-white', 'sleepy-almond', expression))
  const coatRound = profileFor(coat, 'round', expression)
  assert.ok(template && coatRound)
  template.id = `standard-${coat}-sleepy-almond-${expression}`
  template.coat = coat
  for (const step of template.steps) {
    if (step.slot === 'body') step.resources[expression] = generated[coat][expression]
    if (step.slot === 'ears') step.resources['fin-ears'] = coatRound.steps.find(item => item.slot === 'ears').resources['fin-ears']
    if (step.slot === 'neck') step.resources['small-lion-mane'] = coatRound.steps.find(item => item.slot === 'neck').resources['small-lion-mane']
    if (step.slot === 'tailTip') step.resources['forked-tail-tip'] = coatRound.steps.find(item => item.slot === 'tailTip').resources['forked-tail-tip']
  }
  addedProfiles.push(template)
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
    added.push({ id: `sleepy-coats-p${profileIndex + 1}-s${String(stateIndex + 1).padStart(3, '0')}`,
      label: `${profile.body} · ${profile.coat} · ${profile.eyes} · ${profile.expression} · ${[crown, ears, neck, back, tailTip].map(value => names[value]).join('＋')}`,
      phenotype, profileId: profile.id, review: 'pending', rgbaSha256: '0'.repeat(64) })
    stateIndex++
  }
  assert.equal(stateIndex, 288)
}
assert.equal(added.length, 2880)
const coverage = [...base.coverage, ...added]
const evidence = { ...base.evidence, [basePath]: sha(baseBytes), [baseProvenancePath]: sha(baseProvenanceBytes), [transferPath]: sha(await read(transferPath)) }
evidence['scripts/build-pixel-art-v3-sleepy-coats.mjs'] = sha(await read('scripts/build-pixel-art-v3-sleepy-coats.mjs'))
const content = { schemaVersion: 'pixel-art-catalog-v3', styleId: base.styleId, artVersion: '1.5.0-candidate.1', rendererVersion: base.rendererVersion,
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
const provenance = { schemaVersion: 'pixel-art-sleepy-coats-provenance-v1', status: 'candidate-art-review-pending', runtimeEnabled: false,
  base: { path: basePath, artVersion: base.artVersion, revision: base.revision, sha256: sha(baseBytes), provenancePath: baseProvenancePath, provenanceSha256: sha(baseProvenanceBytes) },
  candidate: { artVersion: catalog.artVersion, revision: catalog.revision, sha256: sha(catalogBytes) },
  transfer: { reportPath: transferPath, reportSha256: evidence[transferPath], resources: 10, eyePatch, outsideRgbChanges: 0 },
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
console.log(`Sleepy-coat candidate ${catalog.artVersion}: ${profiles.length} profiles / ${coverage.length} coverage / ${base.coverage.length} approved / ${added.length} pending / ${Object.keys(resources).length} resources / ${catalog.revision}`)
