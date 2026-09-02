import { chromium, type Browser } from '@playwright/test'
import { generateMonster, parseCatalog, type Catalog } from '@qmonster/generator-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = process.cwd()
const PACKAGE_ROOT = resolve(ROOT, 'packages/asset-catalog')
const RUNTIME_ROOT = resolve(PACKAGE_ROOT, 'assets/v0.4.0')
const CATALOG_PATH = resolve(PACKAGE_ROOT, 'catalog/v0.4.0/catalog.json')
const FACE_THRESHOLD = 0.84
const SEED = 'qmonster-v04-user-review-007'

function fsUrl(path: string): string {
  return `/@fs/${resolve(path).replaceAll('\\', '/')}`
}

function productionAssetUrl(path: string): string {
  const absolute = path.startsWith('assets/v0.4.0/')
    ? resolve(PACKAGE_ROOT, path)
    : resolve(RUNTIME_ROOT, path)
  return fsUrl(absolute)
}

function browserCatalog(input: Catalog): Catalog {
  const catalog = structuredClone(input)
  for (const part of catalog.parts) {
    part.assetPath = productionAssetUrl(part.assetPath)
    part.maskPaths = Object.fromEntries(Object.entries(part.maskPaths).map(([role, path]) => [
      role,
      productionAssetUrl(path),
    ]))
    if (part.rigMaskPaths !== undefined) {
      part.rigMaskPaths = Object.fromEntries(Object.entries(part.rigMaskPaths).map(([rigId, paths]) => [
        rigId,
        Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, productionAssetUrl(path)])),
      ]))
    }
    if (part.composition?.mode === 'interface') {
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const node of variant.renderNodes) node.assetPath = productionAssetUrl(node.assetPath)
        for (const connector of variant.connectors) {
          connector.contourMaskPath = productionAssetUrl(connector.contourMaskPath)
          connector.foregroundMaskPath = productionAssetUrl(connector.foregroundMaskPath)
          connector.backgroundMaskPath = productionAssetUrl(connector.backgroundMaskPath)
        }
      }
    } else if (part.composition !== undefined) {
      for (const node of part.composition.renderNodes) node.assetPath = productionAssetUrl(node.assetPath)
    }
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    bridge.neutralAssetPath = productionAssetUrl(bridge.neutralAssetPath)
    bridge.neutralPngPath = productionAssetUrl(bridge.neutralPngPath)
    bridge.frontMaskPath = productionAssetUrl(bridge.frontMaskPath)
    bridge.backMaskPath = productionAssetUrl(bridge.backMaskPath)
  }
  return catalog
}

describe('v0.4 exact face-zone regression', () => {
  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  let baseUrl = ''
  let inputRoot = ''

  beforeAll(async () => {
    inputRoot = await mkdtemp(resolve(ROOT, '.tmp-v04-face-zone-'))
    server = await createServer({
      root: resolve(ROOT, 'apps/creator-web'),
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    })
    await server.listen()
    baseUrl = server.resolvedUrls?.local[0] ?? ''
    if (baseUrl === '') throw new Error('V04_FACE_ZONE_BROWSER_FAILED: Vite server has no local URL')
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await Promise.all([
      browser?.close(),
      server?.close(),
      inputRoot === '' ? undefined : rm(inputRoot, { recursive: true, force: true }),
    ])
  })

  it('keeps every face metric at the existing 0.84 threshold for the exact deep-sea aberration scenario', async () => {
    if (browser === undefined) throw new Error('V04_FACE_ZONE_BROWSER_FAILED: browser was not started')
    const parsed = parseCatalog(JSON.parse(await readFile(CATALOG_PATH, 'utf8')))
    if (!parsed.ok) throw new Error(`Invalid v0.4 production catalog: ${JSON.stringify(parsed.diagnostics)}`)
    const catalog = parsed.value
    expect(catalog.compositionPolicy).toMatchObject({
      faceInsideRatio: FACE_THRESHOLD,
      faceVisibleRatio: FACE_THRESHOLD,
    })

    const generated = generateMonster({ seed: SEED, themeId: 'deep-sea', mode: 'aberration' }, catalog)
    expect(generated.diagnostics).toEqual([])
    expect(generated.spec).toMatchObject({
      catalogVersion: '0.4.0',
      rendererVersion: '0.4.0',
      seed: SEED,
      visualSlots: {
        bodyFrame: { partId: 'body_floating_drop', rigId: 'floating' },
        headShape: { partId: 'head_shadow_hood', rigId: 'floating' },
        eyes: { partId: 'eyes_asymmetric', rigId: 'floating' },
        mouthShape: { partId: 'mouth_wide_grin', rigId: 'floating' },
        oralDetail: { partId: 'oral_lolling_tongue', rigId: 'floating' },
      },
      aberrations: [{
        id: 'aberration_color_discord',
        overrides: { palette: { primary: '#ff5d8f', secondary: '#4cc9f0', accent: '#ffd166' } },
      }],
    })

    const inputPath = join(inputRoot, 'qmonster-v04-user-review-007.json')
    await writeFile(inputPath, `${JSON.stringify({
      catalog: browserCatalog(catalog),
      spec: generated.spec,
      applyPaletteMasks: false,
    })}\n`)
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } })
    try {
      await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
      await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
      expect(await page.evaluate(() => document.body.dataset.renderError)).toBeUndefined()
      const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as {
        diagnostics: Array<{ code: string; path: string[] }>
        compositionMetrics: {
          eyesInsideRatio: number
          eyesVisibleRatio: number
          mouthInsideRatio: number
          mouthVisibleRatio: number
          oralDetailInsideRatio: number | null
          oralDetailVisibleRatio: number | null
        } | null
      }
      expect(evidence.diagnostics).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'COMPOSITION_FACE_OUT_OF_ZONE' }),
        expect.objectContaining({ code: 'COMPOSITION_FACE_OCCLUDED' }),
      ]))
      expect(evidence.compositionMetrics).not.toBeNull()
      const metrics = evidence.compositionMetrics!
      expect(metrics.eyesInsideRatio).toBeGreaterThanOrEqual(FACE_THRESHOLD)
      expect(metrics.eyesVisibleRatio).toBeGreaterThanOrEqual(FACE_THRESHOLD)
      expect(metrics.mouthInsideRatio).toBeGreaterThanOrEqual(FACE_THRESHOLD)
      expect(metrics.mouthVisibleRatio).toBeGreaterThanOrEqual(FACE_THRESHOLD)
      expect(metrics.oralDetailInsideRatio).not.toBeNull()
      expect(metrics.oralDetailVisibleRatio).not.toBeNull()
      expect(metrics.oralDetailInsideRatio!).toBeGreaterThanOrEqual(FACE_THRESHOLD)
      expect(metrics.oralDetailVisibleRatio!).toBeGreaterThanOrEqual(FACE_THRESHOLD)
    } finally {
      await page.close()
    }
  }, 120_000)
})
