import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const packageRoot = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0'
const distRoot = 'dist/pixel-scene/backdrop-candidate'
const catCatalogPath = 'packages/asset-catalog/pixel/v3/approved-1.6.1/catalog.approved.json'
const sourceApprovalPath = 'docs/qa/pixel-backdrop-batch/approval.json'
const specPath = 'docs/superpowers/specs/2026-09-22-pixel-scene-backdrop-design.md'
const expectedCatCatalogSha = '76eec3381d1d09bbbf2a1883e5812818c76b474d0944c13d68f5ade89abaa804'
const expectedCatRevision = 'c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf'

export const backdropSources = [
  { id: 'doodle-horizon', rarity: 'N', growthRank: 1, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png', sha256: '2f4eaff9b6ed478dadfcaff7ae9828b4a3c076d2bea5dd988e9628cffdbc604b' },
  { id: 'doodle-leaf-shadow', rarity: 'R', growthRank: 2, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-leaf-shadow.png', sha256: 'f6acae86a1a7c92ab13e2b9d23e21613b499d204bf0045747038b4f636e7f471' },
  { id: 'doodle-rainbow-trail', rarity: 'L', growthRank: 3, source: 'docs/qa/pixel-backdrop-batch/layers/doodle-rainbow-trail.png', sha256: '17821cc32d36b65167393f802c313b595d4ec2d28b7b82e4ce20ea9d9820f872' },
]

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const serialized = value => JSON.stringify(value, null, 2) + '\n'
const read = file => fs.readFile(path.join(root, file))

export async function verifyBackdropSource(bytes, definition) {
  assert.equal(sha(bytes), definition.sha256, `${definition.id}: source hash mismatch`)
  const image = sharp(bytes, { failOn: 'error' })
  const metadata = await image.metadata()
  assert.equal(metadata.width, 96, `${definition.id}: source width`)
  assert.equal(metadata.height, 64, `${definition.id}: source height`)
  const pixels = await image.ensureAlpha().raw().toBuffer()
  for (let index = 3; index < pixels.length; index += 4) {
    assert.ok(pixels[index] === 0 || pixels[index] === 255, `${definition.id}: nonbinary alpha`)
  }
  return bytes
}

export async function writeImmutableOutputs(outputs, baseRoot = root) {
  for (const [file, bytes] of outputs) {
    const target = path.resolve(baseRoot, file)
    try {
      assert.ok((await fs.readFile(target)).equals(bytes), `Immutable artifact changed: ${file}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  for (const [file, bytes] of outputs) {
    const target = path.resolve(baseRoot, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    try {
      await fs.writeFile(target, bytes, { flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

export async function buildPixelSceneBackdropCandidate() {
  const temp = path.join(root, 'node_modules/.cache/qmonster-pixel-scene-backdrops')
  await fs.mkdir(temp, { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: { sdk: 'packages/incubator-adapter/src/pixel-scene-sdk.ts' },
    outdir: temp,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { canonicalJson, requirePixelSceneCatalogV1 } = await import(pathToFileURL(path.join(temp, 'sdk.js')).href)
  const catCatalogBytes = await read(catCatalogPath)
  assert.equal(sha(catCatalogBytes), expectedCatCatalogSha, '1.6.1 cat catalog changed')
  const catCatalog = JSON.parse(catCatalogBytes)
  assert.equal(catCatalog.schemaVersion, 'pixel-art-catalog-v3')
  assert.equal(catCatalog.artVersion, '1.6.1')
  assert.equal(catCatalog.revision, expectedCatRevision)
  assert.equal(catCatalog.rendererVersion, 'pixel-rgba-v1')
  assert.equal(catCatalog.size, 64)
  assert.equal(catCatalog.coverage.length, 35_840)
  assert.equal(Object.keys(catCatalog.resources).length, 63)

  const sourceApprovalBytes = await read(sourceApprovalPath)
  const specBytes = await read(specPath)
  const resources = {}
  const backdrops = {}
  const sourceBytes = new Map()
  for (const definition of backdropSources) {
    const bytes = await verifyBackdropSource(await read(definition.source), definition)
    const resourceId = `scene-${definition.sha256.slice(0, 16)}`
    const resourcePath = `assets/${resourceId}.png`
    resources[resourceId] = { path: resourcePath, sha256: definition.sha256, width: 96, height: 64 }
    backdrops[definition.id] = {
      resourceId, rarity: definition.rarity, growthRank: definition.growthRank, review: 'pending',
    }
    sourceBytes.set(resourcePath, bytes)
  }

  const evidence = {
    [sourceApprovalPath]: sha(sourceApprovalBytes),
    [catCatalogPath]: sha(catCatalogBytes),
    [specPath]: sha(specBytes),
  }
  for (const definition of backdropSources) evidence[definition.source] = definition.sha256
  const content = {
    schemaVersion: 'pixel-scene-catalog-v1',
    sceneVersion: '1.0.0-candidate.1',
    rendererVersion: 'pixel-scene-rgba-v1',
    canvas: { width: 96, height: 64 },
    subject: {
      schemaVersion: 'feline-phenotype-v2', catalogSchemaVersion: 'pixel-art-catalog-v3',
      rendererVersion: 'pixel-rgba-v1', width: 64, height: 64, anchor: { x: 16, y: 0 },
    },
    outline: {
      owner: 'scene-renderer', neighborhood: 'four', width: 1,
      color: 'adjacent-mean-darken', factor: 0.36,
    },
    resources,
    backdrops,
    growth: { slot: 'backdrop', order: backdropSources.map(item => item.id) },
    validatedSubject: { artVersion: '1.6.1', revision: expectedCatRevision },
    generatable: [],
    evidence,
  }
  const catalog = requirePixelSceneCatalogV1({ ...content, revision: sha(canonicalJson(content)) })
  const catalogBytes = Buffer.from(serialized(catalog))
  const provenance = {
    schemaVersion: 'pixel-scene-backdrop-candidate-provenance-v1',
    status: 'candidate-visual-validation',
    runtimeEnabled: false,
    validationMode: 'representative-scene-samples',
    sourceApproval: { path: sourceApprovalPath, sha256: sha(sourceApprovalBytes) },
    subject: {
      path: catCatalogPath, schemaVersion: catCatalog.schemaVersion, artVersion: catCatalog.artVersion,
      revision: catCatalog.revision, rendererVersion: catCatalog.rendererVersion, size: catCatalog.size,
      sha256: sha(catCatalogBytes), coverage: catCatalog.coverage.length, resources: Object.keys(catCatalog.resources).length,
    },
    scene: {
      packagePath: packageRoot, sceneVersion: catalog.sceneVersion, revision: catalog.revision,
      sha256: sha(catalogBytes), rendererVersion: catalog.rendererVersion, resources: Object.keys(catalog.resources).length,
      backdrops: Object.keys(catalog.backdrops).length, generatable: catalog.generatable.length,
    },
    backdrops: backdropSources.map(definition => ({
      id: definition.id, rarity: definition.rarity, growthRank: definition.growthRank,
      source: definition.source, sha256: definition.sha256,
    })),
    files: evidence,
  }
  const provenanceBytes = Buffer.from(serialized(provenance))
  const outputs = new Map([
    [`${packageRoot}/catalog.candidate.json`, catalogBytes],
    [`${packageRoot}/provenance.candidate.json`, provenanceBytes],
    [`${distRoot}/catalog.json`, catalogBytes],
    [`${distRoot}/provenance.json`, provenanceBytes],
  ])
  for (const [resourcePath, bytes] of sourceBytes) {
    outputs.set(`${packageRoot}/${resourcePath}`, bytes)
    outputs.set(`${distRoot}/${resourcePath}`, bytes)
  }
  await writeImmutableOutputs(outputs)
  return { catalog, provenance, outputs }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const { catalog } = await buildPixelSceneBackdropCandidate()
  console.log(`Scene candidate ${catalog.sceneVersion}: 3 pending / 0 generatable / ${catalog.revision}`)
}
