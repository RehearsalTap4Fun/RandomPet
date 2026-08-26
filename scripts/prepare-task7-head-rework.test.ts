import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { structuralVariants, type InterfaceSourceManifest } from './interface-source-schema.js'
import { MAX_CENTRAL_LOBE_DEPTH_RATIO, measureCentralLobeDepthRatio } from './body-head-contact-metrics.js'
import { extractChecker, normalizeHead } from './prepare-task7-head-rework.js'

describe('Task 7 natural-neck head preparation', () => {
  it('binds every natural-neck head to the approved Task 7 review provenance', async () => {
    const root = process.cwd()
    const manifest = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'),
    ) as InterfaceSourceManifest
    const processed = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/production/processed-index.json'), 'utf8'),
    ) as { sourceIndex: { sources: Array<Record<string, any>> } }
    const reviewPath = 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json'
    const reviewSha256 = createHash('sha256').update(await readFile(resolve(root, reviewPath))).digest('hex')
    const naturalNeckHeads = structuralVariants(manifest).filter(item => (
      item.slotId === 'headShape' && item.sourcePngPath.includes('/task7-natural-neck/')
    ))

    expect(naturalNeckHeads).toHaveLength(12)
    for (const head of naturalNeckHeads) {
      const source = processed.sourceIndex.sources.find(item => item.sourceId === `${head.partId}:${head.rigId}`)
      expect(head.promptEvidence.reviewRecordPath, `${head.partId}:${head.rigId} manifest provenance`).toBe(reviewPath)
      expect(source, `${head.partId}:${head.rigId} source-index provenance`).toMatchObject({
        reviewRecordPath: reviewPath,
        reviewRecordSha256: reviewSha256,
      })
    }
    expect(naturalNeckHeads.some(head => head.promptEvidence.reviewRecordPath.endsWith('/review-record.json'))).toBe(false)
  })

  it('extracts true alpha and removes the authored central lobe from the prototype silhouette', async () => {
    const root = process.cwd()
    const temp = await mkdtemp(join(tmpdir(), 'qmonster-task7-head-'))
    const extracted = join(temp, 'extracted.png')
    const normalized = join(temp, 'normalized.png')
    const audit = await extractChecker(resolve(
      root,
      'asset-source/v0.3.0/generation/task7-candidates/biped/head_mushroom_cap/candidate-natural-neck-1.png',
    ), extracted)
    await normalizeHead(extracted, normalized, 'biped')
    const metadata = await sharp(normalized).metadata()
    const alpha = await sharp(normalized).extractChannel('alpha').raw().toBuffer()
    expect(metadata.hasAlpha).toBe(true)
    expect(alpha.includes(0)).toBe(true)
    expect(audit).toMatchObject({ boundaryAlphaPixels: 0 })

    const manifest = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'),
    ) as InterfaceSourceManifest
    const head = structuralVariants(manifest).find(item => item.partId === 'head_mushroom_cap' && item.rigId === 'biped')!
    expect(await measureCentralLobeDepthRatio({
      imagePath: normalized,
      rigId: 'biped',
      headId: 'head_mushroom_cap',
      connector: head.connectors.find(item => item.id === 'neck')!,
    })).toBeLessThanOrEqual(MAX_CENTRAL_LOBE_DEPTH_RATIO)
  }, 30_000)
})
