import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { EXTERNAL_LIMB_ALPHA_MIN } from '@qmonster/renderer-canvas'
import { extractPairedLimbCandidate, normalizePairedLimb } from './prepare-limb-assets.js'

const SIZE = 2048
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const REVIEW_RECORD_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-review-record.json'
const AMENDMENT_PATH = 'packages/asset-catalog/review/v0.3.0/body-head-connector-amendment.json'
const SNAPSHOT_ROOT = 'packages/asset-catalog/review/v0.3.0/superseded/task7-pre-wide-shoulder-amendment'
const THRESHOLD_065_HISTORY_ROOT = 'packages/asset-catalog/review/v0.3.0/superseded/task8-global-threshold-0.65'
const THRESHOLD_063_HISTORY_ROOT = 'packages/asset-catalog/review/v0.3.0/superseded/task8-global-threshold-0.63'
const THRESHOLD_AMENDMENT_PATH = 'packages/asset-catalog/review/v0.3.0/visible-limb-threshold-amendment.json'
const JOINT_EVIDENCE_PATH = '.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-blob-joint-shoulder-search.json'
const JOINT_EVIDENCE_SHA256 = 'fc538e40d78dd72c6b6ac4daf2883e753d0fe1a47aa3d3be76a1ca035431b295'
const BODY_HEAD_REVIEW_ARTIFACTS = [
  'body-head-contact-sheet-blob.png',
  'body-head-contact-sheet-blob-256.png',
  'body-head-contact-sheet-blob-manifest.json',
  'body-head-contact-sheet-biped.png',
  'body-head-contact-sheet-biped-256.png',
  'body-head-contact-sheet-biped-manifest.json',
  'body-head-contact-sheet-floating.png',
  'body-head-contact-sheet-floating-256.png',
  'body-head-contact-sheet-floating-manifest.json',
] as const

type Point = { x: number, y: number }

export interface ShoulderDerivationInput {
  bodyRgba: Uint8Array
  bodyWidth: number
  bodyHeight: number
  leftArmRgba: Uint8Array
  armWidth: number
  armHeight: number
  leftArmPlugOrigin: Point
  rightArmRgba?: Uint8Array
  rightArmPlugOrigin?: Point
  shoulderY: number
  connectorWidth: number
  connectorDepth: number
  receiverCoverageMin: number
  safeFrame: { minX: number, maxX: number }
}

export interface CommonShoulderDerivationInput {
  bodyRgba: Uint8Array
  bodyWidth: number
  bodyHeight: number
  shoulderY: number
  connectorWidth: number
  connectorDepth: number
  receiverCoverageMin: number
  safeFrame: { minX: number, maxX: number }
  limbs: Array<{
    id: string
    leftArmRgba: Uint8Array
    rightArmRgba: Uint8Array
    armWidth: number
    armHeight: number
    leftArmPlugOrigin: Point
    rightArmPlugOrigin: Point
  }>
}

function alphaBounds(rgba: Uint8Array, width: number, height: number): { minX: number, maxX: number } {
  let minX = width; let maxX = -1
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rgba[(y * width + x) * 4 + 3]! <= 8) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
  }
  if (maxX < minX) throw new Error('SHOULDER_AMENDMENT_INVALID: limb alpha is empty')
  return { minX, maxX }
}

function receiverCoverage(input: ShoulderDerivationInput, origin: Point): number {
  const tangentLimit = input.connectorWidth * 0.4
  const normalLimit = input.connectorDepth * 0.48
  let covered = 0; let total = 0
  const minY = Math.max(0, Math.floor(origin.y - tangentLimit - 0.5))
  const maxY = Math.min(input.bodyHeight - 1, Math.ceil(origin.y + tangentLimit - 0.5))
  const minX = Math.max(0, Math.floor(origin.x - normalLimit - 0.5))
  const maxX = Math.min(input.bodyWidth - 1, Math.ceil(origin.x + normalLimit - 0.5))
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (Math.abs(y + 0.5 - origin.y) > tangentLimit || Math.abs(x + 0.5 - origin.x) > normalLimit) continue
    total += 1
    if (input.bodyRgba[(y * input.bodyWidth + x) * 4 + 3]! > 8) covered += 1
  }
  return total === 0 ? 0 : covered / total
}

export function deriveCommonSymmetricShoulderOrigins(input: CommonShoulderDerivationInput) {
  if (input.bodyWidth !== SIZE || input.bodyHeight !== SIZE || input.limbs.length === 0) {
    throw new Error('SHOULDER_AMENDMENT_INVALID: body must use the canonical 2048 frame and at least one limb is required')
  }
  for (const limb of input.limbs) if (limb.armWidth !== SIZE || limb.armHeight !== SIZE) {
    throw new Error(`SHOULDER_AMENDMENT_INVALID: ${limb.id} must use the canonical 2048 frame`)
  }
  const coverageInput = input as unknown as ShoulderDerivationInput
  const centerX = SIZE / 2
  const bodySupportedLeftX: number[] = []
  for (let leftX = 0; leftX < centerX; leftX += 1) {
    const rightX = SIZE - leftX
    if (
      receiverCoverage(coverageInput, { x: leftX, y: input.shoulderY }) >= input.receiverCoverageMin
      && receiverCoverage(coverageInput, { x: rightX, y: input.shoulderY }) >= input.receiverCoverageMin
    ) bodySupportedLeftX.push(leftX)
  }
  if (bodySupportedLeftX.length === 0) throw new Error('SHOULDER_AMENDMENT_INVALID: no symmetric receiver pair has enough body alpha support')

  const limbIntervals = input.limbs.map(limb => {
    const leftBounds = alphaBounds(limb.leftArmRgba, limb.armWidth, limb.armHeight)
    const rightBounds = alphaBounds(limb.rightArmRgba, limb.armWidth, limb.armHeight)
    const leftDelta = { min: leftBounds.minX - limb.leftArmPlugOrigin.x, max: leftBounds.maxX - limb.leftArmPlugOrigin.x }
    const rightDelta = { min: rightBounds.minX - limb.rightArmPlugOrigin.x, max: rightBounds.maxX - limb.rightArmPlugOrigin.x }
    const minX = Math.ceil(Math.max(
      input.safeFrame.minX - leftDelta.min,
      SIZE + rightDelta.max - input.safeFrame.maxX,
    ))
    const maxX = Math.floor(Math.min(
      input.safeFrame.maxX - leftDelta.max,
      SIZE + rightDelta.min - input.safeFrame.minX,
      centerX - 1,
    ))
    if (minX > maxX) throw new Error(`SHOULDER_AMENDMENT_INVALID: ${limb.id} cannot fit the final safe frame at any symmetric shoulder position`)
    return { id: limb.id, minX, maxX, leftBounds, rightBounds, leftDelta, rightDelta }
  })
  const safeMinX = Math.max(...limbIntervals.map(item => item.minX))
  const safeMaxX = Math.min(...limbIntervals.map(item => item.maxX))
  const feasible = bodySupportedLeftX.filter(x => x >= safeMinX && x <= safeMaxX)
  if (feasible.length === 0) throw new Error('SHOULDER_AMENDMENT_INVALID: retained limb safe frames do not intersect supported body shoulder positions')
  const selectedLeftX = feasible[0]!
  const selectedRightX = SIZE - selectedLeftX
  const origins = { left: { x: selectedLeftX, y: input.shoulderY }, right: { x: selectedRightX, y: input.shoulderY } }
  const coverage = {
    left: receiverCoverage(coverageInput, origins.left),
    right: receiverCoverage(coverageInput, origins.right),
  }
  return {
    origins, selectedLeftX,
    bodySupportedInterval: { minX: bodySupportedLeftX[0]!, maxX: bodySupportedLeftX.at(-1)! },
    commonSafeInterval: { minX: safeMinX, maxX: safeMaxX },
    commonFeasibleInterval: { minX: feasible[0]!, maxX: feasible.at(-1)! },
    receiverCoverage: coverage,
    limbIntervals,
    projectedBoundsByLimb: limbIntervals.map(item => ({
      id: item.id,
      minX: Math.min(selectedLeftX + item.leftDelta.min, selectedRightX + item.rightDelta.min),
      maxX: Math.max(selectedLeftX + item.leftDelta.max, selectedRightX + item.rightDelta.max),
    })),
    grammar: {
      connectorClass: 'shoulder', width: input.connectorWidth, depth: input.connectorDepth,
      tangent: { x: 0, y: 1 }, leftNormal: { x: -1, y: 0 }, rightNormal: { x: 1, y: 0 },
      warpLimits: { widthRatio: { min: 0.85, max: 1.15 }, depthRatio: { min: 0.8, max: 1.2 }, rotationDegrees: { min: -12, max: 12 } },
    },
  }
}

export function deriveSymmetricShoulderOrigins(input: ShoulderDerivationInput) {
  if (input.bodyWidth !== SIZE || input.bodyHeight !== SIZE || input.armWidth !== SIZE || input.armHeight !== SIZE) {
    throw new Error('SHOULDER_AMENDMENT_INVALID: body and limb nodes must use the canonical 2048 frame')
  }
  const rightRgba = input.rightArmRgba ?? input.leftArmRgba
  const rightPlugOrigin = input.rightArmPlugOrigin ?? { x: SIZE - input.leftArmPlugOrigin.x, y: input.leftArmPlugOrigin.y }
  const common = deriveCommonSymmetricShoulderOrigins({
    bodyRgba: input.bodyRgba, bodyWidth: input.bodyWidth, bodyHeight: input.bodyHeight,
    shoulderY: input.shoulderY, connectorWidth: input.connectorWidth, connectorDepth: input.connectorDepth,
    receiverCoverageMin: input.receiverCoverageMin, safeFrame: input.safeFrame,
    limbs: [{
      id: 'selected-limb', leftArmRgba: input.leftArmRgba, rightArmRgba: rightRgba,
      armWidth: input.armWidth, armHeight: input.armHeight,
      leftArmPlugOrigin: input.leftArmPlugOrigin, rightArmPlugOrigin: rightPlugOrigin,
    }],
  })
  const interval = common.limbIntervals[0]!
  const leftReach = -interval.leftDelta.min
  const rightReach = interval.rightDelta.max
  return {
    origins: common.origins,
    selectedLeftX: common.selectedLeftX, outermostSupportedLeftX: common.bodySupportedInterval.minX, safeMinimumLeftX: interval.minX,
    receiverCoverage: common.receiverCoverage,
    projectedBounds: { minX: common.selectedLeftX - leftReach, maxX: SIZE - common.selectedLeftX + rightReach },
    alphaReach: { left: leftReach, right: rightReach },
    grammar: common.grammar,
  }
}

function jointRecordPasses(record: any, outsideMinimum: number): boolean {
  const bounds = record.visibleBounds
  if (
    bounds === null || bounds === undefined
    || bounds.x < 96 || bounds.y < 64
    || bounds.x + bounds.width > 1952 || bounds.y + bounds.height > 1952
  ) return false
  const metrics = record.metrics
  return Array.isArray(metrics) && metrics.length === 2 && metrics.every((metric: any) => (
    metric.receiverCoverage >= 0.9
    && metric.plugCoverage >= 0.9
    && metric.connected >= 0.99
    && metric.gap <= 2
    && metric.outside >= outsideMinimum
  ))
}

export function selectJointShoulderSolution(evidence: any, outsideMinimum: number) {
  if (evidence?.schemaVersion !== 'task8-blob-joint-shoulder-search-v1' || evidence.safeBoundaryVerification === undefined) {
    throw new Error('SHOULDER_AMENDMENT_INVALID: joint evidence is missing or malformed')
  }
  const roundRecords = evidence.exactRound as any[]
  const boundaryRecords = evidence.safeBoundaryVerification.records as any[]
  const roundPasses = (record: any) => roundRecords.some(round => (
    round.armId === record.armId
    && round.scale === record.scale
    && round.rotationDegrees === record.rotationDegrees
    && jointRecordPasses(round, outsideMinimum)
  ))
  const widePasses = boundaryRecords.filter(record => jointRecordPasses(record, outsideMinimum) && roundPasses(record))
  const solutions = widePasses.filter(record => record.armId === 'arms_paddle:c4').flatMap(paddle => (
    widePasses.filter(record => record.originX === paddle.originX && /^arms_short_plush:c[2-7]$/.test(record.armId)).map(short => ({ paddle, short }))
  ))
  if (solutions.length === 0) throw new Error(`SHOULDER_AMENDMENT_INVALID: no common paddle/short solution meets global outside minimum ${outsideMinimum}`)
  const score = (solution: { paddle: any, short: any }) => Math.min(...[solution.paddle, solution.short].flatMap(record => record.metrics.map((metric: any) => metric.outside)))
  solutions.sort((left, right) => score(right) - score(left) || left.short.originX - right.short.originX)
  const selected = solutions[0]!
  const shortMetrics = [...selected.short.metrics].sort((left: any, right: any) => left.connectorId.localeCompare(right.connectorId))
  const currentEvaluation = (record: any) => ({
    ...record,
    pass: jointRecordPasses(record, outsideMinimum),
    gateErrors: [],
    blockingDiagnostics: [],
    sourceEvaluation: {
      pass: record.pass,
      gateErrors: structuredClone(record.gateErrors ?? []),
      blockingDiagnostics: structuredClone(record.blockingDiagnostics ?? []),
    },
  })
  return {
    selectedLeftX: selected.short.originX,
    selectedRightX: SIZE - selected.short.originX,
    outsideMinimum,
    paddle: { armId: selected.paddle.armId, scale: selected.paddle.scale, rotationDegrees: selected.paddle.rotationDegrees },
    short: { armId: selected.short.armId, scale: selected.short.scale, rotationDegrees: selected.short.rotationDegrees },
    outsideMinima: { left: shortMetrics.find((item: any) => item.connectorId === 'shoulderLeft').outside, right: shortMetrics.find((item: any) => item.connectorId === 'shoulderRight').outside },
    wideRecords: { paddle: currentEvaluation(selected.paddle), short: currentEvaluation(selected.short) },
  }
}

async function decodedRgba(bytes: Buffer) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

export async function loadUniversalBlobArmConstraints(root = process.cwd(), manifest?: any) {
  const sourceManifest = manifest ?? JSON.parse(await readFile(resolve(root, 'asset-source/v0.3.0/interface-manifest.json'), 'utf8'))
  const constraints: CommonShoulderDerivationInput['limbs'] = []
  const bindings: Array<Record<string, unknown>> = []
  for (const partId of ['arms_paddle', 'arms_long_noodle'] as const) {
    const variant = sourceManifest.assets.find((asset: any) => asset.id === partId)?.variants.find((item: any) => item.rigId === 'blob')
    if (variant === undefined) throw new Error(`SHOULDER_AMENDMENT_INVALID: missing retained ${partId}:blob variant`)
    const leftConnector = variant.connectors.find((item: any) => item.id === 'shoulderLeft')
    const rightConnector = variant.connectors.find((item: any) => item.id === 'shoulderRight')
    const leftPath = resolve(root, variant.renderNodes.find((item: any) => item.connectorId === 'shoulderLeft').sourcePngPath)
    const rightPath = resolve(root, variant.renderNodes.find((item: any) => item.connectorId === 'shoulderRight').sourcePngPath)
    const [leftBytes, rightBytes] = await Promise.all([readFile(leftPath), readFile(rightPath)])
    const [left, right] = await Promise.all([decodedRgba(leftBytes), decodedRgba(rightBytes)])
    constraints.push({
      id: partId, leftArmRgba: left.data, rightArmRgba: right.data,
      armWidth: left.info.width, armHeight: left.info.height,
      leftArmPlugOrigin: leftConnector.origin, rightArmPlugOrigin: rightConnector.origin,
    })
    bindings.push({
      id: partId,
      left: { path: relative(root, leftPath).replaceAll('\\', '/'), sha256: sha256(leftBytes), rgbaSha256: sha256(left.data) },
      right: { path: relative(root, rightPath).replaceAll('\\', '/'), sha256: sha256(rightBytes), rgbaSha256: sha256(right.data) },
      connectorOrigins: { left: leftConnector.origin, right: rightConnector.origin },
    })
  }
  const tempRoot = await mkdtemp(resolve(root, '.tmp-universal-blob-arm-'))
  try {
    for (let candidate = 2; candidate <= 7; candidate += 1) {
      const candidatePath = resolve(root, `asset-source/v0.3.0/generation/task8-candidates/blob/arms_short_plush/candidate-${candidate}.png`)
      const extractedPath = join(tempRoot, `candidate-${candidate}-extracted.png`)
      await extractPairedLimbCandidate(candidatePath, extractedPath)
      const normalized = await normalizePairedLimb({ extractedPath, rigId: 'blob', slotId: 'arms', partId: 'arms_short_plush' })
      const [left, right, candidateBytes] = await Promise.all([
        decodedRgba(normalized.nodes[0]), decodedRgba(normalized.nodes[1]), readFile(candidatePath),
      ])
      constraints.push({
        id: `arms_short_plush:c${candidate}`, leftArmRgba: left.data, rightArmRgba: right.data,
        armWidth: left.info.width, armHeight: left.info.height,
        leftArmPlugOrigin: normalized.origins[0], rightArmPlugOrigin: normalized.origins[1],
      })
      bindings.push({
        id: `arms_short_plush:c${candidate}`,
        candidate: { path: relative(root, candidatePath).replaceAll('\\', '/'), sha256: sha256(candidateBytes) },
        left: { pngSha256: sha256(normalized.nodes[0]), rgbaSha256: sha256(left.data) },
        right: { pngSha256: sha256(normalized.nodes[1]), rgbaSha256: sha256(right.data) },
        connectorOrigins: { left: normalized.origins[0], right: normalized.origins[1] },
      })
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
  return { constraints, bindings }
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return sha256(await readFile(path)) }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function listSnapshotFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name !== 'pre-amendment-evidence.json') files.push(path)
    }
  }
  await visit(root)
  return files.sort()
}

function maskBand(origin: Point, width: number, depth: number): Buffer {
  const alpha = Buffer.alloc(SIZE * SIZE)
  const tangentLimit = width * 0.4; const normalLimit = depth * 0.48
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    if (Math.abs(y + 0.5 - origin.y) <= tangentLimit && Math.abs(x + 0.5 - origin.x) <= normalLimit) alpha[y * SIZE + x] = 255
  }
  return alpha
}

async function maskPng(alpha: Buffer): Promise<Buffer> {
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } }).png(PNG).toBuffer()
}

async function writeShoulderMasks(root: string, connector: any): Promise<Record<string, string>> {
  const contour = maskBand(connector.origin, connector.width, connector.depth)
  const foreground = Buffer.alloc(contour.length); const background = Buffer.alloc(contour.length)
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const pixel = y * SIZE + x
    if (contour[pixel] === 0) continue
    if ((x + y) % 2 === 0) foreground[pixel] = 255
    else background[pixel] = 255
  }
  const hashes: Record<string, string> = {}
  for (const [kind, alpha] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
    const bytes = await maskPng(alpha)
    const runtimePath = resolve(root, 'packages/asset-catalog', connector[`${kind}MaskPath`])
    const sourcePath = resolve(root, `asset-source/v0.3.0/masks/blob/body_blob_wide/${connector.id}-${kind}.png`)
    await writeFile(runtimePath, bytes); await writeFile(sourcePath, bytes)
    hashes[`${kind}MaskSha256`] = sha256(bytes)
  }
  return hashes
}

export async function applyBlobWideShoulderAmendment(root = process.cwd()) {
  const snapshotRoot = resolve(root, SNAPSHOT_ROOT)
  const archivedAcceptance = join(snapshotRoot, 'body-head-contact-sheets-acceptance.pre-amendment.json')
  if ((await stat(archivedAcceptance)).isFile() !== true) throw new Error('SHOULDER_AMENDMENT_INVALID: archived Task 7 acceptance is missing')
  const snapshotFiles = await listSnapshotFiles(snapshotRoot)
  const snapshotEvidence = {
    schemaVersion: 'task7-pre-shoulder-amendment-evidence-v1', status: 'SUPERSEDED_APPROVAL_PRESERVED',
    supersededBy: AMENDMENT_PATH,
    files: await Promise.all(snapshotFiles.map(async path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: await hashFile(path), size: (await stat(path)).size }))),
  }
  const snapshotEvidencePath = join(snapshotRoot, 'pre-amendment-evidence.json')
  await writeJson(snapshotEvidencePath, snapshotEvidence)
  const snapshotEvidenceSha256 = await hashFile(snapshotEvidencePath)

  const manifestPath = resolve(root, 'asset-source/v0.3.0/interface-manifest.json')
  const processedPath = resolve(root, 'asset-source/v0.3.0/production/processed-index.json')
  const reviewPath = resolve(root, REVIEW_RECORD_PATH)
  const [manifestBytes, processedBytes, archivedReviewBytes, bodyBytes, previousAmendmentBytes, previousThresholdAmendmentBytes, jointEvidenceBytes] = await Promise.all([
    readFile(manifestPath), readFile(processedPath), readFile(join(snapshotRoot, 'body-head-review-record.pre-amendment.json')),
    readFile(resolve(root, 'asset-source/v0.3.0/structural/blob/nodes/body_blob_wide/body.png')),
    readFile(resolve(root, AMENDMENT_PATH)).catch(() => null),
    readFile(resolve(root, THRESHOLD_AMENDMENT_PATH)).catch(() => null),
    readFile(resolve(root, JOINT_EVIDENCE_PATH)),
  ])
  const archivedBodyHash = await hashFile(join(snapshotRoot, 'body/asset-source-body_blob_wide-node.png'))
  if (sha256(bodyBytes) !== archivedBodyHash) throw new Error('SHOULDER_AMENDMENT_INVALID: body bytes changed before metadata amendment')
  const body = await sharp(bodyBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const processed = JSON.parse(processedBytes.toString('utf8'))
  const oldReview = JSON.parse(archivedReviewBytes.toString('utf8'))
  const previousAmendment = previousAmendmentBytes === null ? null : JSON.parse(previousAmendmentBytes.toString('utf8'))
  const bodyVariant = manifest.assets.find((asset: any) => asset.id === 'body_blob_wide')?.variants.find((variant: any) => variant.rigId === 'blob')
  if (bodyVariant === undefined) throw new Error('SHOULDER_AMENDMENT_INVALID: exact blob body variant is missing')
  const leftReceiver = bodyVariant.connectors.find((item: any) => item.id === 'shoulderLeft')
  const rightReceiver = bodyVariant.connectors.find((item: any) => item.id === 'shoulderRight')
  const before = { left: structuredClone(leftReceiver), right: structuredClone(rightReceiver) }
  if (sha256(jointEvidenceBytes) !== JOINT_EVIDENCE_SHA256) throw new Error('SHOULDER_AMENDMENT_INVALID: joint feasibility evidence hash changed')
  if (EXTERNAL_LIMB_ALPHA_MIN !== 0.614) throw new Error('SHOULDER_AMENDMENT_INVALID: global visible-limb threshold is not exactly 0.614')
  const joint = selectJointShoulderSolution(JSON.parse(jointEvidenceBytes.toString('utf8')), EXTERNAL_LIMB_ALPHA_MIN)
  const origins = { left: { x: joint.selectedLeftX, y: leftReceiver.origin.y }, right: { x: joint.selectedRightX, y: rightReceiver.origin.y } }
  const coverageInput = {
    bodyRgba: body.data, bodyWidth: body.info.width, bodyHeight: body.info.height,
    shoulderY: leftReceiver.origin.y, connectorWidth: leftReceiver.width, connectorDepth: leftReceiver.depth,
    receiverCoverageMin: 0.9, safeFrame: { minX: 96, maxX: 1952 },
  } as ShoulderDerivationInput
  const supported = Array.from({ length: SIZE / 2 }, (_, x) => x).filter(x => (
    receiverCoverage(coverageInput, { x, y: leftReceiver.origin.y }) >= 0.9
    && receiverCoverage(coverageInput, { x: SIZE - x, y: rightReceiver.origin.y }) >= 0.9
  ))
  if (!supported.includes(joint.selectedLeftX)) throw new Error('SHOULDER_AMENDMENT_INVALID: selected joint shoulder lacks live body alpha support')
  const derived = {
    origins, selectedLeftX: joint.selectedLeftX, outermostSupportedLeftX: supported[0]!,
    bodySupportedInterval: { minX: supported[0]!, maxX: supported.at(-1)! },
    receiverCoverage: { left: receiverCoverage(coverageInput, origins.left), right: receiverCoverage(coverageInput, origins.right) },
    projectedBounds: joint.wideRecords.short.visibleBounds, joint,
    grammar: {
      connectorClass: 'shoulder', width: leftReceiver.width, depth: leftReceiver.depth,
      tangent: { x: 0, y: 1 }, leftNormal: { x: -1, y: 0 }, rightNormal: { x: 1, y: 0 },
      warpLimits: leftReceiver.warpLimits,
    },
  }
  leftReceiver.origin = derived.origins.left; rightReceiver.origin = derived.origins.right
  const allowedKeys = ['origin']
  for (const [side, connector] of [['left', leftReceiver], ['right', rightReceiver]] as const) {
    const original = before[side]
    for (const key of Object.keys(original)) if (!allowedKeys.includes(key) && JSON.stringify(original[key]) !== JSON.stringify(connector[key])) {
      throw new Error(`SHOULDER_AMENDMENT_INVALID: ${side} connector grammar changed at ${key}`)
    }
  }
  const connectorHashes = processed.processedAssets['body_blob_wide:blob'].connectorHashes
  connectorHashes.shoulderLeft = await writeShoulderMasks(root, leftReceiver)
  connectorHashes.shoulderRight = await writeShoulderMasks(root, rightReceiver)

  const review = {
    schemaVersion: 'body-head-review-amendment-v1', status: 'WAITING_FOR_USER_REAPPROVAL', decision: 'pending',
    reviewer: 'Codex visual self-review', userApproved: false, latestUserDecision: 'C',
    latestUserFeedback: 'Authorized one global visible-limb outside-alpha threshold of exactly 0.614 while retaining the hash-bound x490/1558 shoulder and c3 composition.',
    entryCount: 20, entryCountByRig: { blob: 8, biped: 8, floating: 4 }, selections: oldReview.selections,
    supersededApproval: { path: `${SNAPSHOT_ROOT}/body-head-contact-sheets-acceptance.pre-amendment.json`, sha256: await hashFile(archivedAcceptance) },
    preAmendmentEvidence: { path: `${SNAPSHOT_ROOT}/pre-amendment-evidence.json`, sha256: snapshotEvidenceSha256 },
    amendmentRecord: AMENDMENT_PATH,
  }
  await writeJson(reviewPath, review)
  const reviewSha256 = await hashFile(reviewPath)
  for (const source of processed.sourceIndex.sources) {
    if (source.reviewRecordPath === REVIEW_RECORD_PATH) source.reviewRecordSha256 = reviewSha256
  }
  await writeJson(manifestPath, manifest)
  await writeJson(processedPath, processed)

  const reviewArtifacts = await Promise.all(BODY_HEAD_REVIEW_ARTIFACTS.map(async name => {
    const path = `packages/asset-catalog/review/v0.3.0/${name}`
    return { path, sha256: await hashFile(resolve(root, path)) }
  }))

  const amendment = {
    schemaVersion: 'body-head-connector-amendment-v1', status: 'WAITING_FOR_USER_REAPPROVAL', userApproved: false,
    userDecision: 'B', latestThresholdDecision: 'C', scope: { rigId: 'blob', bodyId: 'body_blob_wide', connectors: ['shoulderLeft', 'shoulderRight'] },
    unchangedBody: { path: 'asset-source/v0.3.0/structural/blob/nodes/body_blob_wide/body.png', beforeSha256: archivedBodyHash, afterSha256: sha256(bodyBytes), decodedRgbaSha256: sha256(body.data) },
    oldOrigins: previousAmendment?.oldOrigins ?? { left: before.left.origin, right: before.right.origin },
    priorAppliedOrigins: previousAmendment?.priorAppliedOrigins ?? { left: before.left.origin, right: before.right.origin }, newOrigins: derived.origins,
    derivation: { ...derived, receiverCoverageMin: 0.9, safeFrame: { minX: 96, maxX: 1952 }, sourceCandidate: 'asset-source/v0.3.0/generation/task8-candidates/blob/arms_short_plush/candidate-3.png', sourceCandidateSha256: await hashFile(resolve(root, 'asset-source/v0.3.0/generation/task8-candidates/blob/arms_short_plush/candidate-3.png')) },
    jointFeasibility: { path: JOINT_EVIDENCE_PATH, sha256: JOINT_EVIDENCE_SHA256, evaluatedAtGlobalOutsideMinimum: EXTERNAL_LIMB_ALPHA_MIN },
    preservedGrammar: derived.grammar,
    preAmendmentEvidence: review.preAmendmentEvidence,
    reviewArtifacts,
    notes: ['The historical Task 7 approval is preserved but no longer applies to amended shoulder metadata.', 'No amendment acceptance exists; user reapproval is required after Task 7 and Task 8 visual review.'],
  }
  await writeJson(resolve(root, AMENDMENT_PATH), amendment)

  const threshold065HistoryRoot = resolve(root, THRESHOLD_065_HISTORY_ROOT)
  await mkdir(threshold065HistoryRoot, { recursive: true })
  const archivedAmendmentPath = join(threshold065HistoryRoot, 'body-head-connector-amendment-at-0.65.json')
  const archivedAmendmentExists = await stat(archivedAmendmentPath).then(item => item.isFile()).catch(() => false)
  if (!archivedAmendmentExists && previousAmendmentBytes !== null) await writeFile(archivedAmendmentPath, previousAmendmentBytes)
  const archivedAmendmentBytes = await readFile(archivedAmendmentPath).catch(() => null)

  const threshold063HistoryRoot = resolve(root, THRESHOLD_063_HISTORY_ROOT)
  await mkdir(threshold063HistoryRoot, { recursive: true })
  const archived063AmendmentPath = join(threshold063HistoryRoot, 'body-head-connector-amendment-at-0.63.json')
  const archived063ThresholdPath = join(threshold063HistoryRoot, 'visible-limb-threshold-amendment-at-0.63.json')
  if (!(await stat(archived063AmendmentPath).then(item => item.isFile()).catch(() => false)) && previousAmendmentBytes !== null) {
    await writeFile(archived063AmendmentPath, previousAmendmentBytes)
  }
  if (!(await stat(archived063ThresholdPath).then(item => item.isFile()).catch(() => false)) && previousThresholdAmendmentBytes !== null) {
    await writeFile(archived063ThresholdPath, previousThresholdAmendmentBytes)
  }
  const [archived063AmendmentBytes, archived063ThresholdBytes] = await Promise.all([
    readFile(archived063AmendmentPath).catch(() => null),
    readFile(archived063ThresholdPath).catch(() => null),
  ])
  const thresholdAmendment = {
    schemaVersion: 'visible-limb-threshold-amendment-v2', status: 'WAITING_FOR_USER_REAPPROVAL', userApproved: false,
    userDecision: 'C', scope: 'global-v0.3-visible-arms-and-legs', supersededMinimum: 0.63, activeMinimum: EXTERNAL_LIMB_ALPHA_MIN,
    decisionHistory: [
      { minimum: 0.65, status: 'superseded', decision: 'initial-v0.3-contract' },
      { minimum: 0.63, status: 'superseded', userDecision: 'B' },
      { minimum: EXTERNAL_LIMB_ALPHA_MIN, status: 'active', userDecision: 'C' },
    ],
    noOverrides: true, boundaryBehavior: { accepts: 0.614, rejects: 0.613999 },
    jointFeasibility: { path: JOINT_EVIDENCE_PATH, sha256: JOINT_EVIDENCE_SHA256, selected: joint },
    supersededEvidence: {
      archivedConnectorAmendmentPath: relative(root, archivedAmendmentPath).replaceAll('\\', '/'),
      archivedConnectorAmendmentSha256: archivedAmendmentBytes === null ? null : sha256(archivedAmendmentBytes),
      archived063ConnectorAmendmentPath: relative(root, archived063AmendmentPath).replaceAll('\\', '/'),
      archived063ConnectorAmendmentSha256: archived063AmendmentBytes === null ? null : sha256(archived063AmendmentBytes),
      archived063ThresholdAmendmentPath: relative(root, archived063ThresholdPath).replaceAll('\\', '/'),
      archived063ThresholdAmendmentSha256: archived063ThresholdBytes === null ? null : sha256(archived063ThresholdBytes),
      taskReportPath: '.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task-8-report.md',
    },
    notes: ['The former 0.65 and 0.63 rules remain historical evidence and are not active fallbacks.', 'No rig, body, part, or identity may override the active 0.614 minimum.'],
  }
  await writeJson(resolve(root, THRESHOLD_AMENDMENT_PATH), thresholdAmendment)
  return { derived, bodySha256: sha256(bodyBytes), decodedRgbaSha256: sha256(body.data), reviewSha256, snapshotEvidenceSha256 }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await applyBlobWideShoulderAmendment()))
}
