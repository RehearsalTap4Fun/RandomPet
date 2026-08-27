import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { auditTask9BridgeSplits, auditTask9DistalFits, auditTask9EdgeResidual, auditTask9ReceiverSupports, deriveTask9ConnectorContracts, deriveTask9TangentWindows, extractTask9Candidate, normalizeTask9Extra, normalizeTask9Tail, resolveTask9ProcessedBodyKey, synchronizeTask9SourceIndex, task9ReceiverSockets, task9StructuralSelections } from './prepare-tail-extra-assets.js'
import { TASK9_BODY_RIG_IDS, TASK9_EXTRA_IDS, TASK9_TAIL_IDS } from './task9-structural-identities.js'

const temporaryRoots: string[] = []
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('prepare tail and extra assets', () => {
  it('freezes 18 exact-rig structural selections and three receiver sockets per body identity', () => {
    expect(task9StructuralSelections()).toHaveLength(18)
    expect(task9ReceiverSockets('body_blob_round')).toMatchObject({
      tailRoot: { x: 1480, y: 1170 },
      extraLeft: { x: 560, y: 900 },
      extraRight: { x: 1488, y: 900 },
    })
  })

  it('shares one complete body-rig mapping and one production/matrix tail-extra identity set', () => {
    expect(TASK9_BODY_RIG_IDS).toEqual({
      body_blob_round: 'blob', body_blob_wide: 'blob',
      body_biped_peanut: 'biped', body_biped_tall: 'biped',
      body_floating_drop: 'floating',
    })
    const selections = task9StructuralSelections()
    expect(new Set(selections.filter(item => item.slotId === 'tail').map(item => item.partId))).toEqual(new Set(TASK9_TAIL_IDS))
    expect(new Set(selections.filter(item => item.slotId === 'extraAppendage').map(item => item.partId))).toEqual(new Set(TASK9_EXTRA_IDS))
  })

  it('derives 15 nonempty in-bounds receiver masks from body-local alpha without mutating body sources', async () => {
    const audit = await auditTask9ReceiverSupports()
    expect(audit.receiverCount).toBe(15)
    expect(audit.minimumCoverage).toBeGreaterThanOrEqual(0.9)
    expect(audit.allHalvesNonempty).toBe(true)
    expect(audit.allWithinCanvas).toBe(true)
    expect(audit.sourceHashesUnchanged).toBe(true)
    expect(audit.minimumPixels).toBeGreaterThanOrEqual(32)
  })

  it('derives one nonempty alpha-supported tangent contract per rig with symmetric extra semantics', async () => {
    const windows = await deriveTask9TangentWindows()
    expect(windows.biped.extraLeft).toEqual({ min: 12.5, max: 63.5 })
    expect(windows.biped.extraRight).toEqual(windows.biped.extraLeft)
    for (const rig of Object.values(windows)) for (const window of Object.values(rig)) {
      expect(window.max).toBeGreaterThan(window.min)
    }
  })

  it('uses one rig-independent end-cap ribbon depth per connector class', async () => {
    const { ribbonDepths } = await deriveTask9ConnectorContracts()
    expect(ribbonDepths).toEqual({
      blob: { tailRoot: 14, extraLeft: 12, extraRight: 12 },
      biped: { tailRoot: 14, extraLeft: 12, extraRight: 12 },
      floating: { tailRoot: 14, extraLeft: 12, extraRight: 12 },
    })
    expect(Object.values(ribbonDepths).flatMap(Object.values).every(depth => depth >= 12)).toBe(true)
  })

  it('fits every distal node against every rig body while preserving the plug envelope bytes', async () => {
    const audit = await auditTask9DistalFits()
    expect(audit.runtimeNodes).toBe(27)
    expect(audit.projectedBodyPairs).toBe(45)
    expect(audit.violations).toEqual([])
    expect(audit.plugEnvelopeBytesIdentical).toBe(true)
    expect(audit.appliedKeys.some(key => key.includes('tail_fish_fan:blob'))).toBe(true)
    expect(audit.appliedKeys.some(key => key.includes('extra_soft_tentacles:blob'))).toBe(true)
    expect(audit.appliedKeys.some(key => key.includes('tail_soft_curl:biped'))).toBe(true)
    expect(audit.appliedKeys.some(key => key.includes(':floating:'))).toBe(false)
  }, 60_000)

  it('resolves each body from the actual processed-index schema and rejects duplicate aliases', async () => {
    const processed = JSON.parse(await readFile('asset-source/v0.3.0/production/processed-index.json', 'utf8')).processedAssets
    expect(resolveTask9ProcessedBodyKey(processed, 'body_biped_peanut', 'biped')).toBe('body_biped_peanut')
    expect(resolveTask9ProcessedBodyKey(processed, 'body_blob_round', 'blob')).toBe('body_blob_round:blob')
    expect(() => resolveTask9ProcessedBodyKey({ ...processed, 'body_biped_peanut:biped': processed.body_biped_peanut }, 'body_biped_peanut', 'biped'))
      .toThrow(/duplicate/u)
  })

  it('closes exact-rig runtime resources and Task 9 agent review evidence without adding aggregate sources', async () => {
    const sourceIndex = await synchronizeTask9SourceIndex({ dryRun: true })
    expect(sourceIndex.sources).toHaveLength(102)
    const task9Bridges = sourceIndex.sources.filter((source: any) => (
      source.kind === 'interface-bridge' && /-(?:tail|extra)-bridge$/u.test(source.sourceId)
    ))
    expect(task9Bridges).toHaveLength(6)
    expect(task9Bridges.every((source: any) => source.runtimeResources.length === 4)).toBe(true)
    expect(task9Bridges.every((source: any) => source.reviewRecordPath === 'packages/asset-catalog/review/v0.3.0/tail-extra-review-record.json')).toBe(true)
    const task9Variants = sourceIndex.sources.filter((source: any) => /^(?:tail_|extra_).+:(?:blob|biped|floating)$/u.test(source.sourceId))
    expect(task9Variants).toHaveLength(18)
    expect(task9Variants.every((source: any) => source.runtimeResources.length >= 7)).toBe(true)
  })

  it('partitions all six Task 9 bridge masks without overlap or neutral-alpha loss', async () => {
    const audit = await auditTask9BridgeSplits()
    expect(audit.bridges).toBe(6)
    expect(audit.nonBinaryPixels).toBe(0)
    expect(audit.outsideNeutralPixels).toBe(0)
    expect(audit.overlapPixels).toBe(0)
    expect(audit.unionMismatchPixels).toBe(0)
    expect(audit.nonemptyPairs).toBe(6)
  })

  it('hash-binds all five bodies by three task9 receiver guide pairs', async () => {
    const index = JSON.parse(await readFile('asset-source/v0.3.0/generation/task9-review/receiver-guides/task9-receiver-guide-index.json', 'utf8'))
    expect(index.files).toHaveLength(15)
    for (const entry of index.files) {
      expect(sha256(await readFile(entry.guidePath))).toBe(entry.guideSha256)
      expect(sha256(await readFile(entry.maskPath))).toBe(entry.maskSha256)
    }
  })

  it('extracts the selected checker-backed tail deterministically as one safe component', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-tail-'))
    temporaryRoots.push(root)
    const sourcePath = 'asset-source/v0.3.0/generation/task9-candidates/blob/tail_fish_fan/candidate-1.png'
    const firstPath = join(root, 'first.png')
    const secondPath = join(root, 'second.png')

    const first = await extractTask9Candidate({ sourcePath, outputPath: firstPath, expectedComponents: 1 })
    const second = await extractTask9Candidate({ sourcePath, outputPath: secondPath, expectedComponents: 1 })

    expect(first.retainedComponents).toBe(1)
    expect(first.boundaryAlphaPixels).toBe(0)
    expect(first.discardedComponents).toBeGreaterThan(0)
    expect(first.processedSha256).toBe(second.processedSha256)
    expect(sha256(await readFile(firstPath))).toBe(sha256(await readFile(secondPath)))
  })

  it('normalizes a tail to a safe 2048 master with a dense left-side plug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-tail-'))
    temporaryRoots.push(root)
    const extractedPath = join(root, 'extracted.png')
    await extractTask9Candidate({
      sourcePath: 'asset-source/v0.3.0/generation/task9-candidates/biped/tail_soft_curl/candidate-1.png',
      outputPath: extractedPath,
      expectedComponents: 1,
    })

    const normalized = await normalizeTask9Tail({ extractedPath, rigId: 'biped' })
    const metadata = await sharp(normalized.master).metadata()

    expect(metadata).toMatchObject({ width: 2048, height: 2048, hasAlpha: true })
    expect(normalized.connector.id).toBe('tailRoot')
    expect(normalized.connectorCoverage).toBeGreaterThanOrEqual(0.9)
    expect(normalized.bounds.minX).toBeGreaterThanOrEqual(64)
    expect(normalized.bounds.maxX).toBeLessThanOrEqual(1984)
    expect(normalized.bounds.minY).toBeGreaterThanOrEqual(64)
    expect(normalized.bounds.maxY).toBeLessThanOrEqual(1984)
  })

  it('rejects the checker-contaminated fish edge and accepts the clean white-backed replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-fish-edge-'))
    temporaryRoots.push(root)
    const contaminatedPath = join(root, 'candidate-1.png')
    const replacementPath = join(root, 'candidate-2.png')
    await extractTask9Candidate({
      sourcePath: 'asset-source/v0.3.0/generation/task9-candidates/blob/tail_fish_fan/candidate-1.png',
      outputPath: contaminatedPath,
      expectedComponents: 1,
    })
    await extractTask9Candidate({
      sourcePath: 'asset-source/v0.3.0/generation/task9-candidates/blob/tail_fish_fan/candidate-2.png',
      outputPath: replacementPath,
      expectedComponents: 1,
    })
    const contaminated = await auditTask9EdgeResidual(contaminatedPath)
    const replacement = await auditTask9EdgeResidual(replacementPath)

    expect(contaminated.paleNeutralBoundaryPixels).toBeGreaterThan(1_000)
    expect(replacement.paleNeutralBoundaryPixels).toBeLessThanOrEqual(500)
  })

  it.each([
    ['blob', 'extra_side_fins'],
    ['biped', 'extra_moth_wings'],
    ['floating', 'extra_soft_tentacles'],
  ] as const)('keeps two separated %s %s nodes and covers both inward plugs', async (rigId, partId) => {
    const root = await mkdtemp(join(tmpdir(), 'qmonster-task9-extra-'))
    temporaryRoots.push(root)
    const extractedPath = join(root, 'extracted.png')
    const extraction = await extractTask9Candidate({
      sourcePath: `asset-source/v0.3.0/generation/task9-candidates/${rigId}/${partId}/candidate-1.png`,
      outputPath: extractedPath,
      expectedComponents: 2,
    })
    const normalized = await normalizeTask9Extra({ extractedPath, rigId })

    expect(extraction.retainedComponents).toBe(2)
    expect(normalized.nodes).toHaveLength(2)
    expect(normalized.connectorCoverage.every(value => value >= 0.9)).toBe(true)
    const master = await sharp(normalized.master).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let centralAlpha = 0
    for (let y = 300; y < 1500; y += 1) for (let x = 920; x < 1128; x += 1) {
      centralAlpha += master.data[(y * master.info.width + x) * 4 + 3]!
    }
    expect(centralAlpha).toBe(0)
  })
})
