import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAttachmentPartComposition, parseCatalog, type Catalog } from '@qmonster/generator-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assembleV04Catalog,
  type V04CatalogPublishOperations,
} from './assemble-v04-catalog.js'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_IDS = [
  'surface_soft_scales',
  'pattern_gentle_stripes',
  'effect_bioluminescent_orbs',
] as const

const V03_PNG_SHA256 = {
  surface_soft_scales: '122f0cb016b5e4c62007df9dd50e9956736174696340a8adb38ff0b29b080e67',
  pattern_gentle_stripes: 'd473dbfd9a29eb170972deced3f72e95c7644f105151603d48f941bef3014fa0',
  effect_bioluminescent_orbs: 'c2a7ad732ae8ee96d4ce5bff3e5d167919d345529dc8c68ae4d01b5217e42d2f',
} as const

const V04_RUNTIME_SHA256 = {
  surface_soft_scales: {
    png: '9b3c9fc4b82edc389552efc895f1958ba07b9bce29d0215a6224231db816d8ec',
    webp: '6ffc00c5ff4a7dfa3ac73d78b0b5fc0fca2234337be03e6383b0ac0a04ff35f8',
  },
  pattern_gentle_stripes: {
    png: '3e4797bf34665e1cbbbce8ca8ed7e6d7835027c90d9faa72dff37f55ac4e923b',
    webp: '5da7fd70f27d56e2205629274e089e811659bc71cd9ce676b8da7a8100cc2b92',
  },
  effect_bioluminescent_orbs: {
    png: 'ba5a4e3e16d5ca51d3c81c6b0fbc42e5965161d89a755c38d7a76ab4acf619f1',
    webp: '0f5fbb06c9279f0e9bc6d0f0dc0be96047aa11300c2ba3d1c07b7f219a72f793',
  },
} as const

const V03_CATALOG_SHA256 = '58ca2ff0d91ee72fb6da788cdea7346daa77c2e400bc8dbe7ad156e87d4eb465'
const V03_INTERFACE_MANIFEST = 'asset-source/v0.3.0/interface-manifest.json'
const V04_FACE_ZONE_OVERLAY = 'asset-source/v0.4.0/interface-face-zone-overrides.json'

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function copyFileFromRepository(root: string, path: string): Promise<void> {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(REPOSITORY_ROOT, path), target)
}

async function seedRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-v04-catalog-'))
  await cp(
    join(REPOSITORY_ROOT, 'packages/asset-catalog/catalog/v0.3.0'),
    join(root, 'packages/asset-catalog/catalog/v0.3.0'),
    { recursive: true },
  )
  await copyFileFromRepository(root, 'packages/asset-catalog/source-index-v0.3.0.json')
  await cp(
    join(REPOSITORY_ROOT, 'asset-source/v0.4.0/runtime-staging/parts'),
    join(root, 'asset-source/v0.4.0/runtime-staging/parts'),
    { recursive: true },
  )
  for (const partId of REQUIRED_IDS) {
    await copyFileFromRepository(root, `packages/asset-catalog/assets/v0.3.0/parts/${partId}.png`)
    await copyFileFromRepository(root, `packages/asset-catalog/assets/v0.3.0/parts/${partId}.webp`)
  }
  await copyFileFromRepository(root, 'packages/asset-catalog/assets/v0.3.0/bridges/blob/neck.webp')
  await copyFileFromRepository(root, 'packages/asset-catalog/audit/v0.3.0/task9-composition-statistics.json')
  await copyFileFromRepository(root, 'packages/asset-catalog/review/v0.3.0/review-record.json')
  await copyFileFromRepository(root, V03_INTERFACE_MANIFEST)
  for (const path of [
    'packages/asset-catalog/assets/v0.3.0/structural/floating/task7-natural-neck/nodes/head_shadow_hood/neck.png',
    'packages/asset-catalog/assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-foreground.png',
    'packages/asset-catalog/assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-background.png',
  ]) await copyFileFromRepository(root, path)
  const manifestSha256 = await sha256File(join(root, V03_INTERFACE_MANIFEST))
  const overlayPath = join(root, V04_FACE_ZONE_OVERLAY)
  await mkdir(dirname(overlayPath), { recursive: true })
  await writeFile(overlayPath, `${JSON.stringify({
    schemaVersion: 'qmonster-v0.4-interface-face-zone-overlay-v1',
    catalogVersion: '0.4.0',
    basedOn: {
      manifestPath: V03_INTERFACE_MANIFEST,
      manifestSha256,
    },
    overrides: [{
      partId: 'head_shadow_hood',
      rigId: 'floating',
      baseFaceSafeZones: [{ x: 800, y: 1050, width: 448, height: 234 }],
      faceSafeZones: [{ x: 800, y: 1050, width: 448, height: 326 }],
    }],
    headOcclusionMaskOverride: {
      derivation: 'head-alpha-face-zone-promote-v1',
      node: {
        sourcePath: 'assets/v0.3.0/structural/floating/task7-natural-neck/nodes/head_shadow_hood/neck.png',
        sourceSha256: '33dd458c8039f1775499696807e7ceb37ad7684166e2d5a14639168f9198bcda',
      },
      foreground: {
        sourcePath: 'assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-foreground.png',
        sourceSha256: '1aab57d718754a94b00b2d6c1b49014bcad76dda9e285a1ade2b11ef460a9914',
        targetPath: 'assets/v0.4.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-foreground.png',
      },
      background: {
        sourcePath: 'assets/v0.3.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-background.png',
        sourceSha256: 'a6f5b0c96020d44e9cb989dfc5a4858bbe699195983982781c6292d7e7579b25',
        targetPath: 'assets/v0.4.0/connectors/floating/task7-natural-neck/head_shadow_hood-neck-background.png',
      },
    },
  }, null, 2)}\n`)
  return root
}

async function fileHashes(root: string, directory: string): Promise<Record<string, string>> {
  const absolute = join(root, directory)
  const output: Record<string, string> = {}
  const visit = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = join(path, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) output[relative(absolute, target).replaceAll('\\', '/')] = await sha256File(target)
      else throw new Error(`Unexpected fixture entry: ${target}`)
    }
  }
  await visit(absolute)
  return output
}

async function snapshotV03(root: string): Promise<Record<string, Record<string, string>>> {
  return Object.fromEntries(await Promise.all([
    'packages/asset-catalog/catalog/v0.3.0',
    'packages/asset-catalog/assets/v0.3.0',
    'packages/asset-catalog/audit/v0.3.0',
    'packages/asset-catalog/review/v0.3.0',
  ].map(async path => [path, await fileHashes(root, path)] as const)))
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

describe('immutable v0.4.0 catalog assembly', () => {
  let root: string
  let v03Before: Record<string, Record<string, string>>
  let assembled: Catalog

  beforeAll(async () => {
    root = await seedRepository()
    expect(await sha256File(join(root, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'))).toBe(V03_CATALOG_SHA256)
    for (const partId of REQUIRED_IDS) {
      expect(await sha256File(join(root, `packages/asset-catalog/assets/v0.3.0/parts/${partId}.png`))).toBe(V03_PNG_SHA256[partId])
    }
    v03Before = await snapshotV03(root)
    assembled = await assembleV04Catalog({ repositoryRoot: root })
  })

  afterAll(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('copies the release exactly once with valid v0.4 policy, paths, hashes, shards, and pending review', async () => {
    const catalogRoot = join(root, 'packages/asset-catalog/catalog/v0.4.0')
    const assetRoot = join(root, 'packages/asset-catalog/assets/v0.4.0')
    const v04 = await readJson<Catalog>(join(catalogRoot, 'catalog.json'))
    const review = await readJson<Record<string, unknown>>(join(root, 'packages/asset-catalog/review/v0.4.0/review-record.json'))
    const sourceIndex = await readJson<{ catalogVersion: string; sources: Array<Record<string, unknown>> }>(
      join(root, 'packages/asset-catalog/source-index-v0.4.0.json'),
    )
    const evidence = await readJson<Record<string, unknown>>(
      join(root, 'packages/asset-catalog/audit/v0.4.0/evidence-manifest.json'),
    )

    expect(assembled).toEqual(v04)
    expect(v04.version).toBe('0.4.0')
    expect(v04.compositionPolicy?.maxStrongNonFacialFeatures).toBe(1)
    expect(JSON.stringify(v04)).not.toContain('assets/v0.3.0/')
    expect(parseCatalog(v04).ok).toBe(true)
    expect(review).toMatchObject({
      catalogVersion: '0.4.0',
      decision: 'pending_user_review',
      userApproved: false,
    })
    expect(evidence).toEqual({
      manifestVersion: 'qmonster-production-evidence-v1',
      canonicalization: 'json-object-keys-unicode-code-point-v1',
      catalogVersion: '0.4.0',
      sourceIndexPath: 'packages/asset-catalog/source-index-v0.4.0.json',
      evidenceRootSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(sourceIndex.catalogVersion).toBe('0.4.0')
    const overlaySha256 = await sha256File(join(root, V04_FACE_ZONE_OVERLAY))
    const manifestSha256 = await sha256File(join(root, V03_INTERFACE_MANIFEST))
    expect(v04.parts.find(part => part.id === 'head_shadow_hood')?.composition).toMatchObject({
      mode: 'interface',
      variantsByRig: {
        floating: {
          faceSafeZones: [{ x: 800, y: 1050, width: 448, height: 326 }],
        },
      },
    })
    const floatingHood = v04.parts.find(part => part.id === 'head_shadow_hood')?.composition
    if (floatingHood?.mode !== 'interface') throw new Error('Expected the floating hood interface composition.')
    const maskConnector = floatingHood.variantsByRig.floating!.connectors.find(item => item.id === 'neck')!
    expect(maskConnector.foregroundMaskSha256).not.toBe('1aab57d718754a94b00b2d6c1b49014bcad76dda9e285a1ade2b11ef460a9914')
    expect(maskConnector.backgroundMaskSha256).not.toBe('a6f5b0c96020d44e9cb989dfc5a4858bbe699195983982781c6292d7e7579b25')
    expect(await sha256File(join(root, 'packages/asset-catalog', maskConnector.foregroundMaskPath))).toBe(maskConnector.foregroundMaskSha256)
    expect(await sha256File(join(root, 'packages/asset-catalog', maskConnector.backgroundMaskPath))).toBe(maskConnector.backgroundMaskSha256)
    expect(sourceIndex.sources.find(source => source.sourceId === 'head_shadow_hood:floating')).toMatchObject({
      interfaceMetadataOverlay: {
        schemaVersion: 'qmonster-v0.4-interface-face-zone-overlay-v1',
        sourcePath: V04_FACE_ZONE_OVERLAY,
        sourceSha256: overlaySha256,
        manifestPath: V03_INTERFACE_MANIFEST,
        manifestSha256,
      },
    })
    expect(review).toMatchObject({
      interfaceMetadataOverlay: {
        schemaVersion: 'qmonster-v0.4-interface-face-zone-overlay-v1',
        sourcePath: V04_FACE_ZONE_OVERLAY,
        sourceSha256: overlaySha256,
        manifestPath: V03_INTERFACE_MANIFEST,
        manifestSha256,
      },
    })

    expect(await fileHashes(root, 'packages/asset-catalog/assets/v0.4.0')).toEqual(expect.objectContaining(
      Object.fromEntries(Object.keys(v03Before['packages/asset-catalog/assets/v0.3.0']!).map(path => [path, expect.any(String)])),
    ))
    expect(Object.keys(await fileHashes(root, 'packages/asset-catalog/assets/v0.4.0')).sort()).toEqual(
      Object.keys(v03Before['packages/asset-catalog/assets/v0.3.0']!).sort(),
    )

    for (const partId of REQUIRED_IDS) {
      const expected = V04_RUNTIME_SHA256[partId]
      const part = v04.parts.find(candidate => candidate.id === partId)!
      expect(await sha256File(join(assetRoot, `parts/${partId}.png`))).toBe(expected.png)
      expect(await sha256File(join(assetRoot, `parts/${partId}.webp`))).toBe(expected.webp)
      expect(part.pngSha256).toBe(expected.png)
      expect(part.assetSha256).toBe(expected.webp)
      if (!isAttachmentPartComposition(part.composition)) throw new Error(`${partId} must remain an attachment part`)
      const matchingNodes = part.composition.renderNodes.filter(node => (
        node.assetPath === `parts/${partId}.webp` || node.pngPath === `parts/${partId}.png`
      ))
      expect(matchingNodes).toHaveLength(3)
      for (const node of matchingNodes) {
        expect(node.assetSha256).toBe(expected.webp)
        expect(node.pngSha256).toBe(expected.png)
      }
      expect(sourceIndex.sources.find(source => source.sourceId === partId)).toMatchObject({
        runtimePngPath: `packages/asset-catalog/assets/v0.4.0/parts/${partId}.png`,
        runtimePngSha256: expected.png,
        runtimeWebpPath: `packages/asset-catalog/assets/v0.4.0/parts/${partId}.webp`,
        runtimeWebpSha256: expected.webp,
        replacementProvenance: {
          schemaVersion: 'v0.4-single-face-release-overlay-v1',
          sourcePath: 'asset-source/v0.4.0/runtime-staging/parts/provenance.json',
        },
      })
    }

    expect(Object.fromEntries([
      'surface_gel_bubbles',
      'effect_bioluminescent_orbs',
      'effect_spore_glow',
      'surface_soft_scales',
      'pattern_gentle_stripes',
    ].map(partId => {
      const part = v04.parts.find(candidate => candidate.id === partId)!
      return [partId, part.composition?.visualIntensity]
    }))).toEqual({
      surface_gel_bubbles: 'strong',
      effect_bioluminescent_orbs: 'strong',
      effect_spore_glow: 'strong',
      surface_soft_scales: 'quiet',
      pattern_gentle_stripes: 'quiet',
    })

    await expect(Promise.all([
      readJson(join(catalogRoot, 'themes.json')),
      readJson(join(catalogRoot, 'rigs.json')),
      readJson(join(catalogRoot, 'parts.json')),
      readJson(join(catalogRoot, 'semantic-traits.json')),
      readJson(join(catalogRoot, 'modifiers.json')),
    ])).resolves.toEqual([v04.themes, v04.rigs, v04.parts, v04.semanticTraits, v04.modifiers])
    expect(await snapshotV03(root)).toEqual(v03Before)
  })

  it('refuses overwrite and makes verify-only a byte-for-byte read-only operation', async () => {
    await expect(assembleV04Catalog({ repositoryRoot: root })).rejects.toThrow('V04_RELEASE_ALREADY_COMPLETE')
    const before = await fileHashes(root, 'packages/asset-catalog')
    await expect(assembleV04Catalog({ repositoryRoot: root, verifyOnly: true })).resolves.toEqual(assembled)
    expect(await fileHashes(root, 'packages/asset-catalog')).toEqual(before)
    expect(await snapshotV03(root)).toEqual(v03Before)
  })
})

it('rolls back every published v0.4 target when publication fails mid-transaction', async () => {
  const root = await seedRepository()
  let publishCount = 0
  const operations: V04CatalogPublishOperations = {
    async publish(stagedPath, targetPath) {
      publishCount += 1
      if (publishCount === 3) throw new Error('injected publish failure')
      await rename(stagedPath, targetPath)
    },
  }
  try {
    const v03Before = await snapshotV03(root)
    await expect(assembleV04Catalog({ repositoryRoot: root, publishOperations: operations }))
      .rejects.toThrow('injected publish failure')
    for (const path of [
      'packages/asset-catalog/catalog/v0.4.0',
      'packages/asset-catalog/assets/v0.4.0',
      'packages/asset-catalog/source-index-v0.4.0.json',
      'packages/asset-catalog/audit/v0.4.0',
      'packages/asset-catalog/review/v0.4.0',
    ]) await expect(readFile(join(root, path))).rejects.toMatchObject({ code: expect.stringMatching(/^E(?:ISDIR|NOENT)$/u) })
    expect((await readdir(join(root, 'packages/asset-catalog'))).filter(name => name.startsWith('.qmonster-v04-catalog-transaction-'))).toEqual([])
    expect(await snapshotV03(root)).toEqual(v03Before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
