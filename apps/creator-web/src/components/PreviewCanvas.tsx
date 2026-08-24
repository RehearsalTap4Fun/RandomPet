import { forwardRef, useCallback, useEffect, useRef } from 'react'
import type { Catalog, Diagnostic, MonsterSpec } from '@qmonster/generator-core'
import {
  renderMonster,
  type ImageResolver,
  type RenderResult,
} from '@qmonster/renderer-canvas'

export type CatalogAssetLoader = (
  catalogVersion: string,
  assetPath: string,
) => Promise<CanvasImageSource>

export type PreviewRenderer = (
  context: CanvasRenderingContext2D,
  spec: MonsterSpec,
  catalog: Catalog,
  resolver: ImageResolver,
  options: {
    width: 1024
    height: 1024
    includeGroundShadow: boolean
  },
) => Promise<RenderResult>

export class CatalogImageResolverCache {
  private readonly cache = new Map<string, Promise<CanvasImageSource>>()

  public constructor(private readonly load: CatalogAssetLoader) {}

  public size(): number {
    return this.cache.size
  }

  public forCatalog(catalogVersion: string): ImageResolver {
    return {
      resolve: assetPath => {
        const key = `${catalogVersion}\u0000${assetPath}`
        const cached = this.cache.get(key)
        if (cached !== undefined) return cached
        const pending = this.load(catalogVersion, assetPath).catch(error => {
          if (this.cache.get(key) === pending) this.cache.delete(key)
          throw error
        })
        this.cache.set(key, pending)
        return pending
      },
    }
  }
}

const PRODUCTION_ASSET_ROOT = '../../../../packages/asset-catalog/assets/'
const productionAssetUrls = import.meta.glob<string>(
  '../../../../packages/asset-catalog/assets/v*/**/*.{png,webp}',
  { query: '?url', import: 'default' },
)

export function catalogAssetKey(catalogVersion: string, assetPath: string): string {
  return `${PRODUCTION_ASSET_ROOT}v${catalogVersion}/${assetPath}`
}

export async function resolveProductionAssetUrl(
  catalogVersion: string,
  assetPath: string,
): Promise<string> {
  const loadUrl = productionAssetUrls[catalogAssetKey(catalogVersion, assetPath)]
  if (loadUrl === undefined) throw new Error(`Asset ${assetPath} is not bundled.`)
  return loadUrl()
}

const browserImageCache = new CatalogImageResolverCache(async (catalogVersion, assetPath) => {
  const assetUrl = await resolveProductionAssetUrl(catalogVersion, assetPath)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load ${assetPath}.`))
    image.src = assetUrl
  })
})

interface PreviewCanvasProps {
  spec: MonsterSpec
  catalog: Catalog
  onDiagnosticsChange: (diagnostics: Diagnostic[]) => void
  renderer?: PreviewRenderer
  resolver?: ImageResolver
}

interface StagingCanvasLease {
  canvas: HTMLCanvasElement
  inUse: boolean
}

function canvasUnavailable(): Diagnostic[] {
  return [{
    severity: 'error',
    code: 'PREVIEW_CANVAS_UNAVAILABLE',
    path: [],
    message: 'The browser could not create the 2D preview canvas.',
  }]
}

function previewFailure(): Diagnostic[] {
  return [{
    severity: 'error',
    code: 'PREVIEW_RENDER_FAILED',
    path: [],
    message: 'The preview renderer stopped before completing this creature.',
  }]
}

export const PreviewCanvas = forwardRef<HTMLCanvasElement, PreviewCanvasProps>(function PreviewCanvas({
  spec,
  catalog,
  onDiagnosticsChange,
  renderer = renderMonster,
  resolver,
}: PreviewCanvasProps, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestId = useRef(0)
  const stagingPool = useRef<StagingCanvasLease[]>([])
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas
    if (typeof forwardedRef === 'function') {
      forwardedRef(canvas)
    } else if (forwardedRef !== null) {
      forwardedRef.current = canvas
    }
  }, [forwardedRef])

  useEffect(() => {
    const currentRequest = ++requestId.current
    onDiagnosticsChange([])
    const target = canvasRef.current
    if (target === null) return undefined
    const targetContext = target.getContext('2d')
    let lease = stagingPool.current.find(candidate => (
      !candidate.inUse && candidate.canvas.ownerDocument === target.ownerDocument
    ))
    if (lease === undefined) {
      lease = { canvas: target.ownerDocument.createElement('canvas'), inUse: false }
      stagingPool.current.push(lease)
    }
    lease.inUse = true
    const staging = lease.canvas
    staging.width = 1024
    staging.height = 1024
    const stagingContext = staging.getContext('2d')

    if (targetContext === null || stagingContext === null) {
      lease.inUse = false
      onDiagnosticsChange(canvasUnavailable())
      return undefined
    }
    stagingContext.clearRect(0, 0, 1024, 1024)

    void renderer(
      stagingContext,
      spec,
      catalog,
      resolver ?? browserImageCache.forCatalog(catalog.version),
      { width: 1024, height: 1024, includeGroundShadow: true },
    ).then(result => {
      if (requestId.current !== currentRequest) return
      targetContext.clearRect(0, 0, 1024, 1024)
      targetContext.drawImage(staging, 0, 0)
      target.dataset.resolverCacheSize = String(browserImageCache.size())
      performance.mark('qmonster-preview-commit')
      onDiagnosticsChange(result.diagnostics)
    }).catch(() => {
      if (requestId.current !== currentRequest) return
      targetContext.clearRect(0, 0, 1024, 1024)
      onDiagnosticsChange(previewFailure())
    }).finally(() => {
      lease.inUse = false
    })

    return () => {
      if (requestId.current === currentRequest) requestId.current += 1
    }
  }, [catalog, onDiagnosticsChange, renderer, resolver, spec])

  return (
    <canvas
      className="preview-canvas"
      ref={setCanvasRef}
      width={1024}
      height={1024}
      role="img"
      aria-label="生物预览"
    />
  )
})
