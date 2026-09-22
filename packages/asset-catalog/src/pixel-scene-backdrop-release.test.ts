import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../generator-core/src/canonical-json.js'
import { requirePixelArtCatalogV3 } from './pixel-art-catalog-v3.js'
import { requirePixelSceneCatalogV1 } from './pixel-scene-catalog.js'

const sceneRoot = 'packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/'
const catRoot = 'packages/asset-catalog/pixel/v3/approved-1.6.1/'
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const temporary: string[] = []

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
})
