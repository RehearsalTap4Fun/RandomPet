import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { generateMonster, parseCatalog, type RenderLayer } from '@qmonster/generator-core'

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

function localLayerFixture(mode: 'normal' | 'mutation' | 'aberration') {
  const catalog = structuredClone(parsed.value)
  const spec = generatedSpec(mode)
  const localNode = (
    slotId: 'eyes' | 'headAppendage' | 'surfaceMaterial' | 'pattern',
    socket: string,
    layer: RenderLayer,
  ) => {
    const part = catalog.parts.find(item => item.id === spec.visualSlots[slotId].partId)!
    part.assetPath = `local/${slotId}.webp`
    part.composition = {
      mode: 'attachment',
      isNone: false,
      motifTags: [],
      visualIntensity: 'quiet',
      renderNodes: [{
        id: `local-${slotId}`,
        assetPath: `local/${slotId}.webp`,
        parentSlot: 'bodyFrame',
        socket,
        origin: slotId === 'eyes' || slotId === 'headAppendage' ? { x: 0, y: 0 } : { x: 1024, y: 1024 },
        transform: { scale: 1, mirrorX: false },
        layer,
        compatibleRigs: ['feline-sit'],
        clipPolicy: 'none',
      }],
      geometryByRig: {},
    }
    return part
  }
  localNode('eyes', 'eyes', 'faceAndHeadwear')
  const surface = localNode('surfaceMaterial', 'surfaceMaterial', 'surface')
  localNode('pattern', 'surfaceMaterial', 'pattern')
  if (mode === 'mutation') {
    const headAppendage = localNode('headAppendage', 'headAppendage', 'faceAndHeadwear')
    headAppendage.featureTier = 'special'
    headAppendage.specialFeatureAnchor = 'ear'
    catalog.archetypes![0]!.specialFeatureSlots = ['headAppendage']
  }
  if (mode === 'aberration') {
    surface.featureTier = 'special'
    surface.specialFeatureAnchor = 'back'
    catalog.archetypes![0]!.specialFeatureSlots = ['surfaceMaterial']
  }
  return { catalog, spec }
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

test('Creator acceptance rendering returns the v0.6 anatomy acceptance measurements', async ({ page }) => {
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')
  const spec = generatedSpec('mutation')
  const result = await page.evaluate(async input => window.renderAcceptanceMonster(input, '0.6.0'), spec)

  expect(result.connectorMetrics).toEqual([])
  expect(result.anatomyAcceptance).toEqual(expect.objectContaining({
    anatomyBundleId: spec.anatomyBundleId,
    archetypeId: 'feline',
    structuralConnectedComponentCount: 1,
    surfaceOutsideAlphaCount: 0,
    specialAnchorValid: true,
  }))
  expect(result.anatomyAcceptance.frameBounds).not.toBeNull()
  expect(result.anatomyAcceptance.faceRatios).toEqual(expect.objectContaining({
    eyesInsideRatio: expect.any(Number),
    eyesVisibleRatio: expect.any(Number),
    mouthInsideRatio: expect.any(Number),
    mouthVisibleRatio: expect.any(Number),
  }))
})

test('v0.6 anatomy bundles clip injected local layers and constrain special anchors', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/acceptance-render.html')
  await page.waitForFunction(() => document.body.dataset.rendererReady === 'true')

  for (const mode of ['normal', 'mutation', 'aberration'] as const) {
    const { catalog, spec } = localLayerFixture(mode)
    const result = await page.evaluate(async input => {
      const renderer = await import(/* @vite-ignore */ input.rendererModuleUrl)
      const preview = await import(/* @vite-ignore */ input.previewModuleUrl)
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const colors = {
        eyes: [251, 17, 19],
        surfaceMaterial: [17, 251, 19],
        pattern: [19, 17, 251],
        headAppendage: [251, 19, 251],
      }
      const localSource = (slotId: keyof typeof colors) => {
        const source = document.createElement('canvas')
        source.width = 2048
        source.height = 2048
        const context = source.getContext('2d')!
        context.fillStyle = `rgb(${colors[slotId].join(',')})`
        if (slotId === 'eyes') context.fillRect(0, 0, 180, 120)
        else if (slotId === 'surfaceMaterial') context.fillRect(500, 0, 800, 2048)
        else if (slotId === 'pattern') context.fillRect(800, 0, 800, 2048)
        else context.fillRect(0, 0, 2048, 2048)
        return source
      }
      const renderResult = await renderer.renderMonster(
        canvas.getContext('2d')!, input.spec, input.catalog,
        {
          async resolve(assetPath: string) {
            if (assetPath.startsWith('local/')) {
              return localSource(assetPath.slice('local/'.length, -'.webp'.length) as keyof typeof colors)
            }
            const image = new Image()
            image.src = await preview.resolveProductionAssetUrl('0.6.0', assetPath)
            await image.decode()
            return image
          },
        },
        { width: 1024, height: 1024, includeGroundShadow: true },
      )
      const output = canvas.getContext('2d')!.getImageData(0, 0, 1024, 1024).data
      const bundle = input.catalog.anatomyBundles.find((item: { id: string }) => item.id === input.spec.anatomyBundleId)!
      const clipImage = new Image()
      clipImage.src = await preview.resolveProductionAssetUrl('0.6.0', bundle.clip.assetPath)
      await clipImage.decode()
      const clipCanvas = document.createElement('canvas')
      clipCanvas.width = 1024
      clipCanvas.height = 1024
      clipCanvas.getContext('2d')!.drawImage(clipImage, 0, 0, 1024, 1024)
      const clip = clipCanvas.getContext('2d')!.getImageData(0, 0, 1024, 1024).data
      const pixels = (color: number[]) => {
        const matches: Array<{ x: number; y: number }> = []
        for (let y = 0; y < 1024; y += 1) {
          for (let x = 0; x < 1024; x += 1) {
            const offset = (y * 1024 + x) * 4
            if (color.every((channel, index) => output[offset + index] === channel)) matches.push({ x, y })
          }
        }
        return matches
      }
      const surface = pixels(colors.surfaceMaterial)
      const pattern = pixels(colors.pattern)
      const special = input.mode === 'mutation'
        ? pixels(colors.headAppendage)
        : input.mode === 'aberration' ? surface : []
      const anchor = input.mode === 'mutation' ? bundle.mutationAnchors.ear : bundle.mutationAnchors.back
      const ordinarySurfaceOrPattern = input.mode === 'aberration' ? pattern : [...surface, ...pattern]
      return {
        renderResult,
        eyes: pixels(colors.eyes),
        surface,
        pattern,
        surfaceOrPatternOutsideClip: ordinarySurfaceOrPattern.filter(({ x, y }) => (
          clip[(y * 1024 + x) * 4 + 3] === 0
        )).length,
        special,
        anchor: { x: anchor.x / 2, y: anchor.y / 2, width: anchor.width / 2, height: anchor.height / 2 },
      }
    }, { rendererModuleUrl, previewModuleUrl, catalog, spec, mode })

    expect(result.renderResult.diagnostics.filter(item => item.severity === 'error'), mode).toEqual([])
    expect(result.eyes.length, mode).toBeGreaterThan(0)
    expect(result.surfaceOrPatternOutsideClip, mode).toBe(0)
    if (mode !== 'normal') {
      expect(result.special.length, mode).toBeGreaterThan(0)
      expect(result.special.every(({ x, y }) => (
        x >= result.anchor.x && x < result.anchor.x + result.anchor.width
          && y >= result.anchor.y && y < result.anchor.y + result.anchor.height
      )), mode).toBe(true)
    }
  }
})
