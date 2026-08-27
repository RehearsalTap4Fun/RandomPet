import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import type { Catalog } from '@qmonster/generator-core'
import sharp from 'sharp'
import { createServer } from 'vite'
import { extractPairedLimbCandidate, normalizePairedLimb } from './prepare-limb-assets.js'
import {
  browserCatalog, fsUrl, makeSpec, resolvedFsPath, validateLimbRenderEvidence,
  type RenderEvidence,
} from './render-limb-contact-sheets.js'

const ROOT = process.cwd()
const SIZE = 2048
const SCALE = 8
const PNG = { compressionLevel: 9, adaptiveFiltering: false, palette: false } as const
const SCALES = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const
const ROTATIONS = [-12, -8, -4, 0, 4, 8, 12] as const
const BODY_IDS = ['body_blob_round', 'body_blob_wide'] as const
const SAFE = { minX: 96, maxX: 1952, minY: 64, maxY: 1952 }
const EVIDENCE_PATH = resolve(ROOT, '.superpowers/sdd/2026-08-24-qmonster-v0.3-interface-components-implementation/task8-blob-joint-shoulder-search.json')

type Point = { x: number, y: number, alpha: number }
type Transform = { scale: number, rotationDegrees: number }
type PreparedArm = {
  id: string
  partId: 'arms_paddle' | 'arms_short_plush'
  candidateNumber: number
  nodePaths: readonly [string, string]
  pngPaths: readonly [string, string]
  origins: readonly [{ x: number, y: number }, { x: number, y: number }]
  points: readonly [Point[], Point[]]
  binding: Record<string, unknown>
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
async function hashFile(path: string): Promise<string> { return sha256(await readFile(path)) }

export function makeSupportedOriginGrid(minX: number, maxX: number): number[] {
  if (!Number.isInteger(minX) || !Number.isInteger(maxX) || minX > maxX) throw new Error('JOINT_SHOULDER_SEARCH_INVALID: bad support interval')
  const values = new Set<number>([minX, maxX, 424, 512, 565].filter(value => value >= minX && value <= maxX))
  for (let x = Math.ceil(minX / 8) * 8; x <= maxX; x += 8) values.add(x)
  return [...values].sort((left, right) => left - right)
}

function transformedPoint(point: Point, plug: { x: number, y: number }, receiver: { x: number, y: number }, transform: Transform, side: 0 | 1) {
  const radians = (side === 0 ? -transform.rotationDegrees : transform.rotationDegrees) * Math.PI / 180
  const dx = (point.x - plug.x) * transform.scale
  const dy = (point.y - plug.y) * transform.scale
  return {
    x: receiver.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: receiver.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

async function alphaPoints(bytes: Buffer): Promise<Point[]> {
  const resized = await sharp(bytes).resize(SIZE / SCALE, SIZE / SCALE, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const points: Point[] = []
  for (let y = 0; y < resized.info.height; y += 1) for (let x = 0; x < resized.info.width; x += 1) {
    const alpha = resized.data[(y * resized.info.width + x) * 4 + 3]! / 255
    if (alpha > 0.01) points.push({ x: (x + 0.5) * SCALE, y: (y + 0.5) * SCALE, alpha })
  }
  return points
}

async function bodyAlpha(path: string): Promise<Float32Array> {
  const resized = await sharp(path).resize(SIZE / SCALE, SIZE / SCALE, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alpha = new Float32Array(resized.info.width * resized.info.height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = resized.data[pixel * 4 + 3]! / 255
  return alpha
}

function approximateSide(points: Point[], plug: { x: number, y: number }, receiver: { x: number, y: number }, transform: Transform, side: 0 | 1, body: Float32Array) {
  let mass = 0; let outside = 0
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (const point of points) {
    const world = transformedPoint(point, plug, receiver, transform, side)
    minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x)
    minY = Math.min(minY, world.y); maxY = Math.max(maxY, world.y)
    const x = Math.floor(world.x / SCALE); const y = Math.floor(world.y / SCALE)
    const bodyValue = x < 0 || x >= SIZE / SCALE || y < 0 || y >= SIZE / SCALE ? 0 : body[y * (SIZE / SCALE) + x]!
    mass += point.alpha; outside += point.alpha * (1 - bodyValue)
  }
  return { outside: mass === 0 ? 0 : outside / mass, bounds: { minX, maxX, minY, maxY } }
}

function approximateCell(arm: PreparedArm, transform: Transform, receivers: readonly [{ x: number, y: number }, { x: number, y: number }], body: Float32Array) {
  const sides = ([0, 1] as const).map(side => approximateSide(arm.points[side], arm.origins[side], receivers[side], transform, side, body))
  const bounds = {
    minX: Math.min(...sides.map(item => item.bounds.minX)), maxX: Math.max(...sides.map(item => item.bounds.maxX)),
    minY: Math.min(...sides.map(item => item.bounds.minY)), maxY: Math.max(...sides.map(item => item.bounds.maxY)),
  }
  const relaxedSafeBounds = bounds.minX >= SAFE.minX - 12 && bounds.maxX <= SAFE.maxX + 12 && bounds.minY >= SAFE.minY - 12 && bounds.maxY <= SAFE.maxY + 12
  return { outside: sides.map(item => item.outside), worstOutside: Math.min(...sides.map(item => item.outside)), bounds, relaxedSafeBounds }
}

async function prepareArms(tempRoot: string, sourceCatalog: Catalog): Promise<PreparedArm[]> {
  const result: PreparedArm[] = []
  const paddleVariant = sourceCatalog.parts.find(part => part.id === 'arms_paddle')?.composition?.mode === 'interface'
    ? sourceCatalog.parts.find(part => part.id === 'arms_paddle')!.composition!.variantsByRig.blob : undefined
  if (paddleVariant === undefined) throw new Error('JOINT_SHOULDER_SEARCH_INVALID: missing paddle blob variant')
  const paddleNodes = paddleVariant.renderNodes.sort((left, right) => left.connectorId!.localeCompare(right.connectorId!))
  const orderedPaddle = [paddleNodes.find(node => node.connectorId === 'shoulderLeft')!, paddleNodes.find(node => node.connectorId === 'shoulderRight')!] as const
  const paddlePaths = orderedPaddle.map(node => resolve(ROOT, 'packages/asset-catalog', node.pngPath!)) as [string, string]
  const paddleBytes = await Promise.all(paddlePaths.map(path => readFile(path)))
  const paddleConnectors = [paddleVariant.connectors.find(item => item.id === 'shoulderLeft')!, paddleVariant.connectors.find(item => item.id === 'shoulderRight')!] as const
  result.push({
    id: 'arms_paddle:c4', partId: 'arms_paddle', candidateNumber: 4,
    nodePaths: orderedPaddle.map(node => resolve(ROOT, 'packages/asset-catalog', node.assetPath)) as [string, string],
    pngPaths: paddlePaths, origins: paddleConnectors.map(item => item.origin) as any,
    points: await Promise.all(paddleBytes.map(bytes => alphaPoints(bytes))) as any,
    binding: {
      sourceCandidate: 'asset-source/v0.3.0/generation/task8-candidates/blob/arms_paddle/candidate-4.png',
      sourceCandidateSha256: await hashFile(resolve(ROOT, 'asset-source/v0.3.0/generation/task8-candidates/blob/arms_paddle/candidate-4.png')),
      nodes: await Promise.all(paddlePaths.map(async path => ({ path: relative(ROOT, path).replaceAll('\\', '/'), sha256: await hashFile(path) }))),
    },
  })
  for (let candidate = 2; candidate <= 7; candidate += 1) {
    const sourcePath = resolve(ROOT, `asset-source/v0.3.0/generation/task8-candidates/blob/arms_short_plush/candidate-${candidate}.png`)
    const extractedPath = join(tempRoot, `candidate-${candidate}-extracted.png`)
    await extractPairedLimbCandidate(sourcePath, extractedPath)
    const normalized = await normalizePairedLimb({ extractedPath, rigId: 'blob', slotId: 'arms', partId: 'arms_short_plush' })
    const pngPaths = [join(tempRoot, `candidate-${candidate}-left.png`), join(tempRoot, `candidate-${candidate}-right.png`)] as const
    const webpPaths = [join(tempRoot, `candidate-${candidate}-left.webp`), join(tempRoot, `candidate-${candidate}-right.webp`)] as const
    for (let side = 0; side < 2; side += 1) {
      await writeFile(pngPaths[side]!, normalized.nodes[side]!)
      await sharp(normalized.nodes[side]!).webp({ lossless: true, effort: 6 }).toFile(webpPaths[side]!)
    }
    result.push({
      id: `arms_short_plush:c${candidate}`, partId: 'arms_short_plush', candidateNumber: candidate,
      nodePaths: webpPaths, pngPaths, origins: normalized.origins,
      points: await Promise.all(normalized.nodes.map(bytes => alphaPoints(bytes))) as any,
      binding: {
        sourceCandidate: relative(ROOT, sourcePath).replaceAll('\\', '/'), sourceCandidateSha256: await hashFile(sourcePath),
        nodes: await Promise.all(pngPaths.map(async (path, side) => ({ side, pngPath: path, pngSha256: await hashFile(path), webpPath: webpPaths[side], webpSha256: await hashFile(webpPaths[side]!) }))),
        connectorOrigins: normalized.origins,
      },
    })
  }
  return result
}

async function receiverMasks(tempRoot: string, originX: number, connectorY: number) {
  const root = join(tempRoot, 'receiver-masks', String(originX))
  const result: Record<string, { contour: string, foreground: string, background: string, hashes: Record<string, string> }> = {}
  for (const [id, x] of [['shoulderLeft', originX], ['shoulderRight', SIZE - originX]] as const) {
    const contour = Buffer.alloc(SIZE * SIZE); const foreground = Buffer.alloc(SIZE * SIZE); const background = Buffer.alloc(SIZE * SIZE)
    for (let y = Math.max(0, connectorY - 88); y <= Math.min(SIZE - 1, connectorY + 87); y += 1) {
      for (let px = Math.max(0, x - 58); px <= Math.min(SIZE - 1, x + 57); px += 1) {
        const pixel = y * SIZE + px; contour[pixel] = 255
        if ((px + y) % 2 === 0) foreground[pixel] = 255
        else background[pixel] = 255
      }
    }
    const paths: any = {}; const hashes: Record<string, string> = {}
    for (const [kind, alpha] of [['contour', contour], ['foreground', foreground], ['background', background]] as const) {
      const bytes = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' } })
        .joinChannel(alpha, { raw: { width: SIZE, height: SIZE, channels: 1 } }).png(PNG).toBuffer()
      const path = join(root, `${id}-${kind}.png`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
      paths[kind] = path; hashes[`${kind}Sha256`] = sha256(bytes)
    }
    result[id] = { ...paths, hashes }
  }
  return result
}

function applyTransform(catalog: Catalog, arm: PreparedArm, transform: Transform) {
  const part = catalog.parts.find(item => item.id === arm.partId)!
  if (part.composition?.mode !== 'interface') throw new Error(`JOINT_SHOULDER_SEARCH_INVALID: ${arm.partId} is not interface composition`)
  const variant = part.composition.variantsByRig.blob!
  for (const node of variant.renderNodes) {
    node.transform = { scale: transform.scale, mirrorX: false }
    if (arm.partId === 'arms_short_plush') {
      const side = node.connectorId === 'shoulderLeft' ? 0 : 1
      node.assetPath = fsUrl(arm.nodePaths[side]); node.pngPath = fsUrl(arm.pngPaths[side]); node.origin = arm.origins[side]
    }
  }
  for (const connector of variant.connectors) {
    const signed = connector.id === 'shoulderLeft' ? transform.rotationDegrees : -transform.rotationDegrees
    const radians = signed * Math.PI / 180
    connector.tangent = { x: -Math.sin(radians), y: Math.cos(radians) }
  }
}

async function renderExact(input: {
  page: Page, baseUrl: string, tempRoot: string, sourceCatalog: Catalog, arm: PreparedArm,
  transform: Transform, bodyId: typeof BODY_IDS[number], originX?: number, index: number,
  maskCache: Map<number, Awaited<ReturnType<typeof receiverMasks>>>, hashCache: Map<string, string>, capture?: boolean,
}) {
  const catalog = browserCatalog(input.sourceCatalog)
  applyTransform(catalog, input.arm, input.transform)
  let maskBinding: unknown = null
  if (input.bodyId === 'body_blob_wide' && input.originX !== undefined) {
    const body = catalog.parts.find(item => item.id === input.bodyId)!
    if (body.composition?.mode !== 'interface') throw new Error('JOINT_SHOULDER_SEARCH_INVALID: wide body is not interface composition')
    const variant = body.composition.variantsByRig.blob!
    let masks = input.maskCache.get(input.originX)
    if (masks === undefined) {
      masks = await receiverMasks(input.tempRoot, input.originX, 870); input.maskCache.set(input.originX, masks)
    }
    for (const connector of variant.connectors.filter(item => item.id.startsWith('shoulder'))) {
      connector.origin = { x: connector.id === 'shoulderLeft' ? input.originX : SIZE - input.originX, y: 870 }
      const files = masks[connector.id]!
      connector.contourMaskPath = fsUrl(files.contour); connector.foregroundMaskPath = fsUrl(files.foreground); connector.backgroundMaskPath = fsUrl(files.background)
    }
    maskBinding = masks
  }
  const selection = { rigId: 'blob' as const, bodyFrame: input.bodyId, headShape: 'head_round_dome', arms: input.arm.partId, legs: 'legs_stub_feet' }
  const spec = makeSpec(catalog, selection, input.index)
  const inputPath = join(input.tempRoot, 'renders', `${input.index.toString().padStart(5, '0')}.json`)
  await mkdir(dirname(inputPath), { recursive: true }); await writeFile(inputPath, `${JSON.stringify({ catalog, spec })}\n`)
  await input.page.goto(`${input.baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
  await input.page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
  const browserError = await input.page.evaluate(() => document.body.dataset.renderError)
  if (browserError !== undefined) throw new Error(`JOINT_SHOULDER_SEARCH_RENDER_FAILED:${browserError}`)
  const evidence = await input.page.evaluate(() => JSON.parse(document.body.dataset.interfaceResult!)) as RenderEvidence
  const expected = ['arms', 'legs'].flatMap(slotId => {
    const part = catalog.parts.find(item => item.id === selection[slotId as 'arms' | 'legs'])!
    return part.composition?.mode === 'interface' ? part.composition.variantsByRig.blob!.renderNodes.map(node => node.assetPath) : []
  })
  const gateErrors = validateLimbRenderEvidence(evidence, expected)
  const shoulders = evidence.connectorMetrics.filter(item => item.connectorId.startsWith('shoulder'))
  const resolvedAssetHashes = await Promise.all([...new Set(evidence.resolvedAssetPaths)].map(async path => {
    let hash = input.hashCache.get(path)
    if (hash === undefined) { hash = await hashFile(resolvedFsPath(path)); input.hashCache.set(path, hash) }
    return { path, sha256: hash }
  }))
  let image: { path: string, sha256: string } | undefined
  if (input.capture) {
    const dataUrl = await input.page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    const path = join(input.tempRoot, 'selected', `${input.arm.id}-${input.bodyId}.png`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
    image = { path, sha256: sha256(bytes) }
  }
  return {
    armId: input.arm.id, bodyId: input.bodyId, originX: input.originX ?? null, ...input.transform,
    pass: gateErrors.length === 0, gateErrors,
    metrics: shoulders.map(item => ({ connectorId: item.connectorId, receiverCoverage: item.receiverCoverage, plugCoverage: item.plugCoverage, connected: item.largestComponentRatio, gap: item.centerlineGapPixels, outside: item.childOutsideBodyRatio })),
    visibleBounds: evidence.compositionMetrics?.visibleBounds ?? null,
    blockingDiagnostics: evidence.diagnostics.filter(item => item.severity === 'error').map(item => ({ code: item.code, path: item.path })),
    resolvedAssetHashes, maskBinding, image,
  }
}

async function mapPool<T, R>(items: readonly T[], workers: number, action: (item: T, index: number, worker: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async (_, worker) => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await action(items[index]!, index, worker)
    }
  }))
  return results
}

export async function compareBlobShortCandidates() {
  const catalogBytes = await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'))
  const sourceCatalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog
  const bodyWide = sourceCatalog.parts.find(part => part.id === 'body_blob_wide')?.composition?.mode === 'interface'
    ? sourceCatalog.parts.find(part => part.id === 'body_blob_wide')!.composition!.variantsByRig.blob : undefined
  const bodyRound = sourceCatalog.parts.find(part => part.id === 'body_blob_round')?.composition?.mode === 'interface'
    ? sourceCatalog.parts.find(part => part.id === 'body_blob_round')!.composition!.variantsByRig.blob : undefined
  if (bodyWide === undefined || bodyRound === undefined) throw new Error('JOINT_SHOULDER_SEARCH_INVALID: missing blob body variants')
  const wideBodyPath = resolve(ROOT, 'packages/asset-catalog', bodyWide.renderNodes[0]!.pngPath!)
  const roundBodyPath = resolve(ROOT, 'packages/asset-catalog', bodyRound.renderNodes[0]!.pngPath!)
  const [wideAlpha, roundAlpha] = await Promise.all([bodyAlpha(wideBodyPath), bodyAlpha(roundBodyPath)])
  const wideY = bodyWide.connectors.find(item => item.id === 'shoulderLeft')!.origin.y
  const roundReceivers = [bodyRound.connectors.find(item => item.id === 'shoulderLeft')!.origin, bodyRound.connectors.find(item => item.id === 'shoulderRight')!.origin] as const
  const originGrid = makeSupportedOriginGrid(353, 1023)
  const tempRoot = await mkdtemp(resolve(ROOT, '.tmp-blob-joint-search-'))
  const arms = await prepareArms(tempRoot, sourceCatalog)
  const preflight: any[] = []
  for (const arm of arms) for (const scale of SCALES) for (const rotationDegrees of ROTATIONS) {
    const transform = { scale, rotationDegrees }
    const round = approximateCell(arm, transform, roundReceivers, roundAlpha)
    for (const originX of originGrid) {
      const receivers = [{ x: originX, y: wideY }, { x: SIZE - originX, y: wideY }] as const
      const wide = approximateCell(arm, transform, receivers, wideAlpha)
      preflight.push({ armId: arm.id, scale, rotationDegrees, originX, round, wide,
        eligibleForExact: round.relaxedSafeBounds && wide.relaxedSafeBounds && round.worstOutside >= 0.5 && wide.worstOutside >= 0.5 })
    }
  }
  const candidatesForExact = preflight.filter(item => item.eligibleForExact)
  const originRanking = originGrid.map(originX => {
    const atOrigin = candidatesForExact.filter(item => item.originX === originX)
    const score = (item: any) => Math.min(item.round.worstOutside, item.wide.worstOutside)
    const paddle = atOrigin.filter(item => item.armId === 'arms_paddle:c4').sort((left, right) => score(right) - score(left))[0]
    const short = atOrigin.filter(item => item.armId.startsWith('arms_short_plush:')).sort((left, right) => score(right) - score(left))[0]
    return { originX, paddleScore: paddle === undefined ? null : score(paddle), shortScore: short === undefined ? null : score(short), jointScore: paddle === undefined || short === undefined ? null : Math.min(score(paddle), score(short)) }
  }).sort((left, right) => (right.jointScore ?? -1) - (left.jointScore ?? -1))
  const shortlistedOrigins = new Set(originRanking.filter(item => item.jointScore !== null).slice(0, 24).map(item => item.originX))
  const shortlist: typeof candidatesForExact = []
  for (const originX of shortlistedOrigins) for (const arm of arms) {
    const score = (item: any) => Math.min(item.round.worstOutside, item.wide.worstOutside)
    shortlist.push(...candidatesForExact.filter(item => item.originX === originX && item.armId === arm.id).sort((left, right) => score(right) - score(left)).slice(0, 4))
  }
  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen(); const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('JOINT_SHOULDER_SEARCH_RENDER_FAILED: Vite has no local URL')
  const browser = await chromium.launch({ headless: true }); const pages = await Promise.all(Array.from({ length: 4 }, () => browser.newPage()))
  const maskCache = new Map<number, Awaited<ReturnType<typeof receiverMasks>>>()
  const hashCache = new Map<string, string>()
  const exactRound = new Map<string, any>(); const exactWide: any[] = []
  try {
    for (const originX of shortlistedOrigins) maskCache.set(originX, await receiverMasks(tempRoot, originX, 870))
    const roundKeys = new Map<string, typeof candidatesForExact[number]>()
    for (const item of shortlist) roundKeys.set(`${item.armId}:${item.scale}:${item.rotationDegrees}`, item)
    const roundItems = [...roundKeys.values()]
    const roundResults = await mapPool(roundItems, pages.length, async (item, index, worker) => {
      const arm = arms.find(value => value.id === item.armId)!
      return renderExact({ page: pages[worker]!, baseUrl, tempRoot, sourceCatalog, arm, transform: { scale: item.scale, rotationDegrees: item.rotationDegrees }, bodyId: 'body_blob_round', index, maskCache, hashCache })
    })
    for (let index = 0; index < roundItems.length; index += 1) {
      const item = roundItems[index]!; exactRound.set(`${item.armId}:${item.scale}:${item.rotationDegrees}`, roundResults[index])
    }
    const ranked = shortlist
      .filter(item => exactRound.get(`${item.armId}:${item.scale}:${item.rotationDegrees}`)?.pass)
      .sort((left, right) => Math.min(right.round.worstOutside, right.wide.worstOutside) - Math.min(left.round.worstOutside, left.wide.worstOutside))
    const perArmOrigin = new Map<string, number>()
    const wideItems: typeof ranked = []
    for (const item of ranked) {
      const key = `${item.armId}:${item.originX}`; const count = perArmOrigin.get(key) ?? 0
      if (count >= 4) continue
      perArmOrigin.set(key, count + 1)
      wideItems.push(item)
    }
    exactWide.push(...await mapPool(wideItems, pages.length, async (item, index, worker) => {
      const arm = arms.find(value => value.id === item.armId)!
      return renderExact({ page: pages[worker]!, baseUrl, tempRoot, sourceCatalog, arm, transform: { scale: item.scale, rotationDegrees: item.rotationDegrees }, bodyId: 'body_blob_wide', originX: item.originX, index: roundItems.length + index, maskCache, hashCache })
    }))
  } finally {
    await Promise.all(pages.map(page => page.close())); await browser.close(); await server.close()
  }
  const widePasses = exactWide.filter(item => item.pass)
  const paddlePasses = widePasses.filter(item => item.armId === 'arms_paddle:c4')
  const shortPasses = widePasses.filter(item => item.armId.startsWith('arms_short_plush:'))
  const joint = paddlePasses.flatMap(paddle => shortPasses.filter(short => short.originX === paddle.originX).map(short => ({ originX: paddle.originX, paddle, short })))
    .sort((left, right) => {
      const worst = (value: any) => Math.min(...[value.paddle, value.short].flatMap((record: any) => record.metrics.map((metric: any) => metric.outside ?? 0)))
      return worst(right) - worst(left)
    })
  const selected = joint[0] ?? null
  const evidence = {
    schemaVersion: 'task8-blob-joint-shoulder-search-v1', status: selected === null ? 'NO_COMMON_SOLUTION' : 'COMMON_SOLUTION_FOUND',
    constraints: { bodySupportInterval: { minX: 353, maxX: 1023 }, originGrid, scales: SCALES, rotations: ROTATIONS, safeFrame: SAFE, preflightOutsideFloor: 0.5, exactOriginShortlistCount: 24, maxExactTransformsPerArmOrigin: 4 },
    inputBinding: {
      catalogPath: 'packages/asset-catalog/catalog/v0.3.0/catalog.json', catalogSha256: sha256(catalogBytes),
      bodyWide: { path: relative(ROOT, wideBodyPath).replaceAll('\\', '/'), sha256: await hashFile(wideBodyPath) },
      bodyRound: { path: relative(ROOT, roundBodyPath).replaceAll('\\', '/'), sha256: await hashFile(roundBodyPath) },
      arms: arms.map(arm => ({ id: arm.id, ...arm.binding })),
    },
    counts: { preflight: preflight.length, preflightEligible: candidatesForExact.length, shortlistedOrigins: shortlistedOrigins.size, shortlistedTransforms: shortlist.length, exactRound: exactRound.size, exactWide: exactWide.length, widePasses: widePasses.length, jointPasses: joint.length },
    selected,
    originRanking,
    exactRound: [...exactRound.values()], exactWide,
    preflight,
  }
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true }); await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)
  const result = { evidencePath: EVIDENCE_PATH, status: evidence.status, counts: evidence.counts, selected }
  await rm(tempRoot, { recursive: true, force: true })
  return result
}

async function exactRelativeBounds(arm: PreparedArm, transform: Transform) {
  const sides = []
  for (const side of [0, 1] as const) {
    const decoded = await sharp(arm.pngPaths[side]).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const radians = (side === 0 ? -transform.rotationDegrees : transform.rotationDegrees) * Math.PI / 180
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
    for (let y = 0; y < decoded.info.height; y += 1) for (let x = 0; x < decoded.info.width; x += 1) {
      if (decoded.data[(y * decoded.info.width + x) * 4 + 3]! <= 8) continue
      const dx = (x + 0.5 - arm.origins[side].x) * transform.scale
      const dy = (y + 0.5 - arm.origins[side].y) * transform.scale
      const tx = dx * Math.cos(radians) - dy * Math.sin(radians)
      const ty = dx * Math.sin(radians) + dy * Math.cos(radians)
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); minY = Math.min(minY, ty); maxY = Math.max(maxY, ty)
    }
    sides.push({ minX, maxX, minY, maxY })
  }
  const minimumOriginX = Math.ceil(Math.max(SAFE.minX - sides[0]!.minX, SIZE + sides[1]!.maxX - SAFE.maxX, 353))
  const maximumOriginX = Math.floor(Math.min(SAFE.maxX - sides[0]!.maxX, SIZE + sides[1]!.minX - SAFE.minX, 1023))
  const ySafe = 870 + Math.min(sides[0]!.minY, sides[1]!.minY) >= SAFE.minY
    && 870 + Math.max(sides[0]!.maxY, sides[1]!.maxY) <= SAFE.maxY
  return { sides, minimumOriginX, maximumOriginX, ySafe }
}

export async function verifyJointSafeBoundaries() {
  const existing = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8'))
  const catalogBytes = await readFile(resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json'))
  const sourceCatalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog
  const tempRoot = await mkdtemp(resolve(ROOT, '.tmp-blob-boundary-search-'))
  const arms = await prepareArms(tempRoot, sourceCatalog)
  const passingRound = existing.exactRound.filter((item: any) => item.pass)
  const transforms = await Promise.all(passingRound.map(async (item: any) => {
    const arm = arms.find(value => value.id === item.armId)!
    const transform = { scale: item.scale, rotationDegrees: item.rotationDegrees }
    return { arm, transform, bounds: await exactRelativeBounds(arm, transform) }
  }))
  const paddles = transforms.filter(item => item.arm.id === 'arms_paddle:c4' && item.bounds.ySafe)
  const shorts = transforms.filter(item => item.arm.id.startsWith('arms_short_plush:') && item.bounds.ySafe)
  const pairs = paddles.flatMap(paddle => shorts.map(short => ({
    originX: Math.max(paddle.bounds.minimumOriginX, short.bounds.minimumOriginX), paddle, short,
  }))).filter(pair => pair.originX <= Math.min(pair.paddle.bounds.maximumOriginX, pair.short.bounds.maximumOriginX))
  const tasks = new Map<string, { originX: number, item: typeof transforms[number] }>()
  for (const pair of pairs) for (const item of [pair.paddle, pair.short]) {
    tasks.set(`${item.arm.id}:${item.transform.scale}:${item.transform.rotationDegrees}:${pair.originX}`, { originX: pair.originX, item })
  }
  const server = await createServer({ root: resolve('apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen(); const baseUrl = server.resolvedUrls?.local[0]
  if (baseUrl === undefined) throw new Error('JOINT_SHOULDER_SEARCH_RENDER_FAILED: Vite has no local URL')
  const browser = await chromium.launch({ headless: true }); const pages = await Promise.all(Array.from({ length: 4 }, () => browser.newPage()))
  const maskCache = new Map<number, Awaited<ReturnType<typeof receiverMasks>>>()
  const hashCache = new Map<string, string>()
  const taskList = [...tasks.values()]
  try {
    for (const originX of new Set(taskList.map(item => item.originX))) maskCache.set(originX, await receiverMasks(tempRoot, originX, 870))
    const records = await mapPool(taskList, pages.length, (task, index, worker) => renderExact({
      page: pages[worker]!, baseUrl, tempRoot, sourceCatalog, arm: task.item.arm, transform: task.item.transform,
      bodyId: 'body_blob_wide', originX: task.originX, index, maskCache, hashCache,
    }))
    const byKey = new Map(records.map(record => [`${record.armId}:${record.scale}:${record.rotationDegrees}:${record.originX}`, record]))
    const joint = pairs.map(pair => ({
      originX: pair.originX,
      paddle: byKey.get(`${pair.paddle.arm.id}:${pair.paddle.transform.scale}:${pair.paddle.transform.rotationDegrees}:${pair.originX}`),
      short: byKey.get(`${pair.short.arm.id}:${pair.short.transform.scale}:${pair.short.transform.rotationDegrees}:${pair.originX}`),
    })).filter(pair => pair.paddle?.pass && pair.short?.pass)
    const boundary = {
      schemaVersion: 'task8-joint-safe-boundary-verification-v1',
      rationale: 'Tests every round-passing paddle/short transform pair at its common outermost integer-safe body-supported shoulder origin, filling the gaps between the fixed 8px origin grid.',
      transforms: transforms.map(item => ({ armId: item.arm.id, ...item.transform, exactBounds: item.bounds })),
      pairCount: pairs.length, renderCount: records.length, records, jointPasses: joint,
    }
    existing.safeBoundaryVerification = boundary
    existing.status = joint.length === 0 ? 'NO_COMMON_SOLUTION' : 'COMMON_SOLUTION_FOUND_AT_SAFE_BOUNDARY'
    existing.selected = joint[0] ?? null
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(existing, null, 2)}\n`)
    return { evidencePath: EVIDENCE_PATH, status: existing.status, pairCount: pairs.length, renderCount: records.length, selected: existing.selected }
  } finally {
    await Promise.all(pages.map(page => page.close())); await browser.close(); await server.close(); await rm(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv.includes('--boundary') ? await verifyJointSafeBoundaries() : await compareBlobShortCandidates()))
}
