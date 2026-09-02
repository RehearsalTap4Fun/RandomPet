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
import { PreviewCanvas, resolveProductionAssetUrl } from './components/PreviewCanvas.js'

interface AcceptanceRenderResult extends RenderResult {
  dataUrl: string
  resolvedAssetPaths: string[]
  resolvedAssetUrls: string[]
}

declare global {
  interface Window {
    renderAcceptanceMonster: (
      spec: unknown,
      catalogVersion?: '0.2.0' | '0.3.0' | '0.4.0',
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
const catalogs = new Map<'0.2.0' | '0.3.0' | '0.4.0', Catalog>([
  ['0.2.0', productionCatalog],
  ['0.3.0', parsedV03Catalog.value],
  ['0.4.0', parsedV04Catalog.value],
] as const)
const acceptanceImageCache = new Map<string, Promise<{
  assetUrl: string
  source: CanvasImageSource
}>>()

const container = document.querySelector<HTMLElement>('#acceptance-root')
if (container === null) throw new Error('Acceptance renderer root is missing.')
const root = createRoot(container)
let renderSequence = 0

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
      resolve({
        ...result,
        dataUrl: canvas.toDataURL('image/png'),
        resolvedAssetPaths: [...resolvedAssetPaths].sort(),
        resolvedAssetUrls: [...resolvedAssetUrls].sort(),
      })
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
