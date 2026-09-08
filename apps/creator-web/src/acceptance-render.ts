import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  parseCatalog,
  parseMonsterSpec,
  rendererVersionForCatalog,
  type Catalog,
  type MonsterSpec,
} from '@qmonster/generator-core'
import type { RenderResult } from '@qmonster/renderer-canvas'
import productionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.2.0/catalog.json'
import v03ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.3.0/catalog.json'
import v04ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.4.0/catalog.json'
import v05ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.5.0/catalog.json'
import v06ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.6.0/catalog.json'
import v08ProductionCatalogDocument from '../../../packages/asset-catalog/catalog/v0.8.0/catalog.json'
import { PreviewCanvas, resolveProductionAssetUrl } from './components/PreviewCanvas.js'

interface AnatomyAcceptanceMetrics {
  anatomyBundleId: string
  archetypeId: string
  structuralConnectedComponentCount: number
  frameBounds: RenderResult['compositionMetrics'] extends infer Metrics
    ? Metrics extends { visibleBounds: infer Bounds } ? Bounds : null
    : null
  faceRatios: {
    eyesInsideRatio: number
    eyesVisibleRatio: number
    mouthInsideRatio: number
    mouthVisibleRatio: number
    oralDetailInsideRatio: number | null
    oralDetailVisibleRatio: number | null
  } | null
  surfaceOutsideAlphaCount: number
  specialAnchorValid: boolean
}

interface AcceptanceRenderResult extends RenderResult {
  dataUrl: string
  resolvedAssetPaths: string[]
  resolvedAssetUrls: string[]
  anatomyAcceptance?: AnatomyAcceptanceMetrics
}

declare global {
  interface Window {
    renderAcceptanceMonster: (
      spec: unknown,
      catalogVersion?: '0.2.0' | '0.3.0' | '0.4.0' | '0.5.0' | '0.6.0' | '0.8.0',
    ) => Promise<AcceptanceRenderResult>
  }
}

const parsedCatalog = parseCatalog(productionCatalogDocument)
if (!parsedCatalog.ok) {
  throw new Error(`Production catalog is invalid: ${parsedCatalog.diagnostics.map(item => item.code).join(', ')}`)
}
const productionCatalog = parsedCatalog.value
const parsedV03Catalog = parseCatalog(v03ProductionCatalogDocument)
if (!parsedV03Catalog.ok) {
  throw new Error(`Candidate catalog is invalid: ${parsedV03Catalog.diagnostics.map(item => item.code).join(', ')}`)
}
const parsedV04Catalog = parseCatalog(v04ProductionCatalogDocument)
if (!parsedV04Catalog.ok) {
  throw new Error(`Current catalog is invalid: ${parsedV04Catalog.diagnostics.map(item => item.code).join(', ')}`)
}
const parsedV05Catalog = parseCatalog(v05ProductionCatalogDocument)
if (!parsedV05Catalog.ok) {
  throw new Error(`V0.5 catalog is invalid: ${parsedV05Catalog.diagnostics.map(item => item.code).join(', ')}`)
}
const parsedV06Catalog = parseCatalog(v06ProductionCatalogDocument)
if (!parsedV06Catalog.ok) {
  throw new Error(`V0.6 catalog is invalid: ${parsedV06Catalog.diagnostics.map(item => item.code).join(', ')}`)
}
const parsedV08Catalog = parseCatalog(v08ProductionCatalogDocument)
if (!parsedV08Catalog.ok) {
  throw new Error(`V0.8 catalog is invalid: ${parsedV08Catalog.diagnostics.map(item => item.code).join(', ')}`)
}
const catalogs = new Map<'0.2.0' | '0.3.0' | '0.4.0' | '0.5.0' | '0.6.0' | '0.8.0', Catalog>([
  ['0.2.0', productionCatalog],
  ['0.3.0', parsedV03Catalog.value],
  ['0.4.0', parsedV04Catalog.value],
  ['0.5.0', parsedV05Catalog.value],
  ['0.6.0', parsedV06Catalog.value],
  ['0.8.0', parsedV08Catalog.value],
] as const)
const acceptanceImageCache = new Map<string, Promise<{
  assetUrl: string
  source: CanvasImageSource
}>>()

const container = document.querySelector<HTMLElement>('#acceptance-root')
if (container === null) throw new Error('Acceptance renderer root is missing.')
const root = createRoot(container)
let renderSequence = 0

function connectedAlphaComponents(alpha: Uint8ClampedArray, width: number, height: number): number {
  const seen = new Uint8Array(width * height)
  let components = 0
  for (let index = 0; index < seen.length; index += 1) {
    if (seen[index] !== 0 || alpha[index * 4 + 3] === 0) continue
    components += 1
    const queue = [index]
    seen[index] = 1
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = queue[cursor]!
      const x = point % width
      const y = Math.floor(point / width)
      const neighbors = [
        x > 0 ? point - 1 : -1,
        x + 1 < width ? point + 1 : -1,
        y > 0 ? point - width : -1,
        y + 1 < height ? point + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || seen[neighbor] !== 0 || alpha[neighbor * 4 + 3] === 0) continue
        seen[neighbor] = 1
        queue.push(neighbor)
      }
    }
  }
  return components
}

async function anatomyAcceptanceMetrics(
  canvas: HTMLCanvasElement,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: { resolve(assetPath: string): Promise<CanvasImageSource> },
  compositionMetrics: RenderResult['compositionMetrics'],
): Promise<AnatomyAcceptanceMetrics | undefined> {
  const bundle = spec.anatomyBundleId === undefined
    ? undefined
    : catalog.anatomyBundles?.find(candidate => candidate.id === spec.anatomyBundleId)
  if (!['0.6.0', '0.8.0'].includes(catalog.version) || bundle === undefined || spec.archetypeId === undefined) return undefined
  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = canvas.width
  alphaCanvas.height = canvas.height
  const alphaContext = alphaCanvas.getContext('2d')
  const outputContext = canvas.getContext('2d')
  if (alphaContext === null || outputContext === null) throw new Error('Acceptance metric canvas is unavailable.')
  alphaContext.drawImage(await resolver.resolve(bundle.alpha.assetPath), 0, 0, canvas.width, canvas.height)
  const alpha = alphaContext.getImageData(0, 0, canvas.width, canvas.height).data
  const output = outputContext.getImageData(0, 0, canvas.width, canvas.height).data
  let surfaceOutsideAlphaCount = 0
  for (let offset = 3; offset < output.length; offset += 4) {
    if (output[offset]! > 0 && alpha[offset]! === 0) surfaceOutsideAlphaCount += 1
  }
  const specialAnchorValid = Object.entries(spec.visualSlots).every(([slotId, selection]) => {
    const part = catalog.parts.find(candidate => candidate.id === selection.partId && candidate.slotId === slotId)
    return part?.specialFeatureAnchor === undefined || bundle.mutationAnchors[part.specialFeatureAnchor] !== undefined
  })
  return {
    anatomyBundleId: bundle.id,
    archetypeId: spec.archetypeId,
    structuralConnectedComponentCount: connectedAlphaComponents(alpha, canvas.width, canvas.height),
    frameBounds: compositionMetrics?.visibleBounds ?? null,
    faceRatios: compositionMetrics === null ? null : {
      eyesInsideRatio: compositionMetrics.eyesInsideRatio,
      eyesVisibleRatio: compositionMetrics.eyesVisibleRatio,
      mouthInsideRatio: compositionMetrics.mouthInsideRatio,
      mouthVisibleRatio: compositionMetrics.mouthVisibleRatio,
      oralDetailInsideRatio: compositionMetrics.oralDetailInsideRatio,
      oralDetailVisibleRatio: compositionMetrics.oralDetailVisibleRatio,
    },
    surfaceOutsideAlphaCount,
    specialAnchorValid,
  }
}

function renderSpec(
  spec: MonsterSpec,
  catalog: Catalog,
): Promise<AcceptanceRenderResult> {
  const canvasRef = createRef<HTMLCanvasElement>()
  const sequence = ++renderSequence
  const resolvedAssetPaths = new Set<string>()
  const resolvedAssetUrls = new Set<string>()
  const resolver = {
    resolve(assetPath: string): Promise<CanvasImageSource> {
      resolvedAssetPaths.add(assetPath)
      const key = `${catalog.version}\u0000${assetPath}`
      const cached = acceptanceImageCache.get(key)
      if (cached !== undefined) {
        return cached.then(({ assetUrl, source }) => {
          resolvedAssetUrls.add(assetUrl)
          return source
        })
      }
      const pending = resolveProductionAssetUrl(catalog.version, assetPath).then(async assetUrl => {
        const source = await new Promise<CanvasImageSource>((resolve, reject) => {
          const image = new Image()
          image.decoding = 'async'
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error(`Unable to load ${assetPath}.`))
          image.src = assetUrl
        })
        return { assetUrl, source }
      }).catch(error => {
        acceptanceImageCache.delete(key)
        throw error
      })
      acceptanceImageCache.set(key, pending)
      return pending.then(({ assetUrl, source }) => {
        resolvedAssetUrls.add(assetUrl)
        return source
      })
    },
  }

  return new Promise((resolve, reject) => {
    const onDiagnosticsChange = (diagnostics: RenderResult['diagnostics']) => {
      const errors = diagnostics.filter(item => item.severity === 'error')
      if (errors.length > 0) {
        reject(new Error(`Acceptance render diagnostics: ${JSON.stringify(errors)}`))
      }
    }
    const onRenderComplete = (result: RenderResult) => {
      const canvas = canvasRef.current
      if (canvas === null) {
        reject(new Error('Acceptance canvas was not committed.'))
        return
      }
      void anatomyAcceptanceMetrics(canvas, spec, catalog, resolver, result.compositionMetrics).then(anatomyAcceptance => {
        resolve({
          ...result,
          dataUrl: canvas.toDataURL('image/png'),
          resolvedAssetPaths: [...resolvedAssetPaths].sort(),
          resolvedAssetUrls: [...resolvedAssetUrls].sort(),
          ...(anatomyAcceptance === undefined ? {} : { anatomyAcceptance }),
        })
      }, reject)
    }

    root.render(createElement(PreviewCanvas, {
      key: sequence,
      ref: canvasRef,
      spec,
      catalog,
      resolver,
      onDiagnosticsChange,
      onRenderComplete,
    }))
  })
}

window.renderAcceptanceMonster = async (input: unknown, catalogVersion = '0.2.0') => {
  const parsedSpec = parseMonsterSpec(input)
  if (!parsedSpec.ok) {
    throw new Error(`Acceptance spec is invalid: ${JSON.stringify(parsedSpec.diagnostics)}`)
  }
  const catalog = catalogs.get(catalogVersion)
  if (catalog === undefined || parsedSpec.value.catalogVersion !== catalog.version) {
    throw new Error(`Acceptance renderer requires exact catalog ${parsedSpec.value.catalogVersion}.`)
  }
  const rendererVersion = rendererVersionForCatalog(catalog)
  if (parsedSpec.value.rendererVersion !== rendererVersion) {
    throw new Error(`Acceptance renderer requires exact renderer ${rendererVersion}.`)
  }
  document.body.dataset.renderComplete = 'false'
  try {
    const result = await renderSpec(parsedSpec.value, catalog)
    document.body.dataset.renderComplete = 'true'
    delete document.body.dataset.renderError
    return result
  } catch (error) {
    document.body.dataset.renderError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

document.body.dataset.rendererReady = 'true'
