import { forwardRef, useCallback, useEffect, useRef } from 'react'
import {
  parseMonsterSpec,
  parseMonsterSpecV09,
  rendererVersionForCatalog,
  type Catalog,
  type Diagnostic,
  type JsonResourceRef,
  type MonsterSpec,
  type MonsterSpecV09,
  type PngResourceRef,
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
import {
  browserCanonicalJsonSha256,
  bundledV09ResourceBytes,
  bundledV09ResourceUrl,
  ProductionReleaseError,
} from '../v09-production-release.js'

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
  return bundledV09ResourceUrl(sha256)
}

interface ProductionV09ResolverOptions {
  loadResourceBytes?: (resourceId: string) => Promise<Uint8Array>
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const PNG_ROW_BYTES = 2048 * 4

function pngFailure(message: string, cause?: unknown): never {
  throw new V09RenderError('RESOURCE_HASH_MISMATCH', message, cause === undefined ? undefined : { cause })
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0)
}

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
      crcTable[index] = value >>> 0
    }
  }
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left), aboveDistance = Math.abs(prediction - above), upperDistance = Math.abs(prediction - upperLeft)
  return leftDistance <= aboveDistance && leftDistance <= upperDistance ? left : aboveDistance <= upperDistance ? above : upperLeft
}

async function decodeVerifiedPng(bytes: Uint8Array, expectedSha256: string): Promise<Uint8Array> {
  try {
    if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return pngFailure('PNG signature is invalid.')
    let offset: number = PNG_SIGNATURE.length
    let sawHeader = false, sawEnd = false
    const compressedParts: Uint8Array[] = []
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) return pngFailure('PNG chunk is truncated.')
      const length = readUint32(bytes, offset), end = offset + 12 + length
      if (end > bytes.length) return pngFailure('PNG chunk length exceeds the resource.')
      const typeBytes = bytes.subarray(offset + 4, offset + 8), type = String.fromCharCode(...typeBytes)
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      const crcInput = new Uint8Array(4 + length); crcInput.set(typeBytes); crcInput.set(data, 4)
      if (crc32(crcInput) !== readUint32(bytes, offset + 8 + length)) return pngFailure('PNG chunk CRC is invalid.')
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13 || readUint32(data, 0) !== 2048 || readUint32(data, 4) !== 2048
          || data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return pngFailure('PNG must be non-interlaced 2048x2048 straight RGBA8.')
        sawHeader = true
      } else if (type === 'IDAT') compressedParts.push(data)
      else if (type === 'IEND') { if (length !== 0 || end !== bytes.length) return pngFailure('PNG end chunk is invalid.'); sawEnd = true }
      else if (['iCCP', 'sRGB', 'gAMA', 'cHRM', 'PLTE', 'tRNS', 'acTL', 'fcTL', 'fdAT'].includes(type) || (type.charCodeAt(0) & 32) === 0) return pngFailure(`PNG chunk ${type} is not allowed by the v0.9 profile-free RGBA8 contract.`)
      offset = end
      if (sawEnd) break
    }
    if (!sawHeader || !sawEnd || compressedParts.length === 0) return pngFailure('PNG structure is incomplete.')
    const compressedLength = compressedParts.reduce((sum, part) => sum + part.length, 0), compressed = new Uint8Array(compressedLength)
    let compressedOffset = 0; for (const part of compressedParts) { compressed.set(part, compressedOffset); compressedOffset += part.length }
    const body = new Response(compressed).body
    if (body === null) return pngFailure('Browser could not stream the PNG payload.')
    const stream = body.pipeThrough(new DecompressionStream('deflate'))
    const filtered = new Uint8Array(await new Response(stream).arrayBuffer())
    if (filtered.length !== (PNG_ROW_BYTES + 1) * 2048) return pngFailure('PNG inflated size is invalid.')
    const pixels = new Uint8Array(PNG_ROW_BYTES * 2048)
    for (let row = 0; row < 2048; row += 1) {
      const filter = filtered[row * (PNG_ROW_BYTES + 1)]!, source = row * (PNG_ROW_BYTES + 1) + 1, target = row * PNG_ROW_BYTES
      if (filter > 4) return pngFailure('PNG row filter is invalid.')
      for (let column = 0; column < PNG_ROW_BYTES; column += 1) {
        const raw = filtered[source + column]!, left = column >= 4 ? pixels[target + column - 4]! : 0, above = row > 0 ? pixels[target + column - PNG_ROW_BYTES]! : 0, upperLeft = row > 0 && column >= 4 ? pixels[target + column - PNG_ROW_BYTES - 4]! : 0
        pixels[target + column] = filter === 0 ? raw : filter === 1 ? raw + left : filter === 2 ? raw + above : filter === 3 ? raw + Math.floor((left + above) / 2) : raw + paeth(left, above, upperLeft)
      }
    }
    const prefix = new TextEncoder().encode('2048x2048:rgba8:'), identity = new Uint8Array(prefix.length + pixels.length); identity.set(prefix); identity.set(pixels, prefix.length)
    const digest = await crypto.subtle.digest('SHA-256', identity)
    const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== expectedSha256) return pngFailure('Decoded PNG digest does not match its resource ID.')
    return pixels
  } catch (error) {
    if (error instanceof V09RenderError) throw error
    return pngFailure('PNG resource could not be decoded and verified.', error)
  }
}

async function createExactDrawable(pixels: Uint8Array, width: 2048, height: 2048): Promise<CanvasImageSource> {
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height, { colorSpace: 'srgb' })
  if (typeof createImageBitmap === 'function') return createImageBitmap(imageData)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (context === null) throw new V09RenderError('RESOURCE_MATERIALIZATION_FAILED', 'Browser could not allocate a v0.9 drawable.')
  context.putImageData(imageData, 0, 0); return canvas
}

export function createProductionV09ResourceResolver(options: ProductionV09ResolverOptions = {}): V09ResourceResolver {
  const loadBytes = options.loadResourceBytes ?? (resourceId => bundledV09ResourceBytes(resourceId.slice('sha256:'.length)))
  const pngCache = new Map<string, Promise<{ pixels: Uint8Array; drawable: CanvasImageSource }>>()
  const jsonCache = new Map<string, Promise<{ sha256: string; value: unknown }>>()
  const validateIdentity = (ref: PngResourceRef | JsonResourceRef): void => {
    if (ref.resourceId !== `sha256:${ref.sha256}` || !V09_HASH.test(ref.sha256)) throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'Resource ID and digest do not agree.')
  }
  return {
    async resolvePng(ref) {
      validateIdentity(ref)
      let pending = pngCache.get(ref.resourceId)
      if (pending === undefined) {
        pending = (async () => { const pixels = await decodeVerifiedPng(await loadBytes(ref.resourceId), ref.sha256); return { pixels, drawable: await createExactDrawable(pixels, 2048, 2048) } })().catch(error => { pngCache.delete(ref.resourceId); if (error instanceof V09RenderError) throw error; throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'PNG resource verification failed.', { cause: error }) })
        pngCache.set(ref.resourceId, pending)
      }
      const verified = await pending
      return { sha256: ref.sha256, width: 2048, height: 2048, pixels: verified.pixels.slice(), drawable: verified.drawable }
    },
    async resolveJson(ref) {
      validateIdentity(ref)
      let pending = jsonCache.get(ref.resourceId)
      if (pending === undefined) {
        pending = (async () => {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await loadBytes(ref.resourceId)); const value = JSON.parse(text) as unknown
          const sha256 = await browserCanonicalJsonSha256(value); if (sha256 !== ref.sha256) throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'Canonical JSON digest mismatch.')
          return { sha256, value }
        })().catch(error => { jsonCache.delete(ref.resourceId); if (error instanceof V09RenderError) throw error; throw new V09RenderError('RESOURCE_HASH_MISMATCH', 'JSON resource verification failed.', { cause: error }) })
        jsonCache.set(ref.resourceId, pending)
      }
      const verified = await pending; return { sha256: verified.sha256, value: structuredClone(verified.value) }
    },
    createDrawable: createExactDrawable,
  }
}

const productionV09ResourceResolver = createProductionV09ResourceResolver()

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
  v09Resolver = productionV09ResourceResolver,
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
