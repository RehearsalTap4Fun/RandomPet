import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  applyRetainedCoordinateMetadata,
  buildRigStructuralUnionAlphaEvidence,
  deriveRetainedCoordinateMetadata,
  mergeRetainedNonstructuralSourceIndex,
  RETAINED_NONSTRUCTURAL_SLOTS,
  planRetainedNonstructuralAssets,
  retainV02NonstructuralAssets,
} from './retain-v02-nonstructural-assets.js'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('retain v0.2 non-structural assets', () => {
  it('plans the frozen 31-part, 62-file retained catalog without reading v0.2 coordinates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-retain-plan-'))
    const catalogDirectory = join(root, 'packages/asset-catalog/catalog/v0.2.0')
    await mkdir(catalogDirectory, { recursive: true })
    const parts = RETAINED_NONSTRUCTURAL_SLOTS.flatMap(([slotId, count]) => (
      Array.from({ length: count }, (_, index) => ({
        id: `${slotId}_${index}`,
        slotId,
        assetPath: `parts/${slotId}_${index}.webp`,
        pngPath: `parts/${slotId}_${index}.png`,
        composition: {
          renderNodes: [{ origin: { x: -999, y: -999 }, transform: { scale: -999 } }],
        },
      })))
    )
    await writeFile(join(catalogDirectory, 'catalog.json'), JSON.stringify({ parts }))
    const sources = parts.map(part => ({
      sourceId: part.id,
      slotId: part.slotId,
      runtimePngPath: `packages/asset-catalog/assets/v0.2.0/${part.pngPath}`,
      runtimePngSha256: 'a'.repeat(64),
      runtimeWebpPath: `packages/asset-catalog/assets/v0.2.0/${part.assetPath}`,
      runtimeWebpSha256: 'b'.repeat(64),
    }))
    await writeFile(
      join(root, 'packages/asset-catalog/source-index-v0.2.0.json'),
      JSON.stringify({ sources }),
    )

    const plan = await planRetainedNonstructuralAssets(root)

    expect(plan.parts).toHaveLength(31)
    expect(plan.files).toHaveLength(62)
    expect(Object.fromEntries(RETAINED_NONSTRUCTURAL_SLOTS.map(([slotId]) => [
      slotId,
      plan.parts.filter(part => part.slotId === slotId).length,
    ]))).toEqual({
      eyes: 5,
      mouthShape: 4,
      oralDetail: 4,
      headAppendage: 4,
      surfaceMaterial: 4,
      pattern: 4,
      colorScheme: 3,
      effect: 3,
    })
    expect(JSON.stringify(plan)).not.toContain('-999')
  })

  it('copies accepted bytes to v0.3 source/runtime roots and records closed provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-retain-copy-'))
    const catalogDirectory = join(root, 'packages/asset-catalog/catalog/v0.2.0')
    await mkdir(catalogDirectory, { recursive: true })
    const parts = RETAINED_NONSTRUCTURAL_SLOTS.flatMap(([slotId, count]) => (
      Array.from({ length: count }, (_, index) => ({
        id: `${slotId}_${index}`,
        slotId,
        assetPath: `parts/${slotId}_${index}.webp`,
        pngPath: `parts/${slotId}_${index}.png`,
      })))
    )
    await writeFile(join(catalogDirectory, 'catalog.json'), JSON.stringify({ parts }))
    const sources = []
    for (const [partIndex, part] of parts.entries()) {
      const pngPath = `packages/asset-catalog/assets/v0.2.0/${part.pngPath}`
      const webpPath = `packages/asset-catalog/assets/v0.2.0/${part.assetPath}`
      const png = Buffer.from(`png-${partIndex}`)
      const webp = Buffer.from(`webp-${partIndex}`)
      await mkdir(join(root, pngPath, '..'), { recursive: true })
      await writeFile(join(root, pngPath), png)
      await writeFile(join(root, webpPath), webp)
      sources.push({
        sourceId: part.id,
        slotId: part.slotId,
        runtimePngPath: pngPath,
        runtimePngSha256: sha256(png),
        runtimeWebpPath: webpPath,
        runtimeWebpSha256: sha256(webp),
      })
    }
    const retainedPrompt = Buffer.from('retained prompt evidence\n')
    const retainedPromptPath = 'asset-source/v0.2.0/prompts/retained.txt'
    await mkdir(dirname(join(root, retainedPromptPath)), { recursive: true })
    await writeFile(join(root, retainedPromptPath), retainedPrompt)
    Object.assign(sources[0]!, {
      prompt: retainedPrompt.toString('utf8').trimEnd(),
      promptPath: retainedPromptPath,
      promptSha256: sha256(Buffer.from(retainedPrompt.toString('utf8').trimEnd())),
    })
    await writeFile(
      join(root, 'packages/asset-catalog/source-index-v0.2.0.json'),
      JSON.stringify({ sources }),
    )
    await mkdir(join(root, 'asset-source/v0.3.0/production'), { recursive: true })
    await writeFile(
      join(root, 'asset-source/v0.3.0/production/processed-index.json'),
      JSON.stringify({ sourceIndex: { catalogVersion: '0.3.0', sources: [{ sourceId: 'structural', kind: 'interface-structural' }] } }),
    )

    const report = await retainV02NonstructuralAssets(root)

    expect(report).toMatchObject({ parts: 31, files: 62, byteIdenticalFiles: 62, acceptedSourceMasters: 31 })
    const provenancePath = join(
      root,
      'asset-source/v0.3.0/provenance/retained-v0.2-nonstructural.json',
    )
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
    expect(provenance.entries).toHaveLength(62)
    expect(provenance.acceptedSourceMasters).toHaveLength(31)
    for (const entry of provenance.entries) {
      expect(entry).toMatchObject({
        byteIdentical: true,
        v02Sha256: entry.v03SourceSha256,
        v03SourceSha256: entry.v03RuntimeSha256,
      })
      expect(await readFile(join(root, entry.v02Path))).toEqual(
        await readFile(join(root, entry.v03SourcePath)),
      )
      expect(await readFile(join(root, entry.v02Path))).toEqual(
        await readFile(join(root, entry.v03RuntimePath)),
      )
    }
    const merged = await mergeRetainedNonstructuralSourceIndex(root)
    expect(merged).toEqual({ retainedSources: 31, totalSources: 32 })
    const v03Index = JSON.parse(await readFile(
      join(root, 'packages/asset-catalog/source-index-v0.3.0.json'), 'utf8',
    ))
    expect(v03Index.sources.filter((source: any) => source.retainedFrom)).toHaveLength(31)
    const migrated = v03Index.sources.find((source: any) => source.sourceId === parts[0]!.id)
    expect(migrated.promptPath).toBe('asset-source/v0.3.0/retained-v0.2/source-rich/prompts/retained.txt')
    expect(await readFile(join(root, migrated.promptPath))).toEqual(retainedPrompt)
    expect(JSON.stringify(v03Index.sources.filter((source: any) => source.retainedFrom))).not.toContain('asset-source/v0.2.0/')
  })

  it('rebuilds 31 retained parts from 12 exact head sockets and five structural unions', async () => {
    const metadata = await deriveRetainedCoordinateMetadata(process.cwd())

    expect(metadata.headFeatureSockets).toHaveLength(12)
    expect(metadata.bodyStructuralUnions).toHaveLength(5)
    expect(metadata.parts).toHaveLength(31)
    expect(metadata.parts.flatMap(part => part.renderNodes)).toHaveLength(87)
    expect(metadata.parts.filter(part => part.isNone)).toHaveLength(2)
    expect(JSON.stringify(metadata)).not.toContain('v0.2.0')
    for (const union of metadata.bodyStructuralUnions) {
      expect(union.contributorIds.length).toBeGreaterThan(1)
      expect(union.structuralUnionSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(union.socket.x).toBeGreaterThanOrEqual(union.alphaBounds.x)
      expect(union.socket.x).toBeLessThanOrEqual(union.alphaBounds.x + union.alphaBounds.width)
      expect(union.socket.y).toBeGreaterThanOrEqual(union.alphaBounds.y)
      expect(union.socket.y).toBeLessThanOrEqual(union.alphaBounds.y + union.alphaBounds.height)
    }
    const rigUnions = await buildRigStructuralUnionAlphaEvidence(process.cwd(), { dryRun: true })
    expect(rigUnions).toHaveLength(3)
    expect(rigUnions.map(item => item.rigId).sort()).toEqual(['biped', 'blob', 'floating'])
    expect(rigUnions.every(item => item.bodyIds.length >= 1 && /^[a-f0-9]{64}$/u.test(item.pngSha256))).toBe(true)
    for (const part of metadata.parts.filter(part => !part.isNone)) {
      expect(part.renderNodes.map(node => node.compatibleRigs[0]).sort()).toEqual([
        'biped', 'blob', 'floating',
      ])
      expect(part.renderNodes.every(node => node.coordinateSource !== 'v0.2-coordinate')).toBe(true)
    }

    const output = await applyRetainedCoordinateMetadata(process.cwd(), { dryRun: true })
    expect(output).toMatchObject({ parts: 31, renderNodes: 87, headFeatureSockets: 12, bodyStructuralUnions: 5 })
  }, 30_000)
})
