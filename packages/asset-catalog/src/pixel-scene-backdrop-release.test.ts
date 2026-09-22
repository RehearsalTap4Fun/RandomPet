import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { phenotypeKeyV2 } from '../../generator-core/src/feline-phenotype-v2.js'
import { composePixelArt } from '../../renderer-canvas/src/pixel-art-render.js'
import { composePixelScene } from '../../renderer-canvas/src/pixel-scene-render.js'
import sharp from 'sharp'
import type { PixelArtPlan } from './pixel-art-catalog.js'
import { requirePixelArtCatalogV3, type PixelArtCatalogV3 } from './pixel-art-catalog-v3.js'
import { requirePixelSceneCatalogV1 } from './pixel-scene-catalog.js'

const sceneRoot = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/'
const catRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.1/'
const qaRoot = 'docs/qa/pixel-scene-backdrops/'
const sha = (bytes: string | Uint8Array | Uint8ClampedArray) => createHash('sha256')
  .update(typeof bytes === 'string' ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const temporary: string[] = []

function planForValidatedCatalog(catalog: PixelArtCatalogV3, phenotype: any): PixelArtPlan {
  const coverage = catalog.coverage.find(row => phenotypeKeyV2(row.phenotype) === phenotypeKeyV2(phenotype))
  if (!coverage) throw new Error(`Missing coverage: ${phenotypeKeyV2(phenotype)}`)
  const profile = catalog.profiles.find(item => item.id === coverage.profileId)!
  const operations: any[] = []
  const resources: Record<string, any> = {}
  for (const step of profile.steps) {
    const selected = step.slot === 'body' ? phenotype.expression : phenotype[step.slot]
    if (selected === 'none') continue
    const resourceId = step.resources[selected]!
    const rendering = step.variants?.[selected] ?? step
    if (rendering.clear.length) operations.push({ kind: 'clear', polygons: rendering.clear })
    operations.push({ kind: 'draw', resource: resourceId, target: rendering.target, occlusion: rendering.occlusion })
    resources[resourceId] = catalog.resources[resourceId]!
  }
  return { size: 64, operations, resources, key: coverage.id, review: coverage.review }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('pixel scene backdrop candidate release', () => {
  it('builds the separate three-resource candidate without changing the cat package', () => {
    expect(existsSync(sceneRoot + 'catalog.candidate.json')).toBe(true)
    const scene = requirePixelSceneCatalogV1(json(sceneRoot + 'catalog.candidate.json'))
    const catBytes = readFileSync(catRoot + 'catalog.approved.json')
    const cat = requirePixelArtCatalogV3(JSON.parse(catBytes.toString()))
    expect(scene.sceneVersion).toBe('1.0.0-candidate.1')
    expect(scene.rendererVersion).toBe('pixel-scene-rgba-v1')
    expect(scene.canvas).toEqual({ width: 96, height: 64 })
    expect(scene.subject.anchor).toEqual({ x: 16, y: 0 })
    expect(Object.keys(scene.resources)).toHaveLength(3)
    expect(Object.values(scene.backdrops).every(item => item.review === 'pending')).toBe(true)
    expect(scene.generatable).toEqual([])
    expect(cat.artVersion).toBe('1.6.1')
    expect(cat.revision).toBe('c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf')
    expect(cat.coverage).toHaveLength(35_840)
    expect(Object.keys(cat.resources)).toHaveLength(63)
    expect(sha(catBytes)).toBe('76eec3381d1d09bbbf2a1883e5812818c76b474d0944c13d68f5ade89abaa804')
    const { revision, ...content } = scene
    expect(revision).toBe(sha(canonicalJson(content)))
  })

  it('copies the three approved source PNGs byte-for-byte', () => {
    const scene = requirePixelSceneCatalogV1(json(sceneRoot + 'catalog.candidate.json'))
    const expected = {
      'doodle-horizon': ['docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png', '2f4eaff9b6ed478dadfcaff7ae9828b4a3c076d2bea5dd988e9628cffdbc604b'],
      'doodle-leaf-shadow': ['docs/qa/pixel-backdrop-batch/layers/doodle-leaf-shadow.png', 'f6acae86a1a7c92ab13e2b9d23e21613b499d204bf0045747038b4f636e7f471'],
      'doodle-rainbow-trail': ['docs/qa/pixel-backdrop-batch/layers/doodle-rainbow-trail.png', '17821cc32d36b65167393f802c313b595d4ec2d28b7b82e4ce20ea9d9820f872'],
    } as const
    for (const [id, [source, hash]] of Object.entries(expected)) {
      const entry = scene.backdrops[id as keyof typeof scene.backdrops]
      const resource = scene.resources[entry.resourceId]!
      const sourceBytes = readFileSync(source)
      const packageBytes = readFileSync(sceneRoot + resource.path)
      expect(resource).toMatchObject({ sha256: hash, width: 96, height: 64 })
      expect(sha(sourceBytes)).toBe(hash)
      expect(packageBytes).toEqual(sourceBytes)
    }
  })

  it('rejects altered source bytes and immutable output drift', async () => {
    // @ts-expect-error Build-time JavaScript helper has no declaration file.
    const { verifyBackdropSource, writeImmutableOutputs } = await import('../../../scripts/build-pixel-scene-backdrops.mjs')
    const source = readFileSync('docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png')
    const changed = new Uint8Array(source); changed[changed.length - 1]! ^= 1
    await expect(verifyBackdropSource(changed, {
      id: 'doodle-horizon', sha256: '2f4eaff9b6ed478dadfcaff7ae9828b4a3c076d2bea5dd988e9628cffdbc604b',
    })).rejects.toThrow(/hash/i)

    const directory = await mkdtemp(path.join(tmpdir(), 'qmonster-scene-'))
    temporary.push(directory)
    await writeFile(path.join(directory, 'artifact.bin'), Buffer.from('old'))
    await expect(writeImmutableOutputs(new Map([['artifact.bin', Buffer.from('new')]]), directory)).rejects.toThrow(/immutable/i)
  })

  it('records exactly nine replayable representative scenes and one in-memory none case', async () => {
    expect(existsSync(qaRoot + 'report.json')).toBe(true)
    const report = json(qaRoot + 'report.json')
    const scene = requirePixelSceneCatalogV1(json(sceneRoot + 'catalog.candidate.json'))
    const cat = requirePixelArtCatalogV3(json(catRoot + 'catalog.approved.json'))
    const expected = [
      ['doodle-horizon', 'standard', 'orange-white', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
      ['doodle-horizon', 'shortleg-round', 'orange-white', 'round', 'small-fangs', 'antlers', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
      ['doodle-horizon', 'standard', 'tuxedo', 'sleepy-almond', 'parted-mouth', 'crystal-horns', 'feathered-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
      ['doodle-leaf-shadow', 'standard', 'brown-tabby', 'sleepy-almond', 'small-fangs', 'none', 'none', 'none', 'none', 'none'],
      ['doodle-leaf-shadow', 'slender-tall', 'orange-white', 'sleepy-almond', 'small-fangs', 'halo', 'celestial-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
      ['doodle-leaf-shadow', 'standard', 'colorpoint', 'round', 'small-fangs', 'dragon-horns', 'fin-ears', 'small-lion-mane', 'small-wings', 'forked-tail-tip'],
      ['doodle-rainbow-trail', 'standard', 'calico', 'round', 'parted-mouth', 'none', 'none', 'none', 'none', 'none'],
      ['doodle-rainbow-trail', 'standard', 'rosetted', 'sleepy-almond', 'small-fangs', 'crystal-horns', 'celestial-ears', 'sunburst-ruff', 'dragon-wings', 'phoenix-tail'],
      ['doodle-rainbow-trail', 'standard', 'orange-white', 'round', 'parted-mouth', 'antlers', 'feathered-ears', 'frill-neck', 'feathered-wings', 'flame-tail'],
    ]
    expect(report.status).toBe('candidate-visual-review')
    expect(report.runtimeEnabled).toBe(false)
    expect(report.scene).toMatchObject({ version: scene.sceneVersion, revision: scene.revision, rendererVersion: 'pixel-scene-rgba-v1' })
    expect(report.subject).toMatchObject({ artVersion: cat.artVersion, revision: cat.revision, rendererVersion: 'pixel-rgba-v1' })
    expect(report.samples).toHaveLength(9)
    expect(report.samples.map((sample: any) => [
      sample.backdrop,
      sample.phenotype.body,
      sample.phenotype.coat,
      sample.phenotype.eyes,
      sample.phenotype.expression,
      sample.phenotype.crown,
      sample.phenotype.ears,
      sample.phenotype.neck,
      sample.phenotype.back,
      sample.phenotype.tailTip,
    ])).toEqual(expected)
    expect(new Set(report.samples.map((sample: any) => sample.backdrop)).size).toBe(3)
    expect(new Set(report.samples.map((sample: any) => sample.phenotype.body))).toEqual(new Set(['standard', 'shortleg-round', 'slender-tall']))
    expect(new Set(report.samples.map((sample: any) => sample.phenotype.coat))).toEqual(new Set(['orange-white', 'brown-tabby', 'tuxedo', 'calico', 'colorpoint', 'rosetted']))
    expect(new Set(report.samples.map((sample: any) => canonicalJson([sample.backdrop, sample.phenotype]))).size).toBe(9)
    for (const backdrop of scene.growth.order) {
      const rows = report.samples.filter((sample: any) => sample.backdrop === backdrop)
      expect(rows).toHaveLength(3)
      expect(rows.some((sample: any) => ['crown', 'ears', 'neck', 'back', 'tailTip'].every(slot => sample.phenotype[slot] === 'none'))).toBe(true)
      expect(rows.some((sample: any) => ['crown', 'ears', 'neck', 'back', 'tailTip'].every(slot => sample.phenotype[slot] !== 'none'))).toBe(true)
    }

    const plans: Array<ReturnType<typeof planForValidatedCatalog>> = report.samples
      .map((sample: any) => planForValidatedCatalog(cat, sample.phenotype))
    const requiredCatResources = new Set<string>(plans.flatMap((plan: ReturnType<typeof planForValidatedCatalog>) =>
      plan.operations.flatMap((operation: any) =>
      operation.kind === 'draw' ? [operation.resource] : [],
      )))
    const catLayers: Record<string, Uint8ClampedArray> = {}
    await Promise.all([...requiredCatResources].map(async id => {
      const resource = cat.resources[id]!
      catLayers[id] = new Uint8ClampedArray(await sharp(readFileSync(catRoot + resource.path)).ensureAlpha().raw().toBuffer())
    }))
    const sceneLayers: Record<string, Uint8ClampedArray> = {}
    await Promise.all(Object.entries(scene.resources).map(async ([id, resource]) => {
      sceneLayers[id] = new Uint8ClampedArray(await sharp(readFileSync(sceneRoot + resource.path)).ensureAlpha().raw().toBuffer())
    }))
    const subjectMeta = {
      schemaVersion: cat.schemaVersion, rendererVersion: cat.rendererVersion, size: cat.size,
      artVersion: cat.artVersion, revision: cat.revision,
    }
    let firstCat: Uint8ClampedArray | undefined
    for (const [index, sample] of report.samples.entries()) {
      const row = cat.coverage.find(item => phenotypeKeyV2(item.phenotype) === phenotypeKeyV2(sample.phenotype))
      expect(row?.id).toBe(sample.coverageId)
      const catPixels = composePixelArt(plans[index]!, catLayers)
      const scenePixels = composePixelScene(
        { schemaVersion: 'pixel-scene-state-v1', backdrop: sample.backdrop }, scene, subjectMeta, catPixels, sceneLayers,
      )
      if (!firstCat) firstCat = catPixels
      expect(sha(catPixels)).toBe(sample.catRgbaSha256)
      expect(sha(scenePixels)).toBe(sample.sceneRgbaSha256)
      const pngBytes = readFileSync(sample.file)
      expect(sha(pngBytes)).toBe(sample.pngSha256)
      const image = sharp(pngBytes)
      expect(await image.metadata()).toMatchObject({ width: 96, height: 64 })
      expect(sha(await image.ensureAlpha().raw().toBuffer())).toBe(sample.sceneRgbaSha256)
    }
    expect(existsSync(qaRoot + 'samples/10.png')).toBe(false)
    const none = composePixelScene(
      { schemaVersion: 'pixel-scene-state-v1', backdrop: 'none' }, scene, subjectMeta, firstCat!, sceneLayers,
    )
    const manual = new Uint8ClampedArray(96 * 64 * 4)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const source = (y * 64 + x) * 4
      if (firstCat![source + 3]) manual.set(firstCat!.subarray(source, source + 4), (y * 96 + x + 16) * 4)
    }
    expect(none).toEqual(manual)
    expect(sha(none)).toBe(report.noneCase.sceneRgbaSha256)
  })
})
