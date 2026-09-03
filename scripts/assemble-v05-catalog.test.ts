import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { legacyTailRuntimePath, makeV05Catalog, makeV05InterfaceManifest, makeV05SourceIndex, type V05TailRuntimeResources } from './assemble-v05-catalog.js'
import { parseInterfaceSourceManifest } from '../packages/asset-catalog/src/interface-source-schema.js'

const hash = (character: string): string => character.repeat(64)

function tailResources(): V05TailRuntimeResources {
  return Object.fromEntries(['tail_cat_long', 'tail_dog_long'].map((tailId, tailIndex) => [tailId, Object.fromEntries(
    ['blob', 'biped', 'floating'].map((rigId, rigIndex) => [rigId, {
      previewPngPath: `assets/v0.5.0/structural/${rigId}/${tailId}.png`,
      previewPngSha256: hash(String(tailIndex + rigIndex + 1)),
      previewWebpPath: `assets/v0.5.0/structural/${rigId}/${tailId}.webp`,
      previewWebpSha256: hash(String(tailIndex + rigIndex + 2)),
      nodePngPath: `assets/v0.5.0/structural/${rigId}/${tailId}/nodes/${tailId}-${rigId}-tailRoot.png`,
      nodePngSha256: hash(String(tailIndex + rigIndex + 3)),
      nodeWebpPath: `assets/v0.5.0/structural/${rigId}/${tailId}/nodes/${tailId}-${rigId}-tailRoot.webp`,
      nodeWebpSha256: hash(String(tailIndex + rigIndex + 4)),
      contourMaskPath: `assets/v0.5.0/connectors/${rigId}/${tailId}-tailRoot-contour.png`,
      contourMaskSha256: hash(String(tailIndex + rigIndex + 5)),
      foregroundMaskPath: `assets/v0.5.0/connectors/${rigId}/${tailId}-tailRoot-foreground.png`,
      foregroundMaskSha256: hash(String(tailIndex + rigIndex + 6)),
      backgroundMaskPath: `assets/v0.5.0/connectors/${rigId}/${tailId}-tailRoot-background.png`,
      backgroundMaskSha256: hash(String(tailIndex + rigIndex + 7)),
    }])),
  ])) as V05TailRuntimeResources
}

describe('assemble v0.5 catalog', () => {
  it('recognizes legacy tail connector masks so they cannot enter the v0.5 runtime tree', () => {
    expect(legacyTailRuntimePath('connectors/blob/tail_soft_curl-tailRoot-contour.png')).toBe(true)
    expect(legacyTailRuntimePath('structural/blob/tail_dog_long.webp')).toBe(false)
  })

  it('replaces legacy tails and removes the double-head modifier in an immutable v0.5 catalog', async () => {
    const v04Catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.4.0/catalog.json', 'utf8'))

    const catalog = makeV05Catalog(v04Catalog, tailResources())

    expect(catalog.version).toBe('0.5.0')
    expect(catalog.modifiers.map((modifier: { id: string }) => modifier.id)).not.toContain('mutation_double_head')
    expect(catalog.modifiers.flatMap((modifier: { excludes?: string[] }) => modifier.excludes ?? [])).not.toContain('mutation_double_head')
    expect(catalog.parts.filter((part: { slotId: string }) => part.slotId === 'tail').map((part: { id: string }) => part.id).sort()).toEqual([
      'tail_cat_long', 'tail_dog_long', 'tail_none',
    ])
    for (const tailId of ['tail_cat_long', 'tail_dog_long']) {
      const part = catalog.parts.find((candidate: { id: string }) => candidate.id === tailId)
      expect(part?.composition?.mode).toBe('interface')
      expect(Object.keys(part?.composition?.variantsByRig ?? {}).sort()).toEqual(['biped', 'blob', 'floating'])
      for (const rigId of ['blob', 'biped', 'floating']) {
        const variant = part!.composition.variantsByRig[rigId]
        expect(variant.renderNodes).toHaveLength(1)
        expect(variant.renderNodes[0]).toMatchObject({
          connectorId: 'tailRoot',
          parentSlot: 'bodyFrame',
          layer: 'rearAppendage',
        })
        expect(variant.connectors).toHaveLength(1)
        expect(variant.connectors[0]).toMatchObject({ id: 'tailRoot', role: 'plug', connectorClass: 'tail' })
      }
    }
  })

  it('creates a v0.5 interface manifest with only the current tail identities', async () => {
    const [v04Catalog, v03Manifest] = await Promise.all([
      readFile('packages/asset-catalog/catalog/v0.4.0/catalog.json', 'utf8').then(JSON.parse),
      readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8').then(JSON.parse),
    ])
    const catalog = makeV05Catalog(v04Catalog, tailResources())

    const manifest = makeV05InterfaceManifest(v03Manifest, catalog)
    const parsed = parseInterfaceSourceManifest(manifest)

    expect(parsed).toMatchObject({ ok: true })
    expect(manifest.catalogVersion).toBe('0.5.0')
    expect(manifest.assets.filter((asset: { slotId: string }) => asset.slotId === 'tail').map((asset: { id: string }) => asset.id).sort())
      .toEqual(['tail_cat_long', 'tail_dog_long'])
    expect(JSON.stringify(manifest)).toContain('assets/v0.5.0/')
  })

  it('replaces legacy tail provenance with six exact v0.5 tail-variant records', async () => {
    const v04Index = JSON.parse(await readFile('packages/asset-catalog/source-index-v0.4.0.json', 'utf8'))
    const sourceSha256 = Object.fromEntries(['tail_cat_long', 'tail_dog_long'].map((tailId, tailIndex) => [tailId, Object.fromEntries(
      ['blob', 'biped', 'floating'].map((rigId, rigIndex) => [rigId, hash(String(tailIndex + rigIndex + 8))]),
    )]))

    const index = makeV05SourceIndex(v04Index, tailResources(), {
      promptSha256: hash('a'),
      reviewRecordSha256: hash('b'),
      sourceSha256,
    })

    expect(index.catalogVersion).toBe('0.5.0')
    expect(index.sources.filter((source: { sourceId: string }) => source.sourceId.startsWith('tail_')).map((source: { sourceId: string }) => source.sourceId).sort())
      .toEqual([
        'tail_cat_long:biped', 'tail_cat_long:blob', 'tail_cat_long:floating',
        'tail_dog_long:biped', 'tail_dog_long:blob', 'tail_dog_long:floating',
      ])
    expect(index.sources.find((source: { sourceId: string }) => source.sourceId === 'tail_cat_long:blob')).toMatchObject({
      kind: 'interface-structural',
      promptPath: 'asset-source/v0.5.0/prompts/long-tail-prompts.json',
      reviewRecordPath: 'packages/asset-catalog/review/v0.5.0/long-tail-review-record.json',
      runtimeResources: expect.arrayContaining([
        expect.objectContaining({ path: 'assets/v0.5.0/structural/blob/tail_cat_long.png' }),
        expect.objectContaining({ path: 'assets/v0.5.0/connectors/blob/tail_cat_long-tailRoot-contour.png' }),
      ]),
    })
    expect(index.sources.find((source: { sourceId: string }) => source.sourceId === 'extra_moth_wings:blob')).toMatchObject({
      sourceResources: expect.arrayContaining([
        expect.objectContaining({ path: 'asset-source/v0.5.0/masks/blob/extra_moth_wings/extraLeft-contour.png' }),
      ]),
    })
  })
})
