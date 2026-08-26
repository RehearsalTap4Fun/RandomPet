import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { structuralVariants, type InterfaceSourceManifest } from './interface-source-schema.js'
import {
  MAX_VISIBLE_TONGUE_AREA_RATIO,
  MAX_VISIBLE_TONGUE_DEPTH_RATIO,
  MAX_CENTRAL_LOBE_DEPTH_RATIO,
  measureCentralLobeDepthRatio,
  measureVisibleConnectorTongue,
  naturalNeckSeamLiftRatio,
} from './body-head-contact-metrics.js'

const HEAD_IDS = ['head_round_dome', 'head_mushroom_cap', 'head_angler_bulb', 'head_shadow_hood']

describe('body/head visible connector tongue', () => {
  it('uses a shallow curved seam rather than a flat connector cut', () => {
    expect(MAX_VISIBLE_TONGUE_DEPTH_RATIO).toBe(0.1)
    expect(MAX_VISIBLE_TONGUE_AREA_RATIO).toBe(0.1)
    expect(MAX_CENTRAL_LOBE_DEPTH_RATIO).toBe(0.2)
    expect(naturalNeckSeamLiftRatio(0)).toBe(0.55)
    expect(naturalNeckSeamLiftRatio(0.5)).toBeCloseTo(0.4125)
    expect(naturalNeckSeamLiftRatio(1)).toBe(0)
  })

  it('rejects the authored biped mushroom stem independently of receiver depth', async () => {
    const root = process.cwd()
    const manifest = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'),
    ) as InterfaceSourceManifest
    const head = structuralVariants(manifest).find(item => item.partId === 'head_mushroom_cap' && item.rigId === 'biped')!
    const plug = head.connectors.find(item => item.id === 'neck')!
    const ratio = await measureCentralLobeDepthRatio({
      imagePath: resolve(root, 'asset-source/v0.3.0/production/nodes/head_mushroom_cap/neck.png'),
      rigId: 'biped',
      connector: plug,
    })
    expect(ratio).toBeGreaterThan(MAX_CENTRAL_LOBE_DEPTH_RATIO)
  })

  it('cannot hide the rejected mushroom tongue by scaling compatible connector width and depth declarations', async () => {
    const root = process.cwd()
    const manifest = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'),
    ) as InterfaceSourceManifest
    const variants = structuralVariants(manifest)
    const body = variants.find(item => item.partId === 'body_biped_tall' && item.rigId === 'biped')!
    const head = variants.find(item => item.partId === 'head_mushroom_cap' && item.rigId === 'biped')!
    const oldHead = {
      ...head,
      renderNodes: head.renderNodes.map(node => ({
        ...node,
        sourcePngPath: 'asset-source/v0.3.0/production/nodes/head_mushroom_cap/neck.png',
      })),
      connectors: head.connectors.map(connector => connector.id === 'neck' ? {
        ...connector,
        foregroundMaskPath: 'assets/v0.3.0/connectors/biped/head_mushroom_cap-neck-foreground.png',
        backgroundMaskPath: 'assets/v0.3.0/connectors/biped/head_mushroom_cap-neck-background.png',
      } : connector),
    }
    const scale = <T extends typeof body>(variant: T): T => ({
      ...variant,
      connectors: variant.connectors.map(connector => connector.id === 'neck' ? {
        ...connector,
        width: connector.width * 1.2,
        depth: connector.depth * 10,
      } : connector),
    })
    const baselineLobe = await measureCentralLobeDepthRatio({
      imagePath: resolve(root, oldHead.renderNodes[0]!.sourcePngPath),
      rigId: 'biped',
      connector: oldHead.connectors.find(item => item.id === 'neck')!,
    })
    const scaledLobe = await measureCentralLobeDepthRatio({
      imagePath: resolve(root, oldHead.renderNodes[0]!.sourcePngPath),
      rigId: 'biped',
      connector: scale(oldHead).connectors.find(item => item.id === 'neck')!,
    })
    const baselineVisible = await measureVisibleConnectorTongue({ root, body, head: oldHead })
    const scaledVisible = await measureVisibleConnectorTongue({ root, body: scale(body), head: scale(oldHead) })

    expect(baselineLobe).toBeGreaterThan(MAX_CENTRAL_LOBE_DEPTH_RATIO)
    expect(baselineVisible.visibleTongueDepthRatio).toBeGreaterThan(MAX_VISIBLE_TONGUE_DEPTH_RATIO)
    expect(scaledLobe).toBeCloseTo(baselineLobe, 12)
    expect(scaledVisible.visibleTongueDepthRatio).toBeCloseTo(baselineVisible.visibleTongueDepthRatio, 12)
    expect(scaledVisible.visibleTongueAreaRatio).toBeCloseTo(baselineVisible.visibleTongueAreaRatio, 12)
  })

  it('limits exposed plug depth and area for every exact body × head pair', async () => {
    const root = process.cwd()
    const manifest = JSON.parse(
      await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'),
    ) as InterfaceSourceManifest
    const variants = structuralVariants(manifest)
    const measurements = []

    for (const rigId of ['blob', 'biped', 'floating'] as const) {
      const bodies = variants.filter(item => item.rigId === rigId && item.slotId === 'bodyFrame')
      const heads = HEAD_IDS.map(headId => variants.find(item => (
        item.rigId === rigId && item.slotId === 'headShape' && item.partId === headId
      ))!)
      for (const body of bodies) for (const head of heads) {
        measurements.push({
          bodyId: body.partId,
          headId: head.partId,
          centralLobeDepthRatio: await measureCentralLobeDepthRatio({
            imagePath: resolve(root, head.renderNodes[0]!.sourcePngPath),
            rigId,
            connector: head.connectors.find(item => item.id === 'neck')!,
          }),
          ...(await measureVisibleConnectorTongue({ root, body, head })),
        })
      }
    }

    expect(measurements).toHaveLength(20)
    expect(measurements.filter(item => (
      item.visibleTongueDepthRatio > MAX_VISIBLE_TONGUE_DEPTH_RATIO
      || item.visibleTongueAreaRatio > MAX_VISIBLE_TONGUE_AREA_RATIO
      || item.centralLobeDepthRatio > MAX_CENTRAL_LOBE_DEPTH_RATIO
    ))).toEqual([])
  }, 30_000)
})
