import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { structuralVariants, type InterfaceSourceManifest } from './interface-source-schema.js'
import { MAX_CENTRAL_LOBE_DEPTH_RATIO, measureCentralLobeDepthRatio } from './body-head-contact-metrics.js'
import { extractChecker, normalizeHead } from './prepare-task7-head-rework.js'

describe('Task 7 natural-neck head preparation', () => {
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
      connector: head.connectors.find(item => item.id === 'neck')!,
    })).toBeLessThanOrEqual(MAX_CENTRAL_LOBE_DEPTH_RATIO)
  }, 30_000)
})
