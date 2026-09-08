import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import {
  generateMonster,
  parseCatalog,
  selectVisualPart,
  type MonsterSpec,
} from '@qmonster/generator-core'
import { buildV08ReviewInputs } from '../../scripts/generate-v08-user-review-batch.js'

const catalogPath = fileURLToPath(new URL('../../packages/asset-catalog/catalog/v0.8.0/catalog.json', import.meta.url))
const parsedCatalog = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
if (!parsedCatalog.ok) throw new Error(`Production v0.8.0 catalog is invalid: ${JSON.stringify(parsedCatalog.diagnostics)}`)
const catalog = parsedCatalog.value
const inputs = buildV08ReviewInputs('qmonster-v08-review', 10)

interface AcceptanceResult {
  dataUrl: string
  diagnostics: Array<{ severity: string, code: string }>
  compositionMetrics: {
    eyesInsideRatio: number
    eyesVisibleRatio: number
    mouthInsideRatio: number
    mouthVisibleRatio: number
    oralDetailInsideRatio: number | null
    oralDetailVisibleRatio: number | null
    visibleBounds: { x: number, y: number, width: number, height: number } | null
  } | null
  connectorMetrics: unknown[] | null
  resolvedAssetPaths: string[]
  anatomyAcceptance?: {
    anatomyBundleId: string
    archetypeId: string
    structuralConnectedComponentCount: number
    surfaceOutsideAlphaCount: number
    specialAnchorValid: boolean
  }
}

function pngHash(dataUrl: string): string {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) throw new Error('Acceptance renderer returned a non-PNG data URL.')
  return createHash('sha256').update(Buffer.from(dataUrl.slice(prefix.length), 'base64')).digest('hex')
}

async function render(page: Page, spec: MonsterSpec): Promise<AcceptanceResult> {
  return page.evaluate(async input => window.renderAcceptanceMonster(input, '0.8.0'), spec)
}

test('renders the ten fixed v0.8 cats through the canonical species-rig path', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1024 })
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  for (const input of inputs) {
    const generated = generateMonster({ ...input, archetypeId: 'feline' }, catalog)
    expect(generated.blocked).toBe(false)
    expect(generated.diagnostics).toEqual([])
    expect(generated.spec).toMatchObject({
      schemaVersion: '0.3.0',
      catalogVersion: '0.8.0',
      rendererVersion: '0.8.0',
      archetypeId: 'feline',
      anatomyBundleId: 'feline-sit-canonical-v1',
      speciesRigId: 'feline-sit-v1',
    })

    const rendered = await render(page, generated.spec)
    expect(rendered.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(rendered.connectorMetrics).toEqual([])
    expect(rendered.resolvedAssetPaths.length).toBeGreaterThan(0)
    expect(rendered.anatomyAcceptance).toMatchObject({
      anatomyBundleId: 'feline-sit-canonical-v1',
      archetypeId: 'feline',
      structuralConnectedComponentCount: 1,
      specialAnchorValid: true,
    })
    expect(rendered.compositionMetrics).not.toBeNull()
    const metrics = rendered.compositionMetrics!
    expect(metrics.eyesInsideRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.eyesVisibleRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.mouthInsideRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.mouthVisibleRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.oralDetailInsideRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.oralDetailVisibleRatio).toBeGreaterThanOrEqual(0.99)
    expect(metrics.visibleBounds).not.toBeNull()
    expect(metrics.visibleBounds!.x).toBeGreaterThanOrEqual(0)
    expect(metrics.visibleBounds!.y).toBeGreaterThanOrEqual(0)
    expect(metrics.visibleBounds!.x + metrics.visibleBounds!.width).toBeLessThanOrEqual(2048)
    expect(metrics.visibleBounds!.y + metrics.visibleBounds!.height).toBeLessThanOrEqual(2048)
  }
})

test('is deterministic and one trait changes pixels without changing the rig', async ({ page }) => {
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const input = inputs[0]!
  const generated = generateMonster({ ...input, archetypeId: 'feline' }, catalog)
  const first = await render(page, generated.spec)
  const repeated = await render(page, generated.spec)
  expect(pngHash(repeated.dataUrl)).toBe(pngHash(first.dataUrl))

  const bundle = catalog.anatomyBundles!.find(item => item.id === generated.spec.anatomyBundleId)!
  const alternative = bundle.partPools!.pattern.find(partId => partId !== generated.spec.visualSlots.pattern.partId)!
  const changed = selectVisualPart({
    spec: generated.spec,
    slotId: 'pattern',
    partId: alternative,
    locks: {},
    catalog,
  })
  expect(changed.blocked).toBe(false)
  expect(changed.spec.visualSlots.pattern.partId).toBe(alternative)
  expect(changed.spec.anatomyBundleId).toBe(generated.spec.anatomyBundleId)
  expect(changed.spec.speciesRigId).toBe(generated.spec.speciesRigId)

  const changedRender = await render(page, changed.spec)
  expect(pngHash(changedRender.dataUrl)).not.toBe(pngHash(first.dataUrl))
})
