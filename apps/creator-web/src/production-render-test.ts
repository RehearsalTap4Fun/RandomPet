import { type Catalog } from '@qmonster/generator-core'
import { renderMonster, type ImageResolver } from '@qmonster/renderer-canvas'
import { buildProductionReviewBundle, type ProductionReviewBundle } from './production-render-review.js'

async function draw(canvas: HTMLCanvasElement, bundle: ProductionReviewBundle): Promise<{
  drawnAssetIds: string[]
  compositionMetrics: unknown
  resolvedAssetPaths: string[]
}> {
  canvas.width = 2048
  canvas.height = 2048
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D context unavailable')
  const resolvedAssetPaths: string[] = []
  const imageResolver: ImageResolver = {
    async resolve(assetPath) {
      resolvedAssetPaths.push(assetPath)
      const image = new Image()
      image.src = assetPath.startsWith('/') ? assetPath : `/production-assets/${assetPath}`
      await image.decode()
      return image
    },
  }
  const result = await renderMonster(context, bundle.spec, bundle.catalog, imageResolver, {
    width: 2048,
    height: 2048,
    includeGroundShadow: true,
  })
  if (result.diagnostics.length > 0) throw new Error(JSON.stringify(result.diagnostics))
  return {
    drawnAssetIds: result.drawnAssetIds,
    compositionMetrics: result.compositionMetrics,
    resolvedAssetPaths,
  }
}

async function renderProductionReview(): Promise<void> {
  const query = new URLSearchParams(location.search)
  if (query.get('contact') === '1') document.body.classList.add('contact')
  const rigId = query.get('rig')
  const partId = query.get('part')
  if (rigId === null || partId === null) throw new Error('rig and part query parameters are required')
  const response = await fetch('/production-catalog.json')
  if (!response.ok) throw new Error(`Production catalog failed: ${response.status}`)
  const production = await response.json() as Catalog
  const rig = production.rigs.find(candidate => candidate.id === rigId)
  const target = production.parts.find(candidate => candidate.id === partId)
  if (rig === undefined || target === undefined || !target.compatibleRigs.includes(rig.id)) {
    throw new Error(`Incompatible production review target: ${partId}/${rigId}`)
  }
  await draw(document.querySelector<HTMLCanvasElement>('#base-target')!, buildProductionReviewBundle(production, rig))
  const evidence = await draw(
    document.querySelector<HTMLCanvasElement>('#render-target')!,
    buildProductionReviewBundle(production, rig, target),
  )
  document.body.dataset.rendererVersion = production.compositionPolicy === undefined ? '0.1.0' : '0.2.0'
  document.body.dataset.renderEvidence = JSON.stringify(evidence)
  document.body.dataset.renderComplete = 'true'
}

void renderProductionReview().catch((error: unknown) => {
  document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
})
