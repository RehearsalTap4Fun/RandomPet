import { chromium, type Browser } from '@playwright/test'
import { parseCatalog, type Catalog, type MonsterSpec } from '@qmonster/generator-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { buildProductionReviewBundle } from '../../apps/creator-web/src/production-render-review.js'

const ROOT = process.cwd()
const CATALOG_PATH = resolve(ROOT, 'packages/asset-catalog/catalog/v0.3.0/catalog.json')
const RUNTIME_ROOT = resolve(ROOT, 'packages/asset-catalog/assets/v0.3.0')
const PACKAGE_ROOT = resolve(ROOT, 'packages/asset-catalog')
const CASES = [
  { rigId: 'blob', tailId: 'tail_fish_fan', extraId: 'extra_soft_tentacles' },
  { rigId: 'biped', tailId: 'tail_soft_curl', extraId: 'extra_moth_wings' },
  { rigId: 'floating', tailId: 'tail_mushroom_cluster', extraId: 'extra_side_fins' },
] as const

function fsUrl(path: string): string {
  return `/@fs/${resolve(path).replaceAll('\\', '/')}`
}

function runtimeFsPath(path: string): string {
  return path.startsWith('assets/v0.3.0/')
    ? resolve(PACKAGE_ROOT, path)
    : resolve(RUNTIME_ROOT, path)
}

function browserAssetPath(path: string): string {
  return path === '' ? path : fsUrl(runtimeFsPath(path))
}

function browserProductionCatalog(input: Catalog): Catalog {
  const catalog = structuredClone(input)
  for (const part of catalog.parts) {
    part.assetPath = browserAssetPath(part.assetPath)
    part.maskPaths = Object.fromEntries(Object.entries(part.maskPaths).map(([role, path]) => [role, browserAssetPath(path)]))
    if (part.rigMaskPaths !== undefined) {
      part.rigMaskPaths = Object.fromEntries(Object.entries(part.rigMaskPaths).map(([rigId, paths]) => [
        rigId,
        Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, browserAssetPath(path)])),
      ]))
    }
    if (part.composition?.mode === 'interface') {
      for (const variant of Object.values(part.composition.variantsByRig)) {
        if (variant === undefined) continue
        for (const node of variant.renderNodes) node.assetPath = browserAssetPath(node.assetPath)
        for (const connector of variant.connectors) {
          connector.contourMaskPath = browserAssetPath(connector.contourMaskPath)
          connector.foregroundMaskPath = browserAssetPath(connector.foregroundMaskPath)
          connector.backgroundMaskPath = browserAssetPath(connector.backgroundMaskPath)
        }
      }
    } else if (part.composition !== undefined) {
      for (const node of part.composition.renderNodes) node.assetPath = browserAssetPath(node.assetPath)
    }
  }
  for (const bridge of catalog.transitionBridges ?? []) {
    bridge.neutralAssetPath = browserAssetPath(bridge.neutralAssetPath)
    bridge.neutralPngPath = browserAssetPath(bridge.neutralPngPath)
    bridge.frontMaskPath = browserAssetPath(bridge.frontMaskPath)
    bridge.backMaskPath = browserAssetPath(bridge.backMaskPath)
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
    const parsed = parseCatalog(JSON.parse(await readFile(CATALOG_PATH, 'utf8')))
    if (!parsed.ok) throw new Error(`Invalid v0.3 production catalog: ${JSON.stringify(parsed.diagnostics)}`)
    sourceCatalog = parsed.value
    browserCatalog = browserProductionCatalog(sourceCatalog)
    inputRoot = await mkdtemp(resolve(ROOT, '.tmp-v03-production-composition-'))
    server = await createServer({ root: resolve(ROOT, 'apps/creator-web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await server.listen()
    baseUrl = server.resolvedUrls?.local[0] ?? ''
    if (baseUrl === '') throw new Error('V03_BROWSER_PRODUCTION_FAILED: Vite server has no local URL')
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
    if (inputRoot !== '') await rm(inputRoot, { recursive: true, force: true })
  })

  it('renders exact-rig tail and extra identities from the real v0.3 catalog and runtime bytes', async () => {
    if (browser === undefined) throw new Error('V03_BROWSER_PRODUCTION_FAILED: browser was not started')
    for (const [index, productionCase] of CASES.entries()) {
      const spec = makeProductionSpec(sourceCatalog, productionCase.rigId, productionCase.tailId, productionCase.extraId)
      expect(spec.catalogVersion).toBe('0.3.0')
      expect(spec.rendererVersion).toBe('0.3.0')
      const inputPath = join(inputRoot, `${index}-${productionCase.rigId}.json`)
      await writeFile(inputPath, `${JSON.stringify({ catalog: browserCatalog, spec })}\n`)

      const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } })
      try {
        await page.goto(`${baseUrl}render-test.html?bipedSlice=${encodeURIComponent(fsUrl(inputPath))}`)
        await page.waitForFunction(() => document.body.dataset.renderComplete === 'true' || document.body.dataset.renderError !== undefined)
        expect(await page.evaluate(() => document.body.dataset.renderError), productionCase.rigId).toBeUndefined()
        const evidence = JSON.parse((await page.evaluate(() => document.body.dataset.interfaceResult))!) as {
          diagnostics: Array<{ severity: string; code: string }>
          connectorMetrics: Array<{ connectorId: string; receiverCoverage: number; plugCoverage: number; centerlineGapPixels: number }>
          compositionMetrics: { visibleBounds: { x: number; y: number; width: number; height: number } | null }
          resolvedAssetPaths: string[]
        }
        const blockingDiagnostics = evidence.diagnostics.filter(item => (
          item.severity === 'error'
          && !(item.code === 'CONNECTOR_COMPOSITE_FAILED' && (item as { path?: string[] }).path?.join('/') === 'connectors/neck')
          && !['COMPOSITION_FACE_OUT_OF_ZONE', 'COMPOSITION_FACE_OCCLUDED'].includes(item.code)
        ))
        expect(blockingDiagnostics, productionCase.rigId).toEqual([])
        const selectedParts = [productionCase.tailId, productionCase.extraId].map(partId => browserCatalog.parts.find(part => part.id === partId)!)
        const expectedNodePaths = selectedParts.flatMap(part => {
          if (part.composition?.mode !== 'interface') throw new Error(`Expected interface production part ${part.id}`)
          return part.composition.variantsByRig[productionCase.rigId]!.renderNodes.map(node => node.assetPath)
        })
        expect(evidence.resolvedAssetPaths, productionCase.rigId).toEqual(expect.arrayContaining(expectedNodePaths))
        for (const connectorId of ['tailRoot', 'extraLeft', 'extraRight']) {
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
      } finally {
        await page.close()
      }
    }
  }, 120_000)
})
