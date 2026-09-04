import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { generateMonster, parseCatalog } from '@qmonster/generator-core'

const catalogPath = fileURLToPath(new URL(
  '../../packages/asset-catalog/catalog/v0.6.0/catalog.json', import.meta.url,
))
const rendererModuleUrl = `/@fs/${fileURLToPath(new URL(
  '../../packages/renderer-canvas/src/index.ts', import.meta.url,
)).replaceAll('\\', '/')}`
const previewModuleUrl = `/@fs/${fileURLToPath(new URL(
  '../../apps/creator-web/src/components/PreviewCanvas.tsx', import.meta.url,
)).replaceAll('\\', '/')}`
const parsed = parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
if (!parsed.ok) throw new Error('Production v0.6.0 catalog is invalid.')
const generated = generateMonster({
  seed: 's11', themeId: 'fungal', mode: 'normal', archetypeId: 'feline',
}, parsed.value)
const mutationGenerated = generateMonster({
  seed: 'x5', themeId: 'fungal', mode: 'mutation', archetypeId: 'feline',
}, parsed.value)
if (generated.blocked || mutationGenerated.blocked) throw new Error('Unable to generate the v0.6 matrix fixture.')

test('all legal feline structural combinations satisfy the real renderer contracts', async ({ page }) => {
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  for (const bodyId of ['body_feline_sit_round', 'body_feline_sit_plush']) {
    for (const headId of ['head_feline_round', 'head_feline_tufted']) {
      for (const tailId of ['tail_feline_long', 'tail_feline_curl', 'tail_feline_star_tip']) {
        const spec = structuredClone(tailId === 'tail_feline_star_tip' ? mutationGenerated.spec : generated.spec)
        spec.visualSlots.bodyFrame.partId = bodyId
        spec.visualSlots.headShape.partId = headId
        spec.visualSlots.tail.partId = tailId
        spec.genome.genes.bodyFrame.P = bodyId
        spec.genome.genes.headShape.P = headId
        spec.genome.genes.tail.P = tailId
        const result = await page.evaluate(async input => {
          const renderer = await import(/* @vite-ignore */ input.rendererModuleUrl)
          const preview = await import(/* @vite-ignore */ input.previewModuleUrl)
          const canvas = document.createElement('canvas')
          canvas.width = 1024
          canvas.height = 1024
          const context = canvas.getContext('2d')!
          const resolver = {
            async resolve(assetPath: string) {
              const assetUrl = await preview.resolveProductionAssetUrl('0.6.0', assetPath)
              return await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image()
                image.onload = () => resolve(image)
                image.onerror = reject
                image.src = assetUrl
              })
            },
          }
          return renderer.renderMonster(
            context, input.spec, input.catalog, resolver,
            { width: 1024, height: 1024, includeGroundShadow: true },
          )
        }, { rendererModuleUrl, previewModuleUrl, catalog: parsed.value, spec })
        const label = `${bodyId}|${headId}|${tailId}`
        expect(result.diagnostics.filter(item => item.severity === 'error'), label).toEqual([])
        expect(result.connectorMetrics, label).toHaveLength(2)
        for (const metric of result.connectorMetrics ?? []) {
          expect(metric.receiverCoverage, `${label}:${metric.connectorId}:receiver`).toBeGreaterThanOrEqual(0.62)
          expect(metric.plugCoverage, `${label}:${metric.connectorId}:plug`).toBeGreaterThanOrEqual(0.899)
          expect(metric.centerlineGapPixels, `${label}:${metric.connectorId}:gap`).toBeLessThanOrEqual(2)
          expect(metric.largestComponentRatio, `${label}:${metric.connectorId}:structure`).toBeGreaterThanOrEqual(0.99)
        }
        expect(result.compositionMetrics?.eyesInsideRatio, label).toBeGreaterThanOrEqual(0.84)
        expect(result.compositionMetrics?.eyesVisibleRatio, label).toBeGreaterThanOrEqual(0.84)
        expect(result.compositionMetrics?.mouthInsideRatio, label).toBeGreaterThanOrEqual(0.84)
        expect(result.compositionMetrics?.mouthVisibleRatio, label).toBeGreaterThanOrEqual(0.84)
        const bounds = result.compositionMetrics?.visibleBounds
        expect(bounds, label).not.toBeNull()
        expect(bounds!.x, label).toBeGreaterThanOrEqual(128)
        expect(bounds!.y, label).toBeGreaterThanOrEqual(128)
        expect(bounds!.x + bounds!.width, label).toBeLessThanOrEqual(1920)
        expect(bounds!.y + bounds!.height, label).toBeLessThanOrEqual(1920)
      }
    }
  }
})
