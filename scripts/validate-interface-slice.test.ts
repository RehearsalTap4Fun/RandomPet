import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  validateBodyHeadAcceptanceDocument,
  validateBodyHeadAcceptanceLocations,
  validateBodyHeadApproval,
  validateBodyHeadCausalMetricEvidence,
  validateBodyHeadRejectionEvidence,
  validateBodyHeadReview,
  validateInterfaceProductionReadiness,
  validateInterfacePromptEvidence,
  validateInterfaceSlice,
  validateLimbApproval,
  validateLimbReview,
  validatePublishedInterfaceApprovals,
} from './validate-interface-slice.js'
import { renderInterfaceGuides } from './render-interface-guides.js'
import { BIPED_SLICE, structuralVariants } from '../packages/asset-catalog/src/interface-source-schema.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function manifestFixture(): Promise<any> {
  return JSON.parse(await readFile('asset-source/v0.3.0/interface-manifest.json', 'utf8'))
}

function canonicalGuideVariants(manifest: any): ReturnType<typeof structuralVariants> {
  const canonical = new Map(Object.entries(BIPED_SLICE).map(([slotId, ids]) => [slotId, new Set(ids)]))
  return structuralVariants(manifest).filter(item => item.rigId === 'biped' && canonical.get(item.slotId)?.has(item.partId))
}

describe('validateInterfaceSlice', () => {
  it('runs both approved Task 7 and Task 8 matrices from the unscoped production entrypoint', async () => {
    const result = await validatePublishedInterfaceApprovals({
      repositoryRoot: process.cwd(),
      production: true,
    })

    expect(result.bodyHeadEntriesChecked).toEqual({ blob: 8, biped: 8, floating: 4 })
    expect(result.bodyHeadApprovalEntriesChecked).toBe(20)
    expect(result.limbEntriesChecked).toEqual({ blob: 24, biped: 24, floating: 12 })
    expect(result.limbApprovalEntriesChecked).toBe(60)
    expect(result.diagnostics).toEqual([])
  }, 300_000)

  it('validates the exact 60-cell limb roster at the global 0.614 boundary', async () => {
    const repositoryRoot = process.cwd()
    const reviewRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0')
    const result = await validateLimbReview({ repositoryRoot, reviewRoot })
    expect(result.entryCountByRig).toEqual({ blob: 24, biped: 24, floating: 12 })
    expect(result.diagnostics).toEqual([])

    const alteredRoot = await mkdtemp(join(tmpdir(), 'qmonster-limb-threshold-'))
    roots.push(alteredRoot)
    for (const rigId of ['blob', 'biped', 'floating']) {
      const source = join(reviewRoot, `limb-contact-sheet-${rigId}-manifest.json`)
      const review = JSON.parse(await readFile(source, 'utf8'))
      if (rigId === 'blob') review.thresholds.childOutsideBodyRatioMin = 0.613999
      await writeFile(join(alteredRoot, `limb-contact-sheet-${rigId}-manifest.json`), `${JSON.stringify(review)}\n`)
    }
    expect((await validateLimbReview({ repositoryRoot, reviewRoot: alteredRoot })).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'LIMB_REVIEW_THRESHOLD_INVALID', path: ['blob', 'thresholds', 'childOutsideBodyRatioMin'] }),
    )
  }, 30_000)

  it('requires one user-approved Task 8 acceptance bound to all live limb review bytes and amendments', async () => {
    const repositoryRoot = process.cwd()
    const reviewRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0')
    const result = await validateLimbApproval({ repositoryRoot, reviewRoot })
    expect(result.entryCount).toBe(60)
    expect(result.diagnostics).toEqual([])
  }, 300_000)

  it('keeps retired guide evidence outside the canonical active guide inventory', async () => {
    const result = await validateInterfaceSlice({
      manifestPath: join(process.cwd(), 'asset-source', 'v0.3.0', 'interface-manifest.json'),
      guideRoot: join(process.cwd(), 'asset-source', 'v0.3.0', 'guides'),
      repositoryRoot: process.cwd(),
    })

    expect(result.diagnostics.filter(item => item.code === 'INTERFACE_GUIDE_STALE')).toEqual([])
  }, 20_000)

  it('validates manifest and deterministic guide inventory without requiring production art', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-slice-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await mkdir(guideRoot, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    await renderInterfaceGuides({ outputRoot: guideRoot, rigId: 'biped', profiles: canonicalGuideVariants(manifest).flatMap(asset => asset.connectors.map(connector => ({ ...connector, assetId: asset.partId }))) })

    const result = await validateInterfaceSlice({ manifestPath, guideRoot })
    expect(result.ok).toBe(true)
    expect(result.productionAssetsChecked).toBe(0)
  }, 20_000)

  it('rejects stale guide resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-slice-'))
    roots.push(root)
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await mkdir(guideRoot, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(await manifestFixture())}\n`)
    await writeFile(join(guideRoot, 'stale.png'), 'stale')
    const result = await validateInterfaceSlice({ manifestPath, guideRoot })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_GUIDE_STALE' }))
  }, 20_000)

  it('rejects opaque or empty masks, transparent guides, renamed WebP, and deterministic drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-guide-negative-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const manifestPath = join(root, 'interface-manifest.json')
    const guideRoot = join(root, 'guides')
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    await renderInterfaceGuides({ outputRoot: guideRoot, rigId: 'biped', profiles: canonicalGuideVariants(manifest).flatMap(asset => asset.connectors.map(connector => ({ ...connector, assetId: asset.partId }))) })
    const stems = canonicalGuideVariants(manifest).flatMap(asset => asset.connectors.map(connector => `${asset.partId}-${connector.id}-${connector.role}`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toFile(join(guideRoot, `${stems[0]}-mask.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(join(guideRoot, `${stems[1]}-mask.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(join(guideRoot, `${stems[2]}-guide.png`))
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp().toFile(join(guideRoot, `${stems[3]}-guide.png`))
    const driftPath = join(guideRoot, `${stems[4]}-guide.png`)
    const drift = await readFile(driftPath)
    drift[drift.length - 1] = drift[drift.length - 1]! ^ 1
    await writeFile(driftPath, drift)
    const result = await validateInterfaceSlice({ manifestPath, guideRoot, repositoryRoot: process.cwd() })
    expect(result.diagnostics.filter(item => item.code === 'INTERFACE_GUIDE_INVALID').length).toBeGreaterThanOrEqual(4)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_GUIDE_DRIFT' }))
  }, 20_000)

  it('fails production readiness specifically for missing source art', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-production-'))
    roots.push(root)
    const manifest = await manifestFixture()
    const result = await validateInterfaceProductionReadiness({ repositoryRoot: root, manifest })
    const expectedSources = new Set([
      ...structuralVariants(manifest).flatMap(asset => [asset.sourcePngPath, ...asset.renderNodes.map(node => node.sourcePngPath)]),
      ...manifest.bridges.map((bridge: any) => bridge.sourcePngPath),
    ]).size
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_ASSET_MISSING' }))
    expect(result.diagnostics.filter(item => item.code === 'INTERFACE_PRODUCTION_ASSET_MISSING')).toHaveLength(expectedSources)
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'INTERFACE_MANIFEST_MISSING' }))
  })

  it('binds prompt evidence to the actual committed prompt catalog bytes', async () => {
    const manifest = await manifestFixture()
    const firstVariant = structuralVariants(manifest)[0]!
    firstVariant.promptEvidence.promptSha256 = 'f'.repeat(64)
    firstVariant.promptEvidence.promptId = 'missing-prompt-id'
    const diagnostics = await validateInterfacePromptEvidence({
      manifest,
      repositoryRoot: process.cwd(),
    })
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_HASH_MISMATCH' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_ID_MISSING' }))
  })

  it('rejects prompt and readiness symlinks that resolve outside the repository root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-interface-symlink-'))
    const outside = await mkdtemp(join(tmpdir(), 'qmonster-interface-outside-'))
    roots.push(root, outside)
    const manifest = await manifestFixture()
    const outsidePrompt = join(outside, 'structural-prompts.json')
    await writeFile(outsidePrompt, JSON.stringify({ prompts: [] }))
    const promptTarget = join(root, 'asset-source', 'v0.3.0', 'prompts', 'structural-prompts.json')
    await mkdir(join(root, 'asset-source', 'v0.3.0', 'prompts'), { recursive: true })
    try {
      await symlink(outsidePrompt, promptTarget, 'file')
    } catch (caught: any) {
      if (caught?.code === 'EPERM' || caught?.code === 'EACCES') return
      throw caught
    }
    const manifestPath = join(root, 'interface-manifest.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
    const promptResult = await validateInterfaceSlice({ manifestPath, guideRoot: join(process.cwd(), 'asset-source', 'v0.3.0', 'guides'), repositoryRoot: root })
    expect(promptResult.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PROMPT_PATH_INVALID' }))

    const variants = structuralVariants(manifest)
    const source = variants[0]!.sourcePngPath
    const outsideSource = join(outside, 'source.png')
    await writeFile(outsideSource, 'outside')
    const sourceTarget = join(root, source)
    await mkdir(join(sourceTarget, '..'), { recursive: true })
    await symlink(outsideSource, sourceTarget, 'file')
    const otherSource = variants[1]!.sourcePngPath
    const otherDirectory = join(root, 'other-repository-subdir')
    await mkdir(otherDirectory)
    const otherFile = join(otherDirectory, 'source.png')
    await writeFile(otherFile, 'inside repository but outside canonical source root')
    const otherTarget = join(root, otherSource)
    await mkdir(join(otherTarget, '..'), { recursive: true })
    await symlink(otherFile, otherTarget, 'file')
    const readiness = await validateInterfaceProductionReadiness({ repositoryRoot: root, manifest })
    expect(readiness.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', path: ['productionAssets', '0'] }))
    expect(readiness.diagnostics).toContainEqual(expect.objectContaining({ code: 'INTERFACE_PRODUCTION_SOURCE_PATH_INVALID', path: ['productionAssets', '1'] }))
  })

  it('rejects Task 7 natural-neck sources bound to the old unapproved review record', async () => {
    const manifest = await manifestFixture()
    const head = structuralVariants(manifest).find(item => (
      item.partId === 'head_mushroom_cap' && item.rigId === 'biped'
    ))!
    head.promptEvidence.reviewRecordPath = 'packages/asset-catalog/review/v0.3.0/review-record.json'

    const result = await validateInterfaceProductionReadiness({ repositoryRoot: process.cwd(), manifest })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'INTERFACE_NATURAL_NECK_REVIEW_INVALID',
      path: ['productionAssets', 'head_mushroom_cap:biped', 'reviewRecordPath'],
    }))
  })

  it('validates the exact body-head matrix roster, continuity metrics, and sheet hashes', async () => {
    const result = await validateBodyHeadReview({
      repositoryRoot: process.cwd(),
      reviewRoot: join(process.cwd(), 'packages', 'asset-catalog', 'review', 'v0.3.0'),
    })

    expect(result.entryCountByRig).toEqual({ blob: 8, biped: 8, floating: 4 })
    expect(result.diagnostics).toEqual([])
    for (const rigId of ['blob', 'biped', 'floating'] as const) {
      const review = JSON.parse(await readFile(join(
        process.cwd(), 'packages', 'asset-catalog', 'review', 'v0.3.0',
        `body-head-contact-sheet-${rigId}-manifest.json`,
      ), 'utf8'))
      expect(review.thresholds).toMatchObject({ visibleTongueDepthRatio: 0.1, visibleTongueAreaRatio: 0.1 })
      expect(review.entries.every((entry: any) => (
        entry.visibleTongueDepthRatio <= 0.1 && entry.visibleTongueAreaRatio <= 0.1
      ))).toBe(true)
    }
  }, 20_000)

  it('recomputes every stored causal metric from the live approved sources and detects drift', async () => {
    const repositoryRoot = process.cwd()
    const liveReviewRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0')
    expect(await validateBodyHeadCausalMetricEvidence({ repositoryRoot, reviewRoot: liveReviewRoot })).toEqual([])

    const reviewRoot = await mkdtemp(join(tmpdir(), 'qmonster-task7-metric-drift-'))
    roots.push(reviewRoot)
    for (const rigId of ['blob', 'biped', 'floating']) {
      const name = `body-head-contact-sheet-${rigId}-manifest.json`
      await cp(join(liveReviewRoot, name), join(reviewRoot, name))
    }
    const bipedPath = join(reviewRoot, 'body-head-contact-sheet-biped-manifest.json')
    const biped = JSON.parse(await readFile(bipedPath, 'utf8'))
    biped.entries[0].largestComponentRatio -= 0.01
    await writeFile(bipedPath, `${JSON.stringify(biped, null, 2)}\n`)

    expect(await validateBodyHeadCausalMetricEvidence({ repositoryRoot, reviewRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_CAUSAL_METRIC_DRIFT' }),
    )
  }, 120_000)

  it('requires the Task 7 reapproval to bind the connector amendment and unchanged visual evidence', async () => {
    const repositoryRoot = process.cwd()
    const reviewRoot = join(repositoryRoot, 'packages', 'asset-catalog', 'review', 'v0.3.0')
    const result = await validateBodyHeadApproval({ repositoryRoot, reviewRoot })
    expect(result.entryCount).toBe(20)
    expect(result.diagnostics).toEqual([])
    const acceptance = JSON.parse(await readFile(join(reviewRoot, 'body-head-contact-sheets-acceptance.json'), 'utf8'))
    expect(acceptance).toMatchObject({
      decision: 'approved', userApproved: true, approvalResponse: 'A',
      reapproval: { reason: 'body_blob_wide-shoulder-connector-amendment', visualArtifactsByteIdentical: true },
    })
    const superseded = JSON.parse(await readFile(join(
      reviewRoot, 'superseded', 'task7-pre-wide-shoulder-amendment',
      'body-head-contact-sheets-acceptance.pre-amendment.json',
    ), 'utf8'))
    expect(await validateBodyHeadAcceptanceDocument({ document: superseded, repositoryRoot, reviewRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REAPPROVAL_BINDING_INVALID' }),
    )
  }, 60_000)

  it('rejects missing, misplaced, and duplicate Task 7 acceptance locations', () => {
    const canonical = join(process.cwd(), 'packages', 'asset-catalog', 'review', 'v0.3.0', 'body-head-contact-sheets-acceptance.json')
    expect(validateBodyHeadAcceptanceLocations([], canonical)).not.toEqual([])
    expect(validateBodyHeadAcceptanceLocations([join(process.cwd(), 'elsewhere', 'body-head-contact-sheets-acceptance.json')], canonical)).not.toEqual([])
    expect(validateBodyHeadAcceptanceLocations([canonical, join(process.cwd(), 'copy', 'body-head-contact-sheets-acceptance.json')], canonical)).not.toEqual([])
    expect(validateBodyHeadAcceptanceLocations([canonical], canonical)).toEqual([])
  })

  it('binds the rejected round to exactly nine canonical live artifact bytes and rejected user fields', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'qmonster-task7-rejection-'))
    roots.push(repositoryRoot)
    const relativeDirectory = join('packages', 'asset-catalog', 'review', 'v0.3.0', 'rejected', 'task7-visible-tongue-round-1')
    const sourceDirectory = join(process.cwd(), relativeDirectory)
    const rejectionDirectory = join(repositoryRoot, relativeDirectory)
    await mkdir(join(rejectionDirectory, '..'), { recursive: true })
    await cp(sourceDirectory, rejectionDirectory, { recursive: true })

    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toEqual([])

    const original = 'body-head-contact-sheet-blob.png'
    const originalBytes = await readFile(join(sourceDirectory, original))
    await rm(join(rejectionDirectory, original))
    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REJECTION_ARTIFACT_MISSING' }),
    )
    await writeFile(join(rejectionDirectory, original), originalBytes)

    await writeFile(join(rejectionDirectory, original), Buffer.concat([originalBytes, Buffer.from('tampered')]))
    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REJECTION_ARTIFACT_HASH_INVALID' }),
    )
    await writeFile(join(rejectionDirectory, original), originalBytes)

    const misplacedDirectory = join(rejectionDirectory, 'misplaced')
    await mkdir(misplacedDirectory)
    await rename(join(rejectionDirectory, original), join(misplacedDirectory, original))
    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REJECTION_ARTIFACT_PATH_INVALID' }),
    )
    await rename(join(misplacedDirectory, original), join(rejectionDirectory, original))
    await rm(misplacedDirectory, { recursive: true })

    await writeFile(join(rejectionDirectory, 'body-head-contact-sheet-blob-copy.png'), originalBytes)
    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REJECTION_ARTIFACT_PATH_INVALID' }),
    )
    await rm(join(rejectionDirectory, 'body-head-contact-sheet-blob-copy.png'))

    const recordPath = join(rejectionDirectory, 'rejection-record.json')
    const record = JSON.parse(await readFile(recordPath, 'utf8'))
    await writeFile(recordPath, `${JSON.stringify({ ...record, userApproved: true })}\n`)
    expect(await validateBodyHeadRejectionEvidence({ repositoryRoot })).toContainEqual(
      expect.objectContaining({ code: 'BODY_HEAD_REJECTION_FIELDS_INVALID' }),
    )
  })
})
