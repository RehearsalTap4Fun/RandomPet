import {
  generateMonsterV09,
  type ResolvedV09Catalog,
  type V09GenerationRequest,
} from '@qmonster/generator-core'
import {
  renderMonsterV09,
  resolveV09Composite,
  type V09DecodedPng,
  type V09ResourceResolver,
} from '@qmonster/renderer-canvas'

interface V09BrowserFixtureResult {
  spec: ReturnType<typeof generateMonsterV09>['spec']
  trace: Awaited<ReturnType<typeof renderMonsterV09>>['trace']
  pixelSha256: string
  resourceIds: string[]
  drawCalls: number
  identityTransforms: boolean
}

declare global {
  interface Window {
    renderV09CandidateFixture(request: V09GenerationRequest, catalog: ResolvedV09Catalog): Promise<V09BrowserFixtureResult>
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value !== 'object') throw new Error(`Canonical JSON contains unsupported ${typeof value}.`)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function resourceUrl(sha256: string, representation?: 'rgba8'): string {
  return `/__v09_candidate_resource__/${sha256}${representation === undefined ? '' : `?representation=${representation}`}`
}

function projectAgainst(canvas: HTMLCanvasElement, color: 'black' | 'white'): Uint8ClampedArray {
  const projection = new OffscreenCanvas(2048, 2048)
  const context = projection.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (context === null) throw new Error('V0.9 parity projection context is unavailable.')
  context.fillStyle = color
  context.fillRect(0, 0, 2048, 2048)
  context.drawImage(canvas, 0, 0)
  return context.getImageData(0, 0, 2048, 2048).data
}

function makeResolver(resourceIds: Set<string>): V09ResourceResolver {
  const pngCache = new Map<string, Promise<V09DecodedPng>>()
  return {
    resolvePng(ref) {
      let pending = pngCache.get(ref.resourceId)
      if (pending !== undefined) return pending
      pending = (async () => {
        resourceIds.add(ref.resourceId)
        const response = await fetch(resourceUrl(ref.sha256, 'rgba8'))
        if (!response.ok) throw new Error(`Candidate PNG request failed: ${response.status}`)
        const pixels = new Uint8Array(await response.arrayBuffer())
        if (pixels.byteLength !== 2048 * 2048 * 4) throw new Error('Candidate PNG has the wrong decoded dimensions.')
        const scratch = new OffscreenCanvas(2048, 2048)
        const context = scratch.getContext('2d', { colorSpace: 'srgb' })
        if (context === null) throw new Error('Candidate PNG decode context is unavailable.')
        const prefix = new TextEncoder().encode('2048x2048:rgba8:')
        const identity = new Uint8Array(prefix.length + pixels.length)
        identity.set(prefix)
        identity.set(pixels, prefix.length)
        if (await sha256(identity) !== ref.sha256) throw new Error(`Candidate PNG digest mismatch: ${ref.resourceId}`)
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 2048, 2048, { colorSpace: 'srgb' }), 0, 0)
        return { sha256: ref.sha256, width: 2048, height: 2048, pixels, drawable: scratch }
      })()
      pngCache.set(ref.resourceId, pending)
      return pending
    },
    async resolveJson(ref) {
      resourceIds.add(ref.resourceId)
      const response = await fetch(resourceUrl(ref.sha256))
      if (!response.ok) throw new Error(`Candidate JSON request failed: ${response.status}`)
      const value = await response.json() as unknown
      const digest = await sha256(new TextEncoder().encode(canonicalize(value)))
      if (digest !== ref.sha256) throw new Error(`Candidate JSON digest mismatch: ${ref.resourceId}`)
      return { sha256: digest, value }
    },
    async createDrawable(pixels, width, height) {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d', { colorSpace: 'srgb' })
      if (context === null) throw new Error('Generated drawable context is unavailable.')
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height, { colorSpace: 'srgb' }), 0, 0)
      return canvas
    },
  }
}

window.renderV09CandidateFixture = async (request, catalog) => {
  const generated = generateMonsterV09(request, catalog)
  if (generated.blocked) throw new Error(`V0.9 generation blocked: ${JSON.stringify(generated.diagnostics)}`)
  const composite = resolveV09Composite(generated.spec, catalog)
  const canvas = document.querySelector<HTMLCanvasElement>('#v09-render-target')
  if (canvas === null) throw new Error('Missing v0.9 render canvas.')
  canvas.width = 2048
  canvas.height = 2048
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (context === null) throw new Error('V0.9 render context is unavailable.')
  context.clearRect(0, 0, 2048, 2048)
  const transforms: number[][] = []
  let drawCalls = 0
  const setTransform = context.setTransform.bind(context)
  const drawImage = context.drawImage.bind(context)
  context.setTransform = ((...args: number[]) => {
    transforms.push(args)
    setTransform(...args as [number, number, number, number, number, number])
  }) as typeof context.setTransform
  context.drawImage = ((source: CanvasImageSource, ...args: number[]) => {
    drawCalls += 1
    if (args.length !== 2 || args[0] !== 0 || args[1] !== 0) throw new Error('V0.9 fixture observed a non-identity draw.')
    drawImage(source, 0, 0)
  }) as typeof context.drawImage
  const resourceIds = new Set<string>()
  const rendered = await renderMonsterV09(context, composite, makeResolver(resourceIds))
  const black = projectAgainst(canvas, 'black')
  const white = projectAgainst(canvas, 'white')
  const parityPixels = new Uint8Array(black.length + white.length)
  parityPixels.set(black)
  parityPixels.set(white, black.length)
  return {
    spec: generated.spec,
    trace: rendered.trace,
    pixelSha256: await sha256(parityPixels),
    resourceIds: [...resourceIds].sort(),
    drawCalls,
    identityTransforms: transforms.length === drawCalls && transforms.every(values => values.join(',') === '1,0,0,1,0,0'),
  }
}

document.body.dataset.rendererReady = 'true'
