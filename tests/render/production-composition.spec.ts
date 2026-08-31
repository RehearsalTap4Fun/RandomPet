import { chromium, type Browser } from '@playwright/test'
import { parseCatalog, type Catalog, type MonsterSpec } from '@qmonster/generator-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { buildProductionReviewBundle } from '../../apps/creator-web/src/production-render-review.js'
import { resolveExistingContainedPath } from '../../scripts/safe-output.js'
import {
  TASK9_EXTRA_IDS,
  TASK9_RIG_IDS,
  TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE,
  TASK9_TAIL_IDS,
} from '../../scripts/task9-structural-identities.js'

const ROOT = process.cwd()
const CATALOG_PATH = resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json')
const RUNTIME_ROOT = resolve(ROOT, 'packages/asset-catalog/assets/v0.3.0')
const PACKAGE_ROOT = resolve(ROOT, 'packages/asset-catalog')
const CASES = TASK9_RIG_IDS.flatMap(rigId => [
  ...TASK9_TAIL_IDS.map(identityId => ({ rigId, identityId, tailId: identityId, extraId: 'extra_appendage_none' as const })),
  ...TASK9_EXTRA_IDS.map(identityId => ({ rigId, identityId, tailId: 'tail_none' as const, extraId: identityId })),
])

export async function cleanupBrowserProductionHarness(input: {
  inputRoot?: string
  browser?: { close(): Promise<unknown> }
  server?: { close(): Promise<unknown> }
}): Promise<void> {
  const operations: Array<Promise<unknown>> = []
  if (input.browser !== undefined) operations.push(input.browser.close())
  if (input.server !== undefined) operations.push(input.server.close())
  if (input.inputRoot !== undefined && input.inputRoot !== '') operations.push(rm(input.inputRoot, { recursive: true, force: true }))
  const results = await Promise.allSettled(operations)
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Browser production harness cleanup failed')
}

it('rejects a browser /@fs production asset reached through an escaping junction', async ({ skip }) => {
  const root = await mkdtemp(join(tmpdir(), 'qmonster-browser-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'qmonster-browser-outside-'))
  await mkdir(join(root, 'assets', 'v0.3.0'), { recursive: true })
  await writeFile(join(outside, 'mask.png'), 'outside')
  try {
    try {
      await symlink(outside, join(root, 'assets', 'v0.3.0', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('directory links unavailable')
      throw error
    }
    await expect(resolveBrowserProductionAssetPath(root, root, root, 'assets/v0.3.0/linked/mask.png'))
      .rejects.toThrow(/escapes output root/i)
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
  }
})

it('cleans every browser harness resource even when one close operation fails', async () => {
  const inputRoot = await mkdtemp(join(tmpdir(), 'qmonster-browser-cleanup-'))
  const closed: string[] = []
  await expect(cleanupBrowserProductionHarness({
    inputRoot,
    browser: { async close() { closed.push('browser'); throw new Error('browser close failed') } },
    server: { async close() { closed.push('server') } },
  })).rejects.toThrow('browser close failed')
  expect(closed).toEqual(['browser', 'server'])
  await expect(readFile(inputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
})

function fsUrl(path: string): string {
  return `/@fs/${resolve(path).replaceAll('\\', '/')}`
}

export async function resolveBrowserProductionAssetPath(
  repositoryRoot: string,
  packageRoot: string,
  runtimeRoot: string,
  path: string,
): Promise<string> {
  if (path === '') return path
  const lexical = path.startsWith('assets/v0.3.0/')
    ? resolve(packageRoot, path)
    : resolve(runtimeRoot, path)
  return fsUrl(await resolveExistingContainedPath(repositoryRoot, lexical))
}

async function browserProductionCatalog(input: Catalog): Promise<Catalog> {
  const catalog = structuredClone(input)
  const browserAssetPath = (path: string) => resolveBrowserProductionAssetPath(ROOT, PACKAGE_ROOT, RUNTIME_ROOT, path)
  for (const part of catalog.parts) {
    part.assetPath = await browserAssetPath(part.assetPath)
    part.maskPaths = Object.fromEntries(await Promise.all(Object.entries(part.maskPaths).map(async ([role, path]) => [role, await browserAssetPath(path)])))
    if (part.rigMaskPaths !== undefined) {
      part.rigMaskPaths = Object.fromEntries(await Promise.all(Object.entries(part.rigMaskPaths).map(async ([rigId, paths]) => [
        rigId,
        Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([role, path]) => [role, await browserAssetPath(path)]))),
      ])))
    }
    if (part.composition?.mode === 'interface') {
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const node of variant.renderNodes) node.assetPath = await browserAssetPath(node.assetPath)
        for (const connector of variant.connectors) {
          connector.contourMaskPath = await browserAssetPath(connector.contourMaskPath)
          connector.foregroundMaskPath = await browserAssetPath(connector.foregroundMaskPath)
          connector.backgroundMaskPath = await browserAssetPath(connector.backgroundMaskPath)
        }
      }
    } else if (part.composition !== undefined) {
      for (const node of part.composition.renderNodes) node.assetPath = await browserAssetPath(node.assetPath)
    }
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    bridge.neutralAssetPath = await browserAssetPath(bridge.neutralAssetPath)
    bridge.neutralPngPath = await browserAssetPath(bridge.neutralPngPath)
    bridge.frontMaskPath = await browserAssetPath(bridge.frontMaskPath)
    bridge.backMaskPath = await browserAssetPath(bridge.backMaskPath)
  }
  return catalog
}

function makeProductionSpec(catalog: Catalog, rigId: 'blob' | 'biped' | 'floating', tailId: string, extraId: string): MonsterSpec {
  const rig = catalog.rigs.find(candidate => candidate.id === rigId)
  const body = catalog.parts.find(part => part.slotId === 'bodyFrame' && part.compatibleRigs.includes(rigId))
  if (rig === undefined || body === undefined) throw new Error(`Missing production body/rig for ${rigId}`)
  const spec = buildProductionReviewBundle(catalog, rig, body).spec
  spec.seed = `production-v03-${rigId}-${tailId}-${extraId}`
  spec.visualSlots.tail = { partId: tailId, rigId }
  spec.visualSlots.extraAppendage = { partId: extraId, rigId }
  return spec
}

describe('v0.3 browser production composition', () => {
  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  let baseUrl = ''
  let inputRoot = ''
  let sourceCatalog: Catalog
  let browserCatalog: Catalog

  beforeAll(async () => {
    try {
      const parsed = parseCatalog(JSON.parse(await readFile(
        await resolveExistingContainedPath(ROOT, CATALOG_PATH), 'utf8',
      )))
      if (!parsed.ok) throw new Error(`Invalid v0.3 production catalog: ${JSON.stringify(parsed.diagnostics)}`)
      sourceCatalog = parsed.value
      browserCatalog = await browserProductionCatalog(sourceCatalog)
      inputRoot = await mkdtemp(resolve(ROOT, '.tmp-v03-production-composition-'))
      server = await createServer({ root: resolve(ROOT, 'apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
      await server.listen()
      baseUrl = server.resolvedUrls?.local[0] ?? ''
      if (baseUrl === '') throw new Error('V03_BROWSER_PRODUCTION_FAILED: Vite server has no local URL')
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      try {
        await cleanupBrowserProductionHarness({ inputRoot, browser, server })
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Browser production harness startup and cleanup failed')
      }
      throw error
    }
  }, 120_000)

  afterAll(async () => {
    await cleanupBrowserProductionHarness({ inputRoot, browser, server })
  })

  it('renders exact-rig tail and extra identities from the real v0.3 catalog and runtime bytes', async () => {
    if (browser === undefined) throw new Error('V03_BROWSER_PRODUCTION_FAILED: browser was not started')
    expect(CASES).toHaveLength(18)
    const exactVariants = new Set<string>()
    const noneRgbaByRig = new Map<string, Buffer>()
    const captureNoneBaseline = async (rigId: 'blob' | 'biped' | 'floating'): Promise<Buffer> => {
      const cached = noneRgbaByRig.get(rigId)
      if (cached !== undefined) return cached
      const spec = makeProductionSpec(sourceCatalog, rigId, 'tail_none', 'extra_appendage_none')
      const inputPath = join(inputRoot, `none-${rigId}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog: browserCatalog, spec, diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE })}\n`)
      const page = await browser!.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), `${rigId}:none`).toBeUndefined()
        const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as { diagnostics: unknown[] }
        expect(evidence.diagnostics, `${rigId}:none`).toEqual([])
        const dataUrl = await page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
        const rgba = (await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
        noneRgbaByRig.set(rigId, rgba)
        return rgba
      } finally {
        await page.close()
      }
    }
    for (const [index, productionCase] of CASES.entries()) {
      exactVariants.add(`${productionCase.rigId}:${productionCase.identityId}`)
      const spec = makeProductionSpec(sourceCatalog, productionCase.rigId, productionCase.tailId, productionCase.extraId)
      expect(spec.catalogVersion).toBe('0.3.0')
      expect(spec.rendererVersion).toBe('0.3.0')
      const inputPath = join(inputRoot, `${index}-${productionCase.rigId}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog: browserCatalog, spec, diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE })}\n`)

      const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), productionCase.rigId).toBeUndefined()
        const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as {
          diagnostics: Array<{ severity: string; code: string; path?: string[] }>
          diagnosticScope?: {
            id: string
            activeVisualSlots: string[]
            activeConnectorIds: string[]
            suppressedDiagnostics: Array<{ severity: string; code: string; path?: string[] }>
          }
          connectorMetrics: Array<{ connectorId: string; receiverCoverage: number; plugCoverage: number; centerlineGapPixels: number }>
          compositionMetrics: { visibleBounds: { x: number; y: number; width: number; height: number } | null }
          resolvedAssetPaths: string[]
        }
        expect(
          evidence.diagnostics,
          `${productionCase.rigId}:${productionCase.identityId}:${JSON.stringify(evidence.connectorMetrics)}`,
        ).toEqual([])
        expect(evidence.diagnosticScope).toMatchObject(TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE)
        expect(evidence.diagnosticScope?.suppressedDiagnostics.every(item => (
          ['COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED'].includes(item.code)
          || (item.code === 'CONNECTOR_COMPOSITE_FAILED' && item.path?.join('/') === 'connectors/neck')
        ))).toBe(true)
        const selectedParts = [productionCase.tailId, productionCase.extraId]
          .filter(partId => !partId.endsWith('_none'))
          .map(partId => browserCatalog.parts.find(part => part.id === partId)!)
        const expectedNodePaths = selectedParts.flatMap(part => {
          if (part.composition?.mode !== 'interface') throw new Error(`Expected interface production part ${part.id}`)
          return part.composition.variantsByRig[productionCase.rigId]!.renderNodes.map(node => node.assetPath)
        })
        expect(evidence.resolvedAssetPaths, productionCase.rigId).toEqual(expect.arrayContaining(expectedNodePaths))
        const expectedConnectors = productionCase.tailId === 'tail_none'
          ? ['extraLeft', 'extraRight']
          : ['tailRoot']
        for (const connectorId of expectedConnectors) {
          const metric = evidence.connectorMetrics.find(item => item.connectorId === connectorId)
          expect(metric, `${productionCase.rigId}:${connectorId}`).toBeDefined()
          expect(metric!.receiverCoverage, `${productionCase.rigId}:${connectorId}:receiver`).toBeGreaterThanOrEqual(0.9)
          expect(metric!.plugCoverage, `${productionCase.rigId}:${connectorId}:plug`).toBeGreaterThanOrEqual(0.9)
          expect(metric!.centerlineGapPixels, `${productionCase.rigId}:${connectorId}:gap`).toBeLessThanOrEqual(2)
        }
        expect(evidence.compositionMetrics.visibleBounds, productionCase.rigId).not.toBeNull()
        const alphaPixels = await page.locator('#render-target').evaluate(canvas => {
          const target = canvas as HTMLCanvasElement
          const rgba = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data
          let count = 0
          for (let offset = 3; offset < rgba.length; offset += 4) if (rgba[offset]! > 0) count += 1
          return count
        })
        expect(alphaPixels, productionCase.rigId).toBeGreaterThan(100_000)
        const dataUrl = await page.locator('#render-target').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
        const actual = (await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
        const none = await captureNoneBaseline(productionCase.rigId)
        expect(createHash('sha256').update(actual).digest('hex'), `${productionCase.rigId}:${productionCase.identityId}:rgba`)
          .not.toBe(createHash('sha256').update(none).digest('hex'))
        let visibleRgbaDiffPixels = 0
        for (let offset = 0; offset < actual.length; offset += 4) {
          if (
            (actual[offset + 3]! > 0 || none[offset + 3]! > 0)
            && (
              actual[offset] !== none[offset]
              || actual[offset + 1] !== none[offset + 1]
              || actual[offset + 2] !== none[offset + 2]
              || actual[offset + 3] !== none[offset + 3]
            )
          ) visibleRgbaDiffPixels += 1
        }
        expect(visibleRgbaDiffPixels, `${productionCase.rigId}:${productionCase.identityId}:visible-pixel-diff`)
          .toBeGreaterThan(1_000)
      } finally {
        await page.close()
      }
    }
    expect(exactVariants).toEqual(new Set(TASK9_RIG_IDS.flatMap(rigId => [
      ...TASK9_TAIL_IDS.map(identityId => `${rigId}:${identityId}`),
      ...TASK9_EXTRA_IDS.map(identityId => `${rigId}:${identityId}`),
    ])))
  }, 300_000)

  it('proves a real biped hip bridge changes final RGBA from distinct production endpoint samples', async () => {
    if (browser === undefined) throw new Error('V03_BROWSER_PRODUCTION_FAILED: browser was not started')
    const rigId = 'biped' as const
    const body = sourceCatalog.parts.find(part => part.id === 'body_biped_peanut')!
    const legs = sourceCatalog.parts.find(part => part.id === 'legs_webbed')!
    if (body.composition?.mode !== 'interface' || legs.composition?.mode !== 'interface') {
      throw new Error('Expected production interface body and legs.')
    }
    const bodyVariant = body.composition.variantsByRig[rigId]!
    const legsVariant = legs.composition.variantsByRig[rigId]!
    const receiver = bodyVariant.connectors.find(item => item.id === 'hipLeft')!
    const plug = legsVariant.connectors.find(item => item.id === 'hipLeft')!
    const averageRegion = async (path: string, region: { x: number; y: number; width: number; height: number }) => {
      const { data, info } = await sharp(resolve(PACKAGE_ROOT, path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const sum = [0, 0, 0]
      let count = 0
      for (let y = region.y; y < region.y + region.height; y += 1) {
        for (let x = region.x; x < region.x + region.width; x += 1) {
          const offset = (y * info.width + x) * 4
          sum[0] += data[offset]!
          sum[1] += data[offset + 1]!
          sum[2] += data[offset + 2]!
          count += 1
        }
      }
      return sum.map(value => value / count)
    }
    const receiverColor = await averageRegion(bodyVariant.renderNodes[0]!.assetPath, receiver.materialSampleRegion)
    const plugColor = await averageRegion(legsVariant.renderNodes[0]!.assetPath, plug.materialSampleRegion)
    expect(Math.hypot(...receiverColor.map((value, index) => value - plugColor[index]!))).toBeGreaterThan(30)

    const withoutBridge = structuredClone(browserCatalog)
    const bridge = withoutBridge.transitionBridges!.find(item => item.rigId === rigId && item.connectorClass === 'hip')!
    const transparentMaskPath = join(inputRoot, 'transparent-production-hip-bridge.png')
    await sharp({ create: { width: 512, height: 256, channels: 4, background: '#00000000' } }).png().toFile(transparentMaskPath)
    bridge.frontMaskPath = fsUrl(transparentMaskPath)
    bridge.backMaskPath = fsUrl(transparentMaskPath)
    const spec = makeProductionSpec(sourceCatalog, rigId, 'tail_none', 'extra_appendage_none')
    const render = async (label: string, catalog: Catalog) => {
      const inputPath = join(inputRoot, `bridge-causal-${label}.json`)
      await writeFile(inputPath, `${JSON.stringify({
        catalog, spec, applyPaletteMasks: false, diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE,
      })}\n`)
      const page = await browser!.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), label).toBeUndefined()
        const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as {
          diagnostics: unknown[]
          resolvedAssetPaths: string[]
        }
        expect(evidence.diagnostics, label).toEqual([])
        const dataUrl = await page.locator('#render-target').evaluate(canvas => (
          (canvas as HTMLCanvasElement).toDataURL('image/png')
        ))
        const rgba = (await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
        return { evidence, rgba }
      } finally {
        await page.close()
      }
    }
    const baseline = await render('baseline', browserCatalog)
    const transparent = await render('transparent', withoutBridge)
    expect(baseline.evidence.resolvedAssetPaths).toContain(
      browserCatalog.transitionBridges!.find(item => item.rigId === rigId && item.connectorClass === 'hip')!.frontMaskPath,
    )
    const productionBridge = browserCatalog.transitionBridges!
      .find(item => item.rigId === rigId && item.connectorClass === 'hip')!
    expect(baseline.evidence.resolvedAssetPaths).toEqual(expect.arrayContaining([
      productionBridge.neutralAssetPath,
      productionBridge.frontMaskPath,
      productionBridge.backMaskPath,
    ]))
    expect(transparent.evidence.resolvedAssetPaths).toContain(fsUrl(transparentMaskPath))

    let changedVisiblePixels = 0
    let receiverSidePixels = 0
    const distance = (rgba: ArrayLike<number>, color: number[]) => Math.hypot(
      rgba[0]! - color[0]!, rgba[1]! - color[1]!, rgba[2]! - color[2]!,
    )
    for (let offset = 0; offset < baseline.rgba.length; offset += 4) {
      if (
        baseline.rgba[offset] === transparent.rgba[offset]
        && baseline.rgba[offset + 1] === transparent.rgba[offset + 1]
        && baseline.rgba[offset + 2] === transparent.rgba[offset + 2]
        && baseline.rgba[offset + 3] === transparent.rgba[offset + 3]
      ) continue
      if (baseline.rgba[offset + 3]! === 0 && transparent.rgba[offset + 3]! === 0) continue
      changedVisiblePixels += 1
      const pixel = baseline.rgba.slice(offset, offset + 3)
      const receiverDistance = distance(pixel, receiverColor)
      const plugDistance = distance(pixel, plugColor)
      if (receiverDistance + 3 < plugDistance) receiverSidePixels += 1
    }
    // Endpoint pixels are partitioned by connector roles rather than by the
    // independently authored transition split. Keep a material causal gate
    // without requiring the invalid cross-product's larger painted area.
    expect(changedVisiblePixels).toBeGreaterThan(40)
    expect(receiverSidePixels).toBeGreaterThan(20)
  }, 120_000)

  it('colors all exact rigs from scheme masks while preserving alpha and transparent boundaries', async () => {
    if (browser === undefined) throw new Error('V03_BROWSER_PRODUCTION_FAILED: browser was not started')
    const schemes = [
      ['color_deep_sea_coral', 'deep-sea'],
      ['color_fungal_amber', 'fungal'],
      ['color_shadow_violet', 'shadow'],
    ] as const
    const albino = sourceCatalog.modifiers.find(modifier => modifier.id === 'mutation_albino')!
    const signatures = new Map<string, { alphaHash: number; rgbHash: number; alphaPixels: number; transparentRgbPixels: number }>()

    for (const [rigId, [schemeId, themeId]] of TASK9_RIG_IDS.flatMap(rig => schemes.map(scheme => [rig, scheme] as const))) {
      const spec = makeProductionSpec(sourceCatalog, rigId, 'tail_soft_curl', 'extra_side_fins')
      const theme = sourceCatalog.themes.find(candidate => candidate.id === themeId)!
      const scheme = browserCatalog.parts.find(part => part.id === schemeId)!
      spec.themeId = themeId
      spec.palette = structuredClone(theme.palette)
      spec.visualSlots.colorScheme = { partId: schemeId, rigId }
      const inputPath = join(inputRoot, `color-${rigId}-${schemeId}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog: browserCatalog, spec, diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE })}\n`)
      const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), `${rigId}:${schemeId}`).toBeUndefined()
        const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as {
          diagnostics: unknown[]; resolvedAssetPaths: string[]
        }
        expect(
          evidence.diagnostics,
          `${rigId}:${schemeId}:${JSON.stringify(evidence.connectorMetrics)}`,
        ).toEqual([])
        const maskPaths = Object.values(scheme.rigMaskPaths?.[rigId] ?? {})
        expect(maskPaths).toHaveLength(3)
        expect(evidence.resolvedAssetPaths, `${rigId}:${schemeId}`).toEqual(expect.arrayContaining(maskPaths))
        expect(evidence.resolvedAssetPaths, `${rigId}:${schemeId}`).not.toContain(scheme.assetPath)
        signatures.set(`${rigId}:${schemeId}`, await page.locator('#render-target').evaluate(canvas => {
          const target = canvas as HTMLCanvasElement
          const rgba = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data
          let alphaHash = 2_166_136_261
          let rgbHash = 2_166_136_261
          let alphaPixels = 0
          let transparentRgbPixels = 0
          for (let offset = 0; offset < rgba.length; offset += 4) {
            const alpha = rgba[offset + 3]!
            alphaHash = Math.imul(alphaHash ^ alpha, 16_777_619) >>> 0
            if (alpha > 0) {
              alphaPixels += 1
              rgbHash = Math.imul(rgbHash ^ rgba[offset]!, 16_777_619) >>> 0
              rgbHash = Math.imul(rgbHash ^ rgba[offset + 1]!, 16_777_619) >>> 0
              rgbHash = Math.imul(rgbHash ^ rgba[offset + 2]!, 16_777_619) >>> 0
            } else if (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0) transparentRgbPixels += 1
          }
          return { alphaHash, rgbHash, alphaPixels, transparentRgbPixels }
        }))
      } finally {
        await page.close()
      }
    }

    for (const rigId of TASK9_RIG_IDS) {
      const values = schemes.map(([schemeId]) => signatures.get(`${rigId}:${schemeId}`)!)
      expect(new Set(values.map(value => value.alphaHash)), `${rigId}:alpha`).toEqual(new Set([values[0]!.alphaHash]))
      expect(new Set(values.map(value => value.rgbHash)).size, `${rigId}:scheme rgb`).toBe(3)
      expect(values.every(value => value.alphaPixels > 100_000 && value.transparentRgbPixels === 0)).toBe(true)

      const baseSpec = makeProductionSpec(sourceCatalog, rigId, 'tail_soft_curl', 'extra_side_fins')
      baseSpec.themeId = 'deep-sea'
      baseSpec.palette = structuredClone(sourceCatalog.themes.find(theme => theme.id === 'deep-sea')!.palette)
      baseSpec.visualSlots.colorScheme = { partId: 'color_deep_sea_coral', rigId }
      baseSpec.mutation = { id: albino.id, overrides: structuredClone(albino.overrides) }
      const inputPath = join(inputRoot, `color-${rigId}-mutation.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog: browserCatalog, spec: baseSpec, diagnosticScope: TASK9_TAIL_EXTRA_DIAGNOSTIC_SCOPE })}\n`)
      const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), `${rigId}:mutation`).toBeUndefined()
        const mutation = await page.locator('#render-target').evaluate(canvas => {
          const target = canvas as HTMLCanvasElement
          const rgba = target.getContext('2d')!.getImageData(0, 0, target.width, target.height).data
          let alphaHash = 2_166_136_261; let rgbHash = 2_166_136_261
          for (let offset = 0; offset < rgba.length; offset += 4) {
            alphaHash = Math.imul(alphaHash ^ rgba[offset + 3]!, 16_777_619) >>> 0
            if (rgba[offset + 3]! > 0) {
              rgbHash = Math.imul(rgbHash ^ rgba[offset]!, 16_777_619) >>> 0
              rgbHash = Math.imul(rgbHash ^ rgba[offset + 1]!, 16_777_619) >>> 0
              rgbHash = Math.imul(rgbHash ^ rgba[offset + 2]!, 16_777_619) >>> 0
            }
          }
          return { alphaHash, rgbHash }
        })
        const baseline = signatures.get(`${rigId}:color_deep_sea_coral`)!
        expect(mutation.alphaHash, `${rigId}:mutation alpha`).toBe(baseline.alphaHash)
        expect(mutation.rgbHash, `${rigId}:mutation rgb`).not.toBe(baseline.rgbHash)
      } finally {
        await page.close()
      }
    }
  }, 300_000)
})
