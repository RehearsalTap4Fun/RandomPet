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
    const { task8LimbCatalogProjectionSha256 } = await import('./task8-stable-projection.js')
    const catalog = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'), 'utf8'))
    const baseline = task8LimbCatalogProjectionSha256(catalog)
    const task9Extension = structuredClone(catalog)
    task9Extension.parts.push({ id: 'task9_projection_probe', slotId: 'tail' })
    expect(task8LimbCatalogProjectionSha256(task9Extension)).toBe(baseline)
    const task8Drift = structuredClone(catalog)
    task8Drift.parts.find((item: any) => item.id === 'arms_short_plush').composition.variantsByRig.blob.renderNodes[0].transform.scale += 0.01
    expect(task8LimbCatalogProjectionSha256(task8Drift)).not.toBe(baseline)
  })

  it('projects the explicit Task 9 diagnostic scope out of frozen Task 8 renderer hashes without hiding Task 8 drift', async () => {
    const { TASK8_APPROVED_RENDERER_BINDINGS, task8RendererProjectionSha256 } = await import('./task8-stable-projection.js')
    for (const path of ['apps/creator-web/src/render-test.ts', 'packages/renderer-canvas/src/render.ts'] as const) {
      const bytes = await readFile(resolve(ROOT, path))
      expect(task8RendererProjectionSha256(path, bytes)).toBe(TASK8_APPROVED_RENDERER_BINDINGS[path])
      const drifted = Buffer.from(bytes.toString('utf8').replace(
        path.includes('render-test') ? '2D context unavailable' : 'validateMonsterSpecAgainstCatalog(spec, catalog)',
        path.includes('render-test') ? 'Task 8 drift' : 'validateMonsterSpecAgainstCatalog(spec, { ...catalog })',
      ))
      expect(task8RendererProjectionSha256(path, drifted)).not.toBe(TASK8_APPROVED_RENDERER_BINDINGS[path])
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
