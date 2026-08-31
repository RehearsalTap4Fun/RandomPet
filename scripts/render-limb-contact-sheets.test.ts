import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXTERNAL_LIMB_ALPHA_MIN } from '@qmonster/renderer-canvas'
import { STRUCTURAL_SLOT_IDS } from '@qmonster/generator-core'
import { cleanupLimbMatrixHarness, LIMB_REVIEW_STRUCTURAL_SLOT_IDS, makeLimbMatrixPlan, makeLimbMatrixWorkerIndices, sweepCandidatePath, validateLimbRenderEvidence } from './render-limb-contact-sheets.js'

describe('Task 8 limb contact-sheet gate', () => {
  it('declares its four-slot review phase as a subset of canonical structural slots', () => {
    expect(LIMB_REVIEW_STRUCTURAL_SLOT_IDS).toEqual(['bodyFrame', 'headShape', 'arms', 'legs'])
    expect(LIMB_REVIEW_STRUCTURAL_SLOT_IDS.every(slotId => STRUCTURAL_SLOT_IDS.includes(slotId))).toBe(true)
  })

  it('partitions matrix cells across bounded workers without reordering or dropping entries', () => {
    expect(makeLimbMatrixWorkerIndices(5, 2)).toEqual([[0, 2, 4], [1, 3]])
    expect(makeLimbMatrixWorkerIndices(1, 2)).toEqual([[0]])
    expect(() => makeLimbMatrixWorkerIndices(4, 3 as 1 | 2)).toThrow('LIMB_MATRIX_WORKER_COUNT_INVALID')
  })

  it('closes every worker page and remaining harness resources after one page cleanup fails', async () => {
    const inputRoot = await mkdtemp(join(tmpdir(), 'qmonster-limb-worker-cleanup-'))
    const closed: string[] = []
    await expect(cleanupLimbMatrixHarness({
      inputRoot,
      pages: [
        { async close() { closed.push('page-0'); throw new Error('page close failed') } },
        { async close() { closed.push('page-1') } },
      ],
      browser: { async close() { closed.push('browser') } },
      server: { async close() { closed.push('server') } },
    })).rejects.toThrow('page close failed')
    expect(closed).toEqual(['page-0', 'page-1', 'browser', 'server'])
    await expect(readFile(inputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('plans every approved prototype body with its exact rig arm/leg prototype', () => {
    const plan = makeLimbMatrixPlan('prototype')
    expect(plan.map(entry => [entry.rigId, entry.bodyFrame, entry.arms, entry.legs])).toEqual([
      ['blob', 'body_blob_round', 'arms_paddle', 'legs_stub_feet'],
      ['blob', 'body_blob_wide', 'arms_paddle', 'legs_stub_feet'],
      ['floating', 'body_floating_drop', 'arms_long_noodle', 'legs_shadow_tiptoe'],
    ])
  })

  it('plans the option A hardest horizontal and vertical blob reauthor pair against both blob bodies', () => {
    expect(makeLimbMatrixPlan('option-a-prototype').map(entry => [entry.bodyFrame, entry.arms, entry.legs])).toEqual([
      ['body_blob_round', 'arms_short_plush', 'legs_shadow_tiptoe'],
      ['body_blob_wide', 'arms_short_plush', 'legs_shadow_tiptoe'],
    ])
  })

  it('uses an approved head whose neck plug stays inside each body receiver warp contract', () => {
    const plan = makeLimbMatrixPlan('full')
    expect(plan).toHaveLength(60)
    expect(plan.filter(entry => entry.bodyFrame === 'body_biped_tall')).toHaveLength(12)
    expect(plan.filter(entry => entry.bodyFrame === 'body_biped_tall').every(entry => entry.headShape === 'head_mushroom_cap')).toBe(true)
    expect(plan.filter(entry => entry.bodyFrame !== 'body_biped_tall').every(entry => entry.headShape === 'head_round_dome')).toBe(true)
  })

  it('binds transform-sweep evidence to the explicitly selected candidate revision', () => {
    expect(sweepCandidatePath('arms_short_plush', 6)).toBe('asset-source/v0.3.0/generation/task8-candidates/blob/arms_short_plush/candidate-6.png')
  })

  it('requires two independent resolver calls per pair and enforces every causal seam threshold', () => {
    expect(EXTERNAL_LIMB_ALPHA_MIN).toBe(0.614)
    const nodePaths = ['arm-left.webp', 'arm-right.webp', 'leg-left.webp', 'leg-right.webp']
    const metrics = ['neck', 'shoulderLeft', 'shoulderRight', 'hipLeft', 'hipRight'].map(connectorId => ({
      connectorId, receiverCoverage: 0.9, plugCoverage: 0.9,
      largestComponentRatio: 0.99, centerlineGapPixels: 2, childOutsideBodyRatio: connectorId === 'neck' ? null : 0.614,
    }))
    expect(validateLimbRenderEvidence({ diagnostics: [], connectorMetrics: metrics, resolvedAssetPaths: nodePaths }, nodePaths)).toEqual([])
    const belowGlobal = structuredClone(metrics)
    belowGlobal[1]!.childOutsideBodyRatio = 0.613999
    expect(validateLimbRenderEvidence({ diagnostics: [], connectorMetrics: belowGlobal, resolvedAssetPaths: nodePaths }, nodePaths)).not.toEqual([])
    for (const field of ['receiverCoverage', 'plugCoverage', 'largestComponentRatio', 'centerlineGapPixels', 'childOutsideBodyRatio'] as const) {
      const broken = structuredClone(metrics)
      ;(broken[1]![field] as number) = field === 'centerlineGapPixels' ? 3 : 0
      expect(validateLimbRenderEvidence({ diagnostics: [], connectorMetrics: broken, resolvedAssetPaths: nodePaths }, nodePaths)).not.toEqual([])
    }
    expect(validateLimbRenderEvidence({ diagnostics: [], connectorMetrics: metrics, resolvedAssetPaths: nodePaths.slice(1) }, nodePaths)).not.toEqual([])
    expect(validateLimbRenderEvidence({ diagnostics: [], connectorMetrics: metrics, resolvedAssetPaths: [...nodePaths, nodePaths[0]!] }, nodePaths)).not.toEqual([])
    expect(validateLimbRenderEvidence({
      diagnostics: [{ severity: 'error', code: 'CONNECTOR_COMPOSITE_FAILED', path: ['connectors', 'neck'], message: 'frozen Task 7 neck' }],
      connectorMetrics: [{ ...metrics[0]!, receiverCoverage: 0.6 }, ...metrics.slice(1)],
      resolvedAssetPaths: nodePaths,
    }, nodePaths)).toEqual([])
    expect(validateLimbRenderEvidence({
      diagnostics: [{ severity: 'error', code: 'COMPOSITION_BOUNDS_EXCEEDED', path: ['visualSlots', 'bodyFrame'], message: 'bounds' }],
      connectorMetrics: metrics, resolvedAssetPaths: nodePaths,
    }, nodePaths)).not.toEqual([])
  })
})
