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
  }, 180_000)

  it('rejects acceptance evidence-root and aggregate drift', async () => {
    const { validateLimbAcceptanceDocument } = await import('./validate-interface-slice.js') as typeof import('./validate-interface-slice.js') & {
      validateLimbAcceptanceDocument: (input: any) => Promise<any[]>
    }
    const acceptance = JSON.parse(await readFile(resolve(REVIEW_ROOT, 'limb-contact-sheets-acceptance.json'), 'utf8'))
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
