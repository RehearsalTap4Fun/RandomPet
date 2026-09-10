import { forwardRef, useCallback, useEffect, useRef } from 'react'
import {
  parseMonsterSpec,
  parseMonsterSpecV09,
  rendererVersionForCatalog,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
  type MonsterSpecV09,
  type ResolvedV09Catalog,
} from '@qmonster/generator-core'
import {
  primeCanvasExport,
  renderMonster,
  renderMonsterV09,
  resolveV09Composite,
  V09RenderError,
  type ImageResolver,
  type RenderResult,
  type V09RenderResult,
  type V09ResourceResolver,
} from '@qmonster/renderer-canvas'
import type { AnyMonsterSpec } from '../state/contracts.js'

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

export type V09PreviewRenderer = (
  context: CanvasRenderingContext2D,
  spec: MonsterSpecV09,
  catalog: ResolvedV09Catalog,
  resolver: V09ResourceResolver,
) => Promise<V09RenderResult>

export type PreviewCatalog = Catalog | ResolvedV09Catalog
export type AnyPreviewRenderResult = RenderResult | V09RenderResult

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
  [
    '../../../../packages/asset-catalog/assets/v*/**/*.{png,webp}',
    '!../../../../packages/asset-catalog/assets/v*/split-*/**/*.{png,webp}',
  ],
  { query: '?url', import: 'default' },
)
const V09_HASH = /^[a-f0-9]{64}$/u

export function catalogAssetKey(catalogVersion: string, assetPath: string): string {
  const exactVersionPrefix = `assets/v${catalogVersion}/`
  const relativeAssetPath = assetPath.startsWith(exactVersionPrefix)
    ? assetPath.slice(exactVersionPrefix.length)
    : assetPath
  return `${PRODUCTION_ASSET_ROOT}v${catalogVersion}/${relativeAssetPath}`
}

export async function resolveProductionAssetUrl(
  catalogVersion: string,
  assetPath: string,
): Promise<string> {
  const loadUrl = productionAssetUrls[catalogAssetKey(catalogVersion, assetPath)]
  if (loadUrl === undefined) throw new Error(`Asset ${assetPath} is not bundled.`)
  return loadUrl()
}

export function resolveProductionV09ResourceUrl(sha256: string): Promise<string> {
  if (!V09_HASH.test(sha256)) return Promise.reject(new V09RenderError('RESOURCE_HASH_MISMATCH', 'Invalid v0.9 content digest.'))
  return resolveProductionAssetUrl('0.9.0', `by-sha256/${sha256}.png`)
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
  spec: AnyMonsterSpec
  catalog: PreviewCatalog
  onDiagnosticsChange: (diagnostics: Diagnostic[]) => void
  onRenderComplete?: (result: RenderResult) => void
  onRenderCommit?: (frameKey: string) => void
  renderer?: PreviewRenderer
  resolver?: ImageResolver
  v09Renderer?: V09PreviewRenderer
  v09Resolver?: V09ResourceResolver
}

interface StagingCanvasLease {
  canvas: HTMLCanvasElement
  inUse: boolean
}

interface CachedPreviewFrame {
  canvas: HTMLCanvasElement
  result: AnyPreviewRenderResult
}

const PREVIEW_FRAME_CACHE_LIMIT = 16
const previewCatalogIds = new WeakMap<object, number>()
const previewRendererIds = new WeakMap<object, number>()
const previewResolverIds = new WeakMap<object, number>()
let nextPreviewIdentity = 1
function isLegacyResult(result: AnyPreviewRenderResult): result is RenderResult {
  return 'diagnostics' in result
}

function hasBlockingRenderDiagnostic(result: AnyPreviewRenderResult): boolean {
  return previewDiagnostics(result).some(diagnostic => diagnostic.severity === 'error')
}

function previewDiagnostics(result: AnyPreviewRenderResult): Diagnostic[] {
  if (!isLegacyResult(result)) return []
  const suppressedErrors = result.diagnosticScope?.suppressedDiagnostics
    .filter(diagnostic => diagnostic.severity === 'error') ?? []
  return [...result.diagnostics, ...suppressedErrors]
}

function objectIdentity<T extends object>(identities: WeakMap<T, number>, value: T): number {
  let identity = identities.get(value)
  if (identity === undefined) {
    identity = nextPreviewIdentity
    nextPreviewIdentity += 1
    identities.set(value, identity)
  }
  return identity
}

export function previewFrameKey(
  spec: AnyMonsterSpec,
  catalog: PreviewCatalog,
  renderer: PreviewRenderer | V09PreviewRenderer = renderMonster,
  resolver?: ImageResolver | V09ResourceResolver,
): string {
  const renderedSpec = 'slotRolls' in spec
    ? (({ slotRolls: _slotRolls, ...rest }) => rest)(spec)
    : spec
  const catalogVersion = 'version' in catalog ? catalog.version : catalog.releaseManifest.versionTuple.catalogVersion
  return JSON.stringify({
    spec: renderedSpec,
    catalog: `${catalogVersion}:${objectIdentity(previewCatalogIds, catalog)}`,
    renderer: objectIdentity(previewRendererIds, renderer),
    resolver: resolver === undefined ? 0 : objectIdentity(previewResolverIds, resolver),
  })
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

function versionTupleMismatch(): Diagnostic[] {
  return [{
    severity: 'error',
    code: 'VERSION_TUPLE_MISMATCH',
    path: [],
    message: 'The preview spec and catalog do not share one exact supported version tuple.',
  }]
}

function v09Failure(error: unknown): Diagnostic[] {
  if (error instanceof V09RenderError) {
    return [{ severity: 'error', code: error.code, path: [], message: error.message }]
  }
  return previewFailure()
}

const fixedV09PreviewRenderer: V09PreviewRenderer = async (context, spec, catalog, resolver) => (
  renderMonsterV09(context, resolveV09Composite(spec, catalog), resolver)
)

export const PreviewCanvas = forwardRef<HTMLCanvasElement, PreviewCanvasProps>(function PreviewCanvas({
  spec,
  catalog,
  onDiagnosticsChange,
  onRenderComplete,
  onRenderCommit,
  renderer = renderMonster,
  resolver,
  v09Renderer = fixedV09PreviewRenderer,
  v09Resolver,
}: PreviewCanvasProps, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestId = useRef(0)
  const stagingPool = useRef<StagingCanvasLease[]>([])
  const frameCache = useRef(new Map<string, CachedPreviewFrame>())
  const cacheOwner = useRef({ catalog, renderer, resolver, v09Renderer, v09Resolver })
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
    if (
      cacheOwner.current.catalog !== catalog
      || cacheOwner.current.renderer !== renderer
      || cacheOwner.current.resolver !== resolver
      || cacheOwner.current.v09Renderer !== v09Renderer
      || cacheOwner.current.v09Resolver !== v09Resolver
    ) {
      frameCache.current.clear()
      cacheOwner.current = { catalog, renderer, resolver, v09Renderer, v09Resolver }
    }
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
    const isV09Catalog = 'releaseManifestSha256' in catalog
    const renderSize = isV09Catalog ? 2048 : 1024
    staging.width = renderSize
    staging.height = renderSize
    const stagingContext = staging.getContext('2d')

    if (targetContext === null || stagingContext === null) {
      lease.inUse = false
      onDiagnosticsChange(canvasUnavailable())
      return undefined
    }
    stagingContext.clearRect(0, 0, renderSize, renderSize)

    let v09Spec: MonsterSpecV09 | undefined
    let legacySpec: MonsterSpec | undefined
    if (isV09Catalog) {
      const parsed = parseMonsterSpecV09(spec)
      if (!parsed.ok) {
        lease.inUse = false
        onDiagnosticsChange(parsed.diagnostics)
        return undefined
      }
      if (v09Resolver === undefined) {
        lease.inUse = false
        onDiagnosticsChange([{
          severity: 'error', code: 'V09_RESOURCE_RESOLVER_MISSING', path: [],
          message: 'The active v0.9 release has no trusted browser resource resolver.',
        }])
        return undefined
      }
      v09Spec = parsed.value
    } else {
      const parsedV09 = parseMonsterSpecV09(spec)
      const parsedLegacy = parseMonsterSpec(spec)
      if (parsedV09.ok || !parsedLegacy.ok) {
        lease.inUse = false
        onDiagnosticsChange(versionTupleMismatch())
        return undefined
      }
      let expectedRendererVersion: MonsterSpec['rendererVersion']
      try {
        expectedRendererVersion = rendererVersionForCatalog(catalog)
      } catch {
        lease.inUse = false
        onDiagnosticsChange(versionTupleMismatch())
        return undefined
      }
      if (parsedLegacy.value.catalogVersion !== catalog.version
        || parsedLegacy.value.rendererVersion !== expectedRendererVersion) {
        lease.inUse = false
        onDiagnosticsChange(versionTupleMismatch())
        return undefined
      }
      legacySpec = parsedLegacy.value
    }

    const commit = (source: CanvasImageSource, result: AnyPreviewRenderResult): void => {
      if (requestId.current !== currentRequest) return
      targetContext.clearRect(0, 0, 1024, 1024)
      if (isV09Catalog) targetContext.drawImage(source, 0, 0, 1024, 1024)
      else targetContext.drawImage(source, 0, 0)
      void primeCanvasExport(target, 'image/png').catch(() => undefined)
      target.dataset.resolverCacheSize = String(isV09Catalog ? 0 : browserImageCache.size())
      performance.mark('qmonster-preview-commit')
      onDiagnosticsChange(previewDiagnostics(result))
      onRenderCommit?.(cacheKey)
      if (isLegacyResult(result)) onRenderComplete?.(result)
    }
    const selectedRenderer = isV09Catalog ? v09Renderer : renderer
    const selectedResolver = isV09Catalog ? v09Resolver : resolver
    const cacheKey = previewFrameKey(spec, catalog, selectedRenderer, selectedResolver)
    const cached = frameCache.current.get(cacheKey)
    if (cached !== undefined) {
      frameCache.current.delete(cacheKey)
      frameCache.current.set(cacheKey, cached)
      commit(cached.canvas, cached.result)
      lease.inUse = false
      return () => {
        if (requestId.current === currentRequest) requestId.current += 1
      }
    }

    const pendingRender: Promise<AnyPreviewRenderResult> = isV09Catalog
      ? v09Renderer(stagingContext, v09Spec!, catalog, v09Resolver!)
      : renderer(
          stagingContext,
          legacySpec!,
          catalog,
          resolver ?? browserImageCache.forCatalog(catalog.version),
          { width: 1024, height: 1024, includeGroundShadow: true },
        )
    void pendingRender.then(result => {
      if (requestId.current !== currentRequest) return
      if (hasBlockingRenderDiagnostic(result)) {
        targetContext.clearRect(0, 0, 1024, 1024)
        onDiagnosticsChange(previewDiagnostics(result))
        return
      }
      const snapshot = target.ownerDocument.createElement('canvas')
      snapshot.width = 1024
      snapshot.height = 1024
      const snapshotContext = snapshot.getContext('2d')
      if (snapshotContext !== null) {
        if (isV09Catalog) snapshotContext.drawImage(staging, 0, 0, 1024, 1024)
        else snapshotContext.drawImage(staging, 0, 0)
        frameCache.current.set(cacheKey, { canvas: snapshot, result })
        while (frameCache.current.size > PREVIEW_FRAME_CACHE_LIMIT) {
          const oldestKey = frameCache.current.keys().next().value as string | undefined
          if (oldestKey === undefined) break
          frameCache.current.delete(oldestKey)
        }
      }
      commit(staging, result)
    }).catch(error => {
      if (requestId.current !== currentRequest) return
      targetContext.clearRect(0, 0, 1024, 1024)
      onDiagnosticsChange(v09Failure(error))
    }).finally(() => {
      lease.inUse = false
    })

    return () => {
      if (requestId.current === currentRequest) requestId.current += 1
    }
  }, [catalog, onDiagnosticsChange, onRenderCommit, onRenderComplete, renderer, resolver, spec, v09Renderer, v09Resolver])

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
