import { describe, expect, it } from 'vitest'
import { buildTailExtraMatrixIndex, makeTailExtraMatrixPlan, reconstructTailExtraMatrixEvidence, validateTailExtraRenderEvidence } from './render-tail-extra-structural-matrices.js'

describe('Task 9 tail/extra structural matrices', () => {
  it('binds the three full matrix artifacts and manifests into one exact-hash index', () => {
    const index = buildTailExtraMatrixIndex([
      { rigId: 'blob', entryCount: 15, originalPath: '/blob.png', originalSha256: 'a'.repeat(64), review256Path: '/blob-256.png', review256Sha256: 'b'.repeat(64), manifestPath: '/blob.json', manifestSha256: 'c'.repeat(64) },
      { rigId: 'biped', entryCount: 15, originalPath: '/biped.png', originalSha256: 'd'.repeat(64), review256Path: '/biped-256.png', review256Sha256: 'e'.repeat(64), manifestPath: '/biped.json', manifestSha256: 'f'.repeat(64) },
      { rigId: 'floating', entryCount: 9, originalPath: '/floating.png', originalSha256: '1'.repeat(64), review256Path: '/floating-256.png', review256Sha256: '2'.repeat(64), manifestPath: '/floating.json', manifestSha256: '3'.repeat(64) },
    ])
    expect(index.entryCount).toBe(39)
    expect(index.entryCountByRig).toEqual({ blob: 15, biped: 15, floating: 9 })
    expect(index.artifacts).toHaveLength(3)
    expect(index.artifacts.every(artifact => /^[a-f0-9]{64}$/.test(artifact.manifestSha256))).toBe(true)
  })

  it('freezes every body by one-slot identity plus three deterministic mixed entries per rig', () => {
    const plan = makeTailExtraMatrixPlan('full')
    expect(plan).toHaveLength(39)
    expect(Object.fromEntries(['blob', 'biped', 'floating'].map(rigId => [
      rigId,
      plan.filter(entry => entry.rigId === rigId).length,
    ]))).toEqual({ blob: 15, biped: 15, floating: 9 })

    for (const [rigId, bodies] of Object.entries({
      blob: ['body_blob_round', 'body_blob_wide'],
      biped: ['body_biped_peanut', 'body_biped_tall'],
      floating: ['body_floating_drop'],
    })) {
      for (const bodyFrame of bodies) {
        const oneSlot = plan.filter(entry => entry.rigId === rigId && entry.bodyFrame === bodyFrame && entry.mode !== 'mixed')
        expect(oneSlot.filter(entry => entry.mode === 'tail-only').map(entry => entry.tail).sort()).toEqual([
          'tail_fish_fan', 'tail_mushroom_cluster', 'tail_soft_curl',
        ])
        expect(oneSlot.filter(entry => entry.mode === 'extra-only').map(entry => entry.extraAppendage).sort()).toEqual([
          'extra_moth_wings', 'extra_side_fins', 'extra_soft_tentacles',
        ])
      }
      const mixed = plan.filter(entry => entry.rigId === rigId && entry.mode === 'mixed')
      expect(mixed).toHaveLength(3)
      expect(mixed.map(entry => [entry.tail, entry.extraAppendage])).toEqual([
        ['tail_fish_fan', 'extra_soft_tentacles'],
        ['tail_soft_curl', 'extra_side_fins'],
        ['tail_mushroom_cluster', 'extra_moth_wings'],
      ])
    }
  })

  it('freezes a three-rig live prototype that exercises tail and both extra connectors', () => {
    const plan = makeTailExtraMatrixPlan('prototype')
    expect(plan).toHaveLength(3)
    expect(plan.map(entry => entry.rigId)).toEqual(['blob', 'biped', 'floating'])
    expect(plan.every(entry => entry.mode === 'mixed')).toBe(true)
  })

  it('enforces causal target metrics and exact resolver calls', () => {
    const expected = ['/tail.webp', '/left.webp', '/right.webp']
    const metric = (connectorId: string) => ({
      connectorId,
      receiverCoverage: 0.95,
      plugCoverage: 0.96,
      largestComponentRatio: 0.995,
      centerlineGapPixels: 1,
      childOutsideBodyRatio: 0.8,
    })
    const evidence = {
      diagnostics: [],
      resolvedAssetPaths: expected,
      connectorMetrics: [
        metric('neck'), metric('shoulderLeft'), metric('shoulderRight'), metric('hipLeft'), metric('hipRight'),
        metric('tailRoot'), metric('extraLeft'), metric('extraRight'),
      ],
    }
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight'])).toEqual([])
    evidence.connectorMetrics.find(item => item.connectorId === 'tailRoot')!.centerlineGapPixels = 3
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight']))
      .toContain('tailRoot:centerlineGapPixels')
  })

  it('keeps the biped extra pair causally covered after the live placement transform', async () => {
    const result = await reconstructTailExtraMatrixEvidence({ mode: 'prototype', failOnGateError: false })
    const biped = result.entries.find(entry => entry.rigId === 'biped')!
    const extraMetrics = biped.connectorMetrics.filter(metric => metric.connectorId === 'extraLeft' || metric.connectorId === 'extraRight')
    expect(extraMetrics).toHaveLength(2)
    expect(extraMetrics.every(metric => metric.receiverCoverage >= 0.9)).toBe(true)
    expect(extraMetrics.every(metric => metric.plugCoverage >= 0.9)).toBe(true)
    expect(extraMetrics.every(metric => metric.centerlineGapPixels <= 2)).toBe(true)
  }, 60_000)
})
