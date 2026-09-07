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

function generatedSpec(mode: 'normal' | 'mutation' | 'aberration') {
  const generated = generateMonster({
    seed: 's11', themeId: 'fungal', mode, archetypeId: 'feline',
  }, parsed.value)
  if (generated.blocked) throw new Error(`Unable to create ${mode} v0.6 anatomy fixture.`)
  return generated.spec
}

test('v0.6 anatomy bundles render as one connected structure without bridges', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  for (const mode of ['normal', 'mutation', 'aberration'] as const) {
    const spec = generatedSpec(mode)
    const result = await page.evaluate(async input => {
      const renderer = await import(/* @vite-ignore */ input.rendererModuleUrl)
      const preview = await import(/* @vite-ignore */ input.previewModuleUrl)
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const paths: string[] = []
      const renderResult = await renderer.renderMonster(
        canvas.getContext('2d')!, input.spec, input.catalog,
        {
          async resolve(assetPath: string) {
            paths.push(assetPath)
            const image = new Image()
            image.src = await preview.resolveProductionAssetUrl('0.6.0', assetPath)
            await image.decode()
            return image
          },
        },
        { width: 1024, height: 1024, includeGroundShadow: true },
      )
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, 1024, 1024).data
      let minX = 1024
      let minY = 1024
      let maxX = -1
      let maxY = -1
      let components = 0
      const seen = new Uint8Array(1024 * 1024)
      for (let index = 0; index < seen.length; index += 1) {
        if (seen[index] !== 0 || pixels[index * 4 + 3] === 0) continue
        components += 1
        const queue = [index]
        seen[index] = 1
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const point = queue[cursor]!
          const x = point % 1024
          const y = Math.floor(point / 1024)
          minX = Math.min(minX, x); minY = Math.min(minY, y)
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
          for (const neighbor of [point - 1, point + 1, point - 1024, point + 1024]) {
            if (
              neighbor < 0 || neighbor >= seen.length || seen[neighbor] !== 0
              || (neighbor % 1024 === 1023 && neighbor === point - 1)
              || (neighbor % 1024 === 0 && neighbor === point + 1)
              || pixels[neighbor * 4 + 3] === 0
            ) continue
            seen[neighbor] = 1
            queue.push(neighbor)
          }
        }
      }
      return {
        renderResult,
        paths,
        components,
        bounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      }
    }, { rendererModuleUrl, previewModuleUrl, catalog: parsed.value, spec })

    const bundle = parsed.value.anatomyBundles!.find(item => item.id === spec.anatomyBundleId)!
    expect(result.renderResult.diagnostics.filter(item => item.severity === 'error'), mode).toEqual([])
    expect(result.renderResult.connectorMetrics, mode).toEqual([])
    expect(result.renderResult.drawnAssetIds, mode).toEqual([bundle.id])
    expect(result.paths, mode).toEqual([
      bundle.structural.assetPath, bundle.alpha.assetPath, bundle.clip.assetPath,
    ])
    expect(result.components, mode).toBe(1)
    expect(result.bounds, mode).not.toBeNull()
    expect(result.bounds!.x, mode).toBeGreaterThanOrEqual(64)
    expect(result.bounds!.y, mode).toBeGreaterThanOrEqual(64)
    expect(result.bounds!.x + result.bounds!.width, mode).toBeLessThanOrEqual(960)
    expect(result.bounds!.y + result.bounds!.height, mode).toBeLessThanOrEqual(960)
  }
})
