import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const REVIEW_ROOT = resolve(ROOT, 'packages/asset-catalog/review/v0.3.0')

describe('Task 8 clean-checkout review integrity', () => {
  it('tracks every manifest, candidate, prompt, split-node, mask, production, and live amendment dependency', async () => {
    const { collectTask8DependencyPaths } = await import('./task8-source-integrity.js')
    const paths = await collectTask8DependencyPaths(ROOT)
    expect(paths.length).toBeGreaterThanOrEqual(190)
    const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean))
    expect(paths.filter(path => !tracked.has(path))).toEqual([])
  })

  it('uses a stable Task 8 catalog projection that ignores Task 9-only extensions', async () => {
    const { TASK8_LIMB_CATALOG_PROJECTION_SHA256, task8LimbCatalogProjectionSha256 } = await import('./task8-stable-projection.js')
    const catalog = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8'))
    const baseline = task8LimbCatalogProjectionSha256(catalog)
    expect(baseline).toBe(TASK8_LIMB_CATALOG_PROJECTION_SHA256)
    const task9Extension = structuredClone(catalog)
    task9Extension.parts.push({ id: 'task9_projection_probe', slotId: 'tail' })
    for (const bridge of task9Extension.transitionBridges) {
      bridge.materialFamilies = bridge.materialFamilies.filter((family: string) => family !== 'soft-skin')
    }
    expect(task8LimbCatalogProjectionSha256(task9Extension)).toBe(baseline)
    const task8Drift = structuredClone(catalog)
    task8Drift.parts.find((item: any) => item.id === 'arms_short_plush').composition.variantsByRig.blob.renderNodes[0].transform.scale += 0.01
    expect(task8LimbCatalogProjectionSha256(task8Drift)).not.toBe(baseline)
    const task8BridgeDrift = structuredClone(catalog)
    task8BridgeDrift.transitionBridges.find((item: any) => item.connectorClass === 'shoulder').materialFamilies = ['mushroom-velvet', 'soft-skin']
    expect(task8LimbCatalogProjectionSha256(task8BridgeDrift)).not.toBe(baseline)
  })

  it('preserves approved amendment hashes across only the compact-proof provenance migration', async () => {
    const { task8HistoricalAmendmentSha256 } = await import('./task8-stable-projection.js')
    for (const [name, approvedSha256] of [
      ['body-head-connector-amendment.json', '2b3c958f50533ae61e49f04ca2d51b3bcee944ebb809f315cafb6b72d8a20806'],
      ['visible-limb-threshold-amendment.json', '2971fd0cd8b076944f3204ea8cb55643dd554510a296d25f01b0fb57c5ab27d6'],
    ] as const) {
      const path = `packages/asset-catalog/review/v0.3.0/${name}`
      const bytes = await readFile(resolve(ROOT, path))
      expect(task8HistoricalAmendmentSha256(path, bytes)).toBe(approvedSha256)
      expect(task8HistoricalAmendmentSha256(
        path,
        Buffer.from(bytes.toString('utf8').replace('"schemaVersion":', '"schemaVersionTampered":')),
      )).not.toBe(approvedSha256)
    }
  })

  it('restores only historical Task 8 face and F006 neck policy while preserving other structural drift', async () => {
    const { task8HistoricalCausalCatalog } = await import('./validate-interface-slice.js')
    const catalog = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8'))
    const projected = task8HistoricalCausalCatalog(catalog)
    const expected = structuredClone(catalog)
    expected.compositionPolicy.faceInsideRatio = 0.8
    expected.compositionPolicy.faceVisibleRatio = 0.85
    for (const partId of ['body_biped_tall', 'head_round_dome']) {
      expected.parts.find((part: any) => part.id === partId)
        .composition.variantsByRig.biped.connectors.find((connector: any) => connector.id === 'neck')
        .warpLimits.depthRatio.max = 1.2
    }
    expect(projected).toEqual(expected)
    expect(catalog.compositionPolicy).toEqual(expect.objectContaining({
      faceInsideRatio: 0.84, faceVisibleRatio: 0.84,
    }))

    const drifted = structuredClone(catalog)
    drifted.parts.find((part: any) => part.id === 'arms_short_plush')
      .composition.variantsByRig.blob.connectors[0].origin.x += 1
    const projectedDrift = task8HistoricalCausalCatalog(drifted)
    expect(projectedDrift.parts).not.toEqual(projected.parts)
    expect(projectedDrift.compositionPolicy).toEqual(projected.compositionPolicy)
  })

  it('recreates only the legacy Task 8 neck diagnostic at its exact historical thresholds', async () => {
    const { task8HistoricalCausalEntry } = await import('./validate-interface-slice.js') as typeof import('./validate-interface-slice.js') & {
      task8HistoricalCausalEntry: (entry: any) => any
    }
    const shoulderDrift = {
      severity: 'error',
      code: 'CONNECTOR_COMPOSITE_FAILED',
      path: ['connectors', 'shoulderLeft'],
      message: 'shoulder structural drift',
    }
    const blob = {
      rigId: 'blob',
      connectorMetrics: [{
        connectorId: 'neck', receiverCoverage: 0.629356580399587,
        plugCoverage: 0.9922589635854342, largestComponentRatio: 0.9999880938604703,
        centerlineGapPixels: 0, childOutsideBodyRatio: null,
      }],
      diagnostics: [shoulderDrift],
    }
    const projectedBlob = task8HistoricalCausalEntry(blob)
    expect(projectedBlob).not.toBe(blob)
    expect(blob.diagnostics).toEqual([shoulderDrift])
    expect(projectedBlob.diagnostics).toEqual([{
      severity: 'error',
      code: 'CONNECTOR_COMPOSITE_FAILED',
      path: ['connectors', 'neck'],
      message: 'Bridge blob-neck-bridge is below 0.9 contour coverage or above a 2px gap.',
    }, shoulderDrift])
    expect(projectedBlob.connectorMetrics).toEqual(blob.connectorMetrics)

    const exactCompatibleBiped = {
      ...blob,
      rigId: 'biped',
      connectorMetrics: [{
        ...blob.connectorMetrics[0],
        receiverCoverage: 0.9, plugCoverage: 0.9,
        largestComponentRatio: 0.99, centerlineGapPixels: 2,
      }],
      diagnostics: [],
    }
    expect(task8HistoricalCausalEntry(exactCompatibleBiped).diagnostics).toEqual([])

    for (const connectorPatch of [
      { receiverCoverage: 0.899999 },
      { plugCoverage: 0.899999 },
      { largestComponentRatio: 0.989999 },
      { centerlineGapPixels: 2.000001 },
    ]) {
      expect(task8HistoricalCausalEntry({
        ...exactCompatibleBiped,
        connectorMetrics: [{ ...exactCompatibleBiped.connectorMetrics[0], ...connectorPatch }],
      }).diagnostics).toEqual([expect.objectContaining({
        code: 'CONNECTOR_COMPOSITE_FAILED', path: ['connectors', 'neck'],
      })])
    }
  })

  it('admits only the exact reviewed Task 9/10 renderer sources before projecting frozen Task 8 hashes', async () => {
    const { TASK8_APPROVED_RENDERER_BINDINGS, task8RendererProjectionSha256 } = await import('./task8-stable-projection.js')
    for (const path of [
      'apps/creator-web/src/render-test.ts',
      'packages/renderer-canvas/src/render.ts',
      'packages/renderer-canvas/src/connector-metrics.ts',
    ] as const) {
      const bytes = await readFile(resolve(ROOT, path))
      expect(task8RendererProjectionSha256(path, bytes)).toBe(TASK8_APPROVED_RENDERER_BINDINGS[path])
      if (path === 'packages/renderer-canvas/src/render.ts') {
        const task9OnlyMutation = Buffer.from(bytes.toString('utf8').replace(
          "if (row.length === 0) throw new Error('Bridge mesh end row is empty.')",
          "if (row.length < 1) throw new Error('Bridge mesh end row is empty.')",
        ))
        expect(() => task8RendererProjectionSha256(path, task9OnlyMutation))
          .toThrow(`TASK8_RENDERER_PROJECTION_SOURCE_DRIFT:${path}`)
        const v04OnlyMutation = Buffer.from(bytes.toString('utf8').replace(
          'const list = Array.from({ length: 20 }, () => factory(MASTER_SIZE, MASTER_SIZE, context))',
          'const list = Array.from({ length: 21 }, () => factory(MASTER_SIZE, MASTER_SIZE, context))',
        ))
        expect(() => task8RendererProjectionSha256(path, v04OnlyMutation))
          .toThrow(`TASK8_RENDERER_PROJECTION_SOURCE_DRIFT:${path}`)
        const v05RouteMutation = Buffer.from(bytes.toString('utf8').replace(
          "    || (catalog.version === '0.5.0' && spec.rendererVersion === '0.5.0')",
          '',
        ))
        expect(() => task8RendererProjectionSha256(path, v05RouteMutation))
          .toThrow(`TASK8_RENDERER_PROJECTION_SOURCE_DRIFT:${path}`)
      }
      if (path === 'packages/renderer-canvas/src/connector-metrics.ts') {
        const task10OnlyMutation = Buffer.from(bytes.toString('utf8').replace(
          'export const CONNECTOR_RECEIVER_COVERAGE_MIN = 0.62',
          'export const CONNECTOR_RECEIVER_COVERAGE_MIN = 0.63',
        ))
        expect(() => task8RendererProjectionSha256(path, task10OnlyMutation))
          .toThrow(`TASK8_RENDERER_PROJECTION_SOURCE_DRIFT:${path}`)
      }
      const drifted = Buffer.from(bytes.toString('utf8').replace(
        path.includes('render-test')
          ? '2D context unavailable'
          : path.endsWith('connector-metrics.ts')
            ? 'overlapMass += Math.min(contourAlpha, bridge[offset] ?? 0)'
            : 'validateMonsterSpecAgainstCatalog(spec, catalog)',
        path.includes('render-test')
          ? 'Task 8 drift'
          : path.endsWith('connector-metrics.ts')
            ? 'overlapMass += contourAlpha * (bridge[offset] ?? 0) / 255'
            : 'validateMonsterSpecAgainstCatalog(spec, { ...catalog })',
      ))
      expect(() => task8RendererProjectionSha256(path, drifted))
        .toThrow(`TASK8_RENDERER_PROJECTION_SOURCE_DRIFT:${path}`)
    }
  })

  it('accepts the frozen legacy catalog binding through the stable projection but rejects Task 8 resource drift', async () => {
    const {
      TASK8_APPROVED_LEGACY_CATALOG_SHA256,
      TASK8_LIMB_CATALOG_PROJECTION_SHA256,
    } = await import('./task8-stable-projection.js')
    const { compareLimbCausalMetricEvidence } = await import('./validate-interface-slice.js')
    const manifests = await Promise.all(['blob', 'biped', 'floating'].map(async rigId => JSON.parse(await readFile(resolve(REVIEW_ROOT, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
    const liveEntries = structuredClone(manifests.flatMap(manifest => manifest.entries))
    expect(liveEntries.every(entry => entry.inputBinding.catalogSha256 === TASK8_APPROVED_LEGACY_CATALOG_SHA256)).toBe(true)
    for (const live of liveEntries) live.inputBinding.catalogSha256 = TASK8_LIMB_CATALOG_PROJECTION_SHA256
    expect(compareLimbCausalMetricEvidence({ liveEntries, manifests }).diagnostics).toEqual([])
    liveEntries[0].inputBinding.resolvedAssetHashes[0].sha256 = '0'.repeat(64)
    expect(compareLimbCausalMetricEvidence({ liveEntries, manifests }).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LIMB_CAUSAL_INPUT_DRIFT' }),
    )
  })

  it('reconstructs all 60 cells from live renderer inputs and detects a stored metric drift', async () => {
    const { validateLimbCausalMetricEvidence } = await import('./validate-interface-slice.js') as typeof import('./validate-interface-slice.js') & {
      validateLimbCausalMetricEvidence: (input: any) => Promise<any>
    }
    const baseline = await validateLimbCausalMetricEvidence({ repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT })
    expect(baseline.entryCount).toBe(60)
    expect(baseline.diagnostics).toEqual([])
    const manifests = await Promise.all(['blob', 'biped', 'floating'].map(async rigId => JSON.parse(await readFile(resolve(REVIEW_ROOT, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
    manifests[0].entries[0].connectorMetrics.find((metric: any) => metric.connectorId === 'shoulderLeft').receiverCoverage -= 0.01
    const drift = await validateLimbCausalMetricEvidence({ repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT, manifestOverrides: { blob: manifests[0] }, liveEvidence: baseline.liveEvidence })
    expect(drift.diagnostics).toContainEqual(expect.objectContaining({ code: 'LIMB_CAUSAL_METRIC_DRIFT' }))
  }, 300_000)

  it('rejects acceptance evidence-root and aggregate drift', async () => {
    const { validateLimbAcceptanceDocument } = await import('./validate-interface-slice.js') as typeof import('./validate-interface-slice.js') & {
      validateLimbAcceptanceDocument: (input: any) => Promise<any[]>
    }
    const acceptance = JSON.parse(await readFile(resolve(REVIEW_ROOT, 'limb-contact-sheets-acceptance.json'), 'utf8'))
    expect(await validateLimbAcceptanceDocument({ document: acceptance, repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT })).toEqual([])
    const missingEvidence = structuredClone(acceptance)
    delete missingEvidence.evidenceRoot
    expect(await validateLimbAcceptanceDocument({ document: missingEvidence, repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT })).toContainEqual(
      expect.objectContaining({ code: 'LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID' }),
    )
    const aggregateDrift = structuredClone(acceptance)
    aggregateDrift.causalMetrics.results.childOutsideBodyRatioMin += 0.01
    expect(await validateLimbAcceptanceDocument({ document: aggregateDrift, repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT })).toContainEqual(
      expect.objectContaining({ code: 'LIMB_ACCEPTANCE_AGGREGATE_DRIFT' }),
    )
  })

  it('detects live catalog transform drift from a targeted renderer reconstruction', async () => {
    const { makeLimbMatrixPlan, reconstructLimbMatrixEvidence } = await import('./render-limb-contact-sheets.js')
    const { compareLimbCausalMetricEvidence } = await import('./validate-interface-slice.js')
    const temp = await mkdtemp(join(tmpdir(), 'qmonster-task8-transform-drift-'))
    try {
      const catalog = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8'))
      const part = catalog.parts.find((item: any) => item.id === 'arms_short_plush')
      for (const node of part.composition.variantsByRig.blob.renderNodes) node.transform.scale = 1.14
      const catalogPath = resolve(temp, 'catalog.json')
      await writeFile(catalogPath, JSON.stringify(catalog))
      const live = await reconstructLimbMatrixEvidence({ catalogPath, planOverride: [makeLimbMatrixPlan('full')[0]!] })
      const manifests = await Promise.all(['blob', 'biped', 'floating'].map(async rigId => JSON.parse(await readFile(resolve(REVIEW_ROOT, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
      expect(compareLimbCausalMetricEvidence({ liveEntries: live.entries, manifests }).diagnostics).toContainEqual(expect.objectContaining({ code: 'LIMB_CAUSAL_INPUT_DRIFT' }))
    } finally { await rm(temp, { recursive: true, force: true }) }
  }, 60_000)

  it('detects a live connector-mask drift from a targeted renderer reconstruction', async () => {
    const { makeLimbMatrixPlan, reconstructLimbMatrixEvidence } = await import('./render-limb-contact-sheets.js')
    const { compareLimbCausalMetricEvidence } = await import('./validate-interface-slice.js')
    const temp = await mkdtemp(join(tmpdir(), 'qmonster-task8-mask-drift-'))
    const runtimeRelative = 'assets/v0.3.0/.tmp-task8-review-mask-drift.png'
    const runtimePath = resolve(ROOT, 'packages/asset-catalog', runtimeRelative)
    try {
      const catalog = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8'))
      const part = catalog.parts.find((item: any) => item.id === 'arms_short_plush')
      const connector = part.composition.variantsByRig.blob.connectors.find((item: any) => item.id === 'shoulderLeft')
      const sourcePath = resolve(ROOT, 'packages/asset-catalog', connector.contourMaskPath)
      const decoded = await sharp(await readFile(sourcePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const alphaIndex = decoded.data.findIndex((value, index) => index % decoded.info.channels === 3 && value > 0)
      decoded.data[alphaIndex] = 0
      await writeFile(runtimePath, await sharp(decoded.data, { raw: decoded.info }).png().toBuffer())
      connector.contourMaskPath = runtimeRelative
      const catalogPath = resolve(temp, 'catalog.json')
      await writeFile(catalogPath, JSON.stringify(catalog))
      const live = await reconstructLimbMatrixEvidence({ catalogPath, planOverride: [makeLimbMatrixPlan('full')[0]!] })
      const manifests = await Promise.all(['blob', 'biped', 'floating'].map(async rigId => JSON.parse(await readFile(resolve(REVIEW_ROOT, `limb-contact-sheet-${rigId}-manifest.json`), 'utf8'))))
      expect(compareLimbCausalMetricEvidence({ liveEntries: live.entries, manifests }).diagnostics).toContainEqual(expect.objectContaining({ code: 'LIMB_CAUSAL_INPUT_DRIFT' }))
    } finally {
      await rm(runtimePath, { force: true })
      await rm(temp, { recursive: true, force: true })
    }
  }, 60_000)

  it('rejects deleted or tampered canonical evidence files and renderer bindings', async () => {
    const { validateLimbAcceptanceDocument } = await import('./validate-interface-slice.js')
    const acceptance = JSON.parse(await readFile(resolve(REVIEW_ROOT, 'limb-contact-sheets-acceptance.json'), 'utf8'))
    const temp = await mkdtemp(join(tmpdir(), 'qmonster-task8-evidence-root-'))
    const bindings = [
      acceptance.evidenceRoot.sourceIndex,
      acceptance.evidenceRoot.processedIndex,
      acceptance.evidenceRoot.productionEvidence,
      ...acceptance.evidenceRoot.rendererInputs,
    ]
    try {
      for (const binding of bindings) {
        const target = resolve(temp, binding.path)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(resolve(ROOT, binding.path), target)
      }
      const deleted = acceptance.evidenceRoot.productionEvidence
      await rm(resolve(temp, deleted.path))
      expect(await validateLimbAcceptanceDocument({ document: acceptance, repositoryRoot: temp, reviewRoot: REVIEW_ROOT })).toContainEqual(expect.objectContaining({ code: 'LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID' }))
      await copyFile(resolve(ROOT, deleted.path), resolve(temp, deleted.path))
      await writeFile(resolve(temp, acceptance.evidenceRoot.processedIndex.path), Buffer.from('tampered'))
      expect(await validateLimbAcceptanceDocument({ document: acceptance, repositoryRoot: temp, reviewRoot: REVIEW_ROOT })).toContainEqual(expect.objectContaining({ code: 'LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID' }))
      const rendererDrift = structuredClone(acceptance)
      rendererDrift.evidenceRoot.rendererInputs[0].sha256 = '0'.repeat(64)
      expect(await validateLimbAcceptanceDocument({ document: rendererDrift, repositoryRoot: ROOT, reviewRoot: REVIEW_ROOT })).toContainEqual(expect.objectContaining({ code: 'LIMB_ACCEPTANCE_EVIDENCE_ROOT_INVALID' }))
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
})
