import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTailExtraMatrixIndex, cleanupTailExtraRenderHarness, makeTailExtraMatrixPlan, reconstructTailExtraMatrixEvidence, reconstructTailExtraMatrixEvidencePair, resolveMatrixResourcePath, shardTailExtraMatrixPlan, TAIL_EXTRA_ENTRY_REPLAY_TIMEOUT_MS, task9HistoricalCausalCatalog, task9HistoricalDiagnosticProjection, task9StructuralCatalogProjectionSha256, validateStoredTailExtraMatrixEvidence, validateTailExtraRenderEvidence } from './render-tail-extra-structural-matrices.js'
import { BODIES as TASK8_BODIES } from './render-limb-contact-sheets.js'
import { assertTask9Task8BodyRoster, TASK9_BODIES_BY_RIG } from './task9-structural-identities.js'

describe('Task 9 tail/extra structural matrices', () => {
  it('allows sixty seconds for one heavy replay entry without changing the 300-second test gate', () => {
    expect(TAIL_EXTRA_ENTRY_REPLAY_TIMEOUT_MS).toBe(60_000)
  })

  it('splits the full 39-entry pair plan into ordered 20/19 shards without dropping frames', () => {
    const plan = makeTailExtraMatrixPlan('full')
    const shards = shardTailExtraMatrixPlan(plan)

    expect(shards.map(shard => shard.length)).toEqual([20, 19])
    expect(shards.flat()).toEqual(plan)
  })

  it('cleans every matrix render resource when browser close fails', async () => {
    const inputRoot = await mkdtemp(join(tmpdir(), 'qmonster-matrix-cleanup-'))
    const closed: string[] = []
    await expect(cleanupTailExtraRenderHarness({
      tempRoot: inputRoot,
      page: { async close() { closed.push('page') } },
      browser: { async close() { closed.push('browser'); throw new Error('browser close failed') } },
      server: { async close() { closed.push('server') } },
    })).rejects.toThrow('browser close failed')
    expect(closed).toEqual(['page', 'browser', 'server'])
    await expect(readFile(inputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a matrix /@fs resource reached through an escaping junction before hashing', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-matrix-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-matrix-outside-'))
    await writeFile(join(outside, 'mask.png'), 'outside')
    try {
      try {
        await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('directory links unavailable')
        throw error
      }
      await expect(resolveMatrixResourcePath(root, `/@fs/${join(root, 'linked', 'mask.png').replaceAll('\\', '/')}`))
        .rejects.toThrow(/escapes output root/i)
    } finally {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    }
  })

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

  it('binds live Task 9 structural inputs while allowing legal nonstructural catalog extensions', async () => {
    const catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8'))
    const baseline = task9StructuralCatalogProjectionSha256(catalog)
    const historical = task9HistoricalCausalCatalog(catalog)
    expect(baseline).toBe('b6b14b5335525bf040c62e756d7f6bc66fc8d952dc3aa755ebebd28824c2c62b')
    expect(historical.parts.find((part: any) => part.id === 'head_round_dome')
      .composition.variantsByRig.blob.featureSockets.eyes.y).toBe(1033)
    expect(catalog.parts.find((part: any) => part.id === 'head_round_dome')
      .composition.variantsByRig.blob.featureSockets.eyes.y).toBe(1100)
    expect(historical.compositionPolicy).toMatchObject({
      frameBounds: { x: 96, y: 64, width: 1856, height: 1888 },
      faceInsideRatio: 0.8,
      faceVisibleRatio: 0.85,
    })
    expect(historical.parts.find((part: any) => part.id === 'head_round_dome')
      .composition.variantsByRig.biped.connectors.find((connector: any) => connector.id === 'neck')
      .warpLimits.depthRatio.max).toBe(1.2)
    const nonstructural = structuredClone(catalog)
    nonstructural.parts.push({ ...structuredClone(nonstructural.parts.find((part: any) => part.slotId === 'eyes')), id: 'eyes_legal_extension' })
    nonstructural.parts.find((part: any) => part.slotId === 'colorScheme').rigMaskPaths.blob.primary = 'assets/v0.3.0/legal-color-extension.png'
    expect(task9StructuralCatalogProjectionSha256(nonstructural)).toBe(baseline)

    const structural = structuredClone(catalog)
    structural.parts.find((part: any) => part.id === 'tail_soft_curl')
      .composition.variantsByRig.blob.connectors.find((connector: any) => connector.id === 'tailRoot').width += 1
    expect(task9StructuralCatalogProjectionSha256(structural)).not.toBe(baseline)
  })

  it('freezes every body by one-slot identity plus three deterministic mixed entries per rig', () => {
    expect(assertTask9Task8BodyRoster(TASK8_BODIES)).toBeUndefined()
    expect(TASK9_BODIES_BY_RIG).toEqual(TASK8_BODIES)
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
      diagnosticScope: {
        id: 'task9-tail-extra',
        activeVisualSlots: ['tail', 'extraAppendage'],
        activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight'],
        suppressedDiagnostics: [],
      },
      connectorMetrics: [
        metric('neck'), metric('shoulderLeft'), metric('shoulderRight'), metric('hipLeft'), metric('hipRight'),
        metric('tailRoot'), metric('extraLeft'), metric('extraRight'),
      ],
    }
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight'])).toEqual([])
    evidence.diagnostics.push({ severity: 'error', code: 'COMPOSITION_FACE_OUT_OF_ZONE' } as any)
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight']))
      .toContain('COMPOSITION_FACE_OUT_OF_ZONE')
    evidence.diagnostics = []
    evidence.diagnosticScope.suppressedDiagnostics = [
      { severity: 'error', code: 'COMPOSITION_FACE_OUT_OF_ZONE', path: ['visualSlots', 'eyes'], message: 'inactive face' },
    ] as any
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight'])).toEqual([])
    evidence.connectorMetrics.find(item => item.connectorId === 'tailRoot')!.centerlineGapPixels = 3
    expect(validateTailExtraRenderEvidence(evidence as any, expected, ['tailRoot', 'extraLeft', 'extraRight']))
      .toContain('tailRoot:centerlineGapPixels')
  })

  it('reconstructs the approved Task 9 neck diagnostic without changing the live receiver threshold', () => {
    const current = {
      diagnostics: [{
        severity: 'error',
        code: 'CONNECTOR_COMPOSITE_FAILED',
        path: ['connectors', 'tailRoot'],
        message: 'active tail failure',
      }],
      connectorMetrics: [{
        connectorId: 'neck',
        receiverCoverage: 0.82,
        plugCoverage: 0.95,
        largestComponentRatio: 1,
        centerlineGapPixels: 0,
        childOutsideBodyRatio: null,
      }],
      diagnosticScope: {
        id: 'task9-tail-extra',
        activeVisualSlots: ['tail', 'extraAppendage'],
        activeConnectorIds: ['tailRoot', 'extraLeft', 'extraRight'],
        suppressedDiagnostics: [{
          severity: 'error',
          code: 'COMPOSITION_FACE_OUT_OF_ZONE',
          path: ['visualSlots', 'eyes'],
          message: 'inactive face',
        }],
      },
    }
    const historical = task9HistoricalDiagnosticProjection(current as any, 'blob')
    expect(historical.diagnostics).toEqual(current.diagnostics)
    expect(historical.diagnosticScope?.suppressedDiagnostics[0]).toEqual({
      severity: 'error',
      code: 'CONNECTOR_COMPOSITE_FAILED',
      path: ['connectors', 'neck'],
      message: 'Bridge blob-neck-bridge is below 0.9 contour coverage or above a 2px gap.',
    })
    expect(historical.diagnosticScope?.suppressedDiagnostics).toHaveLength(2)
    expect(current.diagnosticScope.suppressedDiagnostics).toHaveLength(1)

    current.connectorMetrics[0]!.receiverCoverage = 0.91
    expect(task9HistoricalDiagnosticProjection(current as any, 'blob').diagnosticScope?.suppressedDiagnostics)
      .toEqual(current.diagnosticScope.suppressedDiagnostics)
  })

  it('projects v0.4 oral metrics out of frozen Task 9 matrix records', () => {
    const current = {
      diagnostics: [],
      connectorMetrics: [],
      compositionMetrics: {
        eyesInsideRatio: 0.9,
        eyesVisibleRatio: 0.91,
        mouthInsideRatio: 0.92,
        mouthVisibleRatio: 0.93,
        oralDetailInsideRatio: null,
        oralDetailVisibleRatio: null,
        visibleBounds: { x: 96, y: 64, width: 1856, height: 1888 },
      },
    }

    const historical = task9HistoricalDiagnosticProjection(current as any, 'blob')

    expect(historical.compositionMetrics).toEqual({
      eyesInsideRatio: 0.9,
      eyesVisibleRatio: 0.91,
      mouthInsideRatio: 0.92,
      mouthVisibleRatio: 0.93,
      visibleBounds: { x: 96, y: 64, width: 1856, height: 1888 },
    })
    expect(current.compositionMetrics.oralDetailInsideRatio).toBeNull()
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

  it('keeps all 39 frame bytes identical while the explicit Task 9 scope classifies only inactive diagnostics', async () => {
    const plan = makeTailExtraMatrixPlan('full')
    const [unscoped, scoped] = await reconstructTailExtraMatrixEvidencePair(
      { plan, diagnosticScope: false, catalogProjection: task9HistoricalCausalCatalog, historicalDiagnostics: true },
      { plan, catalogProjection: task9HistoricalCausalCatalog, historicalDiagnostics: true },
    )
    expect(unscoped.entries).toHaveLength(39)
    expect(scoped.entries).toHaveLength(39)
    expect(unscoped.entries.reduce((sum, entry) => sum + entry.diagnostics.filter(item => item.severity === 'error').length, 0)).toBe(188)
    expect(scoped.entries.reduce((sum, entry) => sum + entry.diagnostics.filter(item => item.severity === 'error').length, 0)).toBe(0)
    expect(scoped.entries.reduce((sum, entry) => sum + (entry.diagnosticScope?.suppressedDiagnostics.length ?? 0), 0)).toBe(188)
    expect(scoped.entries.map(entry => createHash('sha256').update(entry.original).digest('hex')))
      .toEqual(unscoped.entries.map(entry => createHash('sha256').update(entry.original).digest('hex')))
  }, 300_000)

  it('rejects a live transform tamper on a non-prototype full-matrix entry', async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), '.tmp-qmonster-tail-extra-tamper-'))
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

  it('rejects non-prototype connector mask path and byte tampering through the formal live gate', async () => {
    const repositoryRoot = process.cwd()
    const tempRoot = await mkdtemp(join(repositoryRoot, '.tmp-qmonster-tail-extra-mask-tamper-'))
    const runtimeTemp = await mkdtemp(join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.3.0', '.tmp-mask-tamper-'))
    try {
      const catalog = JSON.parse(await readFile('packages/asset-catalog/catalog/v0.3.0/catalog.json', 'utf8'))
      const tail = catalog.parts.find((part: any) => part.id === 'tail_soft_curl')
      const connector = tail.composition.variantsByRig.blob.connectors.find((item: any) => item.id === 'tailRoot')
      const originalContour = join(repositoryRoot, 'packages', 'asset-catalog', connector.contourMaskPath)
      const originalForeground = join(repositoryRoot, 'packages', 'asset-catalog', connector.foregroundMaskPath)
      const maskOne = join(runtimeTemp, 'contour-a.png')
      const maskTwo = join(runtimeTemp, 'contour-b.png')
      await Promise.all([copyFile(originalContour, maskOne), copyFile(originalContour, maskTwo)])
      const portableMask = (path: string) => `assets/v0.3.0/${path.slice(join(repositoryRoot, 'packages', 'asset-catalog', 'assets', 'v0.3.0').length + 1).replaceAll('\\', '/')}`
      connector.contourMaskPath = portableMask(maskOne)
      const catalogPath = join(tempRoot, 'catalog.json')
      await writeFile(catalogPath, JSON.stringify(catalog))
      const entry = makeTailExtraMatrixPlan('full').find(item => (
        item.rigId === 'blob'
        && item.bodyFrame === 'body_blob_wide'
        && item.tail === 'tail_soft_curl'
        && item.extraAppendage === 'extra_appendage_none'
      ))!
      const baseline = await reconstructTailExtraMatrixEvidence({ repositoryRoot, catalogPath, plan: [entry] })
      const reviewRoot = join(tempRoot, 'review')
      await mkdir(reviewRoot)
      for (const rigId of ['blob', 'biped', 'floating'] as const) {
        const liveEntries = baseline.entries.filter(item => item.rigId === rigId).map(item => {
          const { original, ...stored } = item
          return { ...stored, originalSha256: createHash('sha256').update(original).digest('hex') }
        })
        await writeFile(join(reviewRoot, `structural-matrix-${rigId}-manifest.json`), JSON.stringify({
          schemaVersion: 'task9-tail-extra-structural-matrix-v1',
          mode: 'full',
          rigId,
          catalogInputSha256: baseline.catalogInputSha256,
          entryCount: liveEntries.length,
          entries: liveEntries,
        }))
      }

      const pathTamperedCatalog = structuredClone(catalog)
      pathTamperedCatalog.parts.find((part: any) => part.id === 'tail_soft_curl')
        .composition.variantsByRig.blob.connectors.find((item: any) => item.id === 'tailRoot').contourMaskPath = portableMask(maskTwo)
      await writeFile(catalogPath, JSON.stringify(pathTamperedCatalog))
      const pathResult = await validateStoredTailExtraMatrixEvidence({ repositoryRoot, catalogPath, reviewRoot, plan: [entry] })
      expect(pathResult.diagnostics).toContain('TAIL_EXTRA_MATRIX_ENTRY_MISMATCH:blob:body_blob_wide:tail_soft_curl:extra_appendage_none')

      await writeFile(catalogPath, JSON.stringify(catalog))
      await copyFile(originalForeground, maskOne)
      const byteResult = await validateStoredTailExtraMatrixEvidence({ repositoryRoot, catalogPath, reviewRoot, plan: [entry] })
      expect(byteResult.diagnostics).toContain('TAIL_EXTRA_MATRIX_ENTRY_MISMATCH:blob:body_blob_wide:tail_soft_curl:extra_appendage_none')
    } finally {
      await Promise.all([
        rm(tempRoot, { recursive: true, force: true }),
        rm(runtimeTemp, { recursive: true, force: true }),
      ])
    }
  }, 120_000)
})
