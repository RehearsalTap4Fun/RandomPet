import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTailExtraMatrixIndex, makeTailExtraMatrixPlan, reconstructTailExtraMatrixEvidence, validateStoredTailExtraMatrixEvidence, validateTailExtraRenderEvidence } from './render-tail-extra-structural-matrices.js'

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

  it('reconstructs all 39 reviewed compositions and matches every stored manifest entry', async () => {
    const result = await validateStoredTailExtraMatrixEvidence({ repositoryRoot: process.cwd() })
    expect(result.entryCount).toBe(39)
    expect(result.entryCountByRig).toEqual({ blob: 15, biped: 15, floating: 9 })
    expect(result.diagnostics).toEqual([])
  }, 300_000)

  it('rejects a live transform tamper on a non-prototype full-matrix entry', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'qmonster-tail-extra-tamper-'))
    try {
      const catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8'))
      const tail = catalog.parts.find((part: any) => part.id === 'tail_soft_curl')
      tail.composition.variantsByRig.blob.renderNodes[0].transform.scale *= 0.82
      const catalogPath = join(tempRoot, 'catalog.json')
      await writeFile(catalogPath, JSON.stringify(catalog))
      const entry = makeTailExtraMatrixPlan('full').find(item => (
        item.rigId === 'blob'
        && item.bodyFrame === 'body_blob_wide'
        && item.tail === 'tail_soft_curl'
        && item.extraAppendage === 'extra_appendage_none'
      ))!
      const result = await validateStoredTailExtraMatrixEvidence({ repositoryRoot: process.cwd(), catalogPath, plan: [entry] })
      expect(result.diagnostics).toContain('TAIL_EXTRA_MATRIX_ENTRY_MISMATCH:blob:body_blob_wide:tail_soft_curl:extra_appendage_none')
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
