import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { deriveCommonSymmetricShoulderOrigins, deriveSymmetricShoulderOrigins, selectJointShoulderSolution } from './amend-blob-wide-shoulders.js'

const ROOT = process.cwd()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('Task 7 body_blob_wide shoulder amendment', () => {
  it('binds all nine rerendered Task 7 artifacts to their byte-identical pre-amendment evidence', async () => {
    const amendment = JSON.parse(await readFile(resolve(ROOT, 'packages/asset-catalog/review/v0.3.0/body-head-connector-amendment.json'), 'utf8'))
    const evidence = JSON.parse(await readFile(resolve(ROOT, amendment.preAmendmentEvidence.path), 'utf8'))
    const archivedByName = new Map(evidence.files
      .filter((item: { path: string }) => item.path.includes('/review/body-head-contact-sheet-'))
      .map((item: { path: string; sha256: string }) => [item.path.split('/').at(-1), item.sha256]))

    expect(amendment.reviewArtifacts).toHaveLength(9)
    for (const artifact of amendment.reviewArtifacts) {
      expect(artifact.sha256).toBe(archivedByName.get(artifact.path.split('/').at(-1)))
      expect(sha256(await readFile(resolve(ROOT, artifact.path)))).toBe(artifact.sha256)
    }
  })

  it('retains the approved x490 c3/paddle solution from frozen joint evidence at global 0.614', async () => {
    const evidence = JSON.parse(await readFile(resolve(ROOT, '.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-blob-joint-shoulder-search.json'), 'utf8'))
    expect(() => selectJointShoulderSolution(evidence, 0.65)).toThrow('no common')
    const selected = selectJointShoulderSolution(evidence, 0.614)
    expect(selected).toMatchObject({
      selectedLeftX: 490,
      paddle: { armId: 'arms_paddle:c4', scale: 1, rotationDegrees: 0 },
      short: { armId: 'arms_short_plush:c3', scale: 1.15, rotationDegrees: 0 },
      outsideMinima: { left: 0.6398863319545027, right: 0.6443505816004901 },
    })
    expect(selected.wideRecords.short).toMatchObject({
      pass: true,
      gateErrors: [],
      sourceEvaluation: { pass: false },
    })
  })

  it('intersects body support and every retained limb safe-frame interval', () => {
    const rgba = (points: Array<{ x: number, y: number }>) => {
      const result = Buffer.alloc(2048 * 2048 * 4)
      for (const point of points) result[(point.y * 2048 + point.x) * 4 + 3] = 255
      return result
    }
    const body = Buffer.alloc(2048 * 2048 * 4, 255)
    const result = deriveCommonSymmetricShoulderOrigins({
      bodyRgba: body, bodyWidth: 2048, bodyHeight: 2048,
      shoulderY: 870, connectorWidth: 220, connectorDepth: 120,
      receiverCoverageMin: 0.9, safeFrame: { minX: 96, maxX: 1952 },
      limbs: [
        {
          id: 'narrow', leftArmRgba: rgba([{ x: 500, y: 500 }, { x: 800, y: 500 }]),
          rightArmRgba: rgba([{ x: 1248, y: 500 }, { x: 1548, y: 500 }]),
          armWidth: 2048, armHeight: 2048,
          leftArmPlugOrigin: { x: 680, y: 480 }, rightArmPlugOrigin: { x: 1368, y: 480 },
        },
        {
          id: 'wide', leftArmRgba: rgba([{ x: 430, y: 500 }, { x: 850, y: 500 }]),
          rightArmRgba: rgba([{ x: 1198, y: 500 }, { x: 1618, y: 500 }]),
          armWidth: 2048, armHeight: 2048,
          leftArmPlugOrigin: { x: 680, y: 480 }, rightArmPlugOrigin: { x: 1368, y: 480 },
        },
      ],
    })

    expect(result.commonFeasibleInterval).toEqual({ minX: 346, maxX: 1023 })
    expect(result.selectedLeftX).toBe(346)
    expect(result.limbIntervals.map(item => ({ id: item.id, minX: item.minX, maxX: item.maxX }))).toEqual([
      { id: 'narrow', minX: 276, maxX: 1023 },
      { id: 'wide', minX: 346, maxX: 1023 },
    ])
    expect(result.projectedBoundsByLimb.find(item => item.id === 'wide')).toEqual({ id: 'wide', minX: 96, maxX: 1952 })
  })

  it('derives the outermost safe symmetric shoulder roots from live body and c7 alpha', async () => {
    const bodyPath = resolve(ROOT, 'asset-source/v0.3.0/structural/blob/nodes/body_blob_wide/body.png')
    const oldBodyPath = resolve(ROOT, 'packages/asset-catalog/review/v0.3.0/superseded/task7-pre-wide-shoulder-amendment/body/asset-source-body_blob_wide-node.png')
    const armPath = resolve(ROOT, 'asset-source/v0.3.0/structural/blob/nodes/arms_short_plush/shoulderLeft.png')
    const [bodyBytes, oldBodyBytes, body, arm] = await Promise.all([
      readFile(bodyPath), readFile(oldBodyPath),
      sharp(bodyPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(armPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])

    const result = deriveSymmetricShoulderOrigins({
      bodyRgba: body.data, bodyWidth: body.info.width, bodyHeight: body.info.height,
      leftArmRgba: arm.data, armWidth: arm.info.width, armHeight: arm.info.height,
      leftArmPlugOrigin: { x: 680, y: 480 }, shoulderY: 870,
      connectorWidth: 220, connectorDepth: 120, receiverCoverageMin: 0.9,
      safeFrame: { minX: 96, maxX: 1952 },
    })

    expect(result.origins.left.x + result.origins.right.x).toBe(2048)
    expect(result.origins.left.y).toBe(870)
    expect(result.origins.right.y).toBe(870)
    expect(result.origins.left.x).toBeLessThan(500)
    expect(result.origins.right.x).toBeGreaterThan(1548)
    expect(result.receiverCoverage.left).toBeGreaterThanOrEqual(0.9)
    expect(result.receiverCoverage.right).toBeGreaterThanOrEqual(0.9)
    expect(result.projectedBounds.minX).toBeGreaterThanOrEqual(96)
    expect(result.projectedBounds.maxX).toBeLessThanOrEqual(1952)
    expect(result.selectedLeftX).toBe(Math.max(result.outermostSupportedLeftX, result.safeMinimumLeftX))
    expect(result.grammar).toEqual({
      connectorClass: 'shoulder', width: 220, depth: 120,
      tangent: { x: 0, y: 1 }, leftNormal: { x: -1, y: 0 }, rightNormal: { x: 1, y: 0 },
      warpLimits: { widthRatio: { min: 0.85, max: 1.15 }, depthRatio: { min: 0.8, max: 1.2 }, rotationDegrees: { min: -12, max: 12 } },
    })
    expect(sha256(bodyBytes)).toBe('95a8f7fbddfa84ce120f849ab541d2bd8f9f2e59a1ce4ae0a6813c604372510a')
    expect(bodyBytes).toEqual(oldBodyBytes)
  }, 15_000)
})
